// A move of the selection on the stage: the press that starts it, and each pointer move after, kept
// to one axis with Shift, landing on whole pixels, snapping to what is around it, finding the frame
// and the flow it would drop into, and carrying the selected layers of other frames by the same
// amount. With Alt, the layers stay where they were and copies of them are moved instead.
import { flowLayoutOf, type GestureStep, placedByFlow, type Session } from '@dazbee/doc'
import type { Design, Point } from '@dazbee/schema'

import type { Camera } from '../../canvas/camera.ts'
import type { Frame } from '../../canvas/frames.ts'
import type { NoticeDetail } from '../../core-interface.ts'
import type { EditorBoxes } from '../../layers/boxes.ts'
import { type EditorDuplicate, originalLinks } from '../../layers/duplicate.ts'
import { type DragSnap, SNAP_DISTANCE, snapMove, type Targets } from '../../layers/snap.ts'
import { boundsOf, type Box, frameStep, localStep, localTo, pageFrom, round } from '../../layers/transform.ts'
import type { EditorSelection, HeldSelection } from '../../selection.ts'
import type { EditorAutoLayoutDrag, FlowDrop } from './auto-layout-drag.ts'
import { canLeaveFrame, targetFrame } from './into-frame.ts'

/** The selected layers of one frame a move carries, inside their containers there, and their boxes as the drag began. */
export interface MovePart {
  frame: Frame
  around: Box[]
  roots: string[]
  boxes: Map<string, Box>
}
/**
 * A drag moving the selection, from the press until it ends: one undo step. The frame pressed in
 * is dragged and snaps; `others` holds the selected layers of the other frames, moved by the same
 * amount. With the pointer over another frame of the page they can leave theirs for, `target` is
 * that frame, which they go into when dropped. Over a laid-out box they aren't in, of `target` or
 * their own frame, `drop` is where in its flow they would go.
 */
export interface MoveDrag extends MovePart {
  kind: 'move'
  /** Whether the pointer has moved the layers yet. */
  moved: boolean
  from: Point
  targets: Targets | null
  others: MovePart[]
  /** The other frame the layers go into when dropped; null while they stay in their own. */
  target: Frame | null
  drop: FlowDrop | null
  step: GestureStep
  /** The last move the drag was given: its point, whether Shift kept it to an axis and whether it snapped; null before the first. */
  last: { p: Point; axisLock: boolean; snap: boolean } | null
  /**
   * While Alt has the drag move copies: the layers pressed on, which stay where they were, as the
   * press gathered them, with what they snap to and the selection then. Null while it moves them.
   */
  sources: {
    parts: MovePart[]
    targets: Targets | null
    picked: HeldSelection
    /**
     * Each layer of the pressed frame's copies, by id: its original's link id as the copies were
     * made, which they keep dropped onto another frame. Only one frame's layers can leave it
     * (`canLeaveFrame`), so the other frames' copies need none.
     */
    links: Record<string, string>
  } | null
}

export interface MoveDragDeps {
  session: Pick<Session, 'design' | 'beginGesture'>
  selection: Pick<EditorSelection, 'held' | 'restore'>
  boxes: Pick<EditorBoxes, 'startBoxes'>
  duplicate: Pick<EditorDuplicate, 'copyInPlace'>
  camera: () => Camera
  /** Where in a laid-out box's flow moved layers would go. */
  autoLayoutDrag: Pick<EditorAutoLayoutDrag, 'dropAt'>
  /** Tells the app that auto layout places some of the layers a drag would move. */
  notify: (...told: NoticeDetail<'placedByLayout'>) => void
  /** What a drag of layers in a frame can snap to, gathered once as it begins. */
  targetsFor: (frame: Frame, ids: string[], around: Box[]) => Targets | null
  /** Shows what the drag snapped to; null when it snapped to nothing. */
  showSnap: (snapped: DragSnap | null) => void
  /** Counts a pointer move that snapped. */
  snapMoved: () => void
  /** Writes new boxes: what changed from `start`, and what the drag changed and put back. */
  writeBoxes: (frame: Frame, start: Map<string, Box>, next: Map<string, Box>) => void
  /** The shown page's frames as last drawn. */
  frames: () => readonly Frame[]
}

