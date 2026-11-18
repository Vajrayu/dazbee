// Copy to other frames ▸ Layer: linked copies of layers put into the linked frames that lack them.
import { z } from 'zod'

import { canHold, frameIdOf, type Layer as LayerT, NodeId } from '@dazbee/schema'

import { ancestorsOf, childrenOf } from '../children.ts'
import { round } from '../geometry.ts'
import { copyIn, framesWithout, linkedFrames } from '../links.ts'
import { missingLayer } from './checks.ts'
import { type CommandContext, defineCommand } from './define.ts'
import { fitted } from './fit.ts'
import { copyIndexes, type Slot, writeOrder } from './tree.ts'

type Area = { x: number; y: number; width: number; height: number }

/** Where a copied layer goes in a frame: its parent there, whether that stands for its own parent, and the areas it fits from and to. */
interface Target {
  parentId: string
  sameParent: boolean
  from: Area
  to: Area
}

/**
 * Copies layers into every linked frame of their page that holds no copy of them, each copy
 * keeping its link id and laid out to fit (fit.ts). A copy goes inside the copy of its parent where
 * that frame has one, laid out to fit that copy, under the copy of the nearest layer above it
 * there, else on top; otherwise on top of the frame, laid out to fit the frame. A container copied
 * in takes in the frame's own copies of the layers inside it, as they are, and copies the rest.
 * Layers go in from the outermost in, so one inside another copied goes where that one went.
 * Returns the copies' ids, by layer and then by frame order.
 */
export const nodeCopyToFrames = defineCommand({
  name: 'node.copyToFrames',
  description:
    'Copies layers into every frame linked to theirs that has no copy of them yet, each copy linked to its original and laid out to fit its frame, and returns the copies’ ids. It refuses a missing layer, and layers every linked frame already has.',
  step: 'copyToFrames',
  input: z.strictObject({ ids: NodeId.array().min(1).describe('The layers to copy into the linked frames.') }),
  check: ({ design }, { ids }) => {
    const missing = missingLayer(design, ids)
    if (missing) return missing
    if (ids.every((id) => framesWithout(design, id).length === 0)) return 'no linked frame lacks a copy of these layers'
    return undefined
  },
  apply: (ctx, { ids }) => copyToFrames(ctx, ids),
})

