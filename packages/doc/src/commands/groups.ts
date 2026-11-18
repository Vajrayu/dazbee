// Commands that put layers in a new group, box or boolean without moving them on screen, take them out
// again, and fit groups to what they hold. Each acts in the layers' own frame.
import { z } from 'zod'

import {
  BooleanOp,
  BooleanProps,
  BoxProps,
  canHold,
  type Design,
  GroupProps,
  type Layer as LayerT,
  NodeId,
} from '@dazbee/schema'

import { ancestorsOf, childrenOf, descendants, fitOf, fitsItsLayers, isInside, shareParent } from '../children.ts'
import { flows, laidOutBox } from '../flow.ts'
import { boundsOf, centreOf, normalAngle, round, turn } from '../geometry.ts'
import { type BoxPlan, boxPlan, DrawnBoxes, writeDrawn } from './box-plan.ts'
import { idProblem, lockProblem, missingLayer } from './checks.ts'
import { type CommandContext, defineCommand } from './define.ts'
import { depthOf, drawnOrder, layerSlots, type Slot, writeOrder } from './tree.ts'

/** A box nothing has sized yet. */
const NO_BOX = { x: 0, y: 0, width: 0, height: 0 }

/** The props a new group, box or boolean starts from, by type: its schema's own defaults. */
const WRAPPER_PROPS = {
  group: GroupProps.parse(NO_BOX),
  box: BoxProps.parse(NO_BOX),
  boolean: BooleanProps.parse(NO_BOX),
}

/**
 * Wraps layers that share a parent in a new group where the topmost of them was, without moving
 * anything on screen. The group's box hugs them. Returns the group's id.
 */
export const nodeGroup = defineCommand({
  name: 'node.group',
  description:
    'Puts layers in a new group where the topmost of them was, with nothing moving on screen, and returns the group’s id. It refuses a missing layer, layers that do not share a parent or are locked against moving, a parent that cannot hold a group, and an id already in use.',
  step: 'group',
  input: z.strictObject({
    ids: NodeId.array().min(1).describe('The layers to group.'),
    id: NodeId.optional().describe('The group’s id; a fresh one is made when left out.'),
    name: z.string().default('Group').describe('The group’s name.'),
    drawn: DrawnBoxes.optional().describe(
      'Where the layers and what they hold are drawn, so layers in a row, column or grid stay where they are.',
    ),
  }),
  check: (ctx, { ids, id }) => wrapProblem(ctx, ids, id, 'group'),
  apply: (ctx, { ids, id = ctx.newId(), name, drawn }) => wrap(ctx, ids, id, { type: 'group', name }, drawn),
})

/**
 * Wraps layers that share a parent in a new box where the topmost of them was, without changing
 * anything on screen: it hugs them, it has no fill, and it doesn't clip, so a stroke or shadow
 * past a layer's box still shows. Returns the box's id.
 */
export const nodeBox = defineCommand({
  name: 'node.box',
  description:
    'Puts layers in a new box with no fill where the topmost of them was, with nothing changing on screen, and returns the box’s id. It refuses a missing layer, layers that do not share a parent or are locked against moving, a parent that cannot hold a box, and an id already in use.',
  step: 'box',
  input: z.strictObject({
    ids: NodeId.array().min(1).describe('The layers to put in a box.'),
    id: NodeId.optional().describe('The box’s id; a fresh one is made when left out.'),
    name: z.string().default('Box').describe('The box’s name.'),
    drawn: DrawnBoxes.optional().describe(
      'Where the layers and what they hold are drawn, so layers in a row, column or grid stay where they are.',
    ),
  }),
  check: (ctx, { ids, id }) => wrapProblem(ctx, ids, id, 'box'),
  apply: (ctx, { ids, id = ctx.newId(), name, drawn }) =>
    wrap(ctx, ids, id, { type: 'box', name, props: { clip: false } }, drawn),
})

/**
 * Moves layers into a box beside them, as when a box is drawn around them, without moving them
 * on screen. They keep their order inside it.
 */
