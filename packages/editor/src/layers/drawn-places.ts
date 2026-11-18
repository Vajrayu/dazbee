// Where layers inside auto layout are drawn, and where to store them so they are drawn there. The
// renderer draws a layer inside a group or box that a flow placed (for a laid-out box, a layer kept
// where it is put) moved by as far as the flow moved that container from its stored box; this
// module works out that shift and its inverse.
import { ancestorsOf, descendants, frameIdOf, type Session } from '@dazbee/doc'
import type { SceneLayer } from '@dazbee/renderer'
import type { Design } from '@dazbee/schema'

import type { FrameScenes } from '../canvas/scenes.ts'
import { laidOut } from './auto-layout.ts'
import type { Box } from './transform.ts'

export interface DrawnPlacesDeps {
  session: Session
  scenes: Pick<FrameScenes, 'laidOutLayer'>
}

export function editorDrawnPlaces({ session, scenes }: DrawnPlacesDeps) {
  /**
   * Where layers that auto layout places or sizes are drawn, and everything inside them, as boxes
   * to store them at, under their parent or under `into` when they move there.
   */
  function drawnInFlow(ids: string[], into?: string): Record<string, Omit<Box, 'rotation'>> | undefined {
    const now = session.design()
    if (!inFlow(ids, into, now)) return undefined
    const inside = new Map<string, Omit<Box, 'rotation'>>()
    for (const id of ids)
      for (const layer of [id, ...descendants(now, id)]) {
        const box = laidOutBoxIn(layer, now)
        if (box) inside.set(layer, sized(box))
      }
    return Object.fromEntries(storedBoxes(inside, into))
  }
  /**
   * The containers around layers, and around `into` when they move there, as drawn, shifted as what
   * moves under `into` is: a command only reads them, to turn the layers about where they are drawn
   * and to keep a laid-out box they leave with nothing in its flow at the size it is drawn. None
   * when no auto layout places or sizes them.
   */
  function drawnHolders(ids: string[], into?: string): Record<string, Omit<Box, 'rotation'>> | undefined {
    const now = session.design()
    if (!inFlow(ids, into, now)) return undefined
    const under = shifts(now, new Map(), into)
    const ups = [
      ...ids.flatMap((id) => ancestorsOf(now, now.nodes[id]?.parentId ?? '')),
      ...ancestorsOf(now, into ?? ''),
    ]
    const holders: Record<string, Omit<Box, 'rotation'>> = {}
    for (const up of new Set(ups)) {
      const box = laidOutBoxIn(up, now) ?? storedBox(now, up)
      holders[up] = { ...sized(box), x: box.x - under.of(into, 'x'), y: box.y - under.of(into, 'y') }
    }
    return holders
  }
  function storedBoxes<B extends Partial<Box>>(boxes: ReadonlyMap<string, B>, into?: string): Map<string, B> {
    const now = session.design()
    if (![...boxes.keys(), ...(into === undefined ? [] : [into])].some((id) => laidOut(id, now))) return new Map(boxes)
    const shift = shifts(now, boxes, into)
    const stored = new Map<string, B>()
    for (const [id, box] of boxes) {
      const up = shift.parentOf(id)
      stored.set(
        id,
        lessShift(box, (axis) => shift.of(up, axis)),
      )
    }
    return stored
  }
  /** Where to store a new layer's box, or its point, drawn at `box` under `parentId`, so it is drawn there. */
  function storedNewBox<B extends Partial<Box>>(box: B, parentId: string): B {
    const now = session.design()
    if (!laidOut(parentId, now)) return box
    const shift = shifts(now, new Map())
    return lessShift(box, (axis) => shift.of(parentId, axis))
  }
  /**
   * How far each layer moves what it holds from where it is stored, on an axis, once `boxes` are
   * stored, the outermost of them under `into` if given: a container as far as it is drawn from its
   * stored box; one given that value, or hidden, as far as what holds it moves it.
   */
  function shifts(now: Design, boxes: ReadonlyMap<string, Partial<Box>>, into?: string) {
    const outermost = (id: string) => !ancestorsOf(now, now.nodes[id]?.parentId ?? '').some((up) => boxes.has(up))
    const parentOf = (id: string) =>
      into !== undefined && boxes.has(id) && outermost(id) ? into : now.nodes[id]?.parentId
    // Each layer's shift once worked out, by layer and axis.
    const known = new Map<string, number>()
    const of = (id: string | undefined, axis: 'x' | 'y'): number => {
      const node = id === undefined ? undefined : now.nodes[id]
      if (!node || id === undefined) return 0
      const key = `${id}|${axis}`
      const seen = known.get(key)
      if (seen !== undefined) return seen
      const up = parentOf(id)
      const drawnAt = boxes.get(id)?.[axis] !== undefined ? null : shownBox(id, now)
      const shift = drawnAt ? drawnAt[axis] - storedBox(now, id)[axis] : of(up, axis)
      known.set(key, shift)
      return shift
    }
    return { parentOf, of }
  }
  function drawnProps(id: string, from: Design = session.design()) {
    const own = from.nodes[id]?.props ?? {}
    const laid = laidOut(id, from) ? laidOutBoxIn(id, from) : null
    return laid ? { ...own, ...sized(laid) } : own
  }
  /** A shown layer's box as its frame is laid out, before its containers turn it; null for a hidden one. */
  function shownBox(id: string, from: Design): Box | null {
    const frameId = frameIdOf(from, id)
    const shown = frameId === undefined ? undefined : scenes.laidOutLayer(frameId, from, id)
    return shown ? boxOfLayer(shown) : null
  }
  /**
   * A layer's box as its frame is laid out, before its containers turn it; a hidden one, which no
   * flow places, where it would be drawn: its stored box moved as what holds it moves it. Null for
   * a layer in no frame.
   */
  function laidOutBoxIn(id: string, from: Design): Box | null {
    const frameId = frameIdOf(from, id)
    if (frameId === undefined || !from.nodes[id]) return null
    const shown = shownBox(id, from)
    if (shown) return shown
    const box = storedBox(from, id)
    const under = shifts(from, new Map())
    const parentId = from.nodes[id]?.parentId
    return { ...box, x: box.x + under.of(parentId, 'x'), y: box.y + under.of(parentId, 'y') }
  }

  return {
    drawnInFlow,
    drawnHolders,
    storedBoxes,
    storedNewBox,
    drawnProps,
    laidOutBoxIn,
  }
}

/** A layer's stored box. */
export function storedBox(from: Design, id: string): Box {
  const p = (from.nodes[id]?.props ?? {}) as Partial<Box>
  return { x: p.x ?? 0, y: p.y ?? 0, width: p.width ?? 0, height: p.height ?? 0, rotation: p.rotation ?? 0 }
}

/** Whether auto layout places or sizes any of layers, or `into`, through what holds them. */
function inFlow(ids: string[], into: string | undefined, now: Design) {
  return [...ids, ...(into === undefined ? [] : [into])].some((id) => laidOut(id, now))
}

/** A box's place and size, without its turn. */
function sized({ x, y, width, height }: Box): Omit<Box, 'rotation'> {
  return { x, y, width, height }
}

/** A layer's box as a scene has it. */
export function boxOfLayer({ props: { x, y, width, height, rotation } }: SceneLayer): Box {
  return { x, y, width, height, rotation }
}

/** A box with how far what holds it moves it taken off each axis it gives. */
function lessShift<B extends Partial<Box>>(box: B, by: (axis: 'x' | 'y') => number): B {
  const at = { ...box }
  for (const axis of ['x', 'y'] as const) {
    const value = box[axis]
    if (value !== undefined) at[axis] = value - by(axis)
  }
  return at
}
