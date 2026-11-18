// Flipping layers: each mirrored across its own vertical or horizontal centre line as it is drawn,
// with what it holds. A layer's flag mirrors only what it draws itself, so the layers inside a
// flipped one are rewritten: each mirrored about the flipped layer's centre, its turn negated and
// its own flag toggled; a laid-out box's flow runs the other way along the flipped axis, a wrapping
// one line by line as it is drawn.
import { z } from 'zod'

import {
  type AutoLayout,
  type Design,
  gridColumns,
  type Layer,
  type LayerLimits,
  NodeId,
  type Rect,
} from '@dazbee/schema'

import { ancestorsOf, descendants, isInside } from '../children.ts'
import { boxWraps, flowOf, laidOutBox, sizingOf } from '../flow.ts'
import { boundsOf, centreOf, normalAngle } from '../geometry.ts'
import type { StoreWrite } from '../store.ts'
import { wrapLines } from '../wrap-lines.ts'
import { type BoxPlan, boxPlan, DrawnBoxes, placeDrawn } from './box-plan.ts'
import { lockProblem, missingLayer } from './checks.ts'
import { defineCommand } from './define.ts'

/** Which way a flip mirrors: `horizontal` swaps left and right, `vertical` top and bottom. */
export type FlipAxis = 'horizontal' | 'vertical'

/** Below this, two lengths along a flow are the same. */
const NEAR = 1e-6

/** The layer types that draw something of their own, which their own flag mirrors. */
const FLIPPED_TYPES: ReadonlySet<string> = new Set(['graphic', 'text', 'box', 'boolean'])

/**
 * Mirrors layers across their own centre line, with what they hold (#604, item 4.2): `horizontal`
 * left to right, `vertical` top to bottom, as they are drawn in their frame, also inside a turned
 * group. Each layer keeps its box; its turn and flag change, and every layer inside it is mirrored
 * about its centre. Flipping twice gives back the same layers. A layer given inside another given
 * one flips with it alone.
 */
export const nodeFlip = defineCommand({
  name: 'node.flip',
  description:
    'Mirrors layers left to right or top to bottom across their own centre line as they are drawn, with what they hold, so flipping twice gives back the same layers. It refuses a missing layer, one locked against resizing, and one whose layers would be mirrored past where a layer can be.',
  step: 'flip',
  input: z.strictObject({
    ids: z.array(NodeId).min(1).describe('The layers to flip, each about its own centre.'),
    axis: z
      .enum(['horizontal', 'vertical'])
      .describe('Which way to mirror: horizontal swaps left and right, vertical swaps top and bottom.'),
    drawn: DrawnBoxes.optional().describe(
      'Where the layers and what they hold are drawn, so layers in a row, column or grid are mirrored where they are drawn.',
    ),
  }),
  check: ({ design }, { ids, axis, drawn = {} }) => {
    const missing = missingLayer(design, ids)
    if (missing) return missing
    for (const id of ids) {
      const locked = lockProblem(id, design.nodes[id] as NonNullable<Design['nodes'][string]>, 'resize')
      if (locked) return locked
    }
    const roots = rootsOf(design, ids)
    const plan = flipPlan(design, roots, axis, drawn)
    const far = roots
      .flatMap((root) => [root, ...descendants(design, root)])
      .find((id) => Object.values(plan.get(id)).some((v) => typeof v === 'number' && !Number.isFinite(v)))
    return far === undefined ? undefined : `"${far}" would be mirrored past where a layer can be`
  },
  apply: ({ w, design }, { ids, axis, drawn = {} }) => {
    const roots = rootsOf(design, ids)
    flipPlan(design, roots, axis, drawn).write(w)
    for (const root of roots) {
      for (const id of [root, ...descendants(design, root)]) {
        toggleFlag(w, design, id, axis)
        if (laidOutBox(design, id)) mirrorFlow(w, design, id, axis, drawn)
      }
    }
  },
})

/** The layers given that aren't inside another given one: what flips them all. */
function rootsOf(design: Design, ids: readonly string[]) {
  return ids.filter((id) => !ids.some((other) => other !== id && isInside(design, id, other)))
}

/** The boxes of `roots` and what they hold, at their `drawn` boxes, each root flipped in place. */
function flipPlan(design: Design, roots: readonly string[], axis: FlipAxis, drawn: DrawnBoxes): BoxPlan {
  const plan = boxPlan(design)
  const own = Object.entries(drawn).filter(([id]) => roots.some((root) => isInside(design, id, root)))
  placeDrawn(plan, design, Object.fromEntries(own))
  for (const root of roots) mirrorInPlan(plan, design, root, axis)
  return plan
}

/**
 * Plans a layer flipped in place: its turn so it is drawn mirrored in its frame across the
 * containers' turns, and every layer inside it mirrored about its centre, each turn negated.
 */
function mirrorInPlan(plan: BoxPlan, design: Design, root: string, axis: FlipAxis) {
  const at = plan.get(root)
  const around = ancestorsOf(design, design.nodes[root]?.parentId ?? '').reduce(
    (sum, id) => sum + plan.get(id).rotation,
    0,
  )
  plan.set(root, { rotation: normalAngle(-at.rotation - 2 * around) })
  const c = centreOf(at)
  for (const id of descendants(design, root)) {
    const b = plan.get(id)
    plan.set(id, {
      ...(axis === 'horizontal' ? { x: 2 * c.x - b.x - b.width } : { y: 2 * c.y - b.y - b.height }),
      rotation: normalAngle(-b.rotation),
    })
  }
}

