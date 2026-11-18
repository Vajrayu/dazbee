// A design's journal in memory, with the fence a stored one keeps: what tests and scratch stores
// open a sync server on. The rows can be shared by two journals, as two servers holding one design
// share its Postgres rows, and a journal can be told to fail or hold back its next write. It keeps
// every version it is given, newest last, under no keep rules.
import type { Entry, NewVersion, Saved } from '@dazbee/schema'

import { DesignGone, Fenced, type Journal, type Loaded } from './journal.ts'

/** What a stored design holds, as its rows do: the folded state, the journal, the fence and the dead letters. */
export interface MemoryRows {
  saved: Saved
  journal: Entry[]
  lastEntry: number
  dead: { entry: Entry; reason: string }[]
  /** The versions added, oldest first, each under the id it was given. */
  versions: (NewVersion & { id: string })[]
}

/** A journal in memory, and the faults a test plants in it. */
export interface MemoryJournal extends Journal {
  readonly rows: MemoryRows
  /** The next write fails, storing nothing. */
  failNext(): void
  /** The next write waits until the returned function is called. */
  holdNext(): () => void
  /** How many writes were stored. */
  writes(): number
  /** The rows are gone, as when the design is deleted: every load and write from now fails with `DesignGone`. */
  remove(): void
}

/** Rows holding `saved` and nothing written since. */
export function memoryRows(saved: Saved): MemoryRows {
  return { saved: structuredClone(saved), journal: [], lastEntry: saved.entry, dead: [], versions: [] }
}

/** A journal over `rows`: give two journals the same rows for two writers. */
export function memoryJournal(rows: MemoryRows): MemoryJournal {
  let fail = false
  let hold: Promise<void> | undefined
  let stored = 0
  let removed = false

  /** Runs a write after any hold, failing it when told to or when the fence moved (null: it names none). */
  async function write(expected: number | null, run: () => void) {
    const held = hold
    hold = undefined
    if (held) await held
    else await Promise.resolve()
    if (fail) {
      fail = false
      throw new Error('a planted write failure')
    }
    if (removed) throw new DesignGone('the design is gone')
    if (expected !== null && rows.lastEntry !== expected) {
      throw new Fenced(`another writer stored entry ${rows.lastEntry}, not ${expected}`)
    }
    run()
    stored++
  }

  return {
    rows,
    load: async (): Promise<Loaded> => {
      await Promise.resolve()
      if (removed) throw new DesignGone('the design is gone')
      const newest = rows.versions.at(-1)
      const lastVersion = newest ? { syncId: newest.syncId, seq: newest.seq } : null
      return structuredClone({ saved: rows.saved, journal: rows.journal, lastEntry: rows.lastEntry, lastVersion })
    },
    version: async (version) => {
      await write(null, () => {
        rows.versions.push({ ...structuredClone(version), id: `v${rows.versions.length + 1}` })
      })
      return 'added'
    },
    readVersion: async (id) => {
      await Promise.resolve()
      if (removed) throw new DesignGone('the design is gone')
      const found = rows.versions.find((v) => v.id === id)
      return found ? { json: JSON.stringify(found.records), schemaVersion: found.schemaVersion } : null
    },
    append: (entries, expected) =>
      write(expected, () => {
        const copies = structuredClone([...entries])
        if (copies.some((e, i) => e.entry !== expected + i + 1)) throw new Error('entries out of order')
        rows.journal.push(...copies)
        rows.lastEntry = (copies.at(-1) as Entry).entry
      }),
    fold: (saved, expected) =>
      write(expected, () => {
        if (saved.entry !== expected) throw new Error(`a fold at entry ${saved.entry} leaves entries out`)
        rows.saved = structuredClone(saved)
        rows.journal = rows.journal.filter((e) => e.entry > saved.entry)
      }),
    bury: (saved, expected, from, reason) =>
      write(expected, () => {
        if (saved.entry !== expected) throw new Error(`a bury at entry ${saved.entry} moves the fence back`)
        const tail = rows.journal.filter((e) => e.entry >= from)
        rows.dead.push(...tail.map((entry) => ({ entry, reason })))
        rows.saved = structuredClone(saved)
        rows.journal = []
      }),
    failNext: () => {
      fail = true
    },
    holdNext: () => {
      let release = () => {}
      hold = new Promise<void>((resolve) => {
        release = resolve
      })
      return release
    },
    writes: () => stored,
    remove: () => {
      removed = true
    },
  }
}