export const nodeEnclose = defineCommand({
  name: 'node.enclose',
  description:
    'Moves layers into a box beside them, as when a box is drawn around them, keeping their order and where they are drawn. It refuses a missing layer, a layer that is not a box to go into, layers not beside it, and a layer a box cannot hold.',
  step: 'box',
  input: z.strictObject({
    id: NodeId.describe('The box the layers go into.'),
    ids: NodeId.array().min(1).describe('The layers to move into it, each beside it under the same parent.'),
  }),
  check: ({ design }, { id, ids }) => {
    const box = design.nodes[id]
    if (!box) return missingLayer(design, [id])
    if (box.type !== 'box') return `"${id}" is a ${box.type}, not a box`
    for (const layer of ids) {
      const node = design.nodes[layer]
      if (!node) return missingLayer(design, [layer])
      if (layer === id) return `can't put "${id}" inside itself`
      if (node.parentId !== box.parentId) return `"${layer}" is not beside "${id}"`
      if (!canHold('box', node.type)) return `a box can't hold a ${node.type}`
    }
    return undefined
  },
  apply: ({ w, design }, { id, ids }) => {
    // Their indexes already order them among what the box holds: they change parent, and those that share an index there take their own.
    for (const layer of ids) w.set('layer', layer, 'parentId', id)
    const coming = layerSlots(design, design.nodes[id]?.parentId ?? '').filter(([layer]) => ids.includes(layer))
    writeOrder(w, 'layer', drawnOrder([...layerSlots(design, id), ...coming]))
  },
})

/**
 * Combines shapes that share a parent into a live boolean (#44) where the topmost of them was,
 * without moving them. It paints with the bottom shape's fills and strokes, the shape the others
 * add to or cut from. Returns the boolean's id.
 */
export const nodeBoolean = defineCommand({
  name: 'node.boolean',
  description:
    'Combines shapes into one live shape where the topmost of them was, painted as the bottom one, and returns its id. It refuses a missing layer, a layer that is not a shape or a combined shape, layers that do not share a parent or are locked against moving, a parent that cannot hold a combined shape, and an id already in use.',
  step: 'combine',
  input: z.strictObject({
    ids: NodeId.array().min(2).describe('The shapes to combine, two or more.'),
    op: BooleanOp.describe(
      'How they combine: union, subtract the upper ones from the bottom one, intersect or exclude.',
    ),
    id: NodeId.optional().describe('The combined shape’s id; a fresh one is made when left out.'),
    name: z.string().optional().describe('Its name; the name of how they combine when left out.'),
    drawn: DrawnBoxes.optional().describe(
      'Where the layers and what they hold are drawn, so layers in a row, column or grid stay where they are.',
    ),
  }),
  check: (ctx, { ids, id }) => {
    for (const layer of ids) {
      const type = ctx.design.nodes[layer]?.type
      if (type && type !== 'graphic' && type !== 'boolean')
        return `"${layer}" is a ${type}; only shapes and booleans combine`
    }
    return wrapProblem(ctx, ids, id, 'boolean')
  },
  apply: (ctx, { ids, op, id = ctx.newId(), name, drawn }) => {
    const parentId = ctx.design.nodes[ids[0] as string]?.parentId as string
    const bottom = childrenOf(ctx.design, parentId).find(([child]) => ids.includes(child))?.[1]
    const paint =
      bottom && (bottom.type === 'graphic' || bottom.type === 'boolean')
        ? { fills: bottom.props.fills, strokes: bottom.props.strokes }
        : {}
    const names = { union: 'Union', subtract: 'Subtract', intersect: 'Intersect', exclude: 'Exclude' } as const
    return wrap(ctx, ids, id, { type: 'boolean', name: name ?? names[op], props: { op, ...paint } }, drawn)
  },
})

/**
 * Takes the layers out of groups, boxes or booleans and removes them, without moving anything on
 * screen: what a box's auto layout placed goes where `drawn` says it is drawn, a turned group's
 * turn goes into each layer it held, and a hidden group hides them. Shapes out of a boolean show
 * their own paints again, and a mask it frees is turned off, so none is left loose to mask what is
 * beside it; a mask with its style locked refuses the ungroup. The layers take the group's place
 * among its siblings. Returns their ids, in order.
 */
