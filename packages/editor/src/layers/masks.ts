// What the Full menu's mask item does for the selection, frame by frame: Use as mask puts the
// layers in a new Mask group, the bottom one the mask; Release mask turns a mask off, and ungroups
// its Mask group when that group is outside an auto layout box. Each frame's part is judged on the
// design before anything runs, so the item and its key never disagree.
import {
  ancestorsOf,
  childrenOf,
  isMaskGroup,
  laidOutBox,
  maskOf,
  type Session,
  shownAbove,
  wrapRefusal,
} from '@dazbee/doc'
import type { Design } from '@dazbee/schema'

/** Why the mask item has nothing to do. */
export type MaskWhy = 'maskLocked' | 'locked' | 'groupLocked' | 'inAutoLayout' | 'apart' | 'mixed'
/** What the Full menu's mask item shows; null when it is left out (nothing selected, or a layer inside a boolean). */
export type MaskState = { item: 'use' | 'release'; why: MaskWhy | null } | null
/**
 * One frame's part: for Use as mask, the layers to wrap and the one that becomes the mask; for
 * Release mask, the Mask groups to ungroup and the masks to turn off only.
 */
export type MaskPart =
  | { item: 'use'; why: MaskWhy | null; wrap: string[]; mask: string }
  | { item: 'release'; why: MaskWhy | null; ungroup: string[]; unmask: string[] }

/** The reasons in the order that picks the one shown when several apply. */
const WHY_ORDER: readonly MaskWhy[] = ['maskLocked', 'locked', 'groupLocked', 'inAutoLayout', 'apart', 'mixed']

/** One frame's part of the mask item for its selected layers, or null when the item is left out. */
export function maskPart(design: Design, ids: readonly string[]): MaskPart | null {
  const nodes = ids.map((id) => design.nodes[id])
  if (nodes.length === 0 || nodes.some((node) => !node || design.nodes[node.parentId]?.type === 'boolean')) return null
  const masks = ids.map((id) => maskFor(design, id))
  if (masks.every((mask) => mask !== null)) return releasePart(design, [...new Set(masks)])
  return usePart(
    design,
    ids,
    masks.some((mask) => mask !== null),
  )
}

/**
 * What the item shows for the parts of every frame with selected layers, as Ungroup does across
 * frames: greyed only while no part can run, with the first reason in the decided order.
 */
export function maskStateOf(parts: readonly (MaskPart | null)[]): MaskState {
  if (parts.length === 0 || parts.some((part) => part === null)) return null
  const shown = parts as MaskPart[]
  const [first] = shown as [MaskPart]
  if (shown.some((part) => part.item !== first.item)) return { item: 'use', why: 'mixed' }
  if (shown.some((part) => part.why === null)) return { item: first.item, why: null }
  return { item: first.item, why: WHY_ORDER.find((why) => shown.some((part) => part.why === why)) ?? null }
}

/**
 * Runs one frame's part on the session, inside the caller's undo step. Returns the layers to
 * select: the new Mask group, or what a release freed and the masks it turned off; null while the
 * part is greyed, leaving its layers as they are.
 */
export function runMaskPart(session: Session, part: MaskPart | null, name: string): string[] | null {
  if (!part || part.why) return null
  if (part.item === 'use') {
    const group = session.run('node.group', { ids: part.wrap, name })
    session.run('node.mask', { ids: [part.mask], mask: 'alpha' })
    return [group]
  }
  // Innermost first, so a Mask group inside another comes apart before the outer one frees it.
  const now = session.design()
  const groups = [...part.ungroup].sort((a, b) => ancestorsOf(now, b).length - ancestorsOf(now, a).length)
  const freed = groups.flatMap((id) => session.run('node.ungroup', { ids: [id] }))
  if (part.unmask.length > 0) session.run('node.mask', { ids: part.unmask, mask: null })
  return [...new Set([...freed, ...part.unmask])].filter((id) => session.design().nodes[id])
}

/** The mask a selected layer stands for: itself when a mask, a Mask group's mask, or the mask that masks it. */
function maskFor(design: Design, id: string): string | null {
  if (design.nodes[id]?.props.mask) return id
  if (isMaskGroup(design, id)) return childrenOf(design, id).find(([, kid]) => kid.props.mask)?.[0] ?? null
  return maskOf(design, id)
}

/**
 * Release mask's part: a mask whose parent is a Mask group outside an auto layout box ungroups
 * that group, which turns the mask off; any other mask is turned off only.
 */
function releasePart(design: Design, masks: readonly string[]): MaskPart {
  const ungroup = new Set<string>()
  const unmask: string[] = []
  for (const mask of masks) {
    const parent = design.nodes[mask]?.parentId ?? ''
    if (isMaskGroup(design, parent) && !laidOutBox(design, design.nodes[parent]?.parentId ?? '')) ungroup.add(parent)
    else unmask.push(mask)
  }
  const why: MaskWhy | null = masks.some((mask) => design.nodes[mask]?.lock?.style)
    ? 'maskLocked'
    : [...ungroup].some((id) => design.nodes[id]?.lock?.delete)
      ? 'groupLocked'
      : null
  return { item: 'release', why, ungroup: [...ungroup], unmask }
}

/**
 * Use as mask's part: wrap the layers, or one layer and the shown layer above unless that is a
 * mask. Whether they can be wrapped at all is Group's rule, `wrapRefusal`.
 */
function usePart(design: Design, ids: readonly string[], mixed: boolean): MaskPart {
  const parent = design.nodes[ids[0] as string]?.parentId ?? ''
  const apart = wrapRefusal(design, ids, 'group') === 'apart'
  const inOrder = childrenOf(design, parent)
    .map(([id]) => id)
    .filter((id) => ids.includes(id))
  const [mask = ids[0] as string] = apart ? [] : inOrder
  const above = ids.length === 1 ? shownAbove(design, mask) : null
  const wrap = ids.length > 1 ? inOrder : above && !design.nodes[above]?.props.mask ? [mask, above] : [mask]
  const refusal = apart ? 'apart' : wrapRefusal(design, wrap, 'group')
  const why: MaskWhy | null =
    !apart && design.nodes[mask]?.lock?.style
      ? 'maskLocked'
      : refusal === 'locked'
        ? 'locked'
        : ids.some((id) => laidOutBox(design, design.nodes[id]?.parentId ?? ''))
          ? 'inAutoLayout'
          : apart
            ? 'apart'
            : mixed
              ? 'mixed'
              : null
  return { item: 'use', why, wrap, mask }
}
