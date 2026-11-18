// A design's journal on Postgres (D8), for the doc's design host: `packages/db`'s rows, with a write
// that finds the fence moved failing as `Fenced` and a design whose rows are gone as `DesignGone`.
// Parsing what a load read, and writing a fold's state, are whole-design work: each waits for `turn`.
// A design with no `design_saves` row reads as gone: the API writes one as it creates the design.
// A version goes to `design_versions` under `packages/db`'s keep rules, its records' JSON written
// after a turn.
import {
  addVersion,
  appendRows,
  buryRows,
  type Db,
  foldRows,
  parseDesignRows,
  readDesignRows,
  versionRecords,
  type WriteResult,
} from '@dazbee/db'
import { DesignGone, Fenced, type Journal } from '@dazbee/doc/sync'

/** The journal of design `designId`, stored in `db`. */
export function pgJournal(db: Db, designId: string, turn: () => Promise<void> = () => Promise.resolve()): Journal {
  return {
    load: async () => {
      const raw = await readDesignRows(db, designId)
      if (!raw) throw new DesignGone(`design ${designId} has no stored rows`)
      await turn()
      return parseDesignRows(raw)
    },
    append: async (entries, expected) => stored(await appendRows(db, designId, entries, expected), designId, expected),
    fold: async (saved, expected) => {
      await turn()
      stored(await foldRows(db, designId, saved, expected), designId, expected)
    },
    bury: async (saved, expected, from, reason) => {
      await turn()
      stored(await buryRows(db, designId, saved, expected, from, reason), designId, expected)
    },
    version: async (version) => {
      await turn()
      const added = await addVersion(db, designId, version)
      if (added === 'gone') throw new DesignGone(`design ${designId} has no stored rows`)
      return typeof added === 'object' ? 'added' : added
    },
    readVersion: (id) => versionRecords(db, designId, id),
  }
}

/** Throws for a write that did not store. */
function stored(result: WriteResult, designId: string, expected: number) {
  if (result === 'gone') throw new DesignGone(`design ${designId} has no stored rows`)
  if (result === 'fenced') throw new Fenced(`another writer moved design ${designId}'s journal past entry ${expected}`)
}
