// A workspace's invites: inviting an email with a role and brands (resending its pending invite, or
// replacing an expired one), the pending ones, resending, revoking, and accepting one that its provider
// says the person accepted.
// An invite is being sent while it has no provider id yet, and pending once sent while it is neither
// accepted nor revoked and its `expires_at` is ahead of `now`. The provider is never called inside a
// transaction: a short transaction checks and reserves, the provider is called, then the row is written.
import { and, asc, eq, gt, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm'

import { type Db, invites, memberships, newId, type Tx, users, workspaces } from '@dazbee/db'
import type { CreateInvite, Invite, InviteRole, MemberBrands } from '@dazbee/schema'

import { checkLimit, writeLimit } from './brand-limits.ts'
import { inviteExpiry, type InvitesProvider, type ProviderInvite } from './invites-provider.ts'

/** A pending invite of the person's email, with its workspace's WorkOS organization, for accepting. */
export interface WaitingInvite {
  id: string
  workspaceId: string
  organizationId: string | null
  providerInviteId: string
}

/** Who invites: the workspace, its WorkOS organization, and the inviter's id here and with WorkOS. */
export interface Inviter {
  workspaceId: string
  organizationId: string | null
  userId: string
  workosUserId: string
}

/** What revoking did: revoked it, or found the person had already accepted it with its provider. */
export type Revoked = 'revoked' | 'accepted'

/** A refusal of an invite, answered 400 with its message. */
export class InvalidInvite extends Error {}

/** An invite that changed, or is being sent, while asked to change; answered 409 with its message. */
export class InviteConflict extends Error {}

// Read only from sent invites, which have their provider's id and link.
const sentLink = sql<string>`${invites.link}`
const sentProviderId = sql<string>`${invites.providerInviteId}`

const inviteSummary = {
  id: invites.id,
  email: invites.email,
  role: invites.role,
  brandIds: invites.brandIds,
  expiresAt: invites.expiresAt,
  link: sentLink,
}

const providerRef = { id: invites.id, providerInviteId: sentProviderId }

/** Neither accepted nor revoked: being sent, pending, or expired when its `expires_at` has passed. */
const open = () => and(isNull(invites.acceptedAt), isNull(invites.revokedAt))

/** Sent: it has its provider's id, so it is no longer being sent. */
const sent = () => isNotNull(invites.providerInviteId)

/** Pending at `now`. */
const pending = (now: Date) => and(open(), sent(), gt(invites.expiresAt, now))

/** The link and expiry a provider gave an invite it sent. */
const sentFields = (invitation: ProviderInvite) => ({ link: invitation.link, expiresAt: invitation.expiresAt })

/** How long a row may be being sent before another invite of its email takes its place. */
const SENDING_MS = 60_000

/**
 * Invites `email` to the inviter's workspace with `role` and `brandIds`: refused for a member or for brands
 * that can't limit the role, a resend of its pending invite with the role and brands changed, or a new
 * invite, any expired one revoked first. A new invite is reserved first, under a lock on the workspace and
 * email, as a row being sent; the provider is called after that transaction, and the row is filled in, or
 * deleted when sending fails. So two invites of one email never send twice: the second finds the first being
 * sent, or pending.
 */
export async function inviteMember(
  db: Db,
  provider: InvitesProvider,
  inviter: Inviter,
  { email, role, brandIds }: CreateInvite,
  now = new Date(),
): Promise<Invite> {
  const { workspaceId } = inviter
  await checkLimit(db, workspaceId, role, brandIds)
  if (await isMember(db, workspaceId, email)) throw new InvalidInvite(`${email} is already a member`)
  const ofEmail = and(eq(invites.workspaceId, workspaceId), eq(invites.email, email))
  const [expired, [waiting]] = await Promise.all([
    db
      .select(providerRef)
      .from(invites)
      .where(and(ofEmail, open(), sent(), lte(invites.expiresAt, now))),
    db
      .select(providerRef)
      .from(invites)
      .where(and(ofEmail, pending(now))),
  ])
  // Revoked whatever the provider says, an accepted one included: our `expires_at` decides.
  for (const old of expired) await revokeWithProvider(provider, old.providerInviteId)
  const expiredIds = expired.map((old) => old.id)

  if (waiting) {
    const resent = await resendPending(db, provider, waiting, now, { change: { role, brandIds }, revoke: expiredIds })
    if (!resent) throw new InviteConflict('This invite changed; try again')
    return resent
  }

  const id = newId()
  await db.transaction(async (tx) => {
    await lockEmail(tx, workspaceId, email)
    if (await isMember(tx, workspaceId, email)) throw new InvalidInvite(`${email} is already a member`)
    await markRevoked(tx, expiredIds, now)
    const [other] = await tx
      .select({ id: invites.id, providerInviteId: invites.providerInviteId, createdAt: invites.createdAt })
      .from(invites)
      .where(and(ofEmail, open(), gt(invites.expiresAt, now)))
    if (other?.providerInviteId) throw new InviteConflict('This invite changed; try again')
    if (other && other.createdAt.getTime() > now.getTime() - SENDING_MS)
      throw new InviteConflict(`An invite to ${email} is being sent; try again in a moment`)
    // One left being sent past its time never finished, so it holds no invitation we know of.
    if (other) await tx.delete(invites).where(eq(invites.id, other.id))
    await tx.insert(invites).values({
      id,
      workspaceId,
      email,
      role,
      brandIds,
      invitedBy: inviter.userId,
      expiresAt: inviteExpiry(now.getTime()),
      createdAt: now,
    })
  })

  let invitation: ProviderInvite
  try {
    invitation = await provider.invite(email, inviter.organizationId, inviter.workosUserId)
  } catch (e) {
    await deleteQuietly(db, id)
    throw e
  }
  try {
    const [row] = await db
      .update(invites)
      .set({ providerInviteId: invitation.id, ...sentFields(invitation) })
      .where(eq(invites.id, id))
      .returning(inviteSummary)
    if (!row) throw new Error('The invite was not recorded')
    return invite(row)
  } catch (e) {
    await revokeQuietly(provider, invitation.id)
    await deleteQuietly(db, id)
    throw e
  }
}

/** The member as they invite: their workspace's WorkOS organization, and their ids here and with WorkOS. */
export async function findInviter(db: Db, workspaceId: string, userId: string): Promise<Inviter | null> {
  const [row] = await db
    .select({ organizationId: workspaces.workosOrganizationId, workosUserId: users.workosUserId })
    .from(workspaces)
    .innerJoin(users, eq(users.id, userId))
    .where(eq(workspaces.id, workspaceId))
  return row ? { workspaceId, userId, ...row } : null
}

/** The workspace's pending invites, oldest first. */
export async function listInvites(db: Db, workspaceId: string, now = new Date()): Promise<Invite[]> {
  const rows = await db
    .select(inviteSummary)
    .from(invites)
    .where(and(eq(invites.workspaceId, workspaceId), pending(now)))
    .orderBy(asc(invites.createdAt), asc(invites.id))
  return rows.map(invite)
}

/** Sends the workspace's pending invite again; null when it has no such pending invite, or it stops being one. */
export async function resendInvite(
  db: Db,
  provider: InvitesProvider,
  workspaceId: string,
  inviteId: string,
  now = new Date(),
): Promise<Invite | null> {
  const waiting = await findPending(db, workspaceId, inviteId, now)
  return waiting && resendPending(db, provider, waiting, now)
}

/**
 * Revokes the workspace's pending invite. Null when it has no such pending invite; `accepted` when the
 * person already accepted it with its provider, which can't be undone, so it stays for their sign-in.
 */
export async function revokeInvite(
  db: Db,
  provider: InvitesProvider,
  workspaceId: string,
  inviteId: string,
  now = new Date(),
): Promise<Revoked | null> {
  const waiting = await findPending(db, workspaceId, inviteId, now)
  if (!waiting) return null
  if ((await revokeWithProvider(provider, waiting.providerInviteId)) === 'accepted') return 'accepted'
  const [row] = await db
    .update(invites)
    .set({ revokedAt: now })
    .where(and(eq(invites.id, waiting.id), pending(now)))
    .returning({ id: invites.id })
  return row ? 'revoked' : null
}

/** The pending invites of an email in every workspace, oldest first. */
export async function waitingInvites(db: Db | Tx, email: string, now = new Date()): Promise<WaitingInvite[]> {
  return db
    .select({
      id: invites.id,
      workspaceId: invites.workspaceId,
      organizationId: workspaces.workosOrganizationId,
      providerInviteId: sentProviderId,
    })
    .from(invites)
    .innerJoin(workspaces, eq(workspaces.id, invites.workspaceId))
    .where(and(eq(invites.email, email.toLowerCase()), pending(now)))
    .orderBy(asc(invites.createdAt), asc(invites.id))
}

/**
 * Accepts a pending invite for the person: makes their membership with its role and brands and marks it
 * accepted, in one transaction. False when it is no longer pending.
 */
export async function acceptInvite(db: Db | Tx, inviteId: string, userId: string, now = new Date()): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [accepted] = await tx
      .update(invites)
      .set({ acceptedAt: now })
      .where(and(eq(invites.id, inviteId), pending(now)))
      .returning({ workspaceId: invites.workspaceId, role: invites.role, brandIds: invites.brandIds })
    if (!accepted) return false
    const [joined] = await tx
      .insert(memberships)
      .values({ workspaceId: accepted.workspaceId, userId, role: accepted.role })
      .onConflictDoNothing()
      .returning({ userId: memberships.userId })
    if (joined && accepted.brandIds) await writeLimit(tx, accepted.workspaceId, userId, accepted.brandIds)
    return true
  })
}

