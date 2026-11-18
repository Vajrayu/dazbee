// Random edits for the sync simulator, as FigCraft's sim_tests.rs makes them, in Dazbee's records:
// one edit writes what a command would to a tab's open step, reading the tab's working design. Each
// checks what a command checks, except now and then a move that a command would refuse (a cycle, a
// second holder of a link in one frame), which the server must refuse. A toy derived value stands
// for a group's box (D6): a group's height is 10 plus 10 for each layer it holds.
import { generateKeyBetween } from 'fractional-indexing'

import { canHold, type Change, type DesignInput, type HeldPart, type Target } from '@dazbee/schema'

import { sameValue } from '../same-value.ts'
import { ORDER_KEY, type Rec, type RecordKey, recordOf } from './changes.ts'
import type { Client } from './client.ts'
import { type Recompute, touchedBy } from './follow-up.ts'
import { type ReadState, recordKeys } from './state.ts'

/** The randomness an edit draws on, from a seed. */
export interface Dice {
  below(n: number): number
  chance(p: number): boolean
  pick<T>(items: readonly T[]): T | undefined
}

/** What an edit needs besides the tab: dice, and a maker of ids no other tab makes. */
export interface EditKit {
  dice: Dice
  newId(): string
}

/** A text layer's text and runs, which change as one value. */
type TextValue = { text: string; runs: { start: number; end: number; style: Record<string, unknown> }[] }

/** The toy derived value, as a group's box is: a group's height is 10 plus 10 for each layer it holds. */
export const groupHeights: Recompute = (state, touched) => {
  const out: Change[] = []
  for (const key of touched) {
    const { part, id } = recordOf(key)
    const record = part === 'layer' ? state.get('layer', id) : undefined
    const want = heightOf(state, id)
    if (record?.type === 'group' && (record.props as Rec).height !== want) {
      out.push({ op: 'set', value: { part: 'layer', id, key: 'props', prop: 'height' }, to: want })
    }
  }
  return out
}

const WORDS = ['Sale', 'New', 'Summer', 'Shop now', 'Hello', '50% off', 'Fresh', 'Today only']
const COLORS = ['#FF5A36FF', '#111111FF', '#FFC400FF', '#2E7DFFFF', '#FFFFFFFF']

/** The edits, each with how often it comes. */
const EDITS: readonly [weight: number, edit: (c: Client, kit: EditKit) => string | undefined][] = [
  [1, addPage],
  [2, addFrame],
  [5, addLayer],
  [2, groupLayers],
  [3, moveLayer],
  [2, reorder],
  [2, deleteLayer],
  [1, deleteFrameOrPage],
  [5, setProp],
  [2, setText],
  [1, rename],
  [1, moveFrame],
]
const TOTAL = EDITS.reduce((sum, [weight]) => sum + weight, 0)

/** The groups whose height is not the one `groupHeights` works out. */
export function staleGroups(state: ReadState): string[] {
  return state.ids('layer').filter((id) => {
    const record = state.get('layer', id)
    return record?.type === 'group' && (record.props as Rec).height !== heightOf(state, id)
  })
}

/** `design` with every group's height as `groupHeights` works it out. */
export function withGroupHeights(design: DesignInput): DesignInput {
  const nodes = Object.entries(design.nodes)
  const held = (id: string) => nodes.filter(([, node]) => node.parentId === id).length
  const fixed = nodes.map(([id, node]) =>
    node.type === 'group' ? [id, { ...node, props: { ...node.props, height: 10 + 10 * held(id) } }] : [id, node],
  )
  return { ...design, nodes: Object.fromEntries(fixed) as DesignInput['nodes'] }
}

/** Writes to `c`'s open step the derived values over what the step changed since `before`, as a command keeps them. */
export function writeDerived(c: Client, before: ReadState, recompute: Recompute) {
  const working = c.working()
  const changed = recordKeys(before, working).filter((key) => !sameValue(before.getKey(key), working.getKey(key)))
  const changes = recompute(working, touchedBy(before, working, changed as RecordKey[]))
  if (changes !== 'wait') for (const change of changes) c.write(change)
}

