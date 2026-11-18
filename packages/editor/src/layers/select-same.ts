// Select all with same: the layers of the shown page that share a layer's fill, or a text's font,
// as FigCraft's Select all with same ▸ Fill and ▸ Font find them.
import { descendants, sameValue } from '@dazbee/doc'
import { type Design, framesOf, type Layer } from '@dazbee/schema'

import type { Picked, Selection } from '../selection.ts'
import type { StageAction } from '../shortcuts.ts'

/** What Select all with same matches layers by: the whole list of fills, or a text's font. */
export type SameBy = 'fill' | 'font'

/** The Select all with same actions, each with what it matches by, in the order the menus list them. */
export const SAME_ACTIONS = [
  { action: 'selectSameFill', by: 'fill' },
  { action: 'selectSameFont', by: 'font' },
] as const satisfies readonly { action: StageAction; by: SameBy }[]

/** What a layer is matched by, undefined where it has none: its fills while it has any, a text's family, weight and style. */
const KEYS: Record<SameBy, (layer: Layer) => unknown> = {
  fill: (layer) =>
    layer.type === 'text' || layer.type === 'group' || layer.props.fills.length === 0 ? undefined : layer.props.fills,
  font: (layer) =>
    layer.type === 'text'
      ? {
          family: layer.props.style.fontFamily,
          weight: layer.props.style.fontWeight,
          style: layer.props.style.fontStyle,
        }
      : undefined,
}

/**
 * The layers of `layer`'s page that share its fill or its font, `layer` first, then the rest in its
 * page's order, frame by frame, parents before children, hidden ones too. Left out are the layers
 * whose own paint is never drawn, a mask and the shapes inside a boolean, and those locked in place,
 * as select all leaves them out. None when `layer` has nothing to match by or is gone.
 */
export function sameAs(design: Design, layer: Picked, by: SameBy): Picked[] {
  const node = design.nodes[layer.id]
  const key = node && KEYS[by](node)
  const pageId = design.frames[layer.frameId]?.pageId
  if (key === undefined || pageId === undefined) return []
  const rest = framesOf(design, pageId).flatMap(([frameId]) =>
    descendants(design, frameId).flatMap((id) => {
      const other = design.nodes[id]
      const drawsOwnPaint = other && !other.props.mask && design.nodes[other.parentId]?.type !== 'boolean'
      return id !== layer.id && other && drawsOwnPaint && !other.lock?.move && sameValue(KEYS[by](other), key)
        ? [{ id, frameId }]
        : []
    }),
  )
  return [layer, ...rest]
}

/**
 * The selection Select all with same makes from the first selected layer (`sameAs`), or null when
 * it would change nothing: that layer has nothing to match by, or the matches are the layers
 * selected, with it first.
 */
export function selectedSame(design: Design, selection: Selection, by: SameBy): Picked[] | null {
  const [first] = selection
  const next = first ? sameAs(design, first, by) : []
  const pairs = new Set(selection.map(pairKey))
  const same = next.length === selection.length && next.every((pick) => pairs.has(pairKey(pick)))
  return next.length === 0 || same ? null : next
}

/** What an action matches layers by, or null for an action that isn't a Select all with same. */
export function sameByOf(action: StageAction): SameBy | null {
  return SAME_ACTIONS.find((row) => row.action === action)?.by ?? null
}

/** Whether a layer has a fill or a font to match others by. */
export function matchable(layer: Layer | undefined, by: SameBy): boolean {
  return layer !== undefined && KEYS[by](layer) !== undefined
}

/** A selected layer and its frame as one key. */
function pairKey({ id, frameId }: Picked) {
  return `${frameId}|${id}`
}