export interface EditorMoveDrag {
  /**
   * A press that moves layers in a frame and, by the same amount, the selected layers of other
   * frames: a drag of those no flow places, one undo step until it is released; the app hears when
   * some are.
   */
  pressMove(
    frame: Frame,
    around: Box[],
    p: Point,
    ids: string[],
    others?: { frame: Frame; around: Box[]; ids: string[] }[],
  ): MoveDrag
  /**
   * Follows the pointer: Shift keeps the move to one axis, `snap` snaps it to what is around it, and
   * `copy`, Alt, has it move copies of the layers, made as it turns on and taken away as it turns off.
   */
  moveTo(g: MoveDrag, p: Point, axisLock: boolean, snap: boolean, copy: boolean): void
  /** Alt pressed or let go with the pointer still: the drag's last move again, with copies or without; nothing before its first. */
  setAlt(g: MoveDrag, alt: boolean): void
  /** Whether the drag carries layers still in the design, its own or the copies it moves: with none, Alt copies nothing. */
  carries(g: MoveDrag): boolean
  /**
   * While the drag moves copies that are each where its original is, dropping into no flow: the
   * selection to put back, the originals' as it was when the copies were made. Null otherwise.
   */
  copiesUnmoved(g: MoveDrag): HeldSelection | null
}

