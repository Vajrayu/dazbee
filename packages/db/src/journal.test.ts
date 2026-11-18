// The sync server's storage on Postgres (D8): a design's folded state and journal, every
// write under the fence, and a load that is one consistent read. Runs on the database
// `DATABASE_URL` names (the compose one locally and in CI).
import { randomUUID } from 'node:crypto'

import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { type Entry, type Saved, SCHEMA_VERSION } from '@dazbee/schema'

import { brands, designJournalDead, designs, migrateDatabase, openDatabase, workspaces } from './index.ts'
import {
  appendRows,
  buryRows,
  createDesignSave,
  foldRows,
  loadDesignRows,
  parseDesignRows,
  readDesignRows,
  storedBytes,
} from './journal.ts'

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://dazbee:dazbee-local@127.0.0.1:55432/dazbee'
const { db, close } = openDatabase(DATABASE_URL, { max: 8 })
const run = randomUUID().slice(0, 8)
const workspaceId = `workspace-${run}`
const brandId = `brand-${run}`
const ANN = { userId: 'ann', workspaceId }

beforeAll(async () => {
  await migrateDatabase(db)
  await db.insert(workspaces).values({ id: workspaceId, name: 'Workspace' })
  await db.insert(brands).values({ id: brandId, workspaceId, name: 'Brand' })
})
afterAll(() => close())

const records = (name: string): Saved['state'] => ({
  meta: { designId: 'd', name },
  pages: { p1: { name: 'Page 1', order: 'a0' } },
  frames: {},
  nodes: {},
})

function savedAt(entry: number, seq = 0, name = 'stored'): Saved {
  return {
    syncId: 'sync-1',
    entry,
    seq,
    state: records(name),
    placed: { p1: { seq: 1, author: 1 } },
    tabs: { 1: { member: ANN, secretHash: 'h', lastChangeSet: 0, rejected: [], lastSeen: 5 } },
    nextTabId: 2,
    versioned: Math.max(0, seq - 1),
  }
}

/** Accepted entries `from` to `to`, each renaming the design to its number. */
function accepted(from: number, to: number): Entry[] {
  const entries: Entry[] = []
  for (let entry = from; entry <= to; entry++) {
    entries.push({
      entry,
      kind: 'accepted',
      member: ANN,
      bytes: 40,
      changeSet: {
        seq: entry,
        author: 1,
        changeSetId: entry,
        changes: [{ op: 'set', value: { part: 'meta', id: 'meta', key: 'name' }, to: `n${entry}` }],
      },
    })
  }
  return entries
}

/** A design with its first stored state. */
async function newDesign(saved: Saved = savedAt(0)): Promise<string> {
  const id = `design-${randomUUID().slice(0, 8)}`
  await db.insert(designs).values({ id, workspaceId, brandId, name: 'D', schemaVersion: SCHEMA_VERSION })
  await createDesignSave(db, id, saved)
  return id
}

const updatedAt = async (id: string) =>
  (await db.select({ at: designs.updatedAt }).from(designs).where(eq(designs.id, id)))[0]?.at.getTime()

