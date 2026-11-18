// Flip horizontal and vertical (Shift+H, Shift+V): each frame's selected layers mirrored in place,
// and several of them each moved to its mirror across the centre of the box round them as drawn,
// as FigCraft flips a selection about the centre of its bounds. A layer a flow places keeps its
// slot. Whether a flip can run is read off the same rule.
import { boxWraps, descendants, type FlipAxis, type Session } from '@dazbee/doc'
import type { Design } from '@dazbee/schema'

import type { EditorTransformDrag } from '../gestures/select/transform-drag.ts'
import { runQuietly } from '../run-quietly.ts'
import type { StageAction } from '../shortcuts.ts'
import { lineUpOf, mirrorOffsets } from './arrange.ts'
import { type EditorBoxes, lockedInPlace } from './boxes.ts'
import { hug } from './hug.ts'
import { boundsOf } from './transform.ts'

export interface FlipDeps {
  session: Session
  boxes: Pick<EditorBoxes, 'rootsByFrame' | 'drawnBoxOf' | 'drawnInFlow' | 'startBoxes' | 'movedBoxes'>
  transformDrag: Pick<EditorTransformDrag, 'writeBoxes'>
}

/** The way each flip action mirrors. */
const FLIP_ACTIONS: Partial<Record<StageAction, FlipAxis>> = { flipHorizontal: 'horizontal', flipVertical: 'vertical' }

/** The way an action flips the selection, or null for an action that isn't a flip. */
export function flipAxisOf(action: StageAction): FlipAxis | null {
  return FLIP_ACTIONS[action] ?? null
}

/**
 * Whether a flip has layers to flip: a frame whose selected layers are none of them locked against
 * resizing, nor, with several, one it would move locked in place.
 */
export function flipReady(design: Design, parts: readonly { ids: readonly string[] }[]): boolean {
  return parts.some(({ ids }) => flipsIn(design, ids))
}

/**
 * Flips the selected layers of each frame along an axis, as one undo step: each in place
 * (`node.flip`), then with several, each that no flow places moved to its mirror across the centre
 * of the box round them all as drawn; the groups round them fit them again. A frame whose layers
 * can't all flip (`flipReady`) is left as it is. Returns whether any frame flipped.
 */
export function flipLayers({ session, boxes, transformDrag }: FlipDeps, axis: FlipAxis): boolean {
  const now = session.design()
  let ran = false
  session.gesture(() => {
    for (const { frame, ids } of boxes.rootsByFrame(now)) {
      const drawn = ids.flatMap((id) => {
        const box = boxes.drawnBoxOf(frame, id, now)
        return box ? [{ id, box }] : []
      })
      if (
        !flipsIn(now, ids) ||
        !runQuietly(() => session.run('node.flip', { ids, axis, drawn: boxes.drawnInFlow(withWrapping(now, ids)) }))
      )
        continue
      ran = true
      const free = lineUpOf(now, ids)
      const moving = drawn.filter(({ id }) => free.includes(id))
      if (ids.length > 1 && moving.length > 0) {
        const around = boundsOf(drawn.map(({ box }) => box))
        const moves = mirrorOffsets(
          moving.map(({ box }) => boundsOf([box])),
          axis,
          around,
        )
        const steps = new Map(moving.map(({ id }, i) => [id, { x: moves[i]?.dx ?? 0, y: moves[i]?.dy ?? 0 }]))
        const movingIds = moving.map(({ id }) => id)
        const start = boxes.startBoxes(frame, movingIds)
        const next = boxes.movedBoxes(frame, movingIds, (id) => steps.get(id) ?? { x: 0, y: 0 })
        transformDrag.writeBoxes(frame, start, next)
      }
      hug(session, ids)
    }
  })
  return ran
}

/** Whether one frame's selected layers can all flip, as `flipReady` says. */
function flipsIn(design: Design, ids: readonly string[]) {
  if (ids.some((id) => design.nodes[id]?.lock?.resize)) return false
  return ids.length === 1 || lineUpOf(design, ids).every((id) => !lockedInPlace(design, id))
}

/**
 * The layers given with the wrapping boxes among what they hold, so where they are drawn is read
 * for those boxes' lines too, wherever they sit.
 */
function withWrapping(design: Design, ids: readonly string[]) {
  const inside = ids.flatMap((id) => descendants(design, id)).filter((id) => boxWraps(design, id))
  return [...ids, ...inside]
}
