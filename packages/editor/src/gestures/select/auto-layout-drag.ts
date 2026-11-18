// Dragging layers that auto layout places: along their flow, moved to their new place in it as the
// pointer finds it so the others lay out around them, or out of its box; dropping layers into the
// flow of a laid-out box they aren't in; the arrow keys moving them a place at a time; and what a
// drag shows: the layers following the pointer and the line marking where they go.
import {
  boxWraps,
  childrenOf,
  flowLayoutOf,
  flows,
  type GestureStep,
  isMask,
  laidOutBox,
  placedByFlow,
  type Session,
  wrapLines,
} from '@dazbee/doc'
import { gridCells, type SceneLayer } from '@dazbee/renderer'
import { canHold, type Design, gridColumns, type Point } from '@dazbee/schema'

import type { Camera } from '../../canvas/camera.ts'
import type { Frame } from '../../canvas/frames.ts'
import type { FrameScenes } from '../../canvas/scenes.ts'
import type { NoticeDetail } from '../../core-interface.ts'
import { type AutoLayoutOf, flowOrder, flowSiblings, propIn, rowIn } from '../../layers/auto-layout.ts'
import type { EditorBoxes } from '../../layers/boxes.ts'
import { boxOfLayer } from '../../layers/drawn-places.ts'
import { copiedIds, type EditorDuplicate, originalLinks } from '../../layers/duplicate.ts'
import { boundsOf, type Box, centreOf, drawnFrom, holdsPoint, localTo, pageFrom, turn } from '../../layers/transform.ts'
import { runQuietly } from '../../run-quietly.ts'
import type { EditorSelection, HeldSelection } from '../../selection.ts'
import { cellPlace, distanceTo, type FlowPlace, linePlace } from './flow-place.ts'
import { canLeaveFrame, targetFrame } from './into-frame.ts'

/** Where dragged layers would go in the flow of a laid-out box they aren't in: the box, and the containers of its layers, the box last. */
export interface FlowDrop extends FlowPlace {
  boxId: string
  around: Box[]
}
/**
 * A drag of layers in a flow, from the press until it ends: where they go in it, or out of it, into
 * the flow of another laid-out box (`drop`) or onto what is under them, or with the pointer over
 * another frame of the page they can leave theirs for (`target`), onto its top or into a flow
 * there. One undo step. Inside the
 * box the layers are moved to their place as the pointer finds it, found in the design as the press
 * found it (`start`). With `copy`, Alt, the layers stay where they are and copies of them go there
 * instead: made as the pointer comes into the box with Alt, or at the drop outside it.
 */
export interface ReorderDrag extends FlowPlace {
  kind: 'reorder'
  frame: Frame
  around: Box[]
  parentId: string
  roots: string[]
  boxes: Map<string, Box>
  from: Point
  to: Point
  moved: boolean
  /** Whether Alt has the drop leave the layers where they are and drop copies of them. */
  copy: boolean
  outside: boolean
  drop: FlowDrop | null
  step: GestureStep
  /** The design as the press found it, which places are found in, kept at the first move; null before. */
  start: Design | null
  /** The place the layers, or their copies, were moved to; null while they are where the press, or Alt, left them. */
  placed: number | null
  /** The copies Alt made inside the box, in their originals' order, and the selection the press found. */
  copies: { roots: string[]; picked: HeldSelection } | null
  /** Outside the box, the other frame of the page under the pointer the layers go into when dropped; null while they stay in theirs. */
  target: Frame | null
}

/**
 * A part of what a drag in a flow, or into one, shows, with its box as drawn in its frame: a dragged
 * layer following the pointer, the box the layers would leave, or the line where they would go.
 */
export interface FlowPart {
  kind: 'ghost' | 'leave' | 'line'
  frame: Frame
  box: Box
}

