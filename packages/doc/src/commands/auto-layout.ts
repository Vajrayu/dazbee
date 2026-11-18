// Setting a box's layout: Free, or a row, a column or a grid, its settings read off where its
// children are, so that laying out moves nothing when the children already sit in an even row or
// column, and going Free leaves everything where it is drawn.
import { z } from 'zod'

import { type AutoLayout, NodeId, type Rect } from '@dazbee/schema'

import { flowOf } from '../flow.ts'
import { boundsOf, round } from '../geometry.ts'
import { boxPlan, DrawnBoxes, writeDrawn } from './box-plan.ts'
import { lockProblem, missingLayer } from './checks.ts'
import { defineCommand } from './define.ts'
import { layerSlots, type Slot, writeOrder } from './tree.ts'

/** A box's layout to set: Free, a row or column read off its layers (`auto`), or the one named. */
export const BoxLayout = z.enum(['auto', 'row', 'column', 'grid', 'free'])
export type BoxLayout = z.infer<typeof BoxLayout>

interface Inferred {
  direction: 'row' | 'column'
  gap: number
  padding: { top: number; right: number; bottom: number; left: number }
  justify: 'start'
  align: 'start' | 'center' | 'end'
}

/** A Free box's first grid: the default columns, nothing between or around, every layer at its cell's start. */
const GRID_START: AutoLayout = {
  direction: 'grid',
  gap: 0,
  padding: { top: 0, right: 0, bottom: 0, left: 0 },
  justify: 'start',
  align: 'start',
}

/**
 * Sets a box's layout. From Free, a row or column is read off where its children are, along the
 * axis named or, for `auto`, the one they follow, and the children are put in the order the flow
 * takes them, so a box whose children already sit in an even row or column looks the same; a grid
 * starts from its defaults with the children in layer order; the box then fits what it holds both
 * ways, keeping its stored size while nothing is in its flow. From another layout, Between, Around, Line up and how the
 * box sizes are kept (a grid starts what was spread out at the start, and a row or column keeps no columns). Going Free, the box and its layers are first
 * stored where `drawn` says they are drawn, what each holds moved along, and the box is fixed both
 * ways, so nothing moves. The layout a box has, or `auto` on a laid-out box, changes nothing. Its
 * linked copies in other frames stay as they are.
 */
export const nodeAutoLayout = defineCommand({
  name: 'node.autoLayout',
  description:
    'Lays out what a box holds as a row, a column or a grid, or sets it Free again with nothing moving on screen. It refuses a missing layer, a layer that is not a box, a box with its style locked, and going Free without where the box and its layers are drawn.',
  step: 'layout',
  input: z.strictObject({
    id: NodeId.describe('The box to lay out.'),
    layout: BoxLayout.describe(
      'The layout: a row, a column or a grid; auto for a row or column, whichever its layers already follow; or free.',
    ),
    drawn: DrawnBoxes.optional().describe(
      'Where the box and its layers are drawn. Needed to go Free from a layout, so nothing moves.',
    ),
  }),
  check: ({ design }, { id, layout, drawn }) => {
    const node = design.nodes[id]
    if (!node) return missingLayer(design, [id])
    if (node.type !== 'box') return `"${id}" is a ${node.type}; only boxes have auto layout`
    if (layout === 'free' && node.props.layout && !drawn)
      return `"${id}" goes Free only given where it and its layers are drawn`
    return lockProblem(id, node, 'style')
  },
  apply: ({ w, design }, { id, layout: to, drawn }) => {
    const node = design.nodes[id]
    if (node?.type !== 'box') return
    const was = node.props.layout
    if (!changesLayout(was, to)) return
    if (to === 'free') {
      writeDrawn(w, design, [id], drawn ?? {})
      const { sizing } = node.props
      if (sizing && (sizing.width !== 'fixed' || sizing.height !== 'fixed'))
        w.setProp(id, 'sizing', { width: 'fixed', height: 'fixed' })
      w.unsetProp(id, 'layout')
      return
    }
    if (was && to !== 'auto') {
      w.setProp(id, 'layout', switched(was, to))
      return
    }
    const flow = flowOf(design, id)
    if (to === 'grid') w.setProp(id, 'layout', GRID_START)
    else {
      const plan = boxPlan(design)
      // A turned layer takes the room of its turned bounds in the flow, so it is read by them.
      const { order, layout } = inferLayout(
        plan.get(id),
        flow.map(([kid]) => [kid, boundsOf([plan.get(kid)])]),
        to === 'auto' ? undefined : to,
      )
      w.setProp(id, 'layout', layout)
      // The flow follows the children's order: they take each other's places in it, leaving the ones it doesn't place where they are.
      const flowing = new Set(order)
      const next = order.values()
      const slots = layerSlots(design, id).map(([kid, index]): Slot => {
        const takes = flowing.has(kid) ? (next.next().value as string) : kid
        return [takes, takes === kid ? index : (design.nodes[takes]?.index ?? null)]
      })
      writeOrder(w, 'layer', slots, flowing)
    }
    const { sizing } = node.props
    if (sizing?.width !== 'hug' || sizing.height !== 'hug') w.setProp(id, 'sizing', { width: 'hug', height: 'hug' })
  },
})