export const nodeUngroup = defineCommand({
  name: 'node.ungroup',
  description:
    'Takes the layers out of groups, boxes or combined shapes and removes those, with nothing moving on screen, and returns the freed layers’ ids. It refuses a missing layer, one that is not a group, box or combined shape, one locked against deleting, and one holding a mask with its style locked.',
  step: 'ungroup',
  input: z.strictObject({
    ids: NodeId.array().min(1).describe('The groups, boxes or combined shapes to take apart.'),
    drawn: DrawnBoxes.optional().describe(
      'Where the layers a laid-out box holds are drawn, so they stay there once it is gone.',
    ),
  }),
  check: ({ design }, { ids }) => {
    for (const id of ids) {
      const node = design.nodes[id]
      if (!node) return missingLayer(design, [id])
      if (node.type !== 'group' && node.type !== 'box' && node.type !== 'boolean')
        return `"${id}" is a ${node.type}, not a group, box or boolean`
      const locked = lockProblem(id, node, 'delete')
      if (locked) return locked
      for (const [kid, child] of childrenOf(design, id)) {
        const maskLocked = child.props.mask ? lockProblem(kid, child, 'style') : undefined
        if (maskLocked) return maskLocked
      }
    }
    return undefined
  },
  apply: ({ w, design }, { ids, drawn = {} }) => {
    const freed: string[] = []
    const groups = ids.filter((id) => !ids.some((other) => other !== id && isInside(design, id, other)))
    writeDrawn(w, design, ids, drawn, (plan) => {
      for (const id of groups) {
        const group = plan.get(id)
        for (const [kid] of childrenOf(design, id)) {
          const was = plan.get(kid)
          if (group.rotation !== 0) {
            const c = centreOf(was)
            const to = turn(c, centreOf(group), group.rotation)
            const dx = to.x - c.x
            const dy = to.y - c.y
            plan.set(kid, { x: was.x + dx, y: was.y + dy, rotation: normalAngle(was.rotation + group.rotation) })
            for (const inner of descendants(design, kid)) {
              const at = plan.get(inner)
              plan.set(inner, { x: at.x + dx, y: at.y + dy })
            }
          }
          if (!group.visible) plan.set(kid, { visible: false })
        }
      }
    })
    for (const id of groups) {
      for (const [kid] of childrenOf(design, id)) {
        w.set('layer', kid, 'parentId', design.nodes[id]?.parentId)
        if (design.nodes[kid]?.props.mask) w.unsetProp(kid, 'mask')
        freed.push(kid)
      }
      w.remove('layer', id)
    }
    // Under each parent, what its groups held takes each group's place.
    for (const parentId of new Set(groups.map((id) => (design.nodes[id] as LayerT).parentId))) {
      const order = layerSlots(design, parentId).flatMap((slot) =>
        groups.includes(slot[0]) ? layerSlots(design, slot[0]) : [slot],
      )
      writeOrder(w, 'layer', order, new Set(freed))
    }
    return freed
  },
})

/**
 * Fits groups and booleans to what they hold: each named one, and every one the named layers are
 * in, innermost first. A turned group's layers shift with its new centre so nothing moves on
 * screen. The editor runs it after a change to layers inside a group, in the same step.
 */
export const nodeHug = defineCommand({
  name: 'node.hug',
  description:
    'Fits groups and combined shapes to what they hold: each one named, and each one the named layers are in, with nothing moving on screen. It refuses a missing layer.',
  step: 'resize',
  batchable: true,
  input: z.strictObject({
    ids: NodeId.array().min(1).describe('Groups to fit, or layers whose groups and combined shapes to fit.'),
  }),
  check: ({ design }, { ids }) => missingLayer(design, ids),
  apply: ({ w, design }, { ids }) => {
    const plan = boxPlan(design)
    planHug(design, plan, ids)
    plan.write(w)
  },
})

/**
 * Plans the groups and booleans `ids` names, and every one the layers `ids` names are in, to fit
 * what they hold as `plan` has it, innermost first, with nothing moving on screen; but those in
 * `leave`, which keep their boxes. A turned group's layers shift with its new centre.
 */
export function planHug(design: Design, plan: BoxPlan, ids: Iterable<string>, leave: ReadonlySet<string> = new Set()) {
  const groups = new Set<string>()
  for (const id of ids) {
    for (const up of ancestorsOf(design, id)) if (fitsItsLayers(design.nodes[up]) && !leave.has(up)) groups.add(up)
  }
  for (const id of [...groups].sort((a, b) => depthOf(design, b) - depthOf(design, a))) {
    const fit = fitOf(design, id, (kid) => plan.get(kid))
    if (!fit) continue
    const group = plan.get(id)
    // Turned about its new centre instead of the old one, the group would draw its layers
    // elsewhere; moving them and the box by d keeps every one where it was.
    const v = { x: centreOf(group).x - centreOf(fit).x, y: centreOf(group).y - centreOf(fit).y }
    const turned = turn(v, { x: 0, y: 0 }, group.rotation)
    const d = { x: v.x - turned.x, y: v.y - turned.y }
    const next = { x: fit.x + d.x, y: fit.y + d.y, width: fit.width, height: fit.height }
    // Within what rounding to hundredths leaves, it already fits: fitting again changes nothing.
    if ((['x', 'y', 'width', 'height'] as const).every((k) => Math.abs(next[k] - group[k]) < 0.02)) continue
    plan.set(id, next)
    if (Math.hypot(d.x, d.y) < 0.005) continue
    for (const inner of descendants(design, id)) {
      const at = plan.get(inner)
      plan.set(inner, { x: at.x + d.x, y: at.y + d.y })
    }
  }
}

