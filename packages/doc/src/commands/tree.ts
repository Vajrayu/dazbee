// Where layers, pages and frames go in their order, and copies of layers with fresh ids and the
// link ids they take.
import { generateNKeysBetween } from 'fractional-indexing'

import { byCodeUnits, type Design, type Layer as LayerT, type Point } from '@dazbee/schema'

import { ancestorsOf, childrenOf, descendants } from '../children.ts'
import type { Part, StoreWrite } from '../store.ts'
import { ORDER_KEY } from '../sync/changes.ts'
import type { CommandContext } from './define.ts'

/**
 * The link ids copies take: 'new', a new one each; 'keep', each its original's; a Map, one new link
 * per old link, filled as it goes, so copies made together stay linked to each other; `{ held }`,
 * the link ids the frame they go into holds: each keeps its original's where the frame doesn't hold
 * it yet, and then holds it, else a new one.
 */
export type LinkRule = 'new' | 'keep' | Map<string, string> | { held: Set<string> }

/** A sibling in the order wanted: its id, and the index it has, null for one that has none yet. */
export type Slot = readonly [id: string, index: string | null]

/** The longest index a command makes: one that would be longer has its siblings re-spaced instead. */
const LONGEST_INDEX = 48

/**
 * The indexes that put siblings in the order given, by id, for those whose index changes. `slots`
 * are all the siblings under one parent, in the order wanted; `moving` are the ones that came or
 * moved, which may take any index. Each other one keeps its index unless it ties with the one
 * kept before it: two tabs inserting at once give two siblings one index, drawn in id order, and
 * the first keeps it. A run of siblings left without an index of their own gets indexes between
 * the kept ones around it, unless the ones they have already sit in order there. Where none can
 * be made, because a neighbour's index is not one the library makes or one would be longer than
 * LONGEST_INDEX, every sibling is re-spaced.
 */
export function orderIndexes(slots: readonly Slot[], moving: ReadonlySet<string> = new Set()): Map<string, string> {
  const kept = new Array<boolean>(slots.length).fill(false)
  let last: string | null = null
  slots.forEach(([id, index], i) => {
    if (index === null || moving.has(id) || (last !== null && index <= last)) return
    kept[i] = true
    last = index
  })
  const changes = new Map<string, string>()
  for (let start = 0; start < slots.length; start++) {
    if (kept[start]) continue
    let end = start
    while (end + 1 < slots.length && !kept[end + 1]) end++
    const run = slots.slice(start, end + 1)
    const low = slots[start - 1]?.[1] ?? null
    const high = slots[end + 1]?.[1] ?? null
    const fits = run.every(([, index], k) => {
      const before = k === 0 ? low : (run[k - 1] as Slot)[1]
      return index !== null && (before === null || index > before) && (high === null || index < high)
    })
    if (!fits) {
      const made = indexesBetween(low, high, run.length)
      if (!made) return respaced(slots)
      run.forEach(([id], k) => changes.set(id, made[k] as string))
    }
    start = end
  }
  return changes
}

/**
 * Writes the indexes that put siblings in the order given (`orderIndexes`) on those the store
 * holds, a layer's `index` or a page's or frame's `order`, and gives the index each sibling has
 * after, by id: one the store does not hold yet is written with it by the caller.
 */
export function writeOrder(
  w: StoreWrite,
  part: Part,
  slots: readonly Slot[],
  moving?: ReadonlySet<string>,
): (id: string) => string {
  const changes = orderIndexes(slots, moving)
  const key = ORDER_KEY[part]
  for (const [id, index] of changes) w.set(part, id, key, index)
  // A sibling that came is asked for most and is among the changes; the others, by id, only once asked.
  let kept: Map<string, string | null> | undefined
  return (id) => changes.get(id) ?? ((kept ??= new Map(slots)).get(id) as string)
}

/** Slots in the order their indexes give, ties by id: the order layers are drawn in, back to front. */
export const drawnOrder = (slots: readonly Slot[]): Slot[] =>
  slots.toSorted(([a, x], [b, y]) => byCodeUnits(x ?? '', y ?? '') || byCodeUnits(a, b))

