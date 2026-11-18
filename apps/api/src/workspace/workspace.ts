// The workspace, its members and their roles, and its brands, always read and written within one
// workspace, and which of a person's workspaces to open: the one they used last.
import { and, asc, eq, sql } from 'drizzle-orm'

import { brands, type Db, memberships, newId, users, workspaces } from '@dazbee/db'
import {
  type BrandSummary,
  MEMBER_ROLES,
  type MemberRole,
  type UpdateWorkspace,
  type WorkspaceMember,
  type WorkspaceSummary,
} from '@dazbee/schema'

const workspaceSummary = { id: workspaces.id, name: workspaces.name }

/** A membership's role as its place in MEMBER_ROLES, from Owner to Reviewer. */
const roleRank = sql`array_position(array[${sql.join(
  MEMBER_ROLES.map((role) => sql`${role}`),
  sql`, `,
)}]::text[], ${memberships.role})`

export async function findWorkspace(db: Db, workspaceId: string): Promise<WorkspaceSummary | null> {
  const [row] = await db.select(workspaceSummary).from(workspaces).where(eq(workspaces.id, workspaceId))
  return row ?? null
}

/** The person's role in the workspace, or null when they are not a member of it. */
export async function findRole(db: Db, workspaceId: string, userId: string): Promise<MemberRole | null> {
  const [row] = await db
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, userId)))
  return row?.role ?? null
}

/** Every member of the workspace, by role from Owner to Reviewer, then in the order they joined. */
export async function listMembers(db: Db, workspaceId: string): Promise<WorkspaceMember[]> {
  return db
    .select({ id: users.id, name: users.name, email: users.email, role: memberships.role })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.workspaceId, workspaceId))
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

export async function listBrands(db: Db, workspaceId: string): Promise<BrandSummary[]> {
  return db
    .select({ id: brands.id, name: brands.name })
    .from(brands)
    .where(eq(brands.workspaceId, workspaceId))
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
