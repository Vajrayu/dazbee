// The simulator's ledger: what each tab sent, what the host got, and what the journal stored, checked
// as it is stored, in server order. Entry numbers only go up; every undo or redo leaves alone what
// others wrote after its tab saw the server (I5); with `checkEach`, the design stays one the schema
// takes and the structure check agrees with the schema on every rejected change set (I1); and every
// edit a tab sent is stored once or rejected (G5).
import {
  type Accepted,
  type Change,
  type ChangeSetKind,
  type DesignRecords,
  type Entry,
  parseDesign,
} from '@dazbee/schema'

import { sameValue } from '../same-value.ts'
import { differenceOf } from '../test-walk.ts'
import { changeSetIssue } from './checks.ts'
import { applyChanges, replay, type Write } from './journal.ts'
import type { MemoryRows } from './memory-journal.ts'
import type { DesignState } from './state.ts'
import { undoCheck } from './test-undo-check.ts'

/** A change set as the host got it, to know what the journal stored. */
export interface Got {
  kind: ChangeSetKind
  base: number
  changes: Change[]
}

/** What the ledger counts of what the journal stored. */
export interface StoredCounts {
  /** Undos and redos, and follow-ups. */
  undos: number
  followUps: number
  /** Folds, appends, and the most entries one append stored. */
  folds: number
  appends: number
  mostInOneWrite: number
}

export interface Ledger {
  /** A tab sent edit `key` (`tabId:changeSetId`). */
  sent(key: string): void
  /** The host got change set `key`: a tab sends one again when it comes back. */
  got(key: string, got: Got): void
  /** Tab `author` came back to a whole design: it never saw the change sets after `after` up to `upto`. */
  gap(author: number, after: number, upto: number): void
  /** Checks and keeps what a stored write holds. */
  record(write: Write): void
  /** An edit some tab sent that the journal stored twice, or neither stored nor rejected, if any. */
  issue(): string | undefined
  /** A gap in the stored journal, dead letters, or a stored design other than the server's (at `seq`), if any. */
  journalIssue(rows: MemoryRows, seq: number, design: DesignRecords): string | undefined
}

/** A ledger from the design `start`, counting into `counts` and noting what breaks in `violations`. */
export function openLedger(
  start: DesignRecords,
  checkEach: boolean,
  counts: StoredCounts,
  violations: string[],
): Ledger {
  const undo = undoCheck(start)
  /** Every edit a tab sent, by `tabId:changeSetId`; how many times the journal stored each, and those it rejected. */
  const sent = new Set<string>()
  const keptTimes = new Map<string, number>()
  const rejected = new Set<string>()
  /** The change sets the host got, by `tabId:changeSetId`. */
  const got = new Map<string, Got[]>()
  /** The last entry number stored. */
  let lastEntry = 0

  function record(write: Write) {
    if (write.type === 'version') return
    if (write.type !== 'append') {
      if (write.saved.entry !== lastEntry)
        violations.push(`a ${write.type} at entry ${write.saved.entry}, not ${lastEntry}`)
      if (write.type === 'bury') violations.push(`entries were dead-lettered: ${write.reason}`)
      counts.folds++
      return
    }
    counts.appends++
    counts.mostInOneWrite = Math.max(counts.mostInOneWrite, write.entries.length)
    for (const entry of write.entries) {
      if (entry.entry <= lastEntry) violations.push(`entry ${entry.entry} stored after entry ${lastEntry}`)
      lastEntry = entry.entry
      storedEntry(entry)
    }
  }

  function storedEntry(entry: Entry) {
    if (entry.kind === 'issued') return
    const id = entry.kind === 'accepted' ? entry.changeSet : { author: entry.tabId, changeSetId: entry.changeSetId }
    const key = `${id.author}:${id.changeSetId}`
    const sentAs = got.get(key) ?? []
    if (entry.kind === 'rejected') {
      rejected.add(key)
      const last = sentAs.at(-1)
      const parity = checkEach && last ? parityIssue(undo.state(), last.changes) : undefined
      if (parity !== undefined) violations.push(`change set ${key}: ${parity}`)
      return
    }
    const { changeSet } = entry
    keptTimes.set(key, (keptTimes.get(key) ?? 0) + 1)
    const as = sentAs.find((g) => sameValue(g.changes, changeSet.changes))
    if (!as) violations.push(`change set ${key} was stored, but the host never got it`)
    const travels = as?.kind === 'undo' || as?.kind === 'redo'
    if (travels) counts.undos++
    if (as?.kind === 'followUp') counts.followUps++
    violations.push(...undo.stored(changeSet as Accepted, travels ? { base: as.base } : undefined))
    if (checkEach) {
      const parsed = parseDesign(undo.state().toRecords())
      if (!parsed.success) violations.push(`seq ${changeSet.seq} left a design the schema refuses: ${parsed.errors[0]}`)
    }
  }

  function issue(): string | undefined {
    for (const [key, kept] of keptTimes) if (kept > 1) return `change set ${key} was applied ${kept} times`
    for (const key of sent) if (!keptTimes.has(key) && !rejected.has(key)) return `change set ${key} was lost`
    return undefined
  }

  function journalIssue(rows: MemoryRows, seq: number, design: DesignRecords): string | undefined {
    const { saved, journal } = rows
    for (const [at, entry] of journal.entries()) {
      if (entry.entry !== saved.entry + 1 + at) return `entry ${entry.entry} after ${saved.entry + at}`
    }
    if (rows.dead.length > 0) return `${rows.dead.length} entries were dead-lettered`
    const replayed = replay({ saved, journal, lastEntry: rows.lastEntry })
    if (replayed.seq !== seq) return `the journal holds change set ${replayed.seq}, the server ${seq}`
    const reloaded = differenceOf(replayed.state.toRecords(), design)
    if (reloaded !== undefined) return `the design reloaded from the journal: ${reloaded}`
    const checked = differenceOf(undo.state().toRecords(), design)
    return checked === undefined ? undefined : `the stored change sets make another design: ${checked}`
  }

  return {
    sent: (key) => sent.add(key),
    got: (key, g) => got.set(key, [...(got.get(key) ?? []), g]),
    gap: (author, after, upto) => undo.gap(author, after, upto),
    record,
    issue,
    journalIssue,
  }
}

/**
 * Whether the structure check and the schema agree on `changes` over `state` (I1): undefined when
 * they do, or when a change doesn't apply at all.
 */
function parityIssue(state: DesignState, changes: readonly Change[]): string | undefined {
  const applied = applyChanges(state, changes)
  if ('reason' in applied) return undefined
  const { after, written } = applied
  const issue = changeSetIssue(after, state, written)
  const parsed = parseDesign(after.toRecords())
  if ((issue === undefined) === parsed.success) return undefined
  return issue
    ? `the structure check refused what the schema takes: ${issue.words}`
    : `the schema refused: ${parsed.success ? '' : parsed.errors[0]}`
}
