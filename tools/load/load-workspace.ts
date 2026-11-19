// The load test's workspace: made by setup.ts with one member and one design per simulated person, each
// with a session token, and deleted by clean.ts with every row and file it gathered. Every id it makes
// starts with the workspace's id, which starts with `load-test-`, so clean-up finds the rows a design or
// person left without touching anyone else's.
import { and, eq, like, sql } from 'drizzle-orm'

import {
  assets,
  brandKits,
  brands,
  createDesignSave,
  type Db,
  designs,
  fontFaces,
  invites,
  memberships,
  newId,
  templates,
  users,
  workspaces,
} from '@dazbee/db'
import { firstSaved } from '@dazbee/doc/sync'
import { BLANK_SIZE, blankDesign, parseDesign, SCHEMA_VERSION } from '@dazbee/schema'
import { signSessionToken } from '@dazbee/session-token'
import type { Storage } from '@dazbee/storage'

/** One simulated person: their member's user, the design they open, and the session cookie's token. */
export interface LoadPerson {
  userId: string
  brandId: string
  designId: string
  /** The frame each edit moves. */
  frameId: string
  sessionToken: string
}

/** What setup.ts writes to its file and editors.ts reads. */
export interface LoadWorkspace {
  workspaceId: string
  people: LoadPerson[]
}

/** What clean-up found left of a workspace: rows by table, and files in storage. */
export interface Leftovers {
  rows: Record<string, number>
  files: number
}

/** The name the load test's workspaces have, which clean-up checks before it deletes anything. */
export const LOAD_WORKSPACE_NAME = 'Load test'

const ID_PREFIX = 'load-test-'

/** A load test workspace's id: the prefix and a new id, so no typed pattern reaches another's rows. */
const LOAD_WORKSPACE_ID = /^load-test-[0-9a-z]{12}$/

/** The brands people's designs are spread over: two, so the Brands page shows a card each. */
const BRANDS = ['Load test brand A', 'Load test brand B']

/** The tables whose rows hold the workspace's id, and the column that holds it. */
const BY_WORKSPACE = [
  'workspaces.id',
  'memberships.workspace_id',
  'membership_brands.workspace_id',
  'invites.workspace_id',
  'brands.workspace_id',
  'designs.workspace_id',
  'assets.workspace_id',
  'brand_kits.workspace_id',
  'templates.workspace_id',
  'font_faces.workspace_id',
]

/** The tables whose rows belong to a design or a person, found by their id's prefix. */
const BY_ID_PREFIX = [
  'users.id',
  'design_saves.design_id',
  'design_versions.design_id',
  'design_journal.design_id',
  'design_journal_dead.design_id',
]

/** Makes a workspace for `people` simulated people, each a member with a design of their own and a session token. */
export async function makeLoadWorkspace(db: Db, sessionSecret: string, people: number): Promise<LoadWorkspace> {
  const workspaceId = `${ID_PREFIX}${newId()}`
  const brandIds = BRANDS.map((_, i) => `${workspaceId}-brand-${i + 1}`)
  const made: LoadPerson[] = []
  await db.transaction(async (tx) => {
    await tx.insert(workspaces).values({ id: workspaceId, name: LOAD_WORKSPACE_NAME })
    await tx.insert(brands).values(BRANDS.map((name, i) => ({ id: brandIds[i] as string, workspaceId, name })))
    for (let n = 1; n <= people; n++) {
      const userId = `${workspaceId}-person-${n}`
      const designId = `${workspaceId}-design-${n}`
      const brandId = brandIds[n % brandIds.length] as string
      const name = `Load test person ${n}`
      await tx.insert(users).values({ id: userId, workosUserId: userId, email: `${userId}@example.invalid`, name })
      // The first person is the workspace's Owner, as every workspace has one; the rest are Editors.
      await tx.insert(memberships).values({ workspaceId, userId, role: n === 1 ? 'owner' : 'editor' })
      const design = parseDesign(
        blankDesign({ designId, name: `Design ${n}` }, [{ name: 'Feed square', ...BLANK_SIZE }]),
      )
      if (!design.success) throw new Error(`a blank design did not parse: ${design.errors.join('; ')}`)
      const { meta, pages, frames, nodes } = design.design
      await tx
        .insert(designs)
        .values({ id: designId, workspaceId, brandId, name: `Design ${n}`, schemaVersion: SCHEMA_VERSION })
      await createDesignSave(tx, designId, firstSaved({ meta, pages, frames, nodes }, newId()))
      const frameId = Object.keys(frames)[0] as string
      const { token } = signSessionToken(sessionSecret, { userId, workosSessionId: null })
      made.push({ userId, brandId, designId, frameId, sessionToken: token })
    }
  })
  return { workspaceId, people: made }
}

