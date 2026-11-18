// A version of a design, read: every reader of a stored version (the API's copy and picture, the
// tab's viewer and restore) reads it here. A version stored under an older schema version is where an
// upgrade will run; until one is written, it reads as a stored design does: a part the schema no
// longer takes is left out and told, and the rest opens.
import type { Design, DesignRecords } from '@dazbee/schema'

import { type LeftOut, repair } from './repair.ts'

/** A version read: its design, and what the read left out, for the reader to tell or log. */
export interface ReadVersion {
  design: Design
  leftOut: LeftOut[]
}

/** The design a version's records hold, stored under `schemaVersion`. */
export function readVersion(records: DesignRecords, schemaVersion: number): ReadVersion {
  // Every schema version reads the same way while there is no upgrade step (docs/agents/code-layout.md, Data).
  void schemaVersion
  const { design, leftOut } = repair(records)
  return { design, leftOut }
}