/**
 * Why layers can't be wrapped in a new group, box or boolean, or undefined when they can: `apart`
 * when they don't share a parent, `locked` when one is locked in place, `held` when their parent
 * can't hold a layer of that type (a boolean holds only shapes and booleans).
 */
export function wrapRefusal(
  design: Design,
  ids: readonly string[],
  type: 'group' | 'box' | 'boolean',
): 'apart' | 'locked' | 'held' | undefined {
  if (!shareParent(design, [...ids])) return 'apart'
  if (ids.some((id) => design.nodes[id]?.lock?.move)) return 'locked'
  const parent = design.nodes[design.nodes[ids[0] ?? '']?.parentId ?? '']
  return parent && !canHold(parent.type, type) ? 'held' : undefined
}

/** What wrapping layers in a new group, box or boolean checks: they exist and `wrapRefusal` finds nothing, and the id is free. */
function wrapProblem(ctx: CommandContext, ids: string[], id: string | undefined, type: 'group' | 'box' | 'boolean') {
  const { design } = ctx
  const missing = missingLayer(design, ids)
  if (missing) return missing
  const refusal = wrapRefusal(design, ids, type)
  if (refusal === 'apart') return `layers to ${type === 'boolean' ? 'combine' : type} must share a parent`
  if (refusal === 'locked') return ids.map((one) => lockProblem(one, design.nodes[one] as LayerT, 'move')).find(Boolean)
  if (refusal === 'held') {
    const parentId = design.nodes[ids[0] as string]?.parentId as string
    return `parent "${parentId}" is a ${design.nodes[parentId]?.type}, which can't hold a ${type}`
  }
  return idProblem(ctx, id)
}

/**
 * Puts layers that share a parent inside a new layer of `type` where the topmost of them was,
 * without moving anything on screen: its box hugs them, and it gets a link id of its own. Layers
 * with `drawn` boxes are first stored where they are drawn, what they hold moved with them, so the
 * new layer hugs them as drawn and takes the room they took in a flow. When they all keep where
 * they are in a flow, the new layer keeps where it is too.
 */
function wrap(
  { w, design, newId }: CommandContext,
  ids: string[],
  id: string,
  layer: { type: 'group' | 'box' | 'boolean'; name: string; props?: Record<string, unknown> },
  drawn: DrawnBoxes = {},
) {
  const parentId = design.nodes[ids[0] as string]?.parentId as string
  const inside = childrenOf(design, parentId).filter(([child]) => ids.includes(child))
  const plan = writeDrawn(w, design, ids, drawn)
  const absolute = laidOutBox(design, parentId) && inside.every(([, child]) => !flows(child))
  const hug = boundsOf(inside.map(([child]) => plan.get(child)))
  const box = { x: round(hug.x), y: round(hug.y), width: round(hug.width), height: round(hug.height) }
  const beside = layerSlots(design, parentId).filter(([child]) => !ids.includes(child) || child === inside.at(-1)?.[0])
  const order = beside.map(([child, index]): Slot => (ids.includes(child) ? [id, index] : [child, index]))
  // The new layer is not held yet: its index is written with it.
  const indexOf = writeOrder(w, 'layer', order, new Set([id]))
  const props = { ...WRAPPER_PROPS[layer.type], ...layer.props, ...box, ...(absolute ? { absolute } : {}) }
  const wrapper = { type: layer.type, name: layer.name, parentId, link: newId(), index: indexOf(id), props }
  w.create('layer', id, wrapper as LayerT)
  // Their indexes already order them: they change parent, and those that shared an index take their own.
  for (const [child] of inside) w.set('layer', child, 'parentId', id)
  writeOrder(
    w,
    'layer',

    inside.map(([child, node]) => [child, node.index]),
  )
  return id
}