/**
 * Whether setting a box with layout `was` (undefined while Free) to `to` changes it: Free changes
 * a laid-out box, and a layout a box lacks changes it, `auto` only a Free box.
 */
export function changesLayout(was: AutoLayout | undefined, to: BoxLayout): boolean {
  if (to === 'free') return was !== undefined
  return !was || (to !== 'auto' && to !== was.direction)
}

/**
 * A laid-out box's layout in another direction, its other settings kept; a grid starts what was
 * spread out at the start, and a row or column keeps no columns.
 */
function switched(was: AutoLayout, to: 'row' | 'column' | 'grid'): AutoLayout {
  const { columns, ...flow } = was
  const grid = to === 'grid'
  return {
    ...flow,
    direction: to,
    ...(grid && columns !== undefined ? { columns } : {}),
    ...(grid && was.justify === 'space-between' ? { justify: 'start' } : {}),
  }
}

const NEAR = 0.5
const same = (values: number[]) => values.every((v) => Math.abs(v - (values[0] ?? 0)) <= NEAR)
/**
 * A gap or padding read off the layers: rounded, and never below 0, so layers that overlap or reach
 * past the box sit apart in the flow.
 */
const room = (value: number) => Math.max(0, round(value))

/**
 * Reads a row or column off the children's boxes: along `axis` when given, else the axis along
 * which they follow each other without overlapping (the longer run if both), the gap between them
 * (their average where they differ), the paddings to the box's edges, and how they line up across
 * the flow. The gap and paddings are never below 0.
 */
function inferLayout(
  outer: Rect,
  kids: [string, Rect][],
  axis?: 'row' | 'column',
): { layout: Inferred; order: string[] } {
  const along = (row: boolean) => {
    const sorted = [...kids].sort(([, a], [, b]) => (row ? a.x - b.x : a.y - b.y))
    const gaps = sorted.slice(1).map(([, b], i) => {
      const a = (sorted[i] as [string, Rect])[1]
      return row ? b.x - (a.x + a.width) : b.y - (a.y + a.height)
    })
    return { sorted, gaps, clear: gaps.every((g) => g >= -NEAR) }
  }
  const asRow = along(true)
  const asColumn = along(false)
  const span = (row: boolean) => {
    const starts = kids.map(([, b]) => (row ? b.x : b.y))
    const ends = kids.map(([, b]) => (row ? b.x + b.width : b.y + b.height))
    return Math.max(...ends) - Math.min(...starts)
  }
  const row = axis
    ? axis === 'row'
    : asRow.clear && asColumn.clear
      ? span(true) >= span(false)
      : asRow.clear || !asColumn.clear
  const { sorted, gaps } = row ? asRow : asColumn
  const gap = gaps.length === 0 ? 0 : room(gaps.reduce((s, g) => s + g, 0) / gaps.length)
  const boxes = kids.map(([, b]) => b)
  const left = Math.min(...boxes.map((b) => b.x)) - outer.x
  const top = Math.min(...boxes.map((b) => b.y)) - outer.y
  const right = outer.x + outer.width - Math.max(...boxes.map((b) => b.x + b.width))
  const bottom = outer.y + outer.height - Math.max(...boxes.map((b) => b.y + b.height))
  const across = (part: 0 | 0.5 | 1) => boxes.map((b) => (row ? b.y + b.height * part : b.x + b.width * part))
  const align = same(across(0)) ? 'start' : same(across(0.5)) ? 'center' : same(across(1)) ? 'end' : 'start'
  const padding =
    kids.length === 0
      ? { top: 0, right: 0, bottom: 0, left: 0 }
      : { top: room(top), right: room(right), bottom: room(bottom), left: room(left) }
  // Centred across the flow, the paddings either side must differ by as much as the centre line
  // is off the box's middle; at the start or end, the paddings read off already hold them there.
  if (align === 'center' && kids.length > 0) {
    const centre = (across(0.5)[0] ?? 0) - (row ? outer.y : outer.x)
    if (row) padding.bottom = room(padding.top + outer.height - 2 * centre)
    else padding.right = room(padding.left + outer.width - 2 * centre)
  }
  return {
    layout: { direction: row ? 'row' : 'column', gap, padding, justify: 'start', align },
    // The children in the order the flow takes them.
    order: sorted.map(([id]) => id),
  }
}
