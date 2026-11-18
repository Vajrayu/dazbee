// Path layers: new path data, and the box a path is drawn in as its size changes.
import { z } from 'zod'

import { type Design, NodeId } from '@dazbee/schema'

import { centreOf, turn } from '../geometry.ts'
import type { StoreWrite } from '../store.ts'
import { boxPlan } from './box-plan.ts'
import { lockProblem, missingLayer } from './checks.ts'
import { defineCommand } from './define.ts'

/**
 * Gives a path layer new path data (#45). The data is in the layer's drawn coordinates as they
 * were before its flip, moved so the new outline starts at 0, 0: `dx` and `dy` are how far its
 * box's corner moves, and `width` and `height` its new size, the box the data is now drawn in. A
 * turned or flipped box also shifts with its new centre, so the points that didn't change stay
 * where they are drawn. Its linked copies in other frames stay as they are.
 */
export const nodeReshape = defineCommand({
  name: 'node.reshape',
  description:
    'Gives a path layer new points, with the points that did not change staying where they are drawn. It refuses a missing layer, a layer that is not a path, and one locked against style changes, moving or resizing.',
  step: 'reshape',
  batchable: true,
  input: z.strictObject({
    id: NodeId.describe('The path layer to reshape.'),
    d: z
      .string()
      .min(1)
      .describe(
        'The new path data, as an SVG path, in the layer’s own coordinates before its flip, with its outline starting at 0, 0.',
      ),
    dx: z.number().describe('How far right the corner of the layer’s box moves, in pixels.'),
    dy: z.number().describe('How far down the corner of the layer’s box moves, in pixels.'),
    width: z.number().min(0).describe('The new width of the layer’s box, in pixels.'),
    height: z.number().min(0).describe('The new height of the layer’s box, in pixels.'),
  }),
  check: ({ design }, { id }) => {
    const node = design.nodes[id]
    if (!node) return missingLayer(design, [id])
    if (node.type !== 'graphic' || node.props.shape.kind !== 'path') return `"${id}" is not a path`
    for (const flag of ['style', 'move', 'resize'] as const) {
      const locked = lockProblem(id, node, flag)
      if (locked) return locked
    }
    return undefined
  },
  apply: ({ w, design }, { id, d, dx, dy, width, height }) => {
    const node = design.nodes[id]
    if (node?.type !== 'graphic' || node.props.shape.kind !== 'path') return
    w.setProp(id, 'shape', { ...node.props.shape, d, drawnIn: { width, height } })
    const plan = boxPlan(design)
    const was = plan.get(id)
    const next = { x: was.x + dx, y: was.y + dy, width, height }
    const v = {
      x: centreOf({ ...next, rotation: 0 }).x - centreOf(was).x,
      y: centreOf({ ...next, rotation: 0 }).y - centreOf(was).y,
    }
    // A flipped layer draws its data mirrored about its box's centre, so the centre's move is too.
    const mirrored = { x: node.props.flipX ? -v.x : v.x, y: node.props.flipY ? -v.y : v.y }
    const turned = turn(mirrored, { x: 0, y: 0 }, was.rotation)
    // How far the flip and the turn shift the box, taken on their own first: small beside where the box is.
    const shift = { x: turned.x - v.x, y: turned.y - v.y }
    plan.set(id, { ...next, x: next.x + shift.x, y: next.y + shift.y })
    plan.write(w)
  },
})

/**
 * Gives a path with no box it was drawn in its box as that box, before its size changes, so the
 * new size scales its drawing from there; a path that has one keeps it.
 */
export function keepDrawnIn(w: StoreWrite, design: Design, id: string) {
  const node = design.nodes[id]
  if (node?.type !== 'graphic' || node.props.shape.kind !== 'path' || node.props.shape.drawnIn) return
  w.setProp(id, 'shape', { ...node.props.shape, drawnIn: { width: node.props.width, height: node.props.height } })
}
