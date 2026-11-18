// The press in progress on the stage, and whether it has become a drag: once the pointer has gone
// past the slop (`press.ts`) from where it went down, it stays a drag until the next press. The
// pointer tells it of each press and asks it on each move; the gestures that wait for a drag ask
// it through the pointer, and the pen asks it for the anchor it is placing.
import type { Point } from '@dazbee/schema'

import { pastSlop } from './press.ts'

export interface EditorDragStart {
  /** A press goes down at a stage point, by a pointer of a type: it is a click until it passes the slop. */
  press(at: Point, pointerType: string): void
  /** Whether the press held is a drag, with the pointer at the stage point `at`; once it is, it stays one. */
  moved(at: Point): boolean
  /** Whether the press held, or the last one, never went past the slop. */
  clicking(): boolean
}

export function editorDragStart(): EditorDragStart {
  /** Where the press held went down, on the stage, and by what type of pointer; null before the first. */
  let pressed: { at: Point; pointerType: string } | null = null
  /** Whether the press held has gone past the slop. */
  let dragged = false

  function clicking() {
    return !dragged
  }
  function press(at: Point, pointerType: string) {
    pressed = { at, pointerType }
    dragged = false
  }
  function moved(at: Point) {
    if (!dragged && pressed) dragged = pastSlop(pressed.at, at, pressed.pointerType)
    return dragged
  }

  return { press, moved, clicking }
}
