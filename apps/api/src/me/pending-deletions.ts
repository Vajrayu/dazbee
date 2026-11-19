// What deleting an account leaves to delete outside the database: a deleted workspace's storage folder and
// WorkOS organization, the person's WorkOS user, and the WorkOS invitations to their email. Each waits in
// `pending_deletions` until it is done: the API deletes them as the account's deletion commits, and again
// when it starts. A failure is logged and its row kept for the next start. Each deletion can run twice, as
// two servers starting at once do: one already gone is done.
import { eq, inArray } from 'drizzle-orm'

import { type Db, newId, type PendingDeletionKind, pendingDeletions, type Tx, users } from '@dazbee/db'
import type { Storage } from '@dazbee/storage'

import type { InvitesProvider } from '../members/invites-provider.ts'
import type { SignInProvider } from '../sign-in/sign-in.ts'

/**
 * What deletes each kind: storage, and WorkOS's sign-in and invites when sign-in is set up; a kind whose
 * deleter is null waits.
 */
export interface Deleters {
  storage: Storage
  signIn: Pick<SignInProvider, 'deleteOrganization' | 'deleteUser'> | null
  invites: Pick<InvitesProvider, 'revoke'> | null
}

/** One thing to delete outside the database. */
export interface PendingDeletion {
  kind: PendingDeletionKind
  target: string
}

/** Records what to delete outside the database, in the transaction that deletes the account; their ids. */
export async function recordDeletions(tx: Tx, deletions: PendingDeletion[]): Promise<string[]> {
  if (deletions.length === 0) return []
  const rows = deletions.map((deletion) => ({ id: newId(), ...deletion }))
  await tx.insert(pendingDeletions).values(rows)
  return rows.map((row) => row.id)
}

/**
 * Deletes what the rows `ids` name, or every row when given none, one at a time, and deletes each row that is
 * done. A failure is logged and leaves its row. Answers how many rows are left of those it tried.
 */
export async function finishDeletions(db: Db, deleters: Deleters, ids?: string[]): Promise<number> {
  const rows = await db
    .select()
    .from(pendingDeletions)
    .where(ids ? inArray(pendingDeletions.id, ids) : undefined)
    .orderBy(pendingDeletions.createdAt, pendingDeletions.id)
  let left = 0
  for (const row of rows) {
    try {
      if (!(await deleteOutside(db, deleters, row))) {
        left += 1
        continue
      }
      await db.delete(pendingDeletions).where(eq(pendingDeletions.id, row.id))
    } catch (e) {
      left += 1
      console.error(`pending deletion ${row.id} (${row.kind}) failed; it is tried again on the next start`, e)
    }
  }
  return left
}

/**
 * Deletes the one thing outside the database; false when its deleter isn't set up here. A WorkOS user who
 * signed up again since is kept: their sign-in made them a person again.
 */
async function deleteOutside(db: Db, { storage, signIn, invites }: Deleters, row: PendingDeletion) {
  switch (row.kind) {
    case 'storage-folder':
      await storage.deleteFolder(row.target)
      return true
    case 'workos-organization':
      if (!signIn) return false
      await gone(signIn.deleteOrganization(row.target))
      return true
    case 'workos-user': {
      if (!signIn) return false
      const [again] = await db.select({ id: users.id }).from(users).where(eq(users.workosUserId, row.target))
      if (!again) await gone(signIn.deleteUser(row.target))
      return true
    }
    case 'workos-invitation':
      if (!invites) return false
      await gone(invites.revoke(row.target))
      return true
  }
}

/** Waits for a deletion, counting one WorkOS answers 404, already gone, as done. */
async function gone(deletion: Promise<unknown>): Promise<void> {
  try {
    await deletion
  } catch (e) {
    if ((e as { status?: unknown } | null)?.status !== 404) throw e
  }
}