/** Writes one random edit to tab `c`'s open step; returns its step name, or undefined when it wrote nothing. */
export function randomEdit(c: Client, kit: EditKit): string | undefined {
  let roll = kit.dice.below(TOTAL)
  const [, edit] = EDITS.find(([weight]) => (roll -= weight) < 0) ?? (EDITS[0] as (typeof EDITS)[number])
  return edit(c, kit)
}

function addPage(c: Client, { newId }: EditKit) {
  const order = keyAt(c.working(), byOrder(c.working(), c.working().ids('page'), 'page'), Infinity, 'page')
  c.write({ op: 'create', part: 'page', id: newId(), record: { name: 'Page', order } })
  return 'add page'
}

function addFrame(c: Client, { dice, newId }: EditKit) {
  const view = c.working()
  const pageId = dice.pick(view.ids('page'))
  if (pageId === undefined) return undefined
  const order = keyAt(view, sortedIn(view, pageId, 'frame'), dice.below(4), 'frame')
  const record = { pageId, name: 'Frame', width: 100 + dice.below(900), height: 100, x: dice.below(2000), y: 0, order }
  c.write({ op: 'create', part: 'frame', id: newId(), record })
  return 'add frame'
}

function addLayer(c: Client, kit: EditKit) {
  const view = c.working()
  const holder = kit.dice.pick(holders(view))
  if (holder === undefined) return undefined
  const type = kit.dice.pick(['box', 'group', 'text', 'graphic', 'graphic'] as const) as string
  const id = kit.newId()
  const index = keyAt(view, sortedIn(view, holder, 'layer'), kit.dice.below(5), 'layer')
  c.write({ op: 'create', part: 'layer', id, record: layer(type, holder, id, index, kit.dice) })
  return 'add layer'
}

/** A new group at a layer's place, with that layer and maybe its next sibling moved into it. */
function groupLayers(c: Client, kit: EditKit) {
  const view = c.working()
  const first = kit.dice.pick(view.ids('layer'))
  const holder = first === undefined ? undefined : (view.get('layer', first)?.parentId as string)
  if (first === undefined || holder === undefined) return undefined
  const siblings = sortedIn(view, holder, 'layer')
  const at = siblings.indexOf(first)
  const id = kit.newId()
  const index = view.get('layer', first)?.index as string
  c.write({ op: 'create', part: 'layer', id, record: layer('group', holder, id, index, kit.dice) })
  for (const [n, inside] of siblings.slice(at, at + 1 + kit.dice.below(2)).entries()) {
    c.write({ op: 'set', value: { part: 'layer', id: inside, key: 'parentId' }, to: id })
    c.write({ op: 'set', value: { part: 'layer', id: inside, key: 'index' }, to: `a${n}` })
  }
  return 'group'
}

function moveLayer(c: Client, { dice }: EditKit) {
  const view = c.working()
  const id = dice.pick(view.ids('layer'))
  const to = dice.pick(holders(view))
  const record = id === undefined ? undefined : view.get('layer', id)
  if (id === undefined || to === undefined || !record) return undefined
  const into = view.get('layer', to)
  // A command refuses these; now and then one goes anyway, for the server to refuse.
  const refused =
    insideOf(view, to, id) ||
    (into !== undefined && !canHold(into.type as string, record.type as string)) ||
    linkTaken(view, id, to)
  if (refused && !dice.chance(0.1)) return undefined
  c.write({ op: 'set', value: { part: 'layer', id, key: 'parentId' }, to })
  const index = keyAt(view, sortedIn(view, to, 'layer'), dice.below(4), 'layer')
  c.write({ op: 'set', value: { part: 'layer', id, key: 'index' }, to: index })
  return 'move'
}