/** A parent's layers as slots, back to front. */
export const layerSlots = (design: Design, parentId: string): Slot[] =>
  childrenOf(design, parentId).map(([id, layer]) => [id, layer.index])

/**
 * The index each of a parent's layers takes in a copy of them: its own, except that layers with
 * one index, which their ids order, take indexes of their own: a copy has another id.
 */
export function copyIndexes(design: Design, parentId: string): (id: string) => string {
  const slots = layerSlots(design, parentId)
  const changes = orderIndexes(slots)
  const own = new Map(slots)
  return (id) => changes.get(id) ?? (own.get(id) as string)
}

/** The link id each copy takes, from its original's, by the rule; `newId` makes a new one. */
export function linkMaker(rule: LinkRule, newId: () => string): (old: string) => string {
  if (rule === 'new') return () => newId()
  if (rule === 'keep') return (old) => old
  if (rule instanceof Map)
    return (old) => {
      const fresh = rule.get(old) ?? newId()
      rule.set(old, fresh)
      return fresh
    }
  return (old) => {
    if (rule.held.has(old)) return newId()
    rule.held.add(old)
    return old
  }
}

/**
 * Copies layers with fresh ids, each with every layer under it, in the order their originals are
 * drawn; `place` says where each copied root goes, given every copy's id by its original's.
 * Returns the old id to new id map.
 */
export function copyLayers(
  { w, design, newId }: CommandContext,
  roots: string[],
  place: (root: string, ids: ReadonlyMap<string, string>) => { parentId: string; index: string },
  options: {
    /** The link ids the copies take ('new' by default). */
    links?: LinkRule
    /** The props copies take, by their originals' ids, in place of their originals' own. */
    props?: ReadonlyMap<string, LayerT['props']>
    /** Where copies are stored, by their originals' ids: their x and y; one left out is stored where its original is. */
    places?: Readonly<Record<string, Point>>
  } = {},
) {
  const { links = 'new', props: given, places = {} } = options
  const linkOf = linkMaker(links, newId)
  const ids = new Map<string, string>()
  for (const root of roots) for (const old of [root, ...descendants(design, root)]) ids.set(old, newId())
  const indexesUnder = new Map<string, (id: string) => string>()
  const indexOf = (old: string, parentId: string) => {
    const indexes = indexesUnder.get(parentId) ?? copyIndexes(design, parentId)
    indexesUnder.set(parentId, indexes)
    return indexes(old)
  }
  for (const [old, fresh] of ids) {
    const node = design.nodes[old]
    if (!node) continue
    const placed = roots.includes(old)
      ? place(old, ids)
      : { parentId: ids.get(node.parentId) ?? node.parentId, index: indexOf(old, node.parentId) }
    const props = { ...(given?.get(old) ?? node.props), ...places[old] }
    w.create('layer', fresh, { ...node, ...placed, link: linkOf(node.link), props } as LayerT)
  }
  return ids
}

/**
 * Copies every layer of a frame into another frame, which holds none yet, each top layer where its
 * original is in the order, with everything under it. Returns the old id to new id map.
 */
export function copyFrameLayers(
  ctx: CommandContext,
  from: string,
  to: string,
  options: Parameters<typeof copyLayers>[3] = {},
) {
  const roots = childrenOf(ctx.design, from).map(([id]) => id)
  const indexes = copyIndexes(ctx.design, from)
  return copyLayers(ctx, roots, (root) => ({ parentId: to, index: indexes(root) }), options)
}

export const depthOf = (design: Design, id: string) => ancestorsOf(design, design.nodes[id]?.parentId ?? '').length

/** `count` indexes in order between two, each null for none on that side; null when none can be made there. */
function indexesBetween(low: string | null, high: string | null, count: number): string[] | null {
  try {
    const made = generateNKeysBetween(low, high, count)
    return made.some((index) => index.length > LONGEST_INDEX) ? null : made
  } catch {
    return null
  }
}

/** New evenly spaced indexes for every sibling, by id, for those whose index changes. */
function respaced(slots: readonly Slot[]): Map<string, string> {
  const made = generateNKeysBetween(null, null, slots.length)
  return new Map(slots.flatMap(([id, index], i) => (made[i] === index ? [] : [[id, made[i] as string]])))
}
