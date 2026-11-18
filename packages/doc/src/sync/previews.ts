// Other tabs' open steps, as they preview them (D7): the latest preview from each, drawn over the
// working design for display only. The working design, undo and commands never read one. A preview
// is the open step's net changes so far, as compact tuples, with `after`, the last change set id
// its tab had made when it sent it: the step's own change set comes after that, so once a later
// change set of that tab is accepted the preview is done, and a preview that arrives after it (the
// server holds back previews for a slow tab, so one can come late) is stale and ignored.
import type { Change, PreviewChange } from '@dazbee/schema'

import { changedRecord, type RecordKey, recordOf } from './changes.ts'
import { recordIssue } from './checks.ts'
import type { DesignState, ReadState } from './state.ts'

export interface Previews {
  /** A preview from tab `tabId`: kept as its latest unless stale; an empty one clears it. Returns the records it shows otherwise. */
  take(tabId: number, after: number, changes: readonly Change[]): Set<RecordKey>
  /** A change set of tab `tabId` was accepted: a preview of the step it ends is cleared. */
  accepted(tabId: number, changeSetId: number): Set<RecordKey>
  /** Tab `tabId` left, or this tab caught up anew (`undefined`: everyone's): their previews are cleared. */
  clear(tabId?: number): Set<RecordKey>
  /** The latest preview from each other tab. */
  all(): ReadonlyMap<number, readonly Change[]>
  /**
   * `under` with the previews over it, by tab id, then `over` on top (the tab's own open step,
   * C41): for display only. A previewed record the schema refuses is left as `under` has it.
   */
  shown(under: DesignState, over: readonly Change[]): ReadState
}

/** A set's tuple: `['s', part, id, key, prop, to]`, `prop` null for a top-level key. */
type SetTuple = Extract<PreviewChange, ['s', ...unknown[]]>

/** The previews of the other tabs, empty. */
export function previews(): Previews {
  /** The latest preview from each other tab, with its `after`. */
  const latest = new Map<number, { after: number; changes: readonly Change[] }>()
  /** The last accepted change set id of each other tab. */
  const lastAccepted = new Map<number, number>()

  function take(tabId: number, after: number, changes: readonly Change[]) {
    if (after < (lastAccepted.get(tabId) ?? 0)) return new Set<RecordKey>()
    const keys = clear(tabId)
    if (changes.length === 0) return keys
    latest.set(tabId, { after, changes })
    for (const change of changes) keys.add(changedRecord(change))
    return keys
  }

  function accepted(tabId: number, changeSetId: number) {
    lastAccepted.set(tabId, Math.max(changeSetId, lastAccepted.get(tabId) ?? 0))
    const held = latest.get(tabId)
    return held && changeSetId > held.after ? clear(tabId) : new Set<RecordKey>()
  }

  function clear(tabId?: number) {
    // Cleared for everyone (a welcome): ids accepted before no longer say which previews are stale.
    if (tabId === undefined) lastAccepted.clear()
    const keys = new Set<RecordKey>()
    for (const [id, held] of latest) {
      if (tabId !== undefined && id !== tabId) continue
      for (const change of held.changes) keys.add(changedRecord(change))
      latest.delete(id)
    }
    return keys
  }

  function shown(under: DesignState, over: readonly Change[]): ReadState {
    const ordered = [...latest.keys()].sort((a, b) => a - b).flatMap((id) => latest.get(id)?.changes ?? [])
    const tried = under.overlay()
    for (const change of ordered) tried.apply(change, 'lenient')
    // A previewed record the schema refuses is left out: what it writes is not drawn.
    const refused = new Set(
      tried.ownKeys().filter((key) => {
        const { part, id } = recordOf(key)
        const record = tried.get(part, id)
        return record !== undefined && recordIssue(part, id, record) !== undefined
      }),
    )
    const out = under.overlay()
    for (const change of ordered) if (!refused.has(changedRecord(change))) out.apply(change, 'lenient')
    for (const change of over) out.apply(change, 'lenient')
    return out
  }

  return {
    take,
    accepted,
    clear,
    all: () => new Map([...latest].map(([id, held]) => [id, held.changes])),
    shown,
  }
}

/** The changes as a preview's tuples. */
export function toTuples(changes: readonly Change[]): PreviewChange[] {
  return changes.map((change): PreviewChange => {
    if (change.op === 'create') return ['c', change.part, change.id, change.record]
    if (change.op === 'delete') return ['d', change.part, change.id]
    const { part, id, key, prop } = change.value
    return 'to' in change && change.to !== undefined
      ? ['s', part, id, key, prop ?? null, change.to]
      : ['u', part, id, key, prop ?? null]
  })
}

/** The changes a preview's tuples stand for. */
export function fromTuples(tuples: readonly PreviewChange[]): Change[] {
  return tuples.map((tuple): Change => {
    switch (tuple[0]) {
      case 'c':
        return { op: 'create', part: tuple[1], id: tuple[2], record: tuple[3] }
      case 'd':
        return { op: 'delete', part: tuple[1], id: tuple[2] }
      case 's': {
        const [, part, id, key, prop, to] = tuple as SetTuple
        return { op: 'set', value: { part, id, key, ...(prop === null ? {} : { prop }) }, to }
      }
      case 'u': {
        const [, part, id, key, prop] = tuple
        return { op: 'set', value: { part, id, key, ...(prop === null ? {} : { prop }) } }
      }
    }
  })
}
