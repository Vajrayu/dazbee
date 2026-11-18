// Duplicate: copies the selected layers beside their originals and selects the copies; and the
// copies an Alt-drag makes where their originals are. While the copies of the last Duplicate or
// Alt-drag are still the whole selection, each in its source's frame, the next Duplicate places its
// copies as far from them as they are from their sources, measured at that moment.
import { childrenOf, frameIdOf, placedByFlow, type Session } from '@dazbee/doc'
import type { Design, Point } from '@dazbee/schema'

import type { Frame } from '../canvas/frames.ts'
import { type EditorSelection, idsOf, pairsIn, type Picked } from '../selection.ts'
import type { EditorBoxes } from './boxes.ts'
import { centreOf } from './transform.ts'

export interface DuplicateDeps {
  session: Session
  selection: Pick<EditorSelection, 'current' | 'selectAcross' | 'onSelection'>
  boxes: Pick<EditorBoxes, 'rootsByFrame' | 'movedBoxes' | 'drawnBoxOf' | 'storedBoxes'>
  /** Groups fit what they hold again after a change inside them, in the same undo step. */
  hug: (ids: string[]) => void
}

export interface EditorDuplicate {
  /**
   * Copies the selected layers of each frame, each right above its original and, unless a flow
   * places it, 20 right and down of it as drawn on the page, or by the last Duplicate's step while
   * its copies are the whole selection, each in its source's frame; selects the copies. One undo step
   * named `duplicate`. With nothing selected it does nothing.
   */
  duplicate(): void
  /**
   * Copies layers of frames where they are, each right above its original, in the undo step open,
   * leaving out any no longer in the design; selects the copies and keeps them, each with its
   * source, as the last Duplicate's. Returns each frame's copies, each by the layer it copies, in
   * the order of its layers; with none made it selects nothing.
   */
  copyInPlace(parts: readonly CopyPart[]): Map<string, string>[]
}

/** The layers of a frame to copy. */
export interface CopyPart {
  frame: Frame
  ids: string[]
}

/** What a copy made: each part's copies, each by the layer it copies, and the copies as layers of their frames. */
interface Copied {
  made: Map<string, string>[]
  picked: Picked[]
}

/** How far right and down of its original a copy is drawn on the page, in design pixels. */
export const DUPLICATE_STEP: Point = { x: 20, y: 20 }

export function editorDuplicate({ session, selection, boxes, hug }: DuplicateDeps): EditorDuplicate {
  /** The last Duplicate's copies, each with its source, while they are the whole selection. */
  let last: Map<string, string> | null = null

  /**
   * Where each copy of a frame's layers is stored, by its original's id: each layer no flow places,
   * with what it holds, moved by its step across the frame; none when a flow places every one.
   */
  function placesOf(frame: Frame, ids: string[], steps: ReadonlyMap<string, Point>, now: Design) {
    const free = ids.filter((root) => !placedByFlow(now, root))
    const moved = boxes.movedBoxes(frame, free, (id) => steps.get(id) ?? DUPLICATE_STEP)
    const places = new Map([...moved].map(([id, { x, y }]) => [id, { x, y }]))
    return places.size > 0 ? Object.fromEntries(boxes.storedBoxes(places)) : undefined
  }
  /** How far each copy of the last Duplicate is drawn from its source now, by the copy's id. */
  function stepsFrom(copies: ReadonlyMap<string, string>, parts: { frame: Frame; ids: string[] }[], now: Design) {
    const steps = new Map<string, Point>()
    for (const { frame, ids } of parts) {
      for (const copy of ids) {
        const to = boxes.drawnBoxOf(frame, copy, now)
        const from = boxes.drawnBoxOf(frame, copies.get(copy) ?? '', now)
        if (to && from) steps.set(copy, minus(centreOf(to), centreOf(from)))
      }
    }
    return steps
  }

  /**
   * Copies each part's layers still in the design by `node.duplicate`, each stored where `places`
   * says or else where its original is. Gives each part's copies, each by the layer it copies, and
   * the copies as layers of their frames.
   */
  function copyParts(parts: readonly (CopyPart & { places?: Record<string, Point> | undefined })[]): Copied {
    const picked: Picked[] = []
    const made = parts.map(({ frame, ids, places }) => {
      const there = ids.filter((id) => session.design().nodes[id])
      const copies = there.length > 0 ? session.run('node.duplicate', { ids: there, places }) : []
      picked.push(...pairsIn(frame.id, copies))
      return new Map(copies.map((copy, i) => [there[i] as string, copy]))
    })
    return { made, picked }
  }
  /** With a copy made, selects the copies and keeps them, each with its source, as the last Duplicate's. */
  function keep({ made, picked }: Copied) {
    if (picked.length === 0) return
    selection.selectAcross(picked)
    last = new Map(made.flatMap((copies) => [...copies].map(([source, copy]) => [copy, source])))
  }
  function duplicate() {
    const now = session.design()
    const parts = boxes.rootsByFrame(now)
    if (parts.length === 0) return
    // A step means something only between a copy and its source in one frame.
    const oneFrame = [...(last ?? [])].every(
      ([copy, source]) => !now.nodes[source] || frameIdOf(now, copy) === frameIdOf(now, source),
    )
    const repeats = last !== null && oneFrame && sameIds(idsOf(selection.current()), [...last.keys()])
    const steps = repeats ? stepsFrom(last as Map<string, string>, parts, now) : new Map<string, Point>()
    const placed = parts.map(({ frame, ids }) => ({ frame, ids, places: placesOf(frame, ids, steps, now) }))
    // Selected once the step has ended: a fault puts the copies back and leaves the selection as it was.
    const copied = session.gesture('duplicate', () => {
      const copies = copyParts(placed)
      for (const made of copies.made) hug([...made.values()])
      return copies
    })
    keep(copied)
  }
  function copyInPlace(parts: readonly CopyPart[]) {
    const copied = copyParts(parts)
    keep(copied)
    return copied.made
  }

  selection.onSelection((ids) => {
    if (last && !sameIds(ids, [...last.keys()])) last = null
  })

  return { duplicate, copyInPlace }
}

/**
 * Each layer of copied layers and of what they hold, by the layer it copies: each copy by its
 * original, then the layers inside each pair, walking the original's and the copy's in order, as
 * `node.duplicate` gives a copy what its original holds, in its order. A layer inside an original
 * with none at its place in the copy is left out, with what it holds.
 */
export function copiedIds(now: Design, copies: ReadonlyMap<string, string>) {
  const ids = new Map<string, string>()
  const pair = (source: string, copy: string) => {
    ids.set(source, copy)
    const inner = childrenOf(now, copy)
    childrenOf(now, source).forEach(([id], i) => {
      const counterpart = inner[i]?.[0]
      if (counterpart) pair(id, counterpart)
    })
  }
  for (const [source, copy] of copies) pair(source, copy)
  return ids
}

/** Each layer of copies, and of what they hold, by its id: the link id of the layer it copies (`copiedIds`). */
export function originalLinks(now: Design, copies: ReadonlyMap<string, string>): Record<string, string> {
  const links: Record<string, string> = {}
  for (const [source, copy] of copiedIds(now, copies)) {
    const link = now.nodes[source]?.link
    if (link !== undefined) links[copy] = link
  }
  return links
}

/** Whether two lists hold the same ids. */
function sameIds(a: readonly string[], b: readonly string[]) {
  const set = new Set(a)
  return set.size === new Set(b).size && b.every((id) => set.has(id))
}

function minus(a: Point, b: Point): Point {
  return { x: a.x - b.x, y: a.y - b.y }
}
