// The change set a step sends: what its writes changed, from the records it wrote as they were
// before the step and as the step left them. Nothing the step wrote back to its old value is sent,
// and a value another tab wrote while the step was open is never taken for the step's own.
import type { Change, HeldPart, Part, Target } from '@dazbee/schema'

import { sameValue } from '../same-value.ts'
import {
  depthAmong,
  holderOf,
  type Rec,
  type RecordKey,
  recordOf,
  setOf,
  targetKey,
  targetsOf,
  valueAt,
} from './changes.ts'
import type { ReadState } from './state.ts'

/**
 * The changes that turn `before` into `after` on the records `written`: creates first (holders
 * before what they hold), then the values set, then one delete per removed subtree root, so a
 * layer the step moved out of a record it deleted has moved by then. Layers deleted while they
 * held each other (a working design replayed leniently can hold such a cycle until the server
 * rejects its change set) have no root: each gets its own delete.
 */
export function stepChangeSet(before: ReadState, after: ReadState, written: readonly RecordKey[]): Change[] {
  const created = new Map<string, { part: HeldPart; record: Rec }>()
  const deleted = new Map<string, { part: HeldPart; record: Rec }>()
  const sets: Change[] = []
  for (const key of written) {
    const { part, id } = recordOf(key)
    const [was, now] = [before.get(part, id), after.get(part, id)]
    if (part !== 'meta' && !was && now) created.set(id, { part, record: now })
    else if (part !== 'meta' && was && !now) deleted.set(id, { part, record: was })
    else if (was && now && was !== now) sets.push(...setsOf(part, id, was, now))
  }
  const creates = [...created]
    .map(([id, { part, record }]) => ({
      change: { op: 'create', part, id, record } as Change,
      depth: depthAmong(created, created.get(id), (at) => holderOf(at.part, at.record)),
    }))
    .sort((a, b) => a.depth - b.depth)
    .map(({ change }) => change)
  const roots = [...deleted.keys()].filter((id) => {
    const { part, record } = deleted.get(id) as { part: HeldPart; record: Rec }
    return !deleted.has(holderOf(part, record) ?? '')
  })
  const covered = new Set(roots.flatMap((id) => before.subtree(id)))
  const deletes = [...roots, ...[...deleted.keys()].filter((id) => !covered.has(id))].map((id): Change => ({
    op: 'delete',
    part: (deleted.get(id) as { part: HeldPart }).part,
    id,
  }))
  return [...creates, ...sets, ...deletes]
}

/** A set for every value of the record that changed. */
function setsOf(part: Part, id: string, was: Rec, now: Rec): Change[] {
  const targets = new Map<string, Target>()
  for (const t of [...targetsOf(part, id, was), ...targetsOf(part, id, now)]) targets.set(targetKey(t), t)
  return [...targets.values()].flatMap((t) =>
    sameValue(valueAt(was, t), valueAt(now, t)) ? [] : [setOf(t, valueAt(now, t))],
  )
}