/** A new place among its siblings, sometimes the very key a sibling has. */
function reorder(c: Client, { dice }: EditKit) {
  const view = c.working()
  const id = dice.pick(view.ids('layer'))
  const record = id === undefined ? undefined : view.get('layer', id)
  if (id === undefined || !record) return undefined
  const siblings = sortedIn(view, record.parentId as string, 'layer').filter((s) => s !== id)
  const same = dice.chance(0.2) ? dice.pick(siblings) : undefined
  const index = same === undefined ? keyAt(view, siblings, dice.below(5), 'layer') : view.get('layer', same)?.index
  c.write({ op: 'set', value: { part: 'layer', id, key: 'index' }, to: index })
  return 'reorder'
}

function deleteLayer(c: Client, { dice }: EditKit) {
  const id = dice.pick(c.working().ids('layer'))
  if (id === undefined || !dice.chance(0.6)) return undefined
  c.write({ op: 'delete', part: 'layer', id })
  return 'delete'
}

function deleteFrameOrPage(c: Client, { dice }: EditKit) {
  const view = c.working()
  const page = dice.chance(0.3) && view.count('page') > 1
  const id = dice.pick(view.ids(page ? 'page' : 'frame'))
  if (id === undefined) return undefined
  c.write({ op: 'delete', part: page ? 'page' : 'frame', id })
  return page ? 'delete page' : 'delete frame'
}

function setProp(c: Client, { dice }: EditKit) {
  const id = dice.pick(c.working().ids('layer'))
  if (id === undefined) return undefined
  const prop = (key: string): Target => ({ part: 'layer', id, key: 'props', prop: key })
  const writes: Change[][] = [
    [{ op: 'set', value: prop('x'), to: dice.below(800) }],
    [{ op: 'set', value: prop('y'), to: dice.below(800) / 2 }],
    [{ op: 'set', value: prop('opacity'), to: dice.below(11) / 10 }],
    [{ op: 'set', value: prop('visible'), to: dice.chance(0.5) }],
    [{ op: 'set', value: prop('rotation'), to: dice.chance(0.3) ? undefined : dice.below(360) }],
    [
      { op: 'set', value: prop('x'), to: dice.below(800) },
      { op: 'set', value: prop('width'), to: 10 + dice.below(400) },
    ],
  ]
  for (const change of dice.pick(writes) ?? []) c.write(change)
  const record = c.working().get('layer', id)
  if (record?.type !== 'group' && record?.type !== 'text' && dice.chance(0.4)) {
    c.write({ op: 'set', value: prop('fills'), to: [{ type: 'solid', color: dice.pick(COLORS) }] })
  }
  return 'edit'
}

function setText(c: Client, { dice }: EditKit) {
  const view = c.working()
  const id = dice.pick(view.ids('layer').filter((n) => view.get('layer', n)?.type === 'text'))
  if (id === undefined) return undefined
  c.write({ op: 'set', value: { part: 'layer', id, key: 'props', prop: 'text' }, to: textValue(dice) })
  return 'type'
}

function rename(c: Client, { dice }: EditKit) {
  const view = c.working()
  const part = dice.pick(['meta', 'page', 'frame', 'layer'] as const) as 'meta' | HeldPart
  const id = part === 'meta' ? 'meta' : dice.pick(view.ids(part))
  if (id === undefined) return undefined
  c.write({ op: 'set', value: { part, id, key: 'name' }, to: `${dice.pick(WORDS)} ${dice.below(100)}` })
  return 'rename'
}

function moveFrame(c: Client, { dice }: EditKit) {
  const view = c.working()
  const [id, pageId] = [dice.pick(view.ids('frame')), dice.pick(view.ids('page'))]
  if (id === undefined || pageId === undefined) return undefined
  c.write({ op: 'set', value: { part: 'frame', id, key: 'pageId' }, to: pageId })
  const order = keyAt(view, sortedIn(view, pageId, 'frame'), dice.below(3), 'frame')
  c.write({ op: 'set', value: { part: 'frame', id, key: 'order' }, to: order })
  return 'move frame'
}

