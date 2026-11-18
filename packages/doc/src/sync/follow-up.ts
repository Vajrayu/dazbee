// Derived values brought up to date after crossing edits (D6), as FigCraft's `Recompute`: a change
// set carries the derived values its author worked out, and when the server orders another tab's
// change set before it, only its author works them out again, on the confirmed design with its
// queue on it, and sends what changed as a follow-up: a change set of its own, which is no undo step.
// The client (client.ts) decides which records are owed; this works out what a follow-up writes.
import type { Change } from '@dazbee/schema'

import { holderOf, type RecordKey, recordKey, recordOf } from './changes.ts'
import type { DesignState, ReadState } from './state.ts'
import { stepChangeSet } from './step-change-set.ts'

/**
 * The tab's derived values over `touched` (records a change set wrote, and what held them before
 * it or holds them after it), as the changes that write them on `state`. It widens further itself
 * where a value depends on more (a group's box on every group above it). It answers `'wait'` while
 * something it needs is not there yet, such as a font still loading.
 */
export type Recompute = (state: ReadState, touched: ReadonlySet<RecordKey>) => Change[] | 'wait'

/** The records `written` turned `before` into `after` on, with what held each before and holds it after. */
export function touchedBy(before: ReadState, after: ReadState, written: Iterable<RecordKey>): Set<RecordKey> {
  const touched = new Set<RecordKey>()
  for (const key of written) {
    touched.add(key)
    const { part, id } = recordOf(key)
    for (const state of [before, after]) {
      const record = state.get(part, id)
      const holder = record && holderOf(part, record)
      const held = holder === undefined ? undefined : (before.partOf(holder) ?? after.partOf(holder))
      if (holder !== undefined && held !== undefined) touched.add(recordKey(held, holder))
    }
  }
  return touched
}

/**
 * The follow-up that brings the derived values over `touched` up to date on `state`: what
 * `recompute` changes there (nothing it writes back to the value it has), or `'wait'`.
 */
export function followUp(state: DesignState, touched: ReadonlySet<RecordKey>, recompute: Recompute): Change[] | 'wait' {
  const changes = recompute(state, touched)
  if (changes === 'wait') return 'wait'
  const next = state.overlay()
  for (const change of changes) next.apply(change, 'lenient')
  return stepChangeSet(state, next, next.ownKeys())
}