export function editorMoveDrag({
  session,
  selection,
  boxes: { startBoxes },
  duplicate,
  camera,
  autoLayoutDrag,
  notify,
  targetsFor,
  showSnap,
  snapMoved,
  writeBoxes,
  frames,
}: MoveDragDeps): EditorMoveDrag {
  /** A press that moves the selection: a drag of the layers no flow places, one undo step. */
  function pressMove(
    frame: Frame,
    around: Box[],
    p: Point,
    ids: string[],
    others: { frame: Frame; around: Box[]; ids: string[] }[] = [],
  ): MoveDrag {
    const now = session.design()
    const free = freeOf(now, ids)
    const layout = flowLayoutOf(now, [ids, ...others.map((o) => o.ids)].flat())
    if (layout) notify('placedByLayout', { layout })
    return {
      kind: 'move',
      moved: false,
      frame,
      around,
      from: localTo(p, around),
      roots: free,
      boxes: startBoxes(frame, free),
      targets: targetsFor(frame, free, around),
      others: others.map((o) => ({
        frame: o.frame,
        around: o.around,
        roots: freeOf(now, o.ids),
        boxes: startBoxes(o.frame, freeOf(now, o.ids)),
      })),
      target: null,
      drop: null,
      step: session.beginGesture('move'),
      last: null,
      sources: null,
    }
  }
  function carries(g: MoveDrag) {
    const now = session.design()
    return [g, ...g.others].some((part) => part.roots.some((id) => now.nodes[id]))
  }
  /**
   * Has the drag move copies of its layers, or those layers again: all its step wrote is put back
   * and a step of its own begins, `duplicate` with the copies made, selected and gathered to snap,
   * or `move` with the layers and the selection as they were. The copies are made before anything moves.
   */
  function carry(g: MoveDrag, copies: boolean) {
    g.step.cancel()
    g.step = session.beginGesture(copies ? 'duplicate' : 'move')
    if (!copies) {
      const { parts, targets, picked } = g.sources as NonNullable<MoveDrag['sources']>
      const [first, ...others] = parts
      Object.assign(g, first, { others, targets, sources: null })
      selection.restore(picked)
      return
    }
    const parts = [g, ...g.others].map(({ frame, around, roots, boxes }) => ({ frame, around, roots, boxes }))
    const picked = selection.held()
    const made = duplicate.copyInPlace(parts.map(({ frame, roots }) => ({ frame, ids: roots })))
    const [first, ...others] = parts.map((part, i) => {
      const roots = [...(made[i]?.values() ?? [])]
      return { ...part, roots, boxes: startBoxes(part.frame, roots) }
    })
    const targets = targetsFor(g.frame, first?.roots ?? [], g.around)
    const links = originalLinks(session.design(), made[0] ?? new Map<string, string>())
    Object.assign(g, first, { others, targets, sources: { parts, targets: g.targets, picked, links } })
  }
  function setAlt(g: MoveDrag, alt: boolean) {
    if (g.last) moveTo(g, g.last.p, g.last.axisLock, g.last.snap, alt)
  }
  function copiesUnmoved(g: MoveDrag) {
    if (!g.sources || g.drop) return null
    const unmoved = [g, ...g.others].every((part) => {
      const now = startBoxes(part.frame, part.roots)
      return part.roots.every(
        (id) => now.get(id)?.x === part.boxes.get(id)?.x && now.get(id)?.y === part.boxes.get(id)?.y,
      )
    })
    return unmoved ? g.sources.picked : null
  }
  /**
   * Moves the layers by the drag, on whole pixels unless they snapped to a line that isn't on one.
   * Over a laid-out box they would drop into, nothing snaps: its flow places them.
   */
  function moveTo(g: MoveDrag, p: Point, axisLock: boolean, snap: boolean, copy: boolean) {
    g.last = { p, axisLock, snap }
    if (g.sources ? !copy : copy && carries(g)) carry(g, copy)
    g.moved = true
    // Copies never drop into the layers they are copies of.
    const originals = g.sources?.parts[0]?.roots
    let dx = p.x - g.from.x
    let dy = p.y - g.from.y
    // Shift keeps a move to one axis, whichever it has gone further along.
    if (axisLock) {
      if (Math.abs(dx) > Math.abs(dy)) dy = 0
      else dx = 0
    }
    // The frame under the pointer decides where they land, not where the layers are; with Shift,
    // under the point the pressed spot is carried to, so they never land in a frame they are off.
    const onPage = (at: Point) => {
      const inFrame = pageFrom(at, g.around)
      return { x: g.frame.x + inFrame.x, y: g.frame.y + inFrame.y }
    }
    const carried = onPage({ x: g.from.x + dx, y: g.from.y + dy })
    const leaves = canLeaveFrame(session.design(), g.roots, g.others.length > 0)
    g.target = targetFrame(frames(), carried, g.frame.id, leaves)
    const [into, under] = g.target ? [g.target, carried] : [g.frame, onPage(p)]
    const point = { x: under.x - into.x, y: under.y - into.y }
    g.drop = g.roots.length > 0 ? autoLayoutDrag.dropAt(into, point, g.roots, originals) : null
    // A move lands on whole pixels, unless it snapped to a line that isn't on one.
    let toX = Math.round
    let toY = Math.round
    showSnap(null)
    const moving = g.roots.map((id) => g.boxes.get(id)).filter((b): b is Box => b !== undefined)
    if (snap && !g.drop && g.targets && moving.length > 0) {
      snapMoved()
      const from = boundsOf(moving)
      const s = snapMove(
        { ...from, x: Math.round(from.x + dx), y: Math.round(from.y + dy) },
        g.targets,
        SNAP_DISTANCE / camera().zoom,
        { x: axisLock && dx === 0, y: axisLock && dy === 0 },
      )
      if (s.dx !== 0) {
        dx = Math.round(from.x + dx) + s.dx - from.x
        toX = (n) => round(n)
      }
      if (s.dy !== 0) {
        dy = Math.round(from.y + dy) + s.dy - from.y
        toY = (n) => round(n)
      }
      showSnap({ frame: g.frame, parent: g.targets.parent, layers: g.roots, snapLines: s.snapLines, gaps: s.gaps })
    }
    const next = new Map([...g.boxes].map(([id, b]) => [id, moveBy(b, { x: dx, y: dy }, toX, toY)]))
    writeBoxes(g.frame, g.boxes, next)
    // The other frames' layers go the same way across their frames, inside whatever turns them there.
    for (const other of g.others) {
      const step = localStep(frameStep({ x: dx, y: dy }, g.around), other.around)
      writeBoxes(other.frame, other.boxes, new Map([...other.boxes].map(([id, b]) => [id, moveBy(b, step, toX, toY)])))
    }
  }

  return { pressMove, moveTo, setAlt, carries, copiesUnmoved }
}

/** The layers of these a move carries: those no flow places, since layers in a flow among others stay in it. */
export function freeOf(design: Design, ids: string[]) {
  return ids.filter((id) => !placedByFlow(design, id))
}

/** A box moved by a step, its place landing where `toX` and `toY` put it. */
function moveBy(b: Box, step: Point, toX: (n: number) => number, toY: (n: number) => number): Box {
  return { ...b, x: toX(b.x + step.x), y: toY(b.y + step.y) }
}
