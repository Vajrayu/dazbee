// The simulator's violations check (I5), as FigCraft's `Sim::check`: an undo or redo may change only
// what its author wrote last, or what another tab wrote after the undoing tab last saw the server.
// It takes every change set the journal stores, in server order, and keeps the design they make.
import type { Accepted, DesignRecords } from '@dazbee/schema'

import { sameValue } from '../same-value.ts'
import { holderTarget, recordKey } from './changes.ts'
import { Touches } from './history.ts'
import { applyChangeSet } from './journal.ts'
import { DesignState, type ReadState } from './state.ts'

export interface UndoCheck {
  /**
   * A change set the journal stored, in server order, with the base it was made on when it is an
   * undo or redo: what it broke, if it is one.
   */
  stored(changeSet: Accepted, undo?: { base: number }): string[]
  /** Tab `author` got the change sets `(after, upto]` only inside a whole design, as a catch-up. */
  gap(author: number, after: number, upto: number): void
  /** The design the stored change sets make. */
  state(): DesignState
}

/** The last change set that wrote something, and its author. */
interface Writer {
  seq: number
  author: number
}

/** A check over `start`, the design before the first change set. */
export function undoCheck(start: DesignRecords): UndoCheck {
  const state = DesignState.fromRecords(start)
  const log: { author: number; touches: Touches }[] = []
  const gaps = new Map<number, [number, number][]>()

  /** The last change set `hit` holds for. */
  function lastWriter(hit: (t: Touches) => boolean): Writer | undefined {
    for (let at = log.length - 1; at >= 0; at--) {
      const logged = log[at] as (typeof log)[number]
      if (hit(logged.touches)) return { seq: at + 1, author: logged.author }
    }
    return undefined
  }

  /**
   * It may change a value or delete a record only if its author wrote or created it last, or if the
   * last writer's change set came after `base` (the tab couldn't know: crossing edits go by server
   * order). Change sets the tab only got inside a whole design are let through: it compares values then.
   */
  function check(changeSet: Accepted, base: number): string[] {
    const found: string[] = []
    const { author, seq } = changeSet
    const allowed = (w: Writer | undefined) =>
      w !== undefined &&
      (w.author === author || w.seq > base || (gaps.get(author) ?? []).some(([a, b]) => a < w.seq && w.seq <= b))
    const work = state.overlay()
    for (const change of changeSet.changes) {
      if (change.op === 'delete' && work.get(change.part, change.id)) {
        for (const id of work.subtree(change.id)) {
          const ok = pathTo(work, id, change.id).some((inside) => {
            const part = work.partOf(inside)
            const holder = part && holderTarget(part, inside)
            const moved = holder && lastWriter((t) => t.hits(holder))
            return (
              (part && allowed(lastWriter((t) => t.records.has(recordKey(part, inside))))) ||
              (moved !== undefined && moved.seq > base)
            )
          })
          if (!ok) found.push(`seq ${seq}: tab ${author} deleted "${id}", someone else's`)
        }
      } else if (change.op === 'set' && !sameValue(state.valueOf(change.value), change.to)) {
        const writer = lastWriter((t) => t.hits(change.value))
        if (!allowed(writer)) {
          found.push(
            `seq ${seq}: tab ${author} wrote ${JSON.stringify(change.value)}, last written by ${JSON.stringify(writer)}`,
          )
        }
      }
      work.apply(change, 'lenient')
    }
    return found
  }

  return {
    stored: (changeSet, undo) => {
      const found = undo ? check(changeSet, undo.base) : []
      const applied = applyChangeSet(state, changeSet.changes)
      if ('reason' in applied) found.push(`seq ${changeSet.seq} was stored but doesn't apply: ${applied.words}`)
      else applied.after.commit({ seq: changeSet.seq, author: changeSet.author })
      log.push({ author: changeSet.author, touches: Touches.of(changeSet.changes) })
      return found
    },
    gap: (author, after, upto) => {
      gaps.set(author, [...(gaps.get(author) ?? []), [after, upto]])
    },
    state: () => state,
  }
}

/** `id` and the records holding it, up to but not including `root`. */
function pathTo(state: ReadState, id: string, root: string): string[] {
  const path = [id]
  for (let at = id; at !== root;) {
    const part = state.partOf(at)
    const holder = part && holderTarget(part, at)
    const up = holder && (state.valueOf(holder) as string)
    if (!up || up === root) break
    path.push(up)
    at = up
  }
  return path
}