describe('a design stored for the sync server', () => {
  it('loads as it was created, with nothing in its journal', async () => {
    const id = await newDesign(savedAt(7, 3))
    expect(await loadDesignRows(db, id)).toEqual({ saved: savedAt(7, 3), journal: [], lastEntry: 7, lastVersion: null })
  })

  it('appends entries in order, all or none, and fences an append that names a stale last entry', async () => {
    const id = await newDesign()
    expect(await appendRows(db, id, accepted(1, 3), 0)).toBe('stored')
    expect(await appendRows(db, id, accepted(4, 4), 3)).toBe('stored')
    expect(await appendRows(db, id, accepted(4, 5), 3)).toBe('fenced')
    const loaded = await loadDesignRows(db, id)
    expect(loaded?.journal).toEqual(accepted(1, 4))
    expect(loaded?.lastEntry).toBe(4)
  })

  it('stores a rejection and a tab id given out, as the journal holds them', async () => {
    const id = await newDesign()
    const entries: Entry[] = [
      { entry: 1, kind: 'issued', tabId: 2, member: ANN, secretHash: 's', at: 9, dropped: [1] },
      { entry: 2, kind: 'rejected', tabId: 2, changeSetId: 4 },
    ]
    expect(await appendRows(db, id, entries, 0)).toBe('stored')
    expect((await loadDesignRows(db, id))?.journal).toEqual(entries)
  })

  it('marks the design updated with each append', async () => {
    const id = await newDesign()
    const before = await updatedAt(id)
    await new Promise((resolve) => setTimeout(resolve, 5))
    await appendRows(db, id, accepted(1, 1), 0)
    expect(await updatedAt(id)).toBeGreaterThan(before ?? Infinity)
  })

  it('folds the entries a state holds into it, and keeps those after', async () => {
    const id = await newDesign()
    await appendRows(db, id, accepted(1, 5), 0)
    expect(await foldRows(db, id, savedAt(5, 5, 'n5'), 5)).toBe('stored')
    expect(await appendRows(db, id, accepted(6, 7), 5)).toBe('stored')
    expect(await loadDesignRows(db, id)).toEqual({
      saved: savedAt(5, 5, 'n5'),
      journal: accepted(6, 7),
      lastEntry: 7,
      lastVersion: null,
    })
  })

  it('fences a fold that names a stale last entry, storing nothing', async () => {
    const id = await newDesign()
    await appendRows(db, id, accepted(1, 2), 0)
    expect(await foldRows(db, id, savedAt(1, 1, 'n1'), 1)).toBe('fenced')
    expect(await loadDesignRows(db, id)).toEqual({
      saved: savedAt(0),
      journal: accepted(1, 2),
      lastEntry: 2,
      lastVersion: null,
    })
  })

  it('buries a tail that no longer applies: moved to the dead letters with why, the fence where it was', async () => {
    const id = await newDesign()
    await appendRows(db, id, accepted(1, 4), 0)
    expect(await buryRows(db, id, savedAt(4, 2, 'n2'), 4, 3, 'entry 3 no longer applies')).toBe('stored')
    expect(await loadDesignRows(db, id)).toEqual({
      saved: savedAt(4, 2, 'n2'),
      journal: [],
      lastEntry: 4,
      lastVersion: null,
    })
    const dead = await db.select().from(designJournalDead).where(eq(designJournalDead.designId, id))
    expect(dead.map((d) => [d.entry, d.error])).toEqual([
      [3, 'entry 3 no longer applies'],
      [4, 'entry 3 no longer applies'],
    ])
    // Entry numbers never go back: the next append follows the buried tail.
    expect(await appendRows(db, id, accepted(5, 5), 4)).toBe('stored')
  })

  it('counts the bytes its state and journal hold', async () => {
    const id = await newDesign()
    const state = new TextEncoder().encode(JSON.stringify(savedAt(0).state)).length
    expect(await storedBytes(db, id)).toBe(state)
    await appendRows(db, id, accepted(1, 2), 0)
    const bodies = accepted(1, 2).reduce((sum, e) => sum + new TextEncoder().encode(JSON.stringify(e)).length, 0)
    expect(await storedBytes(db, id)).toBe(state + bodies)
    expect(await storedBytes(db, 'no-such-design')).toBeNull()
  })

  it('fails the second of two servers burying the same tail, so it cannot take over the sync id', async () => {
    const id = await newDesign()
    await appendRows(db, id, accepted(1, 4), 0)
    expect(await buryRows(db, id, { ...savedAt(4, 2), syncId: 'first' }, 4, 3, 'bad')).toBe('stored')
    expect(await buryRows(db, id, { ...savedAt(4, 2), syncId: 'second' }, 4, 3, 'bad')).toBe('fenced')
    expect((await loadDesignRows(db, id))?.saved.syncId).toBe('first')
  })

  it('refuses a fold or a bury whose state does not end at the fence it names', async () => {
    const id = await newDesign()
    await appendRows(db, id, accepted(1, 2), 0)
    expect(() => foldRows(db, id, savedAt(1, 1), 2)).toThrow('leaves entries out')
    expect(() => buryRows(db, id, savedAt(1, 1), 2, 2, 'x')).toThrow('moves the fence back')
  })

  it('lets the design be deleted while appends run, with neither failing', async () => {
    for (let round = 0; round < 10; round++) {
      const id = await newDesign()
      const [stored] = await Promise.all([
        appendRows(db, id, accepted(1, 50), 0),
        db.delete(designs).where(eq(designs.id, id)),
      ])
      expect(['stored', 'gone']).toContain(stored)
    }
  }, 30_000)

  it('says a deleted design is gone, to every write and to a load', async () => {
    const id = await newDesign()
    await db.delete(designs).where(eq(designs.id, id))
    expect(await appendRows(db, id, accepted(1, 1), 0)).toBe('gone')
    expect(await foldRows(db, id, savedAt(0), 0)).toBe('gone')
    expect(await buryRows(db, id, savedAt(0), 0, 1, 'x')).toBe('gone')
    expect(await loadDesignRows(db, id)).toBeNull()
  })

  it('fails a second writer that loaded the same rows, whether or not the first folded in between', async () => {
    const id = await newDesign()
    const first = await loadDesignRows(db, id)
    const second = await loadDesignRows(db, id)
    expect(await appendRows(db, id, accepted(1, 1), first?.lastEntry ?? -1)).toBe('stored')
    expect(await appendRows(db, id, accepted(1, 1), second?.lastEntry ?? -1)).toBe('fenced')
    expect(await foldRows(db, id, savedAt(1, 1, 'n1'), 1)).toBe('stored')
    // After the fold the first writer's entry 1 is no longer in the journal, so only the fence stops it.
    expect(await appendRows(db, id, accepted(1, 1), second?.lastEntry ?? -1)).toBe('fenced')
    expect(await foldRows(db, id, savedAt(0), second?.lastEntry ?? -1)).toBe('fenced')
  })

  it('lets one of two writers racing on the same fence store, and fails the other', async () => {
    const id = await newDesign()
    const results = await Promise.all([appendRows(db, id, accepted(1, 2), 0), appendRows(db, id, accepted(1, 3), 0)])
    expect(results.toSorted()).toEqual(['fenced', 'stored'])
    const loaded = await loadDesignRows(db, id)
    expect(loaded?.journal.length).toBe(loaded?.lastEntry)
  })

  it('reads the journal as of its state, though a fold commits between the two reads', async () => {
    const id = await newDesign()
    await appendRows(db, id, accepted(1, 3), 0)
    const raw = await readDesignRows(db, id, async () => {
      expect(await foldRows(db, id, savedAt(3, 3, 'n3'), 3)).toBe('stored')
    })
    if (!raw) throw new Error('no rows')
    expect(parseDesignRows(raw)).toEqual({
      saved: savedAt(0),
      journal: accepted(1, 3),
      lastEntry: 3,
      lastVersion: null,
    })
  })

  it('never shows a reader a fold half done: each load ends where its state and journal say', async () => {
    const id = await newDesign()
    let last = 0
    let stop = false
    const writer = (async () => {
      for (let round = 0; round < 100; round++) {
        await appendRows(db, id, accepted(last + 1, last + 3), last)
        last += 3
        if (round % 2 === 1) await foldRows(db, id, savedAt(last, last, `n${last}`), last)
      }
      stop = true
    })()
    let reads = 0
    while (!stop) {
      const loaded = await loadDesignRows(db, id)
      if (!loaded) throw new Error('the design is gone')
      const entries = loaded.journal.map((e) => e.entry)
      const expected = Array.from(
        { length: loaded.lastEntry - loaded.saved.entry },
        (_, i) => loaded.saved.entry + i + 1,
      )
      expect(entries).toEqual(expected)
      reads++
    }
    await writer
    expect(reads).toBeGreaterThan(10)
  }, 30_000)
})
