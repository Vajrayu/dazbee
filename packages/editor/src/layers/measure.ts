// Measuring with Alt: the distance lines from the selection's box to another box in one frame, and
// where each line's value sits on the stage; and where a pill beside the pointer sits. Kept free of
// the editor so the maths can be tested on its own. Boxes are the boxes round layers as drawn, along
// the frame's axes, in design pixels.
import type { Point, Rect } from '@dazbee/schema'

import type { Frame } from '../canvas/frames.ts'
import { boundsOf, type Box, round } from './transform.ts'

/** What Alt measures between in a frame: the box round the selection and the box it measures to. */
export interface Measured {
  frame: Frame
  from: Rect
  to: Rect
}

/**
 * A line between two boxes: `axis: 'x'` runs across the page, `'y'` down it. `value` is its length
 * as shown, at most two decimals with no trailing zeros; null for a dashed extension, which shows none.
 */
export interface MeasureLine {
  axis: 'x' | 'y'
  from: Point
  to: Point
  value: string | null
}

/** A value's pill to place: the line it belongs to on the stage and its size, in screen pixels. */
export interface PillToPlace {
  from: Point
  to: Point
  width: number
  height: number
}

/** Screen pixels a pill keeps from what it moves off. */
const PILL_GAP = 2
/** Screen pixels a pill beside the pointer keeps from it, across and down. */
const PILL_OFFSET = 12

/**
 * The lines from box `a`, the selection, to box `b`. A box inside the other gets a line from the
 * inner box to each side of the outer one, along the inner one's middle. Boxes apart get the gap
 * on each axis they are apart on, across the rows or columns they share, else from the middle of
 * `a` with a dashed extension on to `b`. Overlapping boxes get the distances between their
 * matching sides, across the middle of the overlap. Lines with no length are left out.
 */
export function measureBetween(a: Rect, b: Rect): MeasureLine[] {
  const lines: MeasureLine[] = []
  if (holds(b, a)) return inside(a, b)
  if (holds(a, b)) return inside(b, a)
  const ox = overlapMiddle(a.x, a.x + a.width, b.x, b.x + b.width)
  const oy = overlapMiddle(a.y, a.y + a.height, b.y, b.y + b.height)
  const overlapping = a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
  if (overlapping && ox !== null && oy !== null) {
    measured(lines, { x: a.x, y: oy }, { x: b.x, y: oy })
    measured(lines, { x: a.x + a.width, y: oy }, { x: b.x + b.width, y: oy })
    measured(lines, { x: ox, y: a.y }, { x: ox, y: b.y })
    measured(lines, { x: ox, y: a.y + a.height }, { x: ox, y: b.y + b.height })
    return lines
  }
  const middle = { x: a.x + a.width / 2, y: a.y + a.height / 2 }
  const gapX = gapBetween(a.x, a.x + a.width, b.x, b.x + b.width)
  if (gapX) {
    const y = oy ?? middle.y
    measured(lines, { x: gapX.from, y }, { x: gapX.to, y })
    if (oy === null) extension(lines, { x: gapX.to, y }, { x: gapX.to, y: y < b.y ? b.y : b.y + b.height })
  }
  const gapY = gapBetween(a.y, a.y + a.height, b.y, b.y + b.height)
  if (gapY) {
    const x = ox ?? middle.x
    measured(lines, { x, y: gapY.from }, { x, y: gapY.to })
    if (ox === null) extension(lines, { x, y: gapY.to }, { x: x < b.x ? b.x : b.x + b.width, y: gapY.to })
  }
  return lines
}

/** The box round layers as drawn, turned ones included, along the frame's axes. */
export function alongAxes(drawn: Box[]): Rect {
  const { x, y, width, height } = boundsOf(drawn)
  return { x, y, width, height }
}

/**
 * Where each value's pill sits on the stage, in order: at the middle of its line, unless it would
 * cover a pill placed before it or a box in `avoid` (the size label). Then it moves along its own
 * line, away from the first thing it would cover, past each thing it covers in turn, past the
 * line's end when the line has no room.
 */
