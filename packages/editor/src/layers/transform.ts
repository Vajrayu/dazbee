// The geometry of moving, resizing and rotating layers (#40), kept free of the editor so it can be
// tested on its own. Boxes are in one frame's design pixels; a box's rotation turns it about its
// centre, as the renderer draws it.
import { type Box, centreOf, normalAngle, type Point, round, turn } from '@dazbee/doc'

export { boundsOf, centreOf, cornersOf, normalAngle, round, turn, type Box } from '@dazbee/doc'

export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

export interface ResizeOptions {
  /** Shift: keep the box's proportions. */
  keepRatio?: boolean
  /** Alt: grow and shrink about the centre instead of the opposite handle. */
  fromCentre?: boolean
}

export const HANDLES: readonly Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
/** A box's four corners, in the order `cornersOf` gives their points: nw, ne, se, sw. */
export const CORNERS: readonly Handle[] = ['nw', 'ne', 'se', 'sw']
/** Shift while rotating: the angle snaps to steps of 15°. */
const ANGLE_STEP = 15

/** Where a handle sits on a box, as a fraction of its width and height. */
export function handleAt(h: Handle): Point {
  return { x: h.includes('w') ? 0 : h.includes('e') ? 1 : 0.5, y: h.includes('n') ? 0 : h.includes('s') ? 1 : 0.5 }
}

/**
 * The box after dragging one of its handles to a point in the frame. The opposite edge or corner
 * stays where it is in the frame (the centre does with `fromCentre`), the rotation is kept, and a
 * drag past the opposite edge just meets it there: the box never turns inside out.
 */
export function resize(box: Box, handle: Handle, to: Point, options: ResizeOptions = {}): Box {
  const c = centreOf(box)
  // In the box's own unturned space, centred on its centre.
  const p = turn(to, c, -box.rotation)
  const local = { x: p.x - c.x, y: p.y - c.y }
  let left = -box.width / 2
  let right = box.width / 2
  let top = -box.height / 2
  let bottom = box.height / 2
  const at = handleAt(handle)
  const sideX = at.x === 0.5 ? 0 : at.x === 0 ? -1 : 1
  const sideY = at.y === 0.5 ? 0 : at.y === 0 ? -1 : 1
  if (sideX === 1) right = Math.max(left, local.x)
  if (sideX === -1) left = Math.min(right, local.x)
  if (sideY === 1) bottom = Math.max(top, local.y)
  if (sideY === -1) top = Math.min(bottom, local.y)
  if (options.fromCentre) {
    if (sideX === 1) left = -Math.max(0, right)
    if (sideX === -1) right = Math.max(0, -left)
    if (sideY === 1) top = -Math.max(0, bottom)
    if (sideY === -1) bottom = Math.max(0, -top)
  }
  if (options.keepRatio && box.width > 0 && box.height > 0) {
    const sx = (right - left) / box.width
    const sy = (bottom - top) / box.height
    // A corner follows whichever side moved more; an edge handle grows the other side about its middle.
    const s = sideX && sideY ? Math.max(sx, sy) : sideX ? sx : sy
    const width = box.width * s
    const height = box.height * s
    const anchorX = options.fromCentre || !sideX ? 0 : sideX === 1 ? left : right
    const anchorY = options.fromCentre || !sideY ? 0 : sideY === 1 ? top : bottom
    if (sideX === 1) right = anchorX + width
    else if (sideX === -1) left = anchorX - width
    else [left, right] = [-width / 2, width / 2]
    if (sideY === 1) bottom = anchorY + height
    else if (sideY === -1) top = anchorY - height
    else [top, bottom] = [-height / 2, height / 2]
    if (options.fromCentre) {
      if (sideX) [left, right] = [-width / 2, width / 2]
      if (sideY) [top, bottom] = [-height / 2, height / 2]
    }
  }
  const width = right - left
  const height = bottom - top
  const centre = turn({ x: c.x + (left + right) / 2, y: c.y + (top + bottom) / 2 }, c, box.rotation)
  return { x: centre.x - width / 2, y: centre.y - height / 2, width, height, rotation: box.rotation }
}

/** Shift while rotating: an angle snapped to the nearest step. */
export const snapAngle = (deg: number) => Math.round(deg / ANGLE_STEP) * ANGLE_STEP

/** The angle of a point about a centre, in degrees. */
export const angleOf = (p: Point, about: Point) => (Math.atan2(p.y - about.y, p.x - about.x) * 180) / Math.PI