function heightOf(state: ReadState, id: string): number {
  return 10 + 10 * state.childrenOf(id).size
}

/** A new layer of `type` in `holder`, with a link of its own. */
function layer(type: string, parentId: string, id: string, index: string, dice: Dice): Rec {
  const box = { x: dice.below(500), y: dice.below(500), width: 10 + dice.below(200), height: 10 + dice.below(200) }
  const fills = [{ type: 'solid', color: dice.pick(COLORS) }]
  const props =
    type === 'text'
      ? { ...box, ...textValue(dice), style: { fontFamily: 'Noto Sans', fontSize: 24, color: '#111111FF' } }
      : type === 'graphic'
        ? { ...box, shape: { kind: dice.chance(0.5) ? 'rect' : 'ellipse' }, fills }
        : type === 'box'
          ? { ...box, fills }
          : box
  return { type, parentId, link: id, index, name: type, props }
}

function textValue(dice: Dice): TextValue {
  const text = `${dice.pick(WORDS)} ${dice.below(1000)}`
  const end = 1 + dice.below(text.length)
  return { text, runs: dice.chance(0.5) ? [{ start: 0, end, style: { fontWeight: 700 } }] : [] }
}

/** Frames, boxes and groups: what a layer can be put into. */
function holders(view: ReadState): string[] {
  const containers = view.ids('layer').filter((id) => ['box', 'group'].includes(view.get('layer', id)?.type as string))
  return [...view.ids('frame'), ...containers]
}

/** Whether `id` is `layer` or inside it. */
function insideOf(view: ReadState, id: string, layer: string): boolean {
  const seen = new Set<string>()
  for (
    let at: string | undefined = id;
    at !== undefined && !seen.has(at);
    at = view.get('layer', at)?.parentId as string
  ) {
    if (at === layer) return true
    seen.add(at)
  }
  return false
}

/** Whether moving `id` into `to` would put a second holder of one of its links into a frame. */
function linkTaken(view: ReadState, id: string, to: string): boolean {
  const frame = frameOf(view, to)
  const moved = view.subtree(id)
  return moved.some((layer) =>
    [...view.linkHolders(view.get('layer', layer)?.link as string)].some(
      (other) => other !== layer && !moved.includes(other) && frameOf(view, other) === frame,
    ),
  )
}

function frameOf(view: ReadState, id: string): string | undefined {
  const seen = new Set<string>()
  for (
    let at: string | undefined = id;
    at !== undefined && !seen.has(at);
    at = view.get('layer', at)?.parentId as string
  ) {
    if (view.get('frame', at)) return at
    seen.add(at)
  }
  return undefined
}

/** The ids of what `holder` holds of `part`, by their order key then id, as the design view lists them. */
function sortedIn(view: ReadState, holder: string, part: 'frame' | 'layer'): string[] {
  return byOrder(
    view,
    [...view.childrenOf(holder)].filter((id) => view.get(part, id)),
    part,
  )
}

function byOrder(view: ReadState, ids: string[], part: HeldPart): string[] {
  const key = (id: string) => String(view.get(part, id)?.[ORDER_KEY[part]])
  return ids.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : a < b ? -1 : 1))
}

/** An order key for slot `at` among `sorted` (the end when past it): the key of a neighbour when two are equal. */
function keyAt(view: ReadState, sorted: readonly string[], at: number, part: HeldPart): string {
  const key = (id: string | undefined) => (id === undefined ? null : String(view.get(part, id)?.[ORDER_KEY[part]]))
  const slot = Math.min(at, sorted.length)
  const [before, after] = [key(sorted[slot - 1]), key(sorted[slot])]
  return before !== null && after !== null && before >= after ? before : generateKeyBetween(before, after)
}
