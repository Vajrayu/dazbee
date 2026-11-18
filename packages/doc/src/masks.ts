// What a mask is, as queries over a design. A mask masks the shown layers above it in its parent, up
// to the next shown mask; hidden layers don't count: a hidden mask masks nothing, and a hidden layer
// is never masked. A Mask group is a group whose own layers include exactly one mask.
import type { Design, Layer } from '@dazbee/schema'

import { childrenOf } from './children.ts'

/** One shown mask and the layers it masks, bottom to top. */
export interface MaskSpan {
  mask: string
  masked: string[]
}

/** Whether a layer is used as a mask, shown or hidden. */
export function isMask(node: Layer): boolean {
  return node.props.mask !== undefined
}

/** Whether a layer is a group whose own layers include exactly one mask, shown or hidden. */
export function isMaskGroup(design: Design, id: string): boolean {
  if (design.nodes[id]?.type !== 'group') return false
  return childrenOf(design, id).filter(([, child]) => isMask(child)).length === 1
}

/** The mask that masks a shown layer: the nearest shown mask below it in its parent. Null for a mask, a hidden layer, or a layer no shown mask is below. */
export function maskOf(design: Design, id: string): string | null {
  const node = design.nodes[id]
  if (!node || !shown(node) || isMask(node)) return null
  const siblings = childrenOf(design, node.parentId)
  const at = siblings.findIndex(([sibling]) => sibling === id)
  return siblings.slice(0, at).findLast(([, sibling]) => shown(sibling) && isMask(sibling))?.[0] ?? null
}

/** The nearest shown layer above a layer in its parent, a mask among them, or null at the top. */
export function shownAbove(design: Design, id: string): string | null {
  const node = design.nodes[id]
  if (!node) return null
  const siblings = childrenOf(design, node.parentId)
  const at = siblings.findIndex(([sibling]) => sibling === id)
  return siblings.slice(at + 1).find(([, sibling]) => shown(sibling))?.[0] ?? null
}

/** Each shown mask among a parent's layers, bottom to top, with the layers it masks, in one pass. */
export function maskSpans(design: Design, parentId: string): MaskSpan[] {
  const spans: MaskSpan[] = []
  for (const [id, child] of childrenOf(design, parentId)) {
    if (!shown(child)) continue
    if (isMask(child)) spans.push({ mask: id, masked: [] })
    else spans.at(-1)?.masked.push(id)
  }
  return spans
}

/** Whether a layer is drawn: not hidden. */
function shown(node: Layer) {
  return node.props.visible !== false
}