function copyToFrames({ w, design, newId }: CommandContext, ids: string[]): string[] {
  /** Layers this command wrote or moved, as they now are; read before the design's own. */
  const placed = new Map<string, LayerT>()
  /** The link ids each frame has taken in this command, with the layer holding each. */
  const taken = new Map<string, Map<string, string>>()
  const nodeOf = (id: string) => placed.get(id) ?? design.nodes[id]
  const holderIn = (frameId: string, link: string) => taken.get(frameId)?.get(link) ?? copyIn(design, frameId, link)
  const hold = (frameId: string, link: string, id: string) => {
    const links = taken.get(frameId) ?? new Map<string, string>()
    taken.set(frameId, links)
    links.set(link, id)
  }
  /** What a frame or layer holds now, back to front. */
  const childrenNow = (parentId: string) =>
    [...new Set([...childrenOf(design, parentId).map(([id]) => id), ...placed.keys()])]
      .filter((id) => nodeOf(id)?.parentId === parentId)
      .sort((a, b) => {
        const [x, y] = [nodeOf(a)?.index ?? '', nodeOf(b)?.index ?? '']
        return x < y ? -1 : x > y ? 1 : a < b ? -1 : 1
      })
  /** Whether `id` is `outer` or sits inside it, as placed now. */
  const within = (id: string, outer: string) => {
    for (let up: string | undefined = id; up; up = nodeOf(up)?.parentId) if (up === outer) return true
    return false
  }

  /** Where a layer goes in a frame (see the command). */
  function targetIn(id: string, frameId: string): Target {
    const node = design.nodes[id] as LayerT
    const from = design.frames[frameIdOf(design, id) as string] as Area
    const to = design.frames[frameId] as Area
    const frameFit = {
      from: { x: 0, y: 0, width: from.width, height: from.height },
      to: { x: 0, y: 0, width: to.width, height: to.height },
    }
    const parent = design.nodes[node.parentId]
    if (!parent) return { parentId: frameId, sameParent: true, ...frameFit }
    const copy = holderIn(frameId, parent.link)
    const held = copy === undefined ? undefined : nodeOf(copy)
    if (copy === undefined || !held || !canHold(held.type, node.type))
      return { parentId: frameId, sameParent: false, ...frameFit }
    return { parentId: copy, sameParent: true, from: areaOf(parent), to: areaOf(held) }
  }

  /**
   * The index of the new copy `copy` of a layer: under the copy of the nearest layer above it in its
   * parent, when its target stands for that parent; else on top. Layers of the target that shared
   * an index take ones of their own.
   */
  function indexIn(id: string, copy: string, frameId: string, target: Target) {
    const now = childrenNow(target.parentId)
    const own = childrenOf(design, design.nodes[id]?.parentId ?? '').map(([sibling]) => sibling)
    const above = target.sameParent
      ? own
          .slice(own.indexOf(id) + 1)
          .map((sibling) => holderIn(frameId, design.nodes[sibling]?.link ?? ''))
          .find((held) => held !== undefined && nodeOf(held)?.parentId === target.parentId)
      : undefined
    const at = above === undefined ? now.length : now.indexOf(above)
    const slots = now.map((layer): Slot => [layer, nodeOf(layer)?.index ?? null])
    const indexOf = writeOrder(w, 'layer', slots.toSpliced(at, 0, [copy, null]), new Set([copy]))
    for (const layer of now) {
      const was = nodeOf(layer) as LayerT
      if (indexOf(layer) !== was.index) placed.set(layer, { ...was, index: indexOf(layer) })
    }
    return indexOf(copy)
  }

  /** Writes the copy `id` of a layer, laid out to fit from the root's area, and what it holds; returns its id. */
  function write(
    old: string,
    id: string,
    at: { parentId: string; index: string },
    root: LayerT,
    target: Target,
    frameId: string,
  ) {
    const node = design.nodes[old] as LayerT
    const copy = { ...node, ...at, props: fittedIn(node.props, root.props, target) } as LayerT
    w.create('layer', id, copy)
    placed.set(id, copy)
    hold(frameId, node.link, id)
    const indexOf = copyIndexes(design, old)
    for (const [child, inner] of childrenOf(design, old)) {
      const own = holderIn(frameId, inner.link)
      const held = own === undefined ? undefined : nodeOf(own)
      if (own === undefined || !held) {
        write(child, newId(), { parentId: id, index: indexOf(child) }, root, target, frameId)
        continue
      }
      // The frame's own copy comes in as it is, unless the copy is going inside it.
      if (within(id, own) || !canHold(node.type, held.type)) continue
      w.set('layer', own, 'parentId', id)
      w.set('layer', own, 'index', indexOf(child))
      placed.set(own, { ...held, parentId: id, index: indexOf(child) })
    }
    return id
  }

  const depth = (id: string) => ancestorsOf(design, design.nodes[id]?.parentId ?? '').length
  const roots = [...new Set(ids)].sort((a, b) => depth(a) - depth(b))
  const copies: string[] = []
  for (const root of roots) {
    const node = design.nodes[root] as LayerT
    for (const frameId of linkedFrames(design, frameIdOf(design, root) as string)) {
      if (holderIn(frameId, node.link) !== undefined) continue
      const target = targetIn(root, frameId)
      const copy = newId()
      const at = { parentId: target.parentId, index: indexIn(root, copy, frameId, target) }
      copies.push(write(root, copy, at, node, target, frameId))
    }
  }
  return copies
}

function areaOf(node: LayerT): Area {
  return { x: node.props.x, y: node.props.y, width: node.props.width, height: node.props.height }
}

/** A layer's props laid out to fit from one area to another, as fit.ts fits a frame to a frame. */
function fittedIn<P extends LayerT['props']>(props: P, root: LayerT['props'], { from, to }: Target): P {
  const shift = <B extends { x: number; y: number }>(box: B, dx: number, dy: number): B => ({
    ...box,
    x: box.x + dx,
    y: box.y + dy,
  })
  const fit = fitted(shift(props, -from.x, -from.y), shift(root, -from.x, -from.y), { from, to })
  return { ...fit, x: round(fit.x + to.x), y: round(fit.y + to.y) }
}