/**
 * Revokes the invite with its provider, answering the state it is left in; a provider that refuses one
 * no longer pending, as WorkOS does, is asked for its state instead.
 */
export async function revokeWithProvider(provider: InvitesProvider, id: string): Promise<ProviderInvite['state']> {
  try {
    return (await provider.revoke(id)).state
  } catch (e) {
    const { state } = await provider.read(id)
    if (state === 'pending') throw e
    return state
  }
}

async function isMember(db: Db | Tx, workspaceId: string, email: string): Promise<boolean> {
  const [member] = await db
    .select({ userId: memberships.userId })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.workspaceId, workspaceId), eq(sql`lower(${users.email})`, email)))
    .limit(1)
  return Boolean(member)
}

/**
 * Sends a pending invite again, then writes its new link and expiry, with the new role and brands when
 * given, in a transaction that also marks the given invites revoked. Null when it stopped being pending meanwhile,
 * revoked or accepted, whether the provider then refused to resend it or not.
 */
async function resendPending(
  db: Db,
  provider: InvitesProvider,
  waiting: { id: string; providerInviteId: string },
  now: Date,
  { change = {}, revoke = [] }: { change?: { role?: InviteRole; brandIds?: MemberBrands }; revoke?: string[] } = {},
): Promise<Invite | null> {
  let invitation: ProviderInvite
  try {
    invitation = await provider.resend(waiting.providerInviteId)
  } catch (e) {
    if (await isPending(db, waiting.id, now)) throw e
    return null
  }
  return db.transaction(async (tx) => {
    await markRevoked(tx, revoke, now)
    return updatePending(tx, waiting.id, { ...change, ...sentFields(invitation) }, now)
  })
}

