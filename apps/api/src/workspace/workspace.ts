// The workspace, its members with their roles and the brands each may see, and its brands, always read
// and written within one workspace, and which of a person's workspaces to open: the one they used last.
import { and, asc, eq, inArray, sql } from 'drizzle-orm'

import { brands, type Db, memberships, newId, type Tx, users, workspaces } from '@dazbee/db'
import {
  type BrandSummary,
  MEMBER_ROLES,
  type MemberBrands,
  type MemberRole,
  type UpdateWorkspace,
  type WorkspaceMember,
  type WorkspaceSummary,
} from '@dazbee/schema'

/** A person's role in a workspace, and the brands they may see there: a list, or null for every brand. */
export interface MemberAccess {
  role: MemberRole
  brandIds: MemberBrands
}

const workspaceSummary = { id: workspaces.id, name: workspaces.name }

/**
 * The brands a membership may see: a limited member's rows of `membership_brands`, empty when they have
 * none, or null for one who isn't limited, whose rows are never read.
 */
// Written with its tables named, since a query of one table names its columns bare, which in the inner
// select would mean `membership_brands`' own.
const brandIdsOf = sql<MemberBrands>`case when "memberships"."limited" then array(
  select "mb"."brand_id" from "membership_brands" "mb"
  where "mb"."workspace_id" = "memberships"."workspace_id" and "mb"."user_id" = "memberships"."user_id"
  order by "mb"."brand_id"
) end`

/** A member as the members list shows them. */
const memberColumns = {
  id: users.id,
  name: users.name,
  email: users.email,
  role: memberships.role,
  brandIds: brandIdsOf,
}

/** A membership's role as its place in MEMBER_ROLES, from Owner to Reviewer. */
const roleRank = sql`array_position(array[${sql.join(
  MEMBER_ROLES.map((role) => sql`${role}`),
  sql`, `,
)}]::text[], ${memberships.role})`

export async function findWorkspace(db: Db, workspaceId: string): Promise<WorkspaceSummary | null> {
  const [row] = await db.select(workspaceSummary).from(workspaces).where(eq(workspaces.id, workspaceId))
  return row ?? null
}

/** The person's role in the workspace and the brands they may see there, or null when they are not a member of it. */
export async function findAccess(db: Db, workspaceId: string, userId: string): Promise<MemberAccess | null> {
  const [row] = await db
    .select({ role: memberships.role, brandIds: brandIdsOf })
    .from(memberships)
    .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, userId)))
  return row ?? null
}

/**
 * Every member of the workspace with the brands each may see, by role from Owner to Reviewer, then in the
 * order they joined; only `userId`'s when given.
 */
export async function listMembers(db: Db | Tx, workspaceId: string, userId?: string): Promise<WorkspaceMember[]> {
  return db
    .select(memberColumns)
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(and(eq(memberships.workspaceId, workspaceId), userId ? eq(memberships.userId, userId) : undefined))
    .orderBy(roleRank, asc(memberships.createdAt), asc(users.id))
}

/** Notes that the person opened the workspace now, so it is the one sign-in opens next. */
export async function markWorkspaceUsed(db: Db, workspaceId: string, userId: string): Promise<void> {
  await db
    .update(memberships)
    .set({ lastUsedAt: sql`now()` })
    .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, userId)))
}

/** The workspace the person used last, else the one they joined first; null when they are a member of none. */
export async function workspaceToOpen(db: Db, userId: string): Promise<string | null> {
  const [row] = await db
    .select({ workspaceId: memberships.workspaceId })
    .from(memberships)
    .where(eq(memberships.userId, userId))
    .orderBy(sql`${memberships.lastUsedAt} desc nulls last`, asc(memberships.createdAt), asc(memberships.workspaceId))
    .limit(1)
  return row?.workspaceId ?? null
}

export async function updateWorkspace(
  db: Db,
  workspaceId: string,
  { name }: UpdateWorkspace,
): Promise<WorkspaceSummary | null> {
  const [row] = await db
    .update(workspaces)
    .set({ name })
    .where(eq(workspaces.id, workspaceId))
    .returning(workspaceSummary)
  return row ?? null
}

/** The workspace's brands, by name; only those of `brandIds` when given, a limited member's. */
export async function listBrands(db: Db, workspaceId: string, brandIds: MemberBrands = null): Promise<BrandSummary[]> {
  if (brandIds?.length === 0) return []
  return db
    .select({ id: brands.id, name: brands.name })
    .from(brands)
    .where(and(eq(brands.workspaceId, workspaceId), brandIds ? inArray(brands.id, brandIds) : undefined))
    .orderBy(asc(brands.name), asc(brands.id))
}

export async function createBrand(db: Db, workspaceId: string, name: string, website?: string): Promise<BrandSummary> {
  const [row] = await db
    .insert(brands)
    .values({ id: newId(), workspaceId, name, website: website ?? null })
    .returning({ id: brands.id, name: brands.name })
  if (!row) throw new Error('insert returned no brand')
  return row
}

export async function findBrand(db: Db, workspaceId: string, brandId: string): Promise<BrandSummary | null> {
  const [row] = await db
    .select({ id: brands.id, name: brands.name })
    .from(brands)
    .where(and(eq(brands.id, brandId), eq(brands.workspaceId, workspaceId)))
  return row ?? null
}
