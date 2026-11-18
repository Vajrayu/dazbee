// The radius dots over the stage, as overlay elements: each in its layer's box, which turns them
// with the layer, the one under the pointer or dragged drawn big; and while one is dragged, the
// gap's pill beside the pointer with the radius's words, placed once drawn.
import type { Point, Rect } from '@dazbee/schema'

import { px } from '../../canvas/rulers.ts'
import { pillBeside } from '../../layers/measure.ts'
import type { ShownDot } from './radius-drag.ts'

/** The radius pill drawn, and what places it beside the pointer once it is on the overlay, clear of `avoid` and on `stage`. */
export interface RadiusPillParts {
  pills: HTMLElement[]
  place(at: Point, avoid: readonly Rect[], stage: Rect): void
}

/** The dots, each placed by its corner in its layer's box on screen. */
export function radiusDotParts(dots: readonly ShownDot[]): HTMLElement[] {
  return dots.map((dot) => {
    const el = document.createElement('div')
    el.className = 'radius-dot'
    el.dataset.corner = String(dot.corner)
    if (dot.big) el.dataset.big = ''
    Object.assign(el.style, { left: px(dot.x), top: px(dot.y) })
    return el
  })
}

/** The pill with the words of the radius dragged; none with no drag. */
export function radiusPillParts(label: string | null): RadiusPillParts {
  if (label === null) return { pills: [], place: () => {} }
  const pill = document.createElement('span')
  pill.className = 'gap-size radius-value'
  pill.textContent = label
  function place(at: Point, avoid: readonly Rect[], stage: Rect) {
    const size = { width: pill.offsetWidth, height: pill.offsetHeight }
    const { x, y } = pillBeside(at, size, avoid, stage)
    Object.assign(pill.style, { left: px(x), top: px(y) })
  }
  return { pills: [pill], place }
}
