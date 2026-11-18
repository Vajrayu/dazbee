// A design as the sync server stores it (D8): its folded state and the journal of entries
// stored since. Every write is one transaction that first moves the fence (`design_saves.last_entry`)
// from the value its writer names, so a second writer holding the same design fails, whether or not
// a fold ran in between. A load is one REPEATABLE READ transaction: what readers of a stored design
// run too, so none sees a fold half done.
import { and, desc, eq, lte, sql, TransactionRollbackError } from 'drizzle-orm'

import { type Entry, Saved } from '@dazbee/schema'

import type { Db } from './index.ts'
import { designJournal, designs, designSaves, designVersions } from './tables.ts'

/** A design's stored rows: the folded state, the entries stored since (oldest first), the fence, and its newest version's mark. */
export interface DesignRows {
  saved: Saved
  journal: Entry[]
  lastEntry: number
  /** The sync id and sequence number of the design's newest version; null with none. */
  lastVersion: { syncId: string; seq: number } | null
}

/** A design's rows as read, before they are parsed. */
export interface RawDesignRows {
  save: typeof designSaves.$inferSelect
  bodies: Uint8Array[]
  /** The newest version's mark, read in the same snapshot; none when left out. */
  lastVersion?: { syncId: string; seq: number } | null
}

/** What a write did: stored; failed because another writer moved the fence; or the design is gone. */
export type WriteResult = 'stored' | 'fenced' | 'gone'

/** A transaction on the database, which a write can take part in. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

/** The most rows one insert carries, well inside Postgres's limit on a statement's parameters. */
const ROWS_PER_INSERT = 1_000

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** Stores a design's first state (`saved`), with its fence at the state's entry; in `db`'s transaction when it is one. */
export async function createDesignSave(db: Db | Tx, designId: string, saved: Saved): Promise<void> {
  await db.insert(designSaves).values({ designId, ...stateColumns(saved), lastEntry: saved.entry })
}

/** A design's stored rows, read in one consistent snapshot and parsed; null when the design has none. */
export async function loadDesignRows(db: Db, designId: string): Promise<DesignRows | null> {
  const raw = await readDesignRows(db, designId)
  return raw && parseDesignRows(raw)
}

/**
 * A design's stored rows as Postgres gives them, read in one REPEATABLE READ transaction, so a fold
 * that commits meanwhile is not half seen; null when the design has none. `between` runs between
 * reading the state and the journal (a test's seam).
 */
