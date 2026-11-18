// A design as the sync server stores it, read (D8): the folded state with the journal applied by the
// server's own replay, so a reader stops at the entry the server opens at, and reads what a tab
// would. The API's readers run it on rows loaded in one consistent snapshot.
import type { Design, DesignRecords } from '@dazbee/schema'

import { type LeftOut, repair } from './repair.ts'
import { type Loaded, replay } from './sync/journal.ts'

export interface StoredDesign {
  design: Design
  /** The records as stored, before the read: what a version of the design keeps. */
  records: DesignRecords
  /** The sync id of the stored history it was read from. */
  syncId: string
  /** The last journal entry applied, and the sequence number of the last change set. */
  entry: number
  seq: number
  /** What the read left out, for the reader to log. */
  leftOut: LeftOut[]
}

/** The design `loaded` holds, as far as its journal applies. */
export function storedDesign(loaded: Loaded): StoredDesign {
  const replayed = replay(loaded)
  const records = replayed.state.toRecords()
  const { design, leftOut } = repair(records)
  return { design, records, syncId: replayed.syncId, entry: replayed.entry, seq: replayed.seq, leftOut }
}
