// Where the layers under a frame or a box go when it is resized: each by its constraints, as
// FigCraft's `apply_constraints` places a frame's children, carried into how Dazbee stores boxes.
// Layers are stored in their frame's space, before any flow's shift, so a parent's move moves what
// it holds; and which layers read constraints at all.
import type { Constraints, Design, Guide, Layer, LayerLock, Point, Rect } from '@dazbee/schema'

import { childrenOf, fitsItsLayers } from './children.ts'
import { hugApplies, isLaidOutBox, placedByFlow, sizingOf } from './flow.ts'
import { boundsOf, carry, round, scaleWithin } from './geometry.ts'

export interface FollowOptions {
  /**
   * `keep` (the default) leaves a layer locked in place at its x and y, and one locked against
   * resizing at its width and height (a turned one about its middle), since `node.update` refuses
   * those writes: a writer that writes only the values that differ from a layer's own writes none
   * of them. `ignore` places every layer alike, for copies nothing has written yet.
   */
  locks?: 'keep' | 'ignore'
}

/** One run of the rule: the design it reads, how it takes locks, and the boxes it gives. */
interface Run {
  design: Design
  locks: 'keep' | 'ignore'
  out: Map<string, Rect>
}

/** Where a layer keeps to when it has no constraints of its own: its parent's left and top. */
export const LEFT_TOP: Constraints = { horizontal: 'left', vertical: 'top' }

/** How near a layer's sides are to its parent's, as a share of the parent's side, for the guess to stretch it. */
const STRETCH_NEAR = 1 / 10

/**
 * The new stored boxes of the layers under a frame or a box, all the way down, when its stored box
 * goes from `from` to `to` (in the frame's space; a frame's own is 0, 0, its width and height).
 * A layer its constraints hold follows them along each axis, a turned one by its drawn bounds; one
 * a flow places moves with the box's start; a group or boolean resized scales what it holds with
 * it, and a box resized or moved applies the rule to what it holds. A side that fits its content
 * keeps its size. A value that changes is rounded to hundredths; one that doesn't stays as stored,
 * and only the layers whose box changes are in it.
 */
export function followingBoxes(
  design: Design,
  parentId: string,
  from: Rect,
  to: Rect,
  options: FollowOptions = {},
): Map<string, Rect> {
  const run: Run = { design, locks: options.locks ?? 'keep', out: new Map() }
  follow(run, parentId, from, to)
  return run.out
}

/** A layer's constraints: its own, or left and top. */
export const constraintsOf = (layer: Layer): Constraints => layer.props.constraints ?? LEFT_TOP

/**
 * Whether a layer's constraints say where it goes when its parent is resized: its parent is a frame
 * or a box and, in a laid-out box, its flow doesn't place it. A layer in a group or a boolean
 * scales with it instead.
 */
export function constraintsApply(design: Design, id: string): boolean {
  const node = design.nodes[id]
  if (!node) return false
  if (Object.hasOwn(design.frames, node.parentId)) return true
  return design.nodes[node.parentId]?.type === 'box' && !placedByFlow(design, id)
}

/**
 * Add size's guess at a layer's constraints, from where it sits in its parent's box, `parent`, both
 * in the frame's space. Along each axis, a layer whose two drawn sides are each within a tenth of
 * the parent's side from the parent's edges stretches, when stretching doesn't bend its look (see
 * `stretches`); any other goes by the third of the parent's side its middle is in: the first keeps
 * to the left (top), the middle to the centre, the last to the right (bottom). Scale, which
 * stretches a layer's shape, is never guessed.
 */
export function guessedConstraints(layer: Layer, parent: Rect): Constraints {
  const drawn = boundsOf([{ ...rectOf(layer), rotation: layer.props.rotation }])
  const along = (axis: 'width' | 'height', start: number, size: number, from: number, side: number) => {
    const near = side * STRETCH_NEAR
    if (stretches(layer, axis) && start - from <= near && from + side - (start + size) <= near) return 'stretch'
    const middle = side > 0 ? (start + size / 2 - from) / side : 0
    return middle < 1 / 3 ? 'start' : middle > 2 / 3 ? 'end' : 'centre'
  }
  const h = along('width', drawn.x, drawn.width, parent.x, parent.width)
  const v = along('height', drawn.y, drawn.height, parent.y, parent.height)
  return {
    horizontal: ({ stretch: 'leftRight', start: 'left', centre: 'center', end: 'right' } as const)[h],
    vertical: ({ stretch: 'topBottom', start: 'top', centre: 'center', end: 'bottom' } as const)[v],
  }
}

