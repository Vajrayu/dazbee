// Whether a press on the stage is a click or a drag. Where a press grabs the selection is in
// `hit-zones.ts`, and the press in progress is `drag-start.ts`'s.
import type { Point } from '@dazbee/schema'

/**
 * How far, in screen pixels, a press can wander and still be a click, by pointer type: a mouse and
 * a pen 3, as FigCraft has it, and a finger 8, as the app's own presses have it.
 */
export const CLICK_SLOP = { mouse: 3, pen: 3, touch: 8 } as const

/** The slop of a pointer type, a mouse's for a type it does not know. */
export function slopFor(pointerType: string): number {
  return pointerType === 'touch' || pointerType === 'pen' ? CLICK_SLOP[pointerType] : CLICK_SLOP.mouse
}

/** Whether a pointer at the screen point `at` is further than its slop, in a straight line, from `from`. */
export function pastSlop(from: Point, at: Point, pointerType: string): boolean {
  return Math.hypot(at.x - from.x, at.y - from.y) > slopFor(pointerType)
}