/** A box as drawn inside containers: each one turns it about the container's centre. */
export function drawnFrom(box: Box, around: Box[]): Box {
  let c = centreOf(box)
  let rotation = box.rotation
  for (const outer of [...around].reverse()) {
    c = turn(c, centreOf(outer), outer.rotation)
    rotation += outer.rotation
  }
  return { ...box, x: c.x - box.width / 2, y: c.y - box.height / 2, rotation: normalAngle(rotation) }
}
/** Whether a box, turned about its centre as it is drawn, holds a point. */
export function holdsPoint(box: Box, p: Point) {
  const q = turn(p, centreOf(box), -box.rotation)
  return q.x >= box.x && q.y >= box.y && q.x <= box.x + box.width && q.y <= box.y + box.height
}
/** A point in the frame as layers inside containers see it, before the containers turn them. */
export function localTo(p: Point, around: Box[]): Point {
  let q = p
  for (const outer of around) q = turn(q, centreOf(outer), -outer.rotation)
  return q
}
/** Whether a box is unturned in the space it is kept in: its sides run along that space's. */
export const unturned = (box: Box) => box.rotation === 0
/**
 * Whether a layer is upright on the page: `boxes` are the containers around it, outermost first,
 * then the layer's own box, and none of them is turned. Given only the containers, whether what is
 * drawn in them is.
 */
export const uprightOnPage = (boxes: readonly Box[]) => boxes.every(unturned)
/** A point inside `boxes` on whole design pixels when they are upright on the page (`uprightOnPage`); as it is when they are not. */
export const wholeOnPage = (p: Point, boxes: readonly Box[]) => wholeFrom(p, { x: 0, y: 0 }, boxes)
/**
 * A point inside `boxes` a whole number of `step`s from `from` on each axis when they are upright
 * on the page (`uprightOnPage`); as it is when they are not.
 */
export function wholeFrom(p: Point, from: Point, boxes: readonly Box[], step = 1): Point {
  if (!uprightOnPage(boxes)) return p
  const along = (at: number, start: number) => start + Math.round((at - start) / step) * step
  return { x: along(p.x, from.x), y: along(p.y, from.y) }
}
/** A step across the frame as layers inside containers see it: turned back by every container's turn. */
export const localStep = (step: Point, around: Box[]) => turnStep(step, -turnOf(around))
/** A step inside containers as it goes across the frame: turned by every container's turn. */
export const frameStep = (step: Point, around: Box[]) =>
  turnStep(
    step,
    around.reduce((r, b) => r + b.rotation, 0),
  )
/** A point inside containers as it is in the frame: back through each one's turn, innermost first. */
export function pageFrom(q: Point, around: Box[]): Point {
  let p = q
  for (const outer of [...around].reverse()) p = turn(p, centreOf(outer), outer.rotation)
  return p
}

/** A box as drawn in the frame, as layers inside containers keep it: the inverse of drawnFrom. */
export function undrawn(drawn: Box, around: Box[]): Box {
  const c = localTo(centreOf(drawn), around)
  const rotation = normalAngle(around.reduce((r, b) => r - b.rotation, drawn.rotation))
  return {
    x: round(c.x - drawn.width / 2),
    y: round(c.y - drawn.height / 2),
    width: round(drawn.width),
    height: round(drawn.height),
    rotation: round(rotation),
  }
}

/**
 * How far a box's layers move so they stay where they are drawn when the box, turned, changes
 * from `was` to `box`: it turns them about its centre, which has moved.
 */
export function keptOnScreen(was: Box, box: Box): Point {
  if (box.rotation === 0) return { x: 0, y: 0 }
  const v = { x: centreOf(was).x - centreOf(box).x, y: centreOf(was).y - centreOf(box).y }
  const w = turn(v, { x: 0, y: 0 }, -box.rotation)
  return { x: w.x - v.x, y: w.y - v.y }
}

/** Whether a handle is a corner: it moves two edges. */
export const isCorner = (handle: Handle) => handle.length === 2

/** The box a resize of `outer` by `handle` gives at `factor` of its size, its shape kept: about the opposite corner, or the centre. */
export function boxAt(outer: Box, handle: Handle, factor: number, fromCentre: boolean): Box {
  const at = handleAt(handle)
  const width = outer.width * factor
  const height = outer.height * factor
  const anchor = fromCentre
    ? centreOf(outer)
    : { x: outer.x + (1 - at.x) * outer.width, y: outer.y + (1 - at.y) * outer.height }
  const left = fromCentre ? anchor.x - width / 2 : at.x === 1 ? anchor.x : anchor.x - width
  const top = fromCentre ? anchor.y - height / 2 : at.y === 1 ? anchor.y : anchor.y - height
  const centre = turn({ x: left + width / 2, y: top + height / 2 }, centreOf(outer), outer.rotation)
  return { x: centre.x - width / 2, y: centre.y - height / 2, width, height, rotation: outer.rotation }
}

/** A step turned by an angle, in degrees. */
function turnStep(step: Point, degrees: number): Point {
  return turn(step, { x: 0, y: 0 }, degrees)
}
/** How far containers turn what they hold, in all, in degrees. */
function turnOf(around: Box[]) {
  return around.reduce((r, b) => r + b.rotation, 0)
}