export async function readDesignRows(
  db: Db,
  designId: string,
  between?: () => Promise<void>,
): Promise<RawDesignRows | null> {
  return db.transaction(
    async (tx) => {
      const [save] = await tx.select().from(designSaves).where(eq(designSaves.designId, designId))
      if (!save) return null
      await between?.()
      const bodies = await tx
        .select({ body: designJournal.body })
        .from(designJournal)
        .where(eq(designJournal.designId, designId))
        .orderBy(designJournal.entry)
      const [newest] = await tx
        .select({ syncId: designVersions.syncId, seq: designVersions.seq })
        .from(designVersions)
        .where(eq(designVersions.designId, designId))
        .orderBy(desc(designVersions.takenAt), desc(designVersions.id))
        .limit(1)
      return { save, bodies: bodies.map((b) => b.body), lastVersion: newest ?? null }
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' },
  )
}

/** Parses rows read: the work of a whole design, which the sync server gives a turn of its own. */
export function parseDesignRows({ save, bodies, lastVersion = null }: RawDesignRows): DesignRows {
  const saved = Saved.parse({
    syncId: save.syncId,
    entry: save.entry,
    seq: save.seq,
    state: JSON.parse(decoder.decode(save.state)),
    placed: save.placed,
    tabs: save.tabs,
    nextTabId: save.nextTabId,
    versioned: save.versioned,
  })
  const journal = bodies.map((body) => JSON.parse(decoder.decode(body)) as Entry)
  return { saved, journal, lastEntry: save.lastEntry, lastVersion }
}

/** The bytes a design's stored rows hold (its state and its journal's bodies): what loading it costs; null when it has none. */
export async function storedBytes(db: Db, designId: string): Promise<number | null> {
  const [row] = await db
    .select({
      bytes: sql<string>`octet_length(${designSaves.state}) + coalesce((select sum(octet_length(${designJournal.body})) from ${designJournal} where ${designJournal.designId} = ${designId}), 0)`,
    })
    .from(designSaves)
    .where(eq(designSaves.designId, designId))
  return row ? Number(row.bytes) : null
}

/** Appends `entries` (numbered on from `expected`, the last entry the writer stored or loaded), all or none. */
export function appendRows(
  db: Db,
  designId: string,
  entries: readonly Entry[],
  expected: number,
): Promise<WriteResult> {
  const last = entries.at(-1)?.entry ?? expected
  return fenced(db, designId, expected, last, {}, async (tx) => {
    await tx
      .update(designs)
      .set({ updatedAt: sql`now()` })
      .where(eq(designs.id, designId))
    for (let at = 0; at < entries.length; at += ROWS_PER_INSERT) {
      await tx.insert(designJournal).values(entries.slice(at, at + ROWS_PER_INSERT).map((e) => journalRow(designId, e)))
    }
    return true
  })
}

/** Replaces the stored state with `saved`, which holds every entry stored, and drops those entries. */
export function foldRows(db: Db, designId: string, saved: Saved, expected: number): Promise<WriteResult> {
  if (saved.entry !== expected) throw new Error(`a fold at entry ${saved.entry} leaves entries out`)
  return fenced(db, designId, expected, expected, stateColumns(saved), async (tx) => {
    await tx
      .delete(designJournal)
      .where(and(eq(designJournal.designId, designId), lte(designJournal.entry, saved.entry)))
    return true
  })
}

/**
 * A fold of `saved`, which holds the entries before `from`, that moves the entries from `from` on to
 * the dead letters with `reason`. The fence stays at `expected`: entry numbers never go back.
 */
export function buryRows(
  db: Db,
  designId: string,
  saved: Saved,
  expected: number,
  from: number,
  reason: string,
): Promise<WriteResult> {
  if (saved.entry !== expected) throw new Error(`a bury at entry ${saved.entry} moves the fence back`)
  return fenced(db, designId, expected, expected, stateColumns(saved), async (tx) => {
    await tx.execute(sql`
      insert into design_journal_dead (design_id, entry, kind, member, body, created_at, error)
      select design_id, entry, kind, member, body, created_at, ${reason}
      from design_journal where design_id = ${designId} and entry >= ${from}`)
    const deleted = await tx
      .delete(designJournal)
      .where(eq(designJournal.designId, designId))
      .returning({ entry: designJournal.entry })
    // A bury leaves the fence where it was: a second server burying the same tail finds it gone.
    return deleted.some((d) => d.entry === from)
  })
}

/**
 * Runs a write in one transaction that first moves the fence from `expected` to `last`, with the
 * state columns `set`; rolled back, changing nothing, when the fence is not at `expected` or `write`
 * finds the rows not as its writer left them (false).
 */
async function fenced(
  db: Db,
  designId: string,
  expected: number,
  last: number,
  set: Partial<typeof designSaves.$inferInsert>,
  write: (tx: Tx) => Promise<boolean>,
): Promise<WriteResult> {
  return db
    .transaction(async (tx): Promise<WriteResult> => {
      // The design's row first, as a delete of the design takes it, so the two never deadlock.
      const [design] = await tx
        .select({ id: designs.id })
        .from(designs)
        .where(eq(designs.id, designId))
        .for('key share')
      if (!design) return 'gone'
      // The row lock makes a second writer wait for the first, then see the fence it moved.
      const moved = await tx
        .update(designSaves)
        .set({ ...set, lastEntry: last, updatedAt: sql`now()` })
        .where(and(eq(designSaves.designId, designId), eq(designSaves.lastEntry, expected)))
        .returning({ designId: designSaves.designId })
      if (moved.length === 0) {
        const [held] = await tx
          .select({ designId: designSaves.designId })
          .from(designSaves)
          .where(eq(designSaves.designId, designId))
        return held ? 'fenced' : 'gone'
      }
      if (!(await write(tx))) tx.rollback()
      return 'stored'
    })
    .catch((error: unknown): WriteResult => {
      if (error instanceof TransactionRollbackError) return 'fenced'
      throw error
    })
}

/** The columns of `design_saves` a fold writes. */
function stateColumns(saved: Saved) {
  return {
    syncId: saved.syncId,
    entry: saved.entry,
    seq: saved.seq,
    state: encoder.encode(JSON.stringify(saved.state)),
    placed: saved.placed,
    tabs: saved.tabs,
    nextTabId: saved.nextTabId,
    versioned: saved.versioned,
  }
}

/** A journal entry as its row. */
function journalRow(designId: string, e: Entry): typeof designJournal.$inferInsert {
  return {
    designId,
    entry: e.entry,
    kind: e.kind,
    member: e.kind === 'rejected' ? null : e.member,
    body: encoder.encode(JSON.stringify(e)),
  }
}
