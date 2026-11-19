// Deleting a person's account. What is only theirs goes: the workspaces they own alone, with every brand,
// design, template, font and file in them, and their own records, their invites and their request to join.
// What a team shares stays: they leave the other workspaces as a member does, and what they made there stays
// with the workspace. An Owner of a workspace with other members hands over Owner first; until then deleting
// is refused and names those workspaces. The rows go in one transaction, which also records what is left
// outside the database (pending-deletions.ts); that is deleted once the transaction commits.
import { and, asc, eq, gt, inArray, isNotNull, isNull, sql } from 'drizzle-orm'

import {
  accessRequests,
  assets,
  brandKits,
  brands,
  dazbeeInvites,
  type Db,
  designs,
  fontFaces,
  invites,
  memberships,
  templates,
  type Tx,
  users,
  workspaces,
} from '@dazbee/db'
import type { AccountDeletion, WorkspaceSummary } from '@dazbee/schema'

import { type Deleters, finishDeletions, type PendingDeletion, recordDeletions } from './pending-deletions.ts'

/** A refused deletion, answered with its status, message and the workspaces to hand over first. */
export class AccountRefusal extends Error {
  readonly status: 400 | 409
  readonly handOver: WorkspaceSummary[]
  constructor(status: 400 | 409, message: string, handOver: WorkspaceSummary[] = []) {
    super(message)
    this.status = status
    this.handOver = handOver
  }
}

/** A workspace the person owns: whether anyone else is a member, and its WorkOS organization. */
interface Owned extends WorkspaceSummary {
  shared: boolean
  organizationId: string | null
}

/** What deleting the person's account would delete, and the workspaces they hand over first. */
export async function accountDeletion(db: Db, userId: string): Promise<AccountDeletion> {
  return splitOwned(await ownedWorkspaces(db, userId))
}

/**
 * Deletes the person's account once `email` is theirs and they own no workspace with other members, then
 * deletes what it left outside the database. A failure there is logged and tried again at the next start;
 * the account is deleted all the same.
 */
export async function deleteAccount(db: Db, deleters: Deleters, userId: string, email: string): Promise<void> {
  const pending = await db.transaction((tx) => deleteRows(tx, deleters, userId, email))
  await finishDeletions(db, deleters, pending)
}

/**
 * Deletes the account's rows and records what it leaves outside the database, answering those records' ids.
 * The person's row and memberships are locked first, so no invite they accept and no Owner handed to them
 * lands meanwhile, then the workspaces they own, so nobody joins one while it is counted and deleted.
 */
async function deleteRows(tx: Tx, deleters: Deleters, userId: string, email: string): Promise<string[]> {
  const [user] = await tx
    .select({ email: users.email, workosUserId: users.workosUserId })
    .from(users)
    .where(eq(users.id, userId))
    .for('update')
  if (!user) throw new AccountRefusal(400, 'There is no such account')
  if (email.trim().toLowerCase() !== user.email.toLowerCase())
    throw new AccountRefusal(400, 'Type your account’s email to delete it')
  await tx
    .select({ workspaceId: memberships.workspaceId })
    .from(memberships)
    .where(eq(memberships.userId, userId))
    .orderBy(asc(memberships.workspaceId))
    .for('update')
  const ownedIds = (await ownedWorkspaces(tx, userId)).map((workspace) => workspace.id)
  if (ownedIds.length > 0)
    await tx
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(inArray(workspaces.id, ownedIds))
      .orderBy(asc(workspaces.id))
      .for('update')
  const owned = await ownedWorkspaces(tx, userId)
  const { handOver } = splitOwned(owned)
  if (handOver.length > 0) throw new AccountRefusal(409, 'Hand over Owner first', handOver)

  const alone = owned.filter((workspace) => !workspace.shared)
  await deleteWorkspaces(
    tx,
    alone.map((workspace) => workspace.id),
  )
  const lowerEmail = user.email.toLowerCase()
  const invitations = deleters.invites ? await pendingInvitations(tx, lowerEmail) : []
  await tx.delete(invites).where(eq(invites.email, lowerEmail))
  await tx.delete(dazbeeInvites).where(eq(dazbeeInvites.email, lowerEmail))
  await tx.delete(accessRequests).where(eq(accessRequests.email, lowerEmail))
  // Their memberships elsewhere, and the brands they were limited to there, go with them; what they named
  // there, such as a version, stays with no name of who.
  await tx.delete(users).where(eq(users.id, userId))

  const outside: PendingDeletion[] = [
    ...alone.map((workspace) => ({ kind: 'storage-folder' as const, target: `workspaces/${workspace.id}/` })),
    ...(deleters.signIn
      ? [
          ...alone.flatMap((workspace) =>
            workspace.organizationId
              ? [{ kind: 'workos-organization' as const, target: workspace.organizationId }]
              : [],
          ),
          { kind: 'workos-user' as const, target: user.workosUserId },
        ]
      : []),
    ...invitations.map((id) => ({ kind: 'workos-invitation' as const, target: id })),
  ]
  return recordDeletions(tx, outside)
}

