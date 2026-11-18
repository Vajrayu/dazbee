// The constraint lines over the stage while the page asks for them: for each layer, a dashed line
// from each side it keeps to, to its parent's side, and a short solid bar through its middle along
// each axis it keeps to the centre; none for scale. They are worked out in the parent's own space,
// from the layer's drawn bounds there, and turned with the containers around the layer.
import type { Constraints, Rect } from '@dazbee/schema'

import { boundsOf, type Box, drawnFrom } from '../layers/transform.ts'
import type { Frame } from './frames.ts'

/** A layer the lines are drawn for, in its parent's own space: the space its box is kept in. */
export interface Constrained {
  id: string
  frame: Frame
  /** Its box in its parent's own space, turned as it is. */
  box: Box
  /** Its parent's box in that space, unturned: the frame's whole box, or the box that holds it. */
  parent: Rect
  /** The containers around the layer, outermost first, its parent last, which turn what is drawn in them. */
  around: Box[]
  constraints: Constraints
}

/** The way a line or bar runs: across the parent's space or down it. */
type Run = 'across' | 'down'

/** Screen pixels a centre bar reaches each way from the layer's middle. */
const BAR_REACH = 8

/**
 * The lines and bars of each layer, in the order given: across first (left, right, then the bar),
 * then down (top, bottom, then the bar). `zoom` keeps a bar the same length on screen.
 */
export function constraintParts(
  layers: readonly Constrained[],
  zoom: number,
  outline: (className: string, frame: Frame, box: Box) => HTMLElement,
): HTMLElement[] {
  const parts: HTMLElement[] = []
  const reach = BAR_REACH / zoom
  for (const { id, frame, box, parent, around, constraints } of layers) {
    const bounds = boundsOf([box])
    const middle = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
    /** A part from `from` to `to` along `run`, through the layer's middle the other way. */
    const add = (className: string, run: Run, from: number, to: number, side?: string) => {
      const start = Math.min(from, to)
      const length = Math.abs(to - from)
      const segment =
        run === 'across'
          ? { x: start, y: middle.y, width: length, height: 0, rotation: 0 }
          : { x: middle.x, y: start, width: 0, height: length, rotation: 0 }
      const el = outline(className, frame, drawnFrom(segment, around))
      el.dataset.layer = id
      if (side) el.dataset.side = side
      el.dataset.run = run
      parts.push(el)
    }
    const { horizontal, vertical } = constraints
    const right = bounds.x + bounds.width
    const bottom = bounds.y + bounds.height
    if (horizontal === 'left' || horizontal === 'leftRight')
      add('constraint-line', 'across', parent.x, bounds.x, 'left')
    if (horizontal === 'right' || horizontal === 'leftRight')
      add('constraint-line', 'across', right, parent.x + parent.width, 'right')
    if (horizontal === 'center') add('constraint-bar', 'across', middle.x - reach, middle.x + reach)
    if (vertical === 'top' || vertical === 'topBottom') add('constraint-line', 'down', parent.y, bounds.y, 'top')
    if (vertical === 'bottom' || vertical === 'topBottom')
      add('constraint-line', 'down', bottom, parent.y + parent.height, 'bottom')
    if (vertical === 'center') add('constraint-bar', 'down', middle.y - reach, middle.y + reach)
  }
  return parts
}
