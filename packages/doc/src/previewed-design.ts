// The design as the canvas draws it while other tabs have a step open (D7): the working design with
// each layer their previews show otherwise put in. Only layers are previewed: frames, pages and the
// meta stay as the working design has them, so the frames the canvas lays out are the ones it
// draws. Each previewed layer is read on its own, then checked as repair would check a layer that
// came or moved: a layer the schema refuses, or one whose parent can't hold it or that a move puts
// round a cycle, is drawn as the working design has it, and so is a layer deleted while one it held
// stays. Commands, panels and selection never read it.
import { canHold, deepFreeze, type Design, type Layer, parseLayer } from '@dazbee/schema'

import { type ChildIndex, childrenOf, registerChildIndex, siblingOrder } from './children.ts'
import { idIssue } from './repair.ts'

/** A previewed layer as last read, by the record it was read from, so an unchanged preview reads as the same layer. */
export interface PreviewRead {
  raw: string
  layer: Layer | undefined
}

/**
 * `design` with each layer in `previewed` as a preview shows it: its record, unread, or undefined
 * where the preview deletes it. `design` itself when nothing is previewed. With `memo`, a layer whose
 * record is unchanged since the last call is the same object, so a picture of its frame is kept.
 */
export function previewedDesign(
  design: Design,
  previewed: ReadonlyMap<string, unknown>,
  memo?: Map<string, PreviewRead>,
): Design {
  if (memo) for (const id of memo.keys()) if (!previewed.has(id)) memo.delete(id)
  if (previewed.size === 0) return design
  /** The previewed layers read, and the ones the previews delete. */
  const staged = new Map<string, Layer>()
  const removed = new Set<string>()
  for (const [id, raw] of previewed) {
    const was = design.nodes[id]
    if (raw === undefined) {
      if (was) removed.add(id)
      continue
    }
    // A layer that came is taken only under a key that is an id, and no frame's.
    if (!was && (idIssue(id) !== undefined || Object.hasOwn(design.frames, id))) continue
    const layer = readLayer(id, raw, memo)
    if (layer && (!was || layer.type === was.type)) staged.set(id, layer)
  }

  const next = (id: string): Layer | undefined => staged.get(id) ?? (removed.has(id) ? undefined : design.nodes[id])
  /** Whether a layer the previews delete still holds one: a child that stays in it, or one that moves in. */
  const holdsOne = (id: string) =>
    childrenOf(design, id).some(([child]) => next(child)?.parentId === id) ||
    [...staged.values()].some((layer) => layer.parentId === id)
  const most = Object.keys(design.nodes).length + staged.size
  // A deleted layer that still holds one is drawn as the working design has it. A layer that came or
  // moved must sit in a frame or a layer that holds it, under a frame without a cycle, else it is
  // drawn as the working design has it. Each can undo the other, so check both until nothing changes.
  for (let changed = true; changed;) {
    changed = false
    for (const id of removed)
      if (holdsOne(id)) {
        removed.delete(id)
        changed = true
      }
    for (const [id, layer] of staged) {
      const was = design.nodes[id]
      if (was && was.parentId === layer.parentId) continue
      if (!sitsInAFrame(id, layer, next, design, most)) {
        staged.delete(id)
        changed = true
      }
    }
  }
  if (staged.size === 0 && removed.size === 0) return design

  const nodes: Record<string, Layer> = Object.fromEntries(
    Object.entries(design.nodes).filter(([id]) => !removed.has(id)),
  )
  for (const [id, layer] of staged) nodes[id] = layer
  registerChildIndex(nodes, patchedIndex(design, nodes, staged, removed))
  return Object.freeze({ ...design, nodes: Object.freeze(nodes) })
}

/** A previewed layer's record read, frozen, or undefined where the schema refuses it; the last read when the record is unchanged. */
function readLayer(id: string, raw: unknown, memo: Map<string, PreviewRead> | undefined): Layer | undefined {
  const key = memo ? JSON.stringify(raw) : ''
  const kept = memo?.get(id)
  if (kept && kept.raw === key) return kept.layer
  const parsed = parseLayer(raw)
  const layer = parsed.success ? deepFreeze(parsed.layer) : undefined
  memo?.set(id, { raw: key, layer })
  return layer
}

/** Whether a layer that came or moved sits in a parent that holds it, under a frame, round no cycle. */
function sitsInAFrame(id: string, layer: Layer, next: (id: string) => Layer | undefined, design: Design, most: number) {
  if (!Object.hasOwn(design.frames, layer.parentId)) {
    const parent = next(layer.parentId)
    if (!parent || !canHold(parent.type, layer.type)) return false
  }
  let up = layer.parentId
  for (let steps = 0; !Object.hasOwn(design.frames, up); steps++) {
    const above = next(up)
    if (up === id || !above || steps > most) return false
    up = above.parentId
  }
  return true
}

/**
 * The child index of the previewed layers: the working design's, with the lists of the parents a
 * preview touched sorted again. A preview of a few layers sorts a few lists, however large the design.
 */
function patchedIndex(
  design: Design,
  nodes: Readonly<Record<string, Layer>>,
  staged: ReadonlyMap<string, Layer>,
  removed: ReadonlySet<string>,
): ChildIndex {
  const touched = new Set<string>()
  for (const id of [...staged.keys(), ...removed]) {
    const was = design.nodes[id]
    if (was) touched.add(was.parentId)
    const now = staged.get(id)
    if (now) touched.add(now.parentId)
  }
  const order = siblingOrder(nodes)
  const lists = new Map<string, string[]>()
  for (const parentId of touched) {
    const ids = new Set(childrenOf(design, parentId).map(([id]) => id))
    for (const [id, layer] of staged) if (layer.parentId === parentId) ids.add(id)
    lists.set(parentId, [...ids].filter((id) => nodes[id]?.parentId === parentId).sort(order))
  }
  return (parentId) => lists.get(parentId) ?? childrenOf(design, parentId).map(([id]) => id)
}
