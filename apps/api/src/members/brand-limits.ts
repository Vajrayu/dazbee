// A limit on the brands an Editor or Reviewer may see: checking one a route is given, writing it with
// the membership, and the members' brands as a limited member sees them.
import { and, eq, inArray, sql } from 'drizzle-orm'

import { brands, type Db, membershipBrands, memberships, type Tx } from '@dazbee/db'
import { type MemberBrands, type MemberRole, roleLimitable, type WorkspaceMember } from '@dazbee/schema'

/** A limit that can't be given, answered 400 with its message. */
export class InvalidLimit extends Error {}

/**
 * Refuses, with `InvalidLimit`, brands that can't limit a member with `role` in the workspace: a list for
 * anyone but an Editor or Reviewer, an empty one, or one naming a brand that isn't the workspace's. Null,
 * for every brand, can limit anyone.
 */
export async function checkLimit(db: Db | Tx, workspaceId: string, role: MemberRole, brandIds: MemberBrands) {
  if (brandIds === null) return
  if (!roleLimitable(role)) throw new InvalidLimit('Only an Editor or Reviewer can be limited to some brands')
  const found =
    brandIds.length === 0
      ? []
      : await db
          .select({ id: brands.id })
          .from(brands)
          .where(and(eq(brands.workspaceId, workspaceId), inArray(brands.id, brandIds)))
  if (brandIds.length === 0 || found.length !== new Set(brandIds).size)
    throw new InvalidLimit('Limit a member to brands of this workspace')
}

/**
 * Sets the brands the member may see: limited to those of `brandIds` that are still the workspace's, or
 * to every brand for null; and their `role` when given, in the same write, since the table refuses a limit
 * on any role but Editor or Reviewer. Run it in the transaction that changes the membership.
 */
export async function writeLimit(
  tx: Tx,
  workspaceId: string,
  userId: string,
  brandIds: MemberBrands,
  role?: MemberRole,
) {
  const ofMember = and(eq(membershipBrands.workspaceId, workspaceId), eq(membershipBrands.userId, userId))
  await tx
    .update(memberships)
    .set({ limited: brandIds !== null, ...(role && { role }) })
    .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, userId)))
  await tx.delete(membershipBrands).where(ofMember)
  if (!brandIds?.length) return
  await tx.insert(membershipBrands).select(
    tx
      .select({ workspaceId: brands.workspaceId, userId: sql<string>`${userId}`.as('user_id'), brandId: brands.id })
      .from(brands)
      .where(and(eq(brands.workspaceId, workspaceId), inArray(brands.id, brandIds))),
  )
}

/**
 * The members as a viewer who may see `viewerBrands` sees them: a limited viewer sees of each member's
 * brands only their own, so a client's Reviewer never learns another client's brands.
 */
export function seenBy(viewerBrands: MemberBrands, members: WorkspaceMember[]): WorkspaceMember[] {
  if (!viewerBrands) return members
  return members.map((member) => ({
    ...member,
    brandIds: member.brandIds && member.brandIds.filter((id) => viewerBrands.includes(id)),
  }))
}
