// The load test's workspace against Postgres and storage from Docker Compose
// (`docker compose up -d --wait postgres storage`).
import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { assets, brands, designs, designSaves, memberships, newId, openDatabase, users, workspaces } from '@dazbee/db'
import { readSessionToken } from '@dazbee/session-token'
import { openStorage } from '@dazbee/storage'

import {
  deleteLoadWorkspace,
  folderOf,
  leftovers,
  LOAD_WORKSPACE_NAME,
  type LoadWorkspace,
  makeLoadWorkspace,
} from './load-workspace.ts'
import { DATABASE_URL } from './test-database.ts'

const secret = 'test-session-secret-'.padEnd(32, 'x')
const { db, close } = openDatabase(DATABASE_URL)
const storage = openStorage({
  endpoint: process.env.STORAGE_ENDPOINT ?? 'http://127.0.0.1:59000',
  bucket: process.env.STORAGE_BUCKET ?? 'dazbee-test',
  accessKeyId: process.env.STORAGE_ACCESS_KEY_ID ?? 'dazbee',
  secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY ?? 'dazbee-local-secret',
  region: 'us-east-1',
})

/** Someone else's workspace, which clean-up must leave be. */
const other = { id: `other-${newId()}`, name: 'Harbour Coffee team' }

beforeAll(async () => {
  await storage.ensureBucket()
  await db.insert(workspaces).values(other)
  await db.insert(brands).values({ id: `${other.id}-brand`, workspaceId: other.id, name: 'Harbour Coffee' })
  await storage.put(`${folderOf(other.id)}kept.png`, Uint8Array.of(1), 'image/png')
})

afterAll(async () => {
  await db.delete(brands).where(eq(brands.workspaceId, other.id))
  await db.delete(workspaces).where(eq(workspaces.id, other.id))
  await storage.deleteFolder(folderOf(other.id))
  await close()
})

describe('makeLoadWorkspace', () => {
  it('makes one member and one design per person, the first the Owner, each with a session token for them', async () => {
    const made = await makeLoadWorkspace(db, secret, 3)
    try {
      const { workspaceId, people } = made
      expect(workspaceId).toMatch(/^load-test-[0-9a-z]{12}$/)
      const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId))
      expect(workspace?.name).toBe(LOAD_WORKSPACE_NAME)
      const roles = await db
        .select({ userId: memberships.userId, role: memberships.role })
        .from(memberships)
        .where(eq(memberships.workspaceId, workspaceId))
        .orderBy(memberships.userId)
      expect(roles).toEqual(people.map((person, i) => ({ userId: person.userId, role: i === 0 ? 'owner' : 'editor' })))
      const designIds = people.map((person) => person.designId)
      const stored = await db
        .select({ id: designs.id, brandId: designs.brandId })
        .from(designs)
        .where(and(eq(designs.workspaceId, workspaceId), inArray(designs.id, designIds)))
      expect(stored).toHaveLength(3)
      expect(new Set(stored.map((design) => design.brandId)).size).toBe(2)
      expect(await db.select().from(designSaves).where(inArray(designSaves.designId, designIds))).toHaveLength(3)
      for (const person of people) {
        expect(readSessionToken(secret, person.sessionToken)?.userId).toBe(person.userId)
        expect(person.designId.startsWith(`${workspaceId}-`)).toBe(true)
        expect(person.frameId).toBeTruthy()
      }
    } finally {
      await deleteLoadWorkspace(db, storage, made.workspaceId)
    }
  })
})

describe('deleteLoadWorkspace', () => {
  let made: LoadWorkspace

  beforeAll(async () => {
    made = await makeLoadWorkspace(db, secret, 2)
    const person = made.people[0] as LoadWorkspace['people'][0]
    // An upload, as the web app makes one: its row and its files.
    await db.insert(assets).values({
      id: newId(),
      workspaceId: made.workspaceId,
      brandId: person.brandId,
      sha256: 'a'.repeat(64),
      contentType: 'image/png',
      byteSize: 1,
      width: 1,
      height: 1,
    })
    await storage.put(`${folderOf(made.workspaceId)}originals/${'a'.repeat(64)}`, Uint8Array.of(1), 'image/png')
    await storage.put(`${folderOf(made.workspaceId)}thumbnails/${'a'.repeat(64)}`, Uint8Array.of(1), 'image/png')
  })

  it('deletes every row and file the workspace gathered, and leaves the rest', async () => {
    expect((await leftovers(db, storage, made.workspaceId)).files).toBe(2)
    await deleteLoadWorkspace(db, storage, made.workspaceId)
    const left = await leftovers(db, storage, made.workspaceId)
    expect(Object.values(left.rows).every((rows) => rows === 0)).toBe(true)
    expect(left.files).toBe(0)
    const userIds = made.people.map((person) => person.userId)
    expect(await db.select().from(users).where(inArray(users.id, userIds))).toEqual([])
    expect(await db.select().from(workspaces).where(eq(workspaces.id, other.id))).toHaveLength(1)
    expect(await storage.list(folderOf(other.id))).toEqual([`${folderOf(other.id)}kept.png`])
  })

  it('refuses a workspace that is not a load test’s, by its id or its name, and an id that is a pattern', async () => {
    await expect(deleteLoadWorkspace(db, storage, other.id)).rejects.toThrow('not a load test')
    await expect(deleteLoadWorkspace(db, storage, 'load-test-%')).rejects.toThrow('not a load test')
    const named = `load-test-${newId()}`
    await db.insert(workspaces).values({ id: named, name: 'Northline Cycles' })
    try {
      await expect(deleteLoadWorkspace(db, storage, named)).rejects.toThrow('not "Load test"')
      expect(await db.select().from(workspaces).where(eq(workspaces.id, named))).toHaveLength(1)
    } finally {
      await db.delete(workspaces).where(eq(workspaces.id, named))
    }
  })
})

describe('leftovers', () => {
  it('counts the rows a workspace has, by its id or its ids’ prefix', async () => {
    const counted = await makeLoadWorkspace(db, secret, 2)
    try {
      const { rows } = await leftovers(db, storage, counted.workspaceId)
      expect(rows).toMatchObject({
        'workspaces.id': 1,
        'memberships.workspace_id': 2,
        'brands.workspace_id': 2,
        'designs.workspace_id': 2,
        'users.id': 2,
        'design_saves.design_id': 2,
      })
    } finally {
      await deleteLoadWorkspace(db, storage, counted.workspaceId)
    }
  })
})