export interface AutoLayoutDragDeps {
  session: Session
  scenes: Pick<FrameScenes, 'laidOut' | 'laidOutLayer'>
  boxes: Pick<EditorBoxes, 'boxIn' | 'containersOf' | 'drawnContains' | 'drawnHolders' | 'drawnInFlow' | 'startBoxes'>
  duplicate: Pick<EditorDuplicate, 'copyInPlace'>
  selection: Pick<EditorSelection, 'held' | 'restore'>
  camera: () => Camera
  /** Groups fit what they hold again after a change inside them, in the same undo step. */
  hug: (ids: string[]) => void
  /** Tells the app why the arrow keys did nothing: auto layout decides, the layers are at the flow's end, or one is locked in place. */
  notify: (...told: NoticeDetail<'placedByLayout' | 'flowEnd' | 'refused'>) => void
  /** The shown page's frames as last drawn. */
  frames: () => readonly Frame[]
}

export interface EditorAutoLayoutDrag {
  /**
   * What a drag in a flow shows once it has moved: the layers following the pointer, then the line
   * marking where they go or the box they would leave, which with Alt or onto another frame they
   * don't.
   */
  shown(g: ReorderDrag | null): FlowPart[]
  /** Whether auto layout places layers, all in one flow: a press on them drags them along it (`press`). */
  reorders(ids: string[]): boolean
  /** A press on layers auto layout places, all in one flow: a drag along it or out of its box, one undo step until it is released. Null for any others. */
  press(frame: Frame, around: Box[], p: Point, ids: string[]): ReorderDrag | null
  /**
   * Follows the pointer, once past the click slop: where in the flow the layers go, moving them, or
   * their copies, there; or whether they leave it, the flow put back as the press found it; and
   * `copy`, Alt, whether copies of them go there instead. Alt changing, the pointer leaving the box,
   * or coming back to the press's own place cancels the drag's undo step and begins another.
   */
  drag(g: ReorderDrag, p: Point, copy: boolean): void
  /** Alt pressed or let go with the pointer still: whether copies of the layers go where the drag is instead. */
  setAlt(g: ReorderDrag, alt: boolean): void
  /** Takes back all a drag wrote, copies included, and the selection Alt changed, as a drag the browser takes away does: its release drops nothing. */
  cancel(g: ReorderDrag): void
  /**
   * Drops the layers where the drag shows, or with Alt their copies, which become the selection; the
   * groups around what was dropped fit it again, closing its undo step.
   */
  release(g: ReorderDrag): void
  /**
   * The flow of a laid-out box under a point of a frame that dragged layers would go into, and their
   * place in it: the innermost one under it that they aren't in, don't hold, and that isn't hidden
   * or locked in place, and that isn't a mask or in one. `originals` are the layers the dragged ones
   * are copies of, which they never go into either. Null when there is none, or the layers include
   * a mask.
   */
  dropAt(frame: Frame, p: Point, roots: string[], originals?: readonly string[]): FlowDrop | null
  /** The line where dragged layers would go in a laid-out box's flow; nothing with no drop. */
  shownDrop(frame: Frame, drop: FlowDrop | null): FlowPart[]
  /**
   * Moves layers into a laid-out box's flow at the place found, kept as drawn until it places them,
   * the groups they leave fitting what they hold again. Into another frame, each layer of them takes
   * the link id `links` names for it there, where that frame holds none (`node.move`).
   */
  dropInto(drop: FlowDrop, roots: string[], links?: Record<string, string>): void
  /**
   * The arrow keys on layers a flow places: one place along it, one undo step; the app hears why
   * when it can't. Returns whether a flow places any of them; when none does, it does nothing.
   */
  nudge(ids: string[], dx: number, dy: number, now: Design): boolean
}

/**
 * Where a drag in a flow drops its layers, worked out from them before anything moves: the layers,
 * the parent they go under, the layer they go before, the boxes they are stored at (`drawn`, by
 * id, with what they hold), the containers that turn them (`holders`), the groups they leave that
 * fit what they hold again.
 */
interface Landing {
  ids: string[]
  parentId: string
  before: string | undefined
  drawn: Record<string, Omit<Box, 'rotation'>> | undefined
  holders: Record<string, Omit<Box, 'rotation'>> | undefined
  left: string[]
}

