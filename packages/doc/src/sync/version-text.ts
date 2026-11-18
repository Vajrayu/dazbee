// A version a tab asked for, as the wire carries it: the `version` server message, its design the
// records' JSON as stored, written in unparsed, as a welcome's design is.
import type { VersionAnswer } from './host.ts'

/** The `version` server message for `answer`, as text: its design the stored JSON, or null with no version. */
export function versionText({ id, stored }: VersionAnswer): string {
  const head = JSON.stringify({ type: 'version', id, schemaVersion: stored?.schemaVersion ?? null })
  return `${head.slice(0, -1)},"design":${stored?.json ?? 'null'}}`
}