/**
 * Add size's guess (`guessedConstraints`) for each layer under a frame or a box, all the way down
 * through the boxes it holds, whose constraints say where it goes and that has none of its own, by
 * its id: each from its place in its parent's box, `parent` for the layers `parentId` holds. A
 * layer in a group or a boolean, or one a flow places, gets none: it isn't placed by constraints.
 */
export function guessesUnder(design: Design, parentId: string, parent: Rect): Map<string, Constraints> {
  const out = new Map<string, Constraints>()
  const walk = (id: string, box: Rect) => {
    for (const [child, layer] of childrenOf(design, id)) {
      if (!layer.props.constraints && constraintsApply(design, child)) out.set(child, guessedConstraints(layer, box))
      if (layer.type === 'box') walk(child, rectOf(layer))
    }
  }
  walk(parentId, parent)
  return out
}

/**
 * The stored boxes that keep every layer in a frame where it is on the page when the frame's place
 * goes from `from` to `to`: each moves in the frame's space by the old place less the new, but a
 * layer locked in place, whose place in the frame is what its lock keeps, and what it holds, which
 * stays in it.
 */
export function stayedBoxes(design: Design, frameId: string, from: Point, to: Point): Map<string, Rect> {
  const dx = from.x - to.x
  const dy = from.y - to.y
  const out = new Map<string, Rect>()
  const shift = (parentId: string) => {
    for (const [id, layer] of childrenOf(design, parentId)) {
      if (layer.lock?.move) continue
      const was = rectOf(layer)
      written(out, id, was, settled(was, { ...was, x: was.x + dx, y: was.y + dy }))
      shift(id)
    }
  }
  if (dx !== 0 || dy !== 0) shift(frameId)
  return out
}

/**
 * A frame's guides when its place goes from `from` to `to` and they stay where they are on the page,
 * as its layers do in `stayedBoxes`: each shifted by its whole-pixel place, old less new, so moves
 * there and back leave them where they were. The guides as given when that place stays.
 */
export function stayedGuides(guides: Guide[] | undefined, from: Point, to: Point): Guide[] | undefined {
  const dx = Math.round(from.x) - Math.round(to.x)
  const dy = Math.round(from.y) - Math.round(to.y)
  if (!guides || (dx === 0 && dy === 0)) return guides
  return guides.map((guide) => ({ ...guide, at: guide.at + (guide.axis === 'x' ? dx : dy) }))
}

/** Places each layer a frame or box holds, as its box goes from `from` to `to`. */
function follow(run: Run, parentId: string, from: Rect, to: Rect) {
  const { design } = run
  if (fitsItsLayers(design.nodes[parentId])) {
    carryInside(run, parentId, from, to)
    return
  }
  for (const [id, layer] of childrenOf(design, parentId)) {
    const was = rectOf(layer)
    const target = constraintsApply(design, id)
      ? constrained(run, id, layer, was, from, to)
      : { ...was, x: was.x + to.x - from.x, y: was.y + to.y - from.y }
    const box = settled(was, kept(run, layer.lock, was, target))
    if (!written(run.out, id, was, box)) continue
    if (fitsItsLayers(layer)) carryInside(run, id, was, box)
    else if (layer.type === 'box') follow(run, id, was, box)
  }
}

function rectOf(layer: Layer): Rect {
  const { x, y, width, height } = layer.props
  return { x, y, width, height }
}

/**
 * Whether a layer stretches along `axis` without bending its look: a box, a text, or a rect or a
 * line graphic, turned by a quarter turn at most, with no image fill in Crop fit (its crop would
 * stretch with its box), and not along a side that fits its content (a text that grows with its
 * words that way, a laid-out box that fits what it holds that way).
 */
function stretches(layer: Layer, axis: 'width' | 'height'): boolean {
  if (layer.props.rotation % 90 !== 0) return false
  const fills = (layer.props as { fills?: { type: string; fit?: string }[] }).fills ?? []
  if (fills.some((paint) => paint.type === 'image' && paint.fit === 'crop')) return false
  // A layer turned a quarter turn either way is drawn with its own height across, and its width down.
  const own = Math.abs(layer.props.rotation % 180) === 90 ? ({ width: 'height', height: 'width' } as const)[axis] : axis
  if ((layer.type === 'text' || isLaidOutBox(layer)) && sizingOf(layer)[own] === 'hug') return false
  if (layer.type === 'box' || layer.type === 'text') return true
  return layer.type === 'graphic' && (layer.props.shape.kind === 'rect' || layer.props.shape.kind === 'line')
}