export function placePills(pills: readonly PillToPlace[], avoid: readonly Rect[]): Rect[] {
  const placed: Rect[] = []
  for (const pill of pills) {
    const across = pill.from.y === pill.to.y
    const centre = { x: (pill.from.x + pill.to.x) / 2, y: (pill.from.y + pill.to.y) / 2 }
    let box = centred(centre, pill)
    let way = 0
    const taken = [...placed, ...avoid]
    for (let tries = 0; tries <= taken.length; tries++) {
      const covered = taken.find((other) => covers(box, other))
      if (!covered) break
      const along = across ? 'x' : 'y'
      const size = across ? pill.width : pill.height
      const otherSize = across ? covered.width : covered.height
      if (way === 0) way = centre[along] < covered[along] + otherSize / 2 ? -1 : 1
      centre[along] = way < 0 ? covered[along] - PILL_GAP - size / 2 : covered[along] + otherSize + PILL_GAP + size / 2
      box = centred(centre, pill)
    }
    placed.push(box)
  }
  return placed
}

/**
 * Where a pill of a size sits beside a point of the stage, as its top left corner, in screen pixels:
 * PILL_OFFSET right of and below it; above it where that would cover a box in `avoid` (the size
 * label) or cross the stage's bottom, and left of it where it would cross the stage's right side.
 * The first of those places that covers nothing and is on the stage, else right of and below.
 */
export function pillBeside(at: Point, size: { width: number; height: number }, avoid: readonly Rect[], stage: Rect) {
  const right = at.x + PILL_OFFSET
  const left = at.x - PILL_OFFSET - size.width
  const below = at.y + PILL_OFFSET
  const above = at.y - PILL_OFFSET - size.height
  const places: Point[] = [
    { x: right, y: below },
    { x: right, y: above },
    { x: left, y: below },
    { x: left, y: above },
  ]
  const free = places.find((place) => {
    const box = { ...place, ...size }
    return holds(stage, box) && !avoid.some((other) => covers(box, other))
  })
  return free ?? { x: right, y: below }
}

/** Whether box `outer` holds box `inner`, sides touching included. */
function holds(outer: Rect, inner: Rect) {
  return (
    outer.x <= inner.x &&
    outer.y <= inner.y &&
    outer.x + outer.width >= inner.x + inner.width &&
    outer.y + outer.height >= inner.y + inner.height
  )
}
/** From `inner` to each side of `outer`, along `inner`'s middle. */
function inside(inner: Rect, outer: Rect) {
  const lines: MeasureLine[] = []
  const x = inner.x + inner.width / 2
  const y = inner.y + inner.height / 2
  measured(lines, { x: outer.x, y }, { x: inner.x, y })
  measured(lines, { x: inner.x + inner.width, y }, { x: outer.x + outer.width, y })
  measured(lines, { x, y: outer.y }, { x, y: inner.y })
  measured(lines, { x, y: inner.y + inner.height }, { x, y: outer.y + outer.height })
  return lines
}
/** The middle of where two spans overlap, or null when they don't. */
function overlapMiddle(a0: number, a1: number, b0: number, b1: number) {
  const low = Math.max(a0, b0)
  const high = Math.min(a1, b1)
  return low <= high ? (low + high) / 2 : null
}
/** A line with its length as its value, unless it has none. */
function measured(lines: MeasureLine[], from: Point, to: Point) {
  const length = Math.abs(to.x - from.x) + Math.abs(to.y - from.y)
  if (length > 0 && Number.isFinite(length))
    lines.push({ axis: from.y === to.y ? 'x' : 'y', from, to, value: String(round(length, 2)) })
}
/** The gap from span a to span b where b lies wholly to one side, past a's end; null when they overlap or touch. */
function gapBetween(a0: number, a1: number, b0: number, b1: number) {
  if (b0 > a1) return { from: a1, to: b0 }
  if (b1 < a0) return { from: a0, to: b1 }
  return null
}
/** A dashed line with no value, unless it has no length. */
function extension(lines: MeasureLine[], from: Point, to: Point) {
  if (from.x !== to.x || from.y !== to.y) lines.push({ axis: from.y === to.y ? 'x' : 'y', from, to, value: null })
}
/** A pill's box centred on a point. */
function centred(centre: Point, size: { width: number; height: number }): Rect {
  return { x: centre.x - size.width / 2, y: centre.y - size.height / 2, width: size.width, height: size.height }
}
/** Whether box a would cover box b, or come closer to it than PILL_GAP. */
function covers(a: Rect, b: Rect) {
  return (
    a.x < b.x + b.width + PILL_GAP &&
    b.x < a.x + a.width + PILL_GAP &&
    a.y < b.y + b.height + PILL_GAP &&
    b.y < a.y + a.height + PILL_GAP
  )
}
