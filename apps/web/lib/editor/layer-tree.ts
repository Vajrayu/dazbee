// The layers panel's tree as rows, topmost first: one frame's layers, an open layer with its
// children, and the arrows from the layers a mask masks to the mask.
import { childrenOf, descendants, isMaskGroup, maskSpans, rowsOf } from '@dazbee/doc'
import { type Design, framesOf } from '@dazbee/schema'

type Layer = Design['nodes'][string]

/** A layer's row: depth 0 for a top-level layer of its frame, one more for each group it is in. */
export interface Row {
  id: string
  node: Layer
  depth: number
  parentId: string
  frameId: string
  hasChildren: boolean
  position: number
  siblings: number
  /** Its frame is linked to another on the page, and no other frame there holds a copy of it. */
  onlyHere: boolean
}
/** The keys a click or a key on a row was made with: Shift, and Ctrl or Cmd (`mod`). */
export interface ClickKeys {
  shift: boolean
  mod: boolean
}
/** An arrow from the topmost layer a shown mask masks to the mask: their row indexes, and the mask's depth. */
export interface MaskArrow {
  from: number
  to: number
  depth: number
}

/**
 * A frame's layers as rows, topmost first, each open one followed by its children; and an arrow for
 * each shown mask in an open parent that masks at least one layer. None for a frame the design lacks.
 */
export function treeRows(
  design: Design,
  frameId: string | null,
  open: ReadonlySet<string>,
): { rows: Row[]; arrows: MaskArrow[] } {
  const rows: Row[] = []
  const arrows: MaskArrow[] = []
  const frame = frameId === null ? undefined : design.frames[frameId]
  if (frameId === null || !frame) return { rows, arrows }
  const holders = linkHolders(
    design,
    framesOf(design, frame.pageId).map(([id]) => id),
  )
  // The frame shares a link with another frame of the page.
  const linked = [...holders.values()].some((held) => held.size > 1 && held.has(frameId))
  const walk = (parentId: string, depth: number) => {
    const children = rowsOf(design, parentId)
    // Where each of the parent's own layers is listed.
    const at = new Map<string, number>()
    for (const [position, [id, node]] of children.entries()) {
      const hasChildren = childrenOf(design, id).length > 0
      at.set(id, rows.length)
      rows.push({
        id,
        node,
        depth,
        parentId,
        frameId,
        hasChildren,
        position: position + 1,
        siblings: children.length,
        onlyHere: linked && holders.get(node.link)?.size === 1,
      })
      if (hasChildren && open.has(id)) walk(id, depth + 1)
    }
    for (const { mask, masked } of maskSpans(design, parentId)) {
      const top = masked.at(-1)
      const from = top === undefined ? undefined : at.get(top)
      const to = at.get(mask)
      if (from !== undefined && to !== undefined) arrows.push({ from, to, depth })
    }
  }
  walk(frameId, 0)
  return { rows, arrows }
}

/**
 * The rows to open so the selection shows in the tree: the groups each selected layer is in, and a
 * selected Mask group itself.
 */
export function opensFor(design: Design, ids: readonly string[]): string[] {
  const open = new Set<string>()
  for (const id of ids) {
    const node = design.nodes[id]
    if (!node) continue
    if (isMaskGroup(design, id)) open.add(id)
    for (let up = node.parentId; !open.has(up);) {
      const parent = design.nodes[up]
      if (!parent) break
      open.add(up)
      up = parent.parentId
    }
  }
  return [...open]
}

/**
 * Where an arrow key, Home or End takes the focus from row `i`: to another row, or a layer opened
 * or closed in place. Inward (right, or left in a right-to-left language) opens a closed row, then
 * goes to its first child; outward closes an open row, else goes to its group's row. Null when the
 * key goes nowhere, as outward from a top-level layer, whose frame has no row.
 */
export function arrowStep(
  rows: readonly Row[],
  i: number,
  key: string,
  open: ReadonlySet<string>,
  rtl: boolean,
): { go: Row } | { toggle: string; open: boolean } | null {
  const row = rows[i]
  if (!row) return null
  const go = (to: Row | undefined) => (to ? { go: to } : null)
  if (key === 'ArrowDown') return go(rows[i + 1])
  if (key === 'ArrowUp') return go(rows[i - 1])
  if (key === 'Home') return go(rows[0])
  if (key === 'End') return go(rows.at(-1))
  const inward = rtl ? 'ArrowLeft' : 'ArrowRight'
  const outward = rtl ? 'ArrowRight' : 'ArrowLeft'
  if (key === inward) {
    if (!row.hasChildren) return null
    return open.has(row.id) ? go(rows[i + 1]) : { toggle: row.id, open: true }
  }
  if (key === outward) {
    if (row.hasChildren && open.has(row.id)) return { toggle: row.id, open: false }
    return go(rows.find((r) => r.id === row.parentId))
  }
  return null
}

/**
 * What a click on a layer's row does, as FigCraft's layers panel takes it, with the anchor it
 * leaves: alone, it selects the layer, which becomes the anchor; with Ctrl or Cmd (`mod`), it adds
 * the layer or takes it out, which becomes the anchor. With Shift it selects the layers of the rows
 * from the anchor to it, in the list's order, adding them to the selection
 * with Ctrl or Cmd too, and the anchor stays. The anchor is `anchor` while its layer is selected
 * and listed, else `fallback` while listed, as Shift and an arrow key range from the focused row;
 * with neither, Shift adds or takes out as Ctrl or Cmd does.
 */
export function rowClick(
  rows: readonly Row[],
  id: string,
  keys: ClickKeys,
  selected: readonly string[],
  anchor: string | null,
  fallback: string | null = null,
): ({ select: string[] } | { toggle: string }) & { anchor: string } {
  const listed = (one: string | null) => one !== null && rows.some((row) => row.id === one)
  const from =
    anchor !== null && selected.includes(anchor) && listed(anchor) ? anchor : listed(fallback) ? fallback : null
  const [a, b] = [rows.findIndex((row) => row.id === from), rows.findIndex((row) => row.id === id)]
  if (keys.shift && from !== null && b >= 0) {
    const range = rows.slice(Math.min(a, b), Math.max(a, b) + 1).map((row) => row.id)
    const ranged = new Set(range)
    const kept = keys.mod ? selected.filter((one) => !ranged.has(one)) : []
    return { select: [...kept, ...range], anchor: from }
  }
  if (keys.shift || keys.mod) return { toggle: id, anchor: id }
  return { select: [id], anchor: id }
}

/** Each link id among the layers of the frames given, however deep, with the frames that hold it. */
function linkHolders(design: Design, frameIds: readonly string[]) {
  const holders = new Map<string, Set<string>>()
  for (const frameId of frameIds) {
    for (const id of descendants(design, frameId)) {
      const link = design.nodes[id]?.link
      if (link === undefined) continue
      const held = holders.get(link)
      if (held) held.add(frameId)
      else holders.set(link, new Set([frameId]))
    }
  }
  return holders
}
