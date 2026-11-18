// What a resize of layers changes: their boxes and those of the layers under them (what a box holds
// following its constraints, or kept where it is on the page), the text a corner scales, and the
// sizing of the axes it drags, which stop following their content. And the one patch that sets how
// a side of a layer sizes, which a resize, a size typed and the sizing menu all write.
import {
  ancestorsOf,
  type Axis,
  carry,
  childrenOf,
  descendants,
  fillFixesBox,
  fitsItsLayers,
  followingBoxes,
  placedByFlow,
  type ScaledText,
  scaleWithin,
  type Session,
  type Sizing,
  sizingOf,
} from '@dazbee/doc'
import type { Design, Layer, Point, Rect } from '@dazbee/schema'

import { runQuietly } from '../run-quietly.ts'
import { type Box, type Handle, isCorner, keptOnScreen } from './transform.ts'

/** What sizingPatch reads of a layer: its type, its own sizing and a text's box mode. */
type SizedLayer = Parameters<typeof sizingOf>[0]

/**
 * The boxes a resize from `from` to `to` gives `roots` and the layers under them, from their drawn
 * `boxes` and the design `start` as the resize began: one root takes `to`, several scale within it.
 * A group or boolean scales what it holds with it. What a box holds follows its constraints
 * (`followingBoxes`), worked out on stored boxes and given back drawn: each layer moves and resizes
 * as far as the rule moves and resizes its stored box, placed by `shiftNow`, how far each is drawn
 * from where it is stored as the design is now, where given. With `keep` (the deep key held) what a
 * box holds stays where it is on the page instead.
 */
export function resizedBoxes(
  start: Design,
  roots: string[],
  boxes: Map<string, Box>,
  from: Box,
  to: Box,
  keep = false,
  shiftNow?: (id: string) => Point | null,
): Map<string, Box> {
  const next = new Map<string, Box>()
  for (const root of roots) {
    const was = boxes.get(root)
    if (!was) continue
    const scaled = roots.length === 1 ? to : scaleWithin(was, from, to)
    // Auto layout places a layer in its flow: a resize gives it a size, never a place.
    const box = placedByFlow(start, root) ? { ...scaled, x: was.x, y: was.y, rotation: was.rotation } : scaled
    next.set(root, box)
    const type = start.nodes[root]?.type
    if (fitsItsLayers(start.nodes[root])) {
      // Layers inside a group or boolean keep their place in it, scaled with it.
      for (const id of descendants(start, root)) {
        const inner = boxes.get(id)
        if (inner) next.set(id, carry(inner, was, box))
      }
    } else if (type === 'box' && keep) {
      // A box changes its own size only: what it holds stays where it is on screen.
      const shift = keptOnScreen(was, box)
      for (const id of descendants(start, root)) {
        const inner = boxes.get(id)
        if (inner) next.set(id, { ...inner, x: inner.x + shift.x, y: inner.y + shift.y })
      }
    } else if (type === 'box') {
      // A layer the rule leaves takes its box as the resize began, so one it moved earlier goes back.
      const followed = followingDrawn(start, root, was, box, (id) => boxes.get(id))
      for (const id of descendants(start, root)) {
        const inner = boxes.get(id)
        if (!inner) continue
        const drawn = followed.get(id) ?? inner
        // Drawn where the flows now draw what the box holds, which a box a flow centres moves as it grows.
        const shift = shiftNow?.(id)
        const stored = rectOf(start, id)
        next.set(
          id,
          shift
            ? { ...drawn, x: drawn.x - inner.x + stored.x + shift.x, y: drawn.y - inner.y + stored.y + shift.y }
            : drawn,
        )
      }
    }
  }
  return next
}

/**
 * Where the layers a box holds go by their constraints (`followingBoxes`) when its drawn box goes
 * from `was` to `now`, as drawn boxes. The rule works on stored boxes: the box's stored box moves
 * and resizes as far as its drawn one, and each layer it changes as far as its stored box does,
 * from the box `drawnOf` gives it. A layer with no drawn box, which a flow places with all it holds,
 * is left out, as is one the rule leaves where it is.
 */
export function followingDrawn<B extends Rect>(
  design: Design,
  id: string,
  was: Rect,
  now: Rect,
  drawnOf: (id: string) => B | undefined,
): Map<string, B> {
  const stored = rectOf(design, id)
  const to = movedAs(stored, was, now)
  const out = new Map<string, B>()
  for (const [inner, rect] of followingBoxes(design, id, stored, to)) {
    const drawn = drawnOf(inner)
    if (drawn) out.set(inner, movedAs(drawn, rectOf(design, inner), rect))
  }
  return out
}

/**
 * The design as it is now, held for a resize of `roots`: their layers, what holds them and what
 * they hold, which each move of the resize works from while the design it reads changes under it.
 */
export function heldDesign(design: Design, roots: string[]): Design {
  const nodes: Record<string, Layer> = {}
  for (const root of roots)
    for (const id of [...ancestorsOf(design, root), root, ...descendants(design, root)]) {
      const layer = design.nodes[id]
      if (layer) nodes[id] = layer
    }
  return { ...design, frames: { ...design.frames }, nodes }
}

/**
 * The text a corner drag on `roots` scales, with its sizes now: each text whose box scales with the
 * drag, selected itself or in a group, not one in a box, whose text keeps its size. A text whose
 * style is locked isn't scaled.
 */