/** The workspaces the person owns, by name, each with whether anyone else is a member there. */
async function ownedWorkspaces(db: Db | Tx, userId: string): Promise<Owned[]> {
  const others = sql<boolean>`exists (select 1 from ${memberships} as others where others.workspace_id = ${workspaces.id} and others.user_id <> ${userId})`
  return db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      organizationId: workspaces.workosOrganizationId,
      shared: others,
    })
    .from(memberships)
    .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
    .where(and(eq(memberships.userId, userId), eq(memberships.role, 'owner')))
    .orderBy(asc(workspaces.name), asc(workspaces.id))
}

/** The owned workspaces split into those deleting deletes and those to hand over first. */
function splitOwned(owned: Owned[]): AccountDeletion {
  const summary = ({ id, name }: Owned) => ({ id, name })
  return {
    deletes: owned.filter((workspace) => !workspace.shared).map(summary),
    handOver: owned.filter((workspace) => workspace.shared).map(summary),
  }
}

/**
 * Deletes the workspaces with everything in them: designs with their saves, versions and journal, kits,
 * templates, assets, uploaded fonts and brands, then the workspaces with their memberships and invites.
 * The sync server closes a tab open on a deleted design, as it does when one design is deleted.
 */
async function deleteWorkspaces(tx: Tx, ids: string[]) {
  if (ids.length === 0) return
  await tx.delete(designs).where(inArray(designs.workspaceId, ids))
  await tx.delete(brandKits).where(inArray(brandKits.workspaceId, ids))
  await tx.delete(templates).where(inArray(templates.workspaceId, ids))
  await tx.delete(assets).where(inArray(assets.workspaceId, ids))
  await tx.delete(fontFaces).where(inArray(fontFaces.workspaceId, ids))
  await tx.delete(brands).where(inArray(brands.workspaceId, ids))
  await tx.delete(workspaces).where(inArray(workspaces.id, ids))
}

/**
 * The WorkOS ids of the invitations to the email still waiting to be accepted: a workspace's whose workspace
 * has a WorkOS organization, and Dazbee invites, which WorkOS sends wherever it sends a workspace's.
 */
async function pendingInvitations(tx: Tx, email: string): Promise<string[]> {
  const now = new Date()
  const workspaceInvitations = await tx
    .select({ id: invites.providerInviteId })
    .from(invites)
    .innerJoin(workspaces, eq(workspaces.id, invites.workspaceId))
    .where(
      and(
        eq(invites.email, email),
        isNotNull(workspaces.workosOrganizationId),
        isNotNull(invites.providerInviteId),
        isNull(invites.acceptedAt),
        isNull(invites.revokedAt),
        gt(invites.expiresAt, now),
      ),
    )
  const dazbeeInvitations = await tx
    .select({ id: dazbeeInvites.providerInviteId })
    .from(dazbeeInvites)
    .where(
      and(
        eq(dazbeeInvites.email, email),
        isNotNull(dazbeeInvites.providerInviteId),
        isNull(dazbeeInvites.acceptedAt),
        isNull(dazbeeInvites.revokedAt),
        gt(dazbeeInvites.expiresAt, now),
      ),
    )
  return [...workspaceInvitations, ...dazbeeInvitations].flatMap(({ id }) => (id ? [id] : []))
}
