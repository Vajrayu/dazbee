// Whether layers a drag carries can leave their frame for another frame of the page, and the frame
// they would go into: the one under the pointer, as FigCraft's `drag_parent` decides it.
import { isMask, maskOf } from '@dazbee/doc'
import type { Design, Point } from '@dazbee/schema'

import { type Frame, frameAt } from '../../canvas/frames.ts'

/**
 * Whether the layers a drag carries, all of one frame, can leave it, all of them or none: no layer
 * of another frame is dragged with them (`othersCarried`), each one's parent is that frame or a box,
 * none is a mask or masked by one, and none is locked in place. So a layer in a group or a boolean
 * stays in it, as does a layer of a Mask group, while the Mask group itself can leave.
 */
export function canLeaveFrame(design: Design, roots: readonly string[], othersCarried: boolean): boolean {
  if (othersCarried || roots.length === 0) return false
  return roots.every((id) => {
    const node = design.nodes[id]
    if (!node || isMask(node) || maskOf(design, id) !== null || node.lock?.move) return false
    const parent = design.nodes[node.parentId]
    return !parent || parent.type === 'box'
  })
}

/**
 * The frame of the shown page under a page point that layers of `own` would go into when dropped:
 * one other than their own, when they can leave it. Null over their own frame, between frames, or
 * when they can't leave.
 */
export function targetFrame(frames: readonly Frame[], p: Point, own: string, canLeave: boolean): Frame | null {
  if (!canLeave) return null
  const under = frameAt(frames, p)
  return under && under.id !== own ? under : null
}