/** Toggles a layer's own flag along the axis: set when it comes on, taken out when it goes off. */
function toggleFlag(w: StoreWrite, design: Design, id: string, axis: FlipAxis) {
  const node = design.nodes[id]
  if (!node || !FLIPPED_TYPES.has(node.type)) return
  const key = axis === 'horizontal' ? 'flipX' : 'flipY'
  if ((node.props as Record<string, unknown>)[key]) w.unsetProp(id, key)
  else w.setProp(id, key, true)
}

/**
 * Mirrors a laid-out box's flow along the axis, as its drawing is mirrored: its lining up along the
 * axis swaps start and end, and so do its paddings either side, and its flow runs the other way
 * along the axis (a grid's within each row across it, and row by row down it while every row is
 * full; a wrapping row's or column's within each line along it, as `drawn` shows its lines, where
 * they still break there). A flow holding a mask keeps its order, so the mask still masks what it
 * masked.
 */
function mirrorFlow(w: StoreWrite, design: Design, id: string, axis: FlipAxis, drawn: DrawnBoxes) {
  const node = design.nodes[id]
  const layout = node?.type === 'box' ? node.props.layout : undefined
  if (!layout) return
  w.setProp(id, 'layout', mirroredLayout(layout, axis))
  const flow = flowOf(design, id)
  if (flow.some(([, layer]) => layer.props.mask)) return
  const slots = boxWraps(design, id) ? wrapSlots(flow, drawn, layout, axis) : flowSlots(flow.length, layout, axis)
  if (!slots) return
  const keys = flow.map(([, layer]) => layer.index)
  flow.forEach(([child, layer], i) => {
    const key = keys[slots[i] ?? i]
    if (key !== undefined && key !== layer.index) w.set('layer', child, 'index', key)
  })
}

/** A layout mirrored along an axis: the lining up along it and the paddings either side swapped. */
export function mirroredLayout(layout: AutoLayout, axis: FlipAxis): AutoLayout {
  const swap = <T extends string>(v: T) => (v === 'start' ? 'end' : v === 'end' ? 'start' : v) as T
  const key = (layout.direction === 'column') === (axis === 'horizontal') ? 'align' : 'justify'
  const { top, right, bottom, left } = layout.padding
  const padding =
    axis === 'horizontal' ? { top, right: left, bottom, left: right } : { top: bottom, right, bottom: top, left }
  return { ...layout, padding, [key]: swap(layout[key]) }
}

/**
 * The slot each of a flow's `n` layers goes to once it is mirrored along the axis, or null where the
 * flow keeps its order: a row across and a column down run backwards; a grid across has each row
 * reversed, and down has its rows reversed while each is full.
 */
function flowSlots(n: number, layout: AutoLayout, axis: FlipAxis): number[] | null {
  const across = axis === 'horizontal'
  if (layout.direction !== 'grid') {
    if ((layout.direction === 'row') !== across) return null
    return Array.from({ length: n }, (_, i) => n - 1 - i)
  }
  const columns = gridColumns(layout)
  if (across)
    return Array.from({ length: n }, (_, i) => {
      const start = i - (i % columns)
      return start + Math.min(columns, n - start) - 1 - (i - start)
    })
  if (n % columns !== 0) return null
  const rows = n / columns
  return Array.from({ length: n }, (_, i) => (rows - 1 - Math.floor(i / columns)) * columns + (i % columns))
}

/**
 * The slot each of a wrapping flow's layers goes to once it is mirrored along its flow, from where
 * they are `drawn`, or null where it keeps its order: each line runs backwards, while the lines
 * still break where they did, since a line's new first layer takes no less of a line than its old
 * one (a layer that fills along it takes its least length). Across the flow, and where a layer
 * isn't drawn or a line would break elsewhere, the order is kept: the lines break from the start,
 * so no other order draws them mirrored.
 */
function wrapSlots(flow: [string, Layer][], drawn: DrawnBoxes, layout: AutoLayout, axis: FlipAxis): number[] | null {
  const row = layout.direction === 'row'
  if (row !== (axis === 'horizontal')) return null
  const rooms: Rect[] = []
  for (const [id, layer] of flow) {
    const box = drawn[id]
    if (!box) return null
    rooms.push(boundsOf([{ ...box, rotation: layer.props.rotation }]))
  }
  const along = (i: number) => {
    const layer = flow[i]?.[1]
    if (layer && sizingOf(layer)[row ? 'width' : 'height'] === 'fill')
      return (row ? (layer.props as LayerLimits).minWidth : (layer.props as LayerLimits).minHeight) ?? 0
    return row ? (rooms[i]?.width ?? 0) : (rooms[i]?.height ?? 0)
  }
  const lines = wrapLines(rooms, row)
  const keeps = lines.every((line, k) => k === 0 || along(line.at(-1) ?? 0) >= along(line[0] ?? 0) - NEAR)
  if (!keeps) return null
  const slots: number[] = []
  lines
    .flatMap((line) => [...line].reverse())
    .forEach((from, to) => {
      slots[from] = to
    })
  return slots
}