export function editorAutoLayoutDrag({
  session,
  scenes,
  boxes: { boxIn, containersOf, drawnContains, drawnHolders, drawnInFlow, startBoxes },
  duplicate,
  selection,
  camera,
  hug,
  notify,
  frames,
}: AutoLayoutDragDeps): EditorAutoLayoutDrag {
  /**
   * A drag in a flow: the layers following the pointer, and inside the box a line marking the gap
   * they fill; outside it, the line where a flow under the pointer takes them, else the box they
   * would leave, since a drop there takes them out, unless Alt has copies dropped and nothing leaves
   * it, or they go onto another frame, which the overlay outlines.
   */
  function shown(g: ReorderDrag | null): FlowPart[] {
    if (!g?.moved) return []
    const now = session.design()
    const parts: FlowPart[] = []
    const dx = g.to.x - g.from.x
    const dy = g.to.y - g.from.y
    for (const id of g.roots) {
      const b = g.boxes.get(id)
      if (b) parts.push({ kind: 'ghost', frame: g.frame, box: drawnFrom({ ...b, x: b.x + dx, y: b.y + dy }, g.around) })
    }
    const holder = boxIn(g.parentId, now)
    if (!holder) return parts
    if (g.drop) return [...parts, ...shownDrop(g.target ?? g.frame, g.drop)]
    if (g.outside) {
      // Onto another frame the layers leave the box too; that frame is outlined instead (overlay.ts).
      if (!g.copy && !g.target)
        parts.push({ kind: 'leave', frame: g.frame, box: drawnFrom(holder, g.around.slice(0, -1)) })
      return parts
    }
    return [...parts, ...gapLine(g)]
  }
  /**
   * The line marking the gap dragged layers fill in their flow, as it is laid out now: before them
   * along the flow by half the box's gap, at least 3 and at most 24 px; in a grid, at the start edge
   * of the cell the first of them takes.
   */
  function gapLine(g: ReorderDrag): FlowPart[] {
    const now = session.design()
    const ids = g.copies?.roots ?? g.roots
    const thick = 2 / camera().zoom
    const cells = cellsIn(g.frame, g.parentId, now)
    if (cells.length > 0) {
      const order = flowOrder(g.parentId, now)
      const cell = cells[Math.min(...ids.map((id) => order.indexOf(id)).filter((i) => i >= 0))]
      if (!cell) return []
      const line = { x: cell.x - thick / 2, y: cell.y, width: thick, height: cell.height, rotation: 0 }
      return [{ kind: 'line', frame: g.frame, box: drawnFrom(line, g.around) }]
    }
    const rooms = ids.flatMap((id) => roomIn(g.frame, id, now) ?? [])
    if (rooms.length === 0) return []
    const b = boundsOf(rooms)
    // In a wrapping flow, as long across it as the line they are on.
    const span = (ids[0] !== undefined && lineSpan(g.frame, g.parentId, ids[0], now)) || b
    const gap = (propIn(g.parentId, 'layout', now) as AutoLayoutOf | undefined)?.gap ?? 0
    const off = Math.min(Math.max(gap / 2, 3), 24)
    const line = rowIn(g.parentId, now)
      ? { x: b.x - off - thick / 2, y: span.y, width: thick, height: span.height, rotation: 0 }
      : { x: span.x, y: b.y - off - thick / 2, width: span.width, height: thick, rotation: 0 }
    return [{ kind: 'line', frame: g.frame, box: drawnFrom(line, g.around) }]
  }
  function shownDrop(frame: Frame, drop: FlowDrop | null): FlowPart[] {
    return drop ? lineIn(frame, drop.boxId, drop.around, drop) : []
  }
  /** The line in a laid-out box's flow where layers would go, its layers inside `around`. */
  function lineIn(frame: Frame, boxId: string, around: Box[], place: FlowPlace): FlowPart[] {
    const now = session.design()
    const holder = boxIn(boxId, now)
    if (!holder) return []
    const row = rowIn(boxId, now)
    const gap = (propIn(boxId, 'layout', now) as AutoLayoutOf | undefined)?.gap ?? 0
    const cells = cellsIn(frame, boxId, now)
    // In a grid the line is beside the layer's cell; in a row or column, beside the layer.
    const near =
      place.near &&
      (cells.length > 0 ? cells[flowOrder(boxId, now).indexOf(place.near.id)] : roomIn(frame, place.near.id, now))
    const thick = 2 / camera().zoom
    // Halfway into the gap beside it; at the box's start when the flow is empty.
    const edge = !near
      ? row
        ? holder.x
        : holder.y
      : place.near?.after
        ? (row ? near.x + near.width : near.y + near.height) + gap / 2
        : (row ? near.x : near.y) - gap / 2
    const span = (near && place.near && lineSpan(frame, boxId, place.near.id, now)) ?? near ?? holder
    const line = row
      ? { x: edge - thick / 2, y: span.y, width: thick, height: span.height, rotation: 0 }
      : { x: span.x, y: edge - thick / 2, width: span.width, height: thick, rotation: 0 }
    return [{ kind: 'line', frame, box: drawnFrom(line, around) }]
  }

  /**
   * The rooms of the line a layer of a wrapping flow is drawn on, its length across the flow
   * spanning them all; undefined in a flow that doesn't wrap.
   */
  function lineSpan(frame: Frame, boxId: string, id: string, now: Design) {
    if (!boxWraps(now, boxId)) return undefined
    const flow = roomsIn(frame, boxId, now)
    const line = wrapLines(
      flow.map(({ room }) => room),
      rowIn(boxId, now),
    ).find((indexes) => indexes.some((i) => flow[i]?.id === id))
    const rooms = (line ?? []).flatMap((i) => flow[i]?.room ?? [])
    return rooms.length > 0 ? boundsOf(rooms) : undefined
  }

  /**
   * A press on layers that auto layout places, all in one flow: a drag that moves them along it,
   * or out of its box. Null for layers that aren't.
   */
  function press(frame: Frame, around: Box[], p: Point, ids: string[]): ReorderDrag | null {
    const flowParent = flowOf(ids)
    if (flowParent) {
      // Auto layout places these: a drag moves them along the flow, or out of the box.
      const from = localTo(p, around)
      return {
        kind: 'reorder',
        frame,
        around,
        parentId: flowParent,
        roots: ids,
        boxes: startBoxes(frame, ids),
        from,
        to: from,
        moved: false,
        copy: false,
        slot: 0,
        near: null,
        outside: false,
        drop: null,
        step: session.beginGesture(),
        start: null,
        placed: null,
        copies: null,
        target: null,
      }
    }
    return null
  }
  /** The box whose one flow places every one of the layers; undefined when none does. */
  function flowOf(ids: string[]) {
    const now = session.design()
    const parents = new Set(ids.map((id) => now.nodes[id]?.parentId))
    const [flowParent] = parents
    return flowParent && parents.size === 1 && ids.every((id) => placedByFlow(now, id)) ? flowParent : undefined
  }
  /**
   * Follows a drag of layers in a flow: where they go in it, found in the design as the press found
   * it so the place doesn't change as the layers move under the pointer, moving them, or with Alt
   * their copies, there; or out of it, with the flow as the press found it.
   */
  function reorderTo(g: ReorderDrag, p: Point, copy: boolean) {
    g.copy = copy
    g.moved = true
    g.to = p
    g.start ??= keptDesign(session.design())
    const start = g.start
    // The box as the press found it: copies a box that fits its content takes in make it no bigger.
    const holder = boxIn(g.parentId, start)
    g.outside =
      !holder || p.x < holder.x || p.y < holder.y || p.x > holder.x + holder.width || p.y > holder.y + holder.height
    Object.assign(g, placeIn(g.frame, g.parentId, g.roots, p, start))
    if (g.outside) {
      if (g.placed !== null || g.copies) restart(g, false)
    } else if (copy !== (g.copies !== null)) restart(g, copy)
    // Outside it, the frame under the pointer decides where they land, as for a move.
    const inFrame = pageFrom(p, g.around)
    const onPage = { x: g.frame.x + inFrame.x, y: g.frame.y + inFrame.y }
    const leaves = g.outside && canLeaveFrame(session.design(), g.roots, false)
    g.target = targetFrame(frames(), onPage, g.frame.id, leaves)
    const into = g.target ?? g.frame
    g.drop = g.outside ? dropAt(into, { x: onPage.x - into.x, y: onPage.y - into.y }, g.roots) : null
    if (!g.outside) reflow(g, start)
  }
  function setAlt(g: ReorderDrag, alt: boolean) {
    if (g.moved) reorderTo(g, g.to, alt)
    else g.copy = alt
  }
  function cancel(g: ReorderDrag) {
    restart(g, false)
    Object.assign(g, { moved: false, target: null, drop: null })
  }
  /**
   * Cancels the drag's undo step and begins another, putting back the selection the press found
   * when copies made it theirs; with `copies`, makes copies of the layers where they are, which
   * become the selection, as a Duplicate step.
   */
  function restart(g: ReorderDrag, copies: boolean) {
    const picked = g.copies?.picked
    g.step.cancel()
    // Unnamed without copies: a drop outside the box with Alt makes its copies then, a Duplicate step.
    g.step = session.beginGesture(copies ? 'duplicate' : null)
    g.placed = null
    g.copies = null
    if (picked) selection.restore(picked)
    if (!copies) return
    const held = selection.held()
    const [made = new Map<string, string>()] = duplicate.copyInPlace([{ frame: g.frame, ids: g.roots }])
    const roots = inFlowOrder(g, g.roots).flatMap((id) => made.get(id) ?? [])
    g.copies = { roots, picked: held }
  }
  /**
   * Moves the dragged layers, or their copies, to the place found, before the layer at that place
   * in the design as the press found it, or at the end, when it changed; at the press's own place
   * the layers go back by a new undo step instead, so a drag there and back leaves none, and the
   * copies go together right above the last of their originals.
   */
  function reflow(g: ReorderDrag, start: Design) {
    if (g.placed === g.slot) return
    const home = atHome(g, start)
    if (!g.copies && home) {
      if (g.placed !== null) restart(g, false)
      return
    }
    const before = home ? childAfter(g, start) : flowSiblings(g.parentId, g.roots, start)[g.slot]
    const moved = (g.copies?.roots ?? inFlowOrder(g, g.roots)).map((id) =>
      runQuietly(() => session.run('node.move', { id, parentId: g.parentId, ...(before ? { before } : {}) })),
    )
    // A layer another tab changed meanwhile can refuse its place: the flow goes back as the press found it.
    if (moved.every(Boolean)) g.placed = g.slot
    else restart(g, g.copies !== null)
  }
  /** Whether the place found is where the press found the layers: moving them there changes no order. */
  function atHome(g: ReorderDrag, start: Design) {
    const siblings = flowSiblings(g.parentId, g.roots, start)
    const before = siblings[g.slot]
    const flow = childrenOf(start, g.parentId).map(([id]) => id)
    const moving = flow.filter((id) => g.roots.includes(id))
    const next = siblings.flatMap((id) => (id === before ? [...moving, id] : [id]))
    if (!before) next.push(...moving)
    const placed = new Set(next)
    return next.join() === flow.filter((id) => placed.has(id)).join()
  }
  /** The layer right above the last dragged one under their parent, as the press found them; undefined on top. */
  function childAfter(g: ReorderDrag, start: Design) {
    const children = childrenOf(start, g.parentId).map(([id]) => id)
    const last = children.findLastIndex((id) => g.roots.includes(id))
    return children.slice(last + 1).find((id) => !g.roots.includes(id))
  }
  /** Layers of the drag's flow in the order the press found them in it. */
  function inFlowOrder(g: ReorderDrag, ids: string[]) {
    return childrenOf(g.start ?? session.design(), g.parentId)
      .map(([id]) => id)
      .filter((id) => ids.includes(id))
  }
  function dropAt(frame: Frame, p: Point, roots: string[], originals: readonly string[] = []): FlowDrop | null {
    const now = session.design()
    if (roots.some((id) => now.nodes[id] && isMask(now.nodes[id]))) return null
    const boxId = boxUnder(scenes.laidOut(frame.id, now), p, new Set([...roots, ...originals]), now)
    if (!boxId || roots.some((id) => now.nodes[id]?.parentId === boxId)) return null
    const around = containersOf(frame, boxId, now)
    return { boxId, around, ...placeIn(frame, boxId, roots, localTo(p, around)) }
  }
  /**
   * Where in a box's flow a point, as its layers see it, puts layers being moved: in a grid, by the
   * cell under it (`cellPlace`); in a wrapping row or column, by the line under it (`linePlace`);
   * in a row or column, next to the layer nearest it, before it or after it as the point is before
   * or past its middle along the flow. The slot is the index of the layer they go before, among
   * those that aren't moving; that list's length is the end.
   */
  function placeIn(frame: Frame, boxId: string, roots: string[], p: Point, from?: Design): FlowPlace {
    const now = from ?? session.design()
    const cells = cellsIn(frame, boxId, now)
    if (cells.length > 0) return cellPlace(cells, flowOrder(boxId, now), roots, p)
    const row = rowIn(boxId, now)
    const siblings = flowSiblings(boxId, roots, now)
    if (boxWraps(now, boxId)) {
      const placed = roomsIn(frame, boxId, now).map(({ id, room }) => ({
        id,
        room,
        i: roots.includes(id) ? null : siblings.indexOf(id),
      }))
      return linePlace(placed, p, row)
    }
    let best: { i: number; d: number; after: boolean } | null = null
    siblings.forEach((id, i) => {
      const b = roomIn(frame, id, now)
      if (!b) return
      const d = distanceTo(b, p)
      const after = row ? p.x > b.x + b.width / 2 : p.y > b.y + b.height / 2
      if (!best || d < best.d) best = { i, d, after }
    })
    const near = best as { i: number; d: number; after: boolean } | null
    return near
      ? { slot: near.i + (near.after ? 1 : 0), near: { id: siblings[near.i] as string, after: near.after } }
      : { slot: 0, near: null }
  }
  /**
   * The innermost box among scene layers that holds a point, as those layers see it before their
   * containers turn them, the topmost where they overlap: a laid-out box's id, or '' for a Free box,
   * which takes no drop. Skips layers that are hidden, masks, among `skip`, or inside one of them,
   * and a laid-out box locked in place: a mask is never drawn, so a layer in its flow would vanish.
   * A Mask group is a group, never a target itself. Undefined when no box holds the point.
   */
  function boxUnder(layers: SceneLayer[], p: Point, skip: Set<string>, now: Design): string | undefined {
    let found: string | undefined
    for (const layer of layers) {
      const node = now.nodes[layer.id]
      if (skip.has(layer.id) || !node || !layer.props.visible || isMask(node)) continue
      const box = boxOfLayer(layer)
      // The point as the layers inside see it, before this one turns them.
      const inner =
        layer.children.length > 0
          ? boxUnder(layer.children, turn(p, centreOf(box), -box.rotation), skip, now)
          : undefined
      if (inner !== undefined) found = inner
      else if (node.type === 'box' && holdsPoint(box, p)) {
        if (!laidOutBox(now, layer.id)) found = ''
        else if (!node.lock?.move) found = layer.id
      }
    }
    return found
  }
  function dropInto(drop: FlowDrop, roots: string[], links?: Record<string, string>) {
    land(intoFlow(drop, roots), roots, { links })
  }
  /** Where layers dropped into a laid-out box's flow at the place found go, read before any of them moves. */
  function intoFlow(drop: FlowDrop, roots: string[]): Landing {
    const now = session.design()
    const before = flowSiblings(drop.boxId, roots, now)[drop.slot]
    const left = [...new Set(roots.map((id) => now.nodes[id]?.parentId ?? ''))]
    // As drawn before any moves: a box they all leave keeps the size it was drawn at.
    const [drawn, holders] = [drawnInFlow(roots, drop.boxId), drawnHolders(roots, drop.boxId)]
    return { ids: roots, parentId: drop.boxId, before, drawn, holders, left }
  }
  /**
   * Moves layers where a landing worked out for them or their originals says, each under its
   * parent, before its layer or on top, stored at `drawn` by their own ids, with what they hold,
   * turned about its holders and, into another frame, taking the link ids `links` names; then the
   * groups the landing leaves fit what they hold again.
   */
  function land(
    landing: Landing,
    ids: string[],
    { drawn = landing.drawn, links }: { drawn?: Landing['drawn']; links?: Record<string, string> | undefined } = {},
  ) {
    const { parentId, before, holders } = landing
    for (const id of ids)
      runQuietly(() =>
        session.run('node.move', {
          id,
          parentId,
          ...(before ? { before } : {}),
          ...(drawn ? { drawn } : {}),
          ...(holders ? { holders } : {}),
          ...(links ? { links } : {}),
        }),
      )
    const groups = landing.left.filter((id) => session.design().nodes[id])
    if (groups.length > 0) hug(groups)
  }
  /** Ends a drag in a flow: the drop, then the groups around what was dropped fit it again, closing its undo step. */
  function release(g: ReorderDrag) {
    hug(finishReorder(g))
    g.step.end()
  }
  /**
   * Drops layers dragged in a flow, one undo step: inside their box they, or with Alt their copies,
   * are in their place already; outside it, out of the box into what holds it, where they were
   * dropped, onto the top of another frame, or into the flow of the box under them. With Alt
   * outside, the layers stay, copies of those still in the design are made where they are, and each
   * copy is dropped as its original would have been, keeping its original's link ids in another
   * frame where it holds none. Returns what was dropped: the layers, or the copies.
   */
  function finishReorder(g: ReorderDrag): string[] {
    if (g.moved && !g.outside) return g.copies?.roots ?? g.roots
    const landing = g.moved ? landingOf(g) : null
    if (!landing) return g.roots
    if (!g.copy) {
      land(landing, landing.ids)
      return g.roots
    }
    const [copied = new Map<string, string>()] = duplicate.copyInPlace([{ frame: g.frame, ids: landing.ids }])
    const copies = [...copied.values()]
    const ids = copiedIds(session.design(), copied)
    // Copies dropped onto another frame keep their originals' link ids where it holds none.
    const links = g.target ? originalLinks(session.design(), copied) : undefined
    // Each copy, and each layer in it, stored at its original's box by its own id; an original with no copy is left out.
    const drawn =
      landing.drawn &&
      Object.fromEntries(
        Object.entries(landing.drawn).flatMap(([id, box]) => {
          const copy = ids.get(id)
          return copy ? [[copy, box]] : []
        }),
      )
    land(landing, copies, { drawn, links })
    return copies
  }
  /**
   * Where a drag out of its flow drops its layers, read from them before anything moves: into a
   * flow under the pointer, on the top of another frame, or into what holds the box; null when
   * nothing holds them there.
   */
  function landingOf(g: ReorderDrag): Landing | null {
    if (g.drop) return intoFlow(g.drop, g.roots)
    const now = session.design()
    if (!now.nodes[g.parentId]) return null
    const dx = g.to.x - g.from.x
    const dy = g.to.y - g.from.y
    // As drawn before any moves, each moved by the drag with what it holds: where they were dropped.
    const dropped = (drawn: Landing['drawn']) =>
      drawn &&
      Object.fromEntries(Object.entries(drawn).map(([id, box]) => [id, { ...box, x: box.x + dx, y: box.y + dy }]))
    if (g.target) {
      // On its top in the order they are drawn; the groups around the box they leave fit it again.
      const ids = inFlowOrder(g, g.roots)
      const [drawn, holders] = [drawnInFlow(ids, g.target.id), drawnHolders(ids, g.target.id)]
      return { ids, parentId: g.target.id, before: undefined, drawn: dropped(drawn), holders, left: [g.parentId] }
    }
    // The container the drop point is in, among those holding the box, nearest first; or the frame.
    const point = pageFrom(g.to, g.around)
    let branch = g.parentId
    let target = now.nodes[g.parentId]?.parentId ?? g.frame.id
    while (
      now.nodes[target] &&
      !(canHold(now.nodes[target]?.type ?? '', 'graphic') && drawnContains(g.frame, target, point, now))
    ) {
      branch = target
      target = now.nodes[target]?.parentId ?? g.frame.id
    }
    // Above the part of the container that held them.
    const order = childrenOf(now, target).map(([id]) => id)
    const before = order[order.indexOf(branch) + 1]
    const holders = drawnHolders(g.roots, target)
    return { ids: g.roots, parentId: target, before, drawn: dropped(drawnInFlow(g.roots, target)), holders, left: [] }
  }
  /**
   * The arrow keys on layers in a flow: along a row or column they move them one place earlier or
   * later, and in a grid Left and Right move them one place and Up and Down a row of places, one
   * undo step; across a row or column, or for layers in different flows, auto layout decides, and
   * the app says so, naming the layout of the flow that places the first of them. A layer that
   * takes no place in a flow (`flows`), such as a hidden one, is left out first, and the others
   * move; with a layer locked in place among those nothing moves, and the app says why, as Group
   * and Box refuse it. Layers no flow places are left to the caller.
   */
  function nudgeInFlow(selected: string[], dx: number, dy: number, now: Design) {
    const layout = flowLayoutOf(now, selected)
    if (!layout) return false
    const ids = selected.filter((id) => {
      const node = now.nodes[id]
      return node !== undefined && flows(node)
    })
    if (ids.some((id) => now.nodes[id]?.lock?.move)) {
      notify('refused', { why: 'locked' })
      return true
    }
    const parents = new Set(ids.map((id) => now.nodes[id]?.parentId))
    const [parentId] = parents
    const steps = parentId === undefined ? 0 : flowSteps(parentId, dx, dy, now)
    // The layout of the one flow that places every layer that moves.
    const along = parents.size === 1 && ids.every((id) => placedByFlow(now, id)) ? flowLayoutOf(now, ids) : undefined
    if (!parentId || !along || steps === 0) {
      notify('placedByLayout', { layout })
      return true
    }
    const flow = flowOrder(parentId, now)
    const places = ids.map((id) => flow.indexOf(id)).sort((a, b) => a - b)
    const first = places[0] ?? 0
    const last = places.at(-1) ?? 0
    // Earlier: before the layer that many places ahead of the first; later: past the one that many after the last.
    if (steps < 0 ? first + steps < 0 : last + steps > flow.length - 1) {
      notify('flowEnd', { layout: along })
      return true
    }
    const before = steps < 0 ? flow[first + steps] : flow[last + steps + 1]
    const moving = flow.filter((id) => ids.includes(id))
    runQuietly(() =>
      session.gesture(() => {
        for (const id of moving) session.run('node.move', { id, parentId, ...(before ? { before } : {}) })
      }),
    )
    return true
  }

  /**
   * The places an arrow moves a layer along its parent's flow: one along a row or column, and in a
   * grid one with Left and Right and a row of places with Up and Down; 0 across a row or column.
   */
  function flowSteps(parentId: string, dx: number, dy: number, now: Design) {
    const layout = propIn(parentId, 'layout', now) as AutoLayoutOf | undefined
    if (layout?.direction === 'grid') return Math.sign(dx) + Math.sign(dy) * gridColumns(layout)
    const row = rowIn(parentId, now)
    return (row ? dy : dx) === 0 ? Math.sign(row ? dx : dy) : 0
  }

  /** The rooms a box's flow's layers take, as drawn, in its order; a layer not drawn is left out. */
  function roomsIn(frame: Frame, boxId: string, now: Design) {
    return flowOrder(boxId, now).flatMap((id) => {
      const room = roomIn(frame, id, now)
      return room ? [{ id, room }] : []
    })
  }
  /** The room a layer takes in its flow, as drawn: its box, or its turned bounds when it is turned. */
  function roomIn(frame: Frame, id: string, now: Design) {
    const box = boxIn(id, now)
    return box && boundsOf([box])
  }
  /** A grid box's cells as laid out in its frame, row after row on to the end of its last row; none for a row or column. */
  function cellsIn(frame: Frame, boxId: string, now: Design) {
    const box = scenes.laidOutLayer(frame.id, now, boxId)
    return box ? gridCells(box) : []
  }

  return {
    shown,
    shownDrop,
    reorders: (ids) => flowOf(ids) !== undefined,
    press,
    drag: reorderTo,
    setAlt,
    cancel,
    release,
    dropAt,
    dropInto,
    nudge: nudgeInFlow,
  }
}

/** A design as it is now, kept apart from the live one, which changes as the design does. */
function keptDesign(design: Design): Design {
  return { ...design, nodes: { ...design.nodes } }
}
