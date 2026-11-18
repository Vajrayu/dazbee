// Moving a frame on its page by a drag on its label: the frame goes where the pointer takes it, in
// whole design pixels, and the whole drag is one undo step.
import type { GestureStep, Session } from '@dazbee/doc'
import type { Point } from '@dazbee/schema'

import type { Frame } from '../../canvas/frames.ts'
import { runQuietly } from '../../run-quietly.ts'

/** A frame being moved, from the press on its label until it is let go. */
export interface FrameMoveDrag {
  kind: 'frameMove'
  /** The frame as it was when pressed. */
  frame: Frame
  /** Where the press went down, in world units. */
  from: Point
  /** Ends the drag's undo step; null until the drag first moves the frame. */
  step: GestureStep | null
}

export interface FrameMoveDeps {
  session: Pick<Session, 'run' | 'beginGesture'>
}

export interface EditorFrameMove {
  /** The drag a press on a frame's label starts, at `world` on the page. */
  start(frame: Frame, world: Point): FrameMoveDrag
  /**
   * Follows the pointer, once the press is a drag: the frame moves by as much as the pointer did;
   * Shift keeps it to the axis it went furthest along.
   */
  drag(g: FrameMoveDrag, world: Point, shift: boolean): void
  /** Ends the drag, closing its undo step. */
  release(g: FrameMoveDrag): void
}

export function editorFrameMove({ session }: FrameMoveDeps): EditorFrameMove {
  function start(frame: Frame, world: Point): FrameMoveDrag {
    return { kind: 'frameMove', frame, from: world, step: null }
  }
  function drag(g: FrameMoveDrag, world: Point, shift: boolean) {
    g.step ??= session.beginGesture('move')
    let dx = world.x - g.from.x
    let dy = world.y - g.from.y
    if (shift && Math.abs(dx) >= Math.abs(dy)) dy = 0
    else if (shift) dx = 0
    const to = { x: Math.round(g.frame.x + dx), y: Math.round(g.frame.y + dy) }
    // Another tab may delete the frame mid-drag; the drag then just leaves it be.
    runQuietly(() => session.run('frame.update', { frameId: g.frame.id, ...to }))
  }
  function release(g: FrameMoveDrag) {
    g.step?.end()
  }

  return {
    start,
    drag,
    release,
  }
}