/** Holds a lock on the workspace and email until the transaction ends. */
async function lockEmail(tx: Tx, workspaceId: string, email: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`invite ${workspaceId} ${email}`}, 0))`)
}

/** Marks the invites revoked, those still neither accepted nor revoked. */
async function markRevoked(tx: Tx, inviteIds: string[], now: Date): Promise<void> {
  if (inviteIds.length === 0) return
  await tx
    .update(invites)
    .set({ revokedAt: now })
    .where(and(inArray(invites.id, inviteIds), open()))
}

function invite(row: {
  id: string
  email: string
  role: InviteRole
  brandIds: MemberBrands
  expiresAt: Date
  link: string
}): Invite {
  return { ...row, expiresAt: row.expiresAt.toISOString() }
}

/** Revokes an invitation the provider sent that we don't keep, logging a failure rather than answering it. */
async function revokeQuietly(provider: InvitesProvider, id: string): Promise<void> {
  try {
    await provider.revoke(id)
  } catch (e) {
    console.error(e)
  }
}

/** Deletes an invite whose sending failed, logging a failure rather than answering it. */
async function deleteQuietly(db: Db, inviteId: string): Promise<void> {
  try {
    await db.delete(invites).where(eq(invites.id, inviteId))
  } catch (e) {
    console.error(e)
  }
}

/** The workspace's pending invite, or null when there is none. */
async function findPending(db: Db, workspaceId: string, inviteId: string, now: Date) {
  const [row] = await db
    .select(providerRef)
    .from(invites)
    .where(and(eq(invites.id, inviteId), eq(invites.workspaceId, workspaceId), pending(now)))
  return row ?? null
}

async function isPending(db: Db, inviteId: string, now: Date): Promise<boolean> {
  const [row] = await db
    .select({ id: invites.id })
    .from(invites)
    .where(and(eq(invites.id, inviteId), pending(now)))
  return Boolean(row)
}

/** Changes a pending invite and answers it; null when it is no longer pending. */
async function updatePending(
  tx: Tx,
  inviteId: string,
  set: { role?: InviteRole; brandIds?: MemberBrands; link?: string; expiresAt?: Date },
  now: Date,
): Promise<Invite | null> {
  const [row] = await tx
    .update(invites)
    .set(set)
    .where(and(eq(invites.id, inviteId), pending(now)))
    .returning(inviteSummary)
  return row ? invite(row) : null
}
