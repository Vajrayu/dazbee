// A design's versions as the API reads them: the design's records as stored with their place in the
// stored history, which a named version records, and a version's design, read through `readVersion`, the
// one read of a stored version, with what it leaves out logged.
import { type Db, loadDesignRows, versionRecords } from '@dazbee/db'
import { readVersion } from '@dazbee/doc'
import { storedDesign } from '@dazbee/doc/sync'
import type { Design, DesignRecords } from '@dazbee/schema'

/**
 * The design's records as the sync server stores them, unread (a version keeps what the read would
 * leave out, for `readVersion`), with the sync id and sequence number they are at; null with nothing stored.
 */
export async function storedWithPlace(
  db: Db,
  designId: string,
): Promise<{ records: DesignRecords; syncId: string; seq: number } | null> {
  const rows = await loadDesignRows(db, designId)
  if (!rows) return null
  const { records, syncId, seq } = storedDesign(rows)
  return { records, syncId, seq }
}

/** The design version `versionId` of design `designId` holds; null for none of this design. */
export async function versionDesign(db: Db, designId: string, versionId: string): Promise<Design | null> {
  const stored = await versionRecords(db, designId, versionId)
  if (!stored) return null
  const { design, leftOut } = readVersion(JSON.parse(stored.json) as DesignRecords, stored.schemaVersion)
  if (leftOut.length > 0) {
    console.warn(`version ${versionId} of design ${designId} leaves out ${JSON.stringify(leftOut)}`)
  }
  return design
}