export function scalingTexts(now: Design, roots: string[], handle: Handle): Map<string, ScaledText> {
  const texts = new Map<string, ScaledText>()
  if (!isCorner(handle)) return texts
  const add = (id: string) => {
    const node = now.nodes[id]
    if (node?.type !== 'text' || node.lock?.style) return
    const { props } = node
    texts.set(id, {
      style: props.style,
      runs: props.runs,
      ...(props.paragraphSpacing === undefined ? {} : { paragraphSpacing: props.paragraphSpacing }),
      ...(props.shrinkToFit ? { shrinkToFit: props.shrinkToFit } : {}),
    })
  }
  const walk = (id: string) => {
    const type = now.nodes[id]?.type
    if (type === 'text') add(id)
    else if (fitsItsLayers(now.nodes[id])) for (const [child] of childrenOf(now, id)) walk(child)
  }
  for (const id of roots) walk(id)
  return texts
}

/**
 * The patch that sizes sides of a layer as `to` says, Fixed, Fit content or Fill, writing only what
 * changes. Text keeps its box mode in step: it fits its words across only while it fits them down
 * too, so fitting its width fits its height, and fixing its height fixes its width. Its own sizing
 * is written only where it has one or a side fills, which its box mode can't say.
 */
export function sizingPatch(layer: SizedLayer, to: Partial<Record<Axis, Sizing>>): Record<string, unknown> {
  const was = sizingOf(layer)
  const next = { ...was, ...to }
  if (layer.type !== 'text') return sameSizing(next, was) ? {} : { sizing: next }
  if (to.height === 'fixed' && next.width === 'hug') next.width = 'fixed'
  if (to.width === 'hug' && next.height === 'fixed') next.height = 'hug'
  const patch: Record<string, unknown> = {}
  const boxMode = next.width === 'hug' ? 'autoWidth' : next.height === 'hug' ? 'autoHeight' : 'fixed'
  if (boxMode !== layer.props.boxMode) patch.boxMode = boxMode
  const own = layer.props.sizing !== undefined || next.width === 'fill' || next.height === 'fill'
  if (own && !sameSizing(next, was)) patch.sizing = next
  return patch
}

/**
 * The patches that size the sides of layers as `to` says, by layer. Fill along the flow of a box
 * that fits what it holds fixes that box there too (`fillFixesBox`), so it keeps the size it is
 * drawn at and leaves the room to fill; a box given itself takes the sides asked of it instead.
 */
export function sizingPatches(
  design: Design,
  ids: string[],
  to: Partial<Record<Axis, Sizing>>,
): Map<string, Record<string, unknown>> {
  const patches = new Map<string, Record<string, unknown>>()
  for (const id of ids) {
    const node = design.nodes[id]
    if (!node) continue
    patches.set(id, sizingPatch(node, to))
    const box = design.nodes[node.parentId]
    if (!box || ids.includes(node.parentId)) continue
    const fixes = (['width', 'height'] as const).filter((axis) => to[axis] === 'fill' && fillFixesBox(design, id, axis))
    if (fixes.length > 0) patches.set(node.parentId, sizingPatch(box, sidesTo(fixes, 'fixed')))
  }
  return patches
}

/**
 * At the start of a resize, the axes it drags stop following their content, as in Figma: each
 * becomes Fixed (`sizingPatch`). Text a corner scales keeps the sides that grow with its words, so
 * only a side of it that filled becomes Fixed.
 */
export function switchSizing(
  session: Session,
  ids: string[],
  handle: Handle,
  from: Design,
  scaled: ReadonlyMap<string, unknown>,
) {
  const dragged = (['width', 'height'] as const).filter((axis) =>
    axis === 'width' ? handle.includes('e') || handle.includes('w') : handle.includes('n') || handle.includes('s'),
  )
  for (const id of ids) {
    const node = from.nodes[id]
    if (!node) continue
    const sides = scaled.has(id) ? dragged.filter((axis) => sizingOf(node)[axis] === 'fill') : dragged
    const patch = sizingPatch(node, sidesTo(sides, 'fixed'))
    if (Object.keys(patch).length > 0) runQuietly(() => session.run('node.update', { ids: [id], patch }))
  }
}

/** A layer's stored box. */
function rectOf(design: Design, id: string): Rect {
  const { x = 0, y = 0, width = 0, height = 0 } = design.nodes[id]?.props ?? {}
  return { x, y, width, height }
}

/** A box moved and resized as far as `was` goes to `now`. */
function movedAs<B extends Rect>(drawn: B, was: Rect, now: Rect): B {
  return {
    ...drawn,
    x: drawn.x + now.x - was.x,
    y: drawn.y + now.y - was.y,
    width: drawn.width + now.width - was.width,
    height: drawn.height + now.height - was.height,
  }
}

/** Each of `sides` set to `to`. */
function sidesTo(sides: readonly Axis[], to: Sizing): Partial<Record<Axis, Sizing>> {
  return Object.fromEntries(sides.map((axis) => [axis, to]))
}

/** Whether two sizings are the same on both sides. */
function sameSizing(a: Record<Axis, Sizing>, b: Record<Axis, Sizing>) {
  return a.width === b.width && a.height === b.height
}