/** Puts a layer's box in `out` when it differs from the one it has; whether it did. */
function written(out: Map<string, Rect>, id: string, was: Rect, box: Rect): boolean {
  const changed = box.x !== was.x || box.y !== was.y || box.width !== was.width || box.height !== was.height
  if (changed) out.set(id, box)
  return changed
}

/** A box rounded to hundredths where it changes from `was`; where it rounds to the same, `was`'s own value. */
function settled(was: Rect, box: Rect): Rect {
  const one = (now: number, then: number) => (round(now) === round(then) ? then : round(now))
  return {
    x: one(box.x, was.x),
    y: one(box.y, was.y),
    width: one(box.width, was.width),
    height: one(box.height, was.height),
  }
}

/**
 * Every layer under a group or boolean, scaled with it from `from` to `to`, keeping its place in
 * it; what a layer whose lock keeps its box holds is carried with the box the lock leaves it.
 */
function carryInside(run: Run, id: string, from: Rect, to: Rect) {
  for (const [inner, layer] of childrenOf(run.design, id)) {
    const was = rectOf(layer)
    const box = settled(was, kept(run, layer.lock, was, carry({ ...was, rotation: layer.props.rotation }, from, to)))
    written(run.out, inner, was, box)
    const locked = run.locks === 'keep' && (layer.lock?.move || layer.lock?.resize)
    if (locked) carryInside(run, inner, was, box)
    else carryInside(run, inner, from, to)
  }
}

/**
 * A layer's box, `was`, by its constraints when its parent goes from `from` to `to`. A turned
 * layer's drawn bounds follow them, and its middle goes to the middle of their new place, its own
 * sides scaled by how much that stretches them. A side that fits its content keeps its size, and
 * so do both sides of a layer whose lock keeps them.
 */
function constrained(run: Run, id: string, layer: Layer, was: Rect, from: Rect, to: Rect): Rect {
  const c = constraintsOf(layer)
  const own = sizingOf(layer)
  const hugs = hugApplies(run.design, id)
  const sized = run.locks === 'keep' && layer.lock?.resize === true
  const fits = { width: sized || (hugs && own.width === 'hug'), height: sized || (hugs && own.height === 'hug') }
  const { rotation } = layer.props
  if (rotation === 0) {
    const [x, width] = along(c.horizontal, was.x - from.x, was.width, from.width, to.width, fits.width)
    const [y, height] = along(c.vertical, was.y - from.y, was.height, from.height, to.height, fits.height)
    return { x: to.x + x, y: to.y + y, width, height }
  }
  const turned = { ...was, rotation }
  const bounds = boundsOf([turned])
  const [x, width] = along(c.horizontal, bounds.x - from.x, bounds.width, from.width, to.width, false)
  const [y, height] = along(c.vertical, bounds.y - from.y, bounds.height, from.height, to.height, false)
  const next = scaleWithin(turned, bounds, { x: to.x + x, y: to.y + y, width, height, rotation: 0 })
  return {
    x: fits.width ? next.x + (next.width - was.width) / 2 : next.x,
    y: fits.height ? next.y + (next.height - was.height) / 2 : next.y,
    width: fits.width ? was.width : next.width,
    height: fits.height ? was.height : next.height,
  }
}

/**
 * One axis of a box by its constraint, as a start from the parent's start and a size, when the
 * parent's side goes from `was` to `now` (FigCraft's arithmetic): a size never below 0, kept when
 * the side fits its content.
 */
function along(
  c: Constraints['horizontal'] | Constraints['vertical'],
  start: number,
  size: number,
  was: number,
  now: number,
  fits: boolean,
): [number, number] {
  const d = now - was
  let s = start
  let e = start + size
  if (c === 'right' || c === 'bottom') {
    s += d
    e += d
  } else if (c === 'leftRight' || c === 'topBottom') e += d
  else if (c === 'center') {
    s += d / 2
    e += d / 2
  } else if (c === 'scale') {
    const k = was > 0 ? now / was : 1
    s *= k
    e *= k
  }
  return [s, fits ? size : Math.max(0, e - s)]
}

/** A box with the place or size a layer's lock keeps put back, under `keep`. */
function kept(run: Run, lock: LayerLock | undefined, was: Rect, box: Rect): Rect {
  if (run.locks === 'ignore' || !lock) return box
  return {
    x: lock.move ? was.x : box.x,
    y: lock.move ? was.y : box.y,
    width: lock.resize ? was.width : box.width,
    height: lock.resize ? was.height : box.height,
  }
}