/**
 * Deletes a load test's workspace: its designs with their saves, versions and journal, its kits, templates,
 * assets, fonts and brands, the workspace with its memberships and invites, the people made for it, and its
 * folder in storage. Refuses any workspace that isn't a load test's.
 */
export async function deleteLoadWorkspace(db: Db, storage: Storage, workspaceId: string): Promise<void> {
  await checkIsLoadWorkspace(db, workspaceId)
  await db.transaction(async (tx) => {
    await tx.delete(designs).where(eq(designs.workspaceId, workspaceId))
    await tx.delete(brandKits).where(eq(brandKits.workspaceId, workspaceId))
    await tx.delete(templates).where(eq(templates.workspaceId, workspaceId))
    await tx.delete(assets).where(eq(assets.workspaceId, workspaceId))
    await tx.delete(fontFaces).where(eq(fontFaces.workspaceId, workspaceId))
    await tx.delete(invites).where(eq(invites.workspaceId, workspaceId))
    await tx.delete(brands).where(eq(brands.workspaceId, workspaceId))
    await tx.delete(workspaces).where(eq(workspaces.id, workspaceId))
    await tx.delete(users).where(like(users.id, `${workspaceId}-%`))
  })
  await storage.deleteFolder(folderOf(workspaceId))
}

/** What is left of a load test's workspace: the rows holding its id or its ids' prefix, and its files. */
export async function leftovers(db: Db, storage: Storage, workspaceId: string): Promise<Leftovers> {
  checkLoadWorkspaceId(workspaceId)
  const rows: Record<string, number> = {}
  for (const column of BY_WORKSPACE) rows[column] = await count(db, column, sql`= ${workspaceId}`)
  for (const column of BY_ID_PREFIX) rows[column] = await count(db, column, sql`like ${`${workspaceId}-%`}`)
  return { rows, files: (await storage.list(folderOf(workspaceId))).length }
}

/** The workspace's folder in storage. */
export function folderOf(workspaceId: string): string {
  return `workspaces/${workspaceId}/`
}

/** Throws unless the workspace is a load test's, by its id and its name, or is already gone. */
async function checkIsLoadWorkspace(db: Db, workspaceId: string) {
  checkLoadWorkspaceId(workspaceId)
  const [other] = await db
    .select({ name: workspaces.name })
    .from(workspaces)
    .where(and(eq(workspaces.id, workspaceId), sql`${workspaces.name} <> ${LOAD_WORKSPACE_NAME}`))
  if (other) throw new Error(`${workspaceId} is named "${other.name}", not "${LOAD_WORKSPACE_NAME}"`)
}

/** Throws unless the id is one makeLoadWorkspace gives. */
function checkLoadWorkspaceId(workspaceId: string) {
  if (!LOAD_WORKSPACE_ID.test(workspaceId)) throw new Error(`${workspaceId} is not a load test's workspace`)
}

/** How many rows of `table.column`'s table match `test`. */
async function count(db: Db, tableColumn: string, test: ReturnType<typeof sql>): Promise<number> {
  const [table, column] = tableColumn.split('.') as [string, string]
  const result = await db.execute<{ n: number }>(
    sql`select count(*)::int as n from ${sql.identifier(table)} where ${sql.identifier(column)} ${test}`,
  )
  return result.rows[0]?.n ?? 0
}
