// The pen: a path drawn a press at a time until it closes or is finished, and a path's points
// edited, with what is shown of both: the path, the anchors in play and the pen's next segment.
import { flipsOf, type GestureStep, type Session } from '@dazbee/doc'
import type { Design, Point } from '@dazbee/schema'

import { type Camera, toWorld } from '../../canvas/camera.ts'
import type { Frame } from '../../canvas/frames.ts'
import type { EditorBoxes } from '../../layers/boxes.ts'
import { deleteLayers } from '../../layers/delete-hide.ts'
import { type Box, localTo, round } from '../../layers/transform.ts'
import { runQuietly } from '../../run-quietly.ts'
import type { EditorSelection } from '../../selection.ts'
import type { EditorTyping } from '../../text/typing.ts'
import type { EditorTools } from '../../tools.ts'
import type { EditorDragStart } from '../drag-start.ts'
import { newPath } from '../drawing/draw-tools.ts'
import type { PointerInput } from '../inputs.ts'
import {
  type Anchor,
  anchorOf,
  type AnchorRef,
  constrain,
  deleteAnchors,
  flipPath,
  formatPath,
  hitPath,
  isSmooth,
  moveAnchors,
  moveControl,
  pathBounds,
  type PenPath,
  sameRef,
  type Side,
  splitSegment,
} from './path.ts'

/** A path layer being drawn or edited: the box it had when that began, which its points are relative to, and how far the box has moved since. */
export interface Reshaping {
  id: string
  start: Box
  applied: Point
}
/** A drag of a path's anchors or of one handle, from the press on it until it ends: one undo step. */
export interface PathDrag {
  kind: 'path'
  frame: Frame
  around: Box[]
  layer: Reshaping
  path: PenPath
  grab: Point
  roots: string[]
  step: GestureStep
  drag: { anchors: AnchorRef[] } | { ref: AnchorRef; side: Side; from: Point; mirror: boolean }
}

/** The path the pen is drawing, or whose points are being edited, as it is shown. */
export interface ShownPath {
  frame: Frame
  /** The containers of the path's layer, which its points are inside. */
  around: Box[]
  path: PenPath
  /** The anchors whose handles show: the one the pen has in play, or the selected ones of a path being edited. */
  handles: AnchorRef[]
  /** Whether a path's points are being edited, so the anchors in `handles` are marked as selected. */
  picked: boolean
  /** For the pen between presses, the next segment: from its last anchor to where the pointer is. */
  preview: [Anchor, Point] | null
  /** Whether the pen's first anchor shows that a click on it would close the path. */
  closing: boolean
}

export interface PenDeps {
  /** Asks for the pointer to be held from the press being handled. */
  hold: () => void
  /** Whether the press held has become a drag, with the pointer at a stage point. */
  dragStart: Pick<EditorDragStart, 'moved'>
  session: Session
  selection: Pick<EditorSelection, 'pathEditing' | 'editPath' | 'pickAnchors' | 'select' | 'selectKeepingModes'>
  tools: Pick<EditorTools, 'setTool'>
  typing: Pick<EditorTyping, 'stop'>
  camera: () => Camera
  /** The design as last drawn. */
  drawn: () => Design
  /** The shown page's frame with an id, as last drawn, if there is one. */
  frameOf: (id: string | undefined) => Frame | undefined
  boxes: Pick<EditorBoxes, 'containersOf' | 'drawnHolders' | 'pathIn' | 'parentFor' | 'storedNewBox'>
  /** Groups fit what they hold again after a change inside them, in the same undo step. */
  hug: (ids: string[]) => void
  /** Tells that what is shown changed. */
  shownChanged: () => void
}

export interface EditorPen {
  /** Whether the pen is drawing a path: from its first press until the path closes or is finished. */
  drawing(): boolean
  /**
   * A press with the pen: a click adds a corner, a drag pulls out smooth handles, Shift turns the
   * new segment to 45°, and a press on the first anchor closes the path. The first press starts
   * one undo step that lasts until the path is closed or finished.
   */
  down(e: PointerInput, at: { frame: Frame; p: Point }): void
  /** The pointer moving while the pen draws, at a point on the stage: pulls handles, or shows the next segment. */
  move(e: PointerInput, screen: Point): void
  /** The press is over: a closing one finishes the path. */
  up(): void
  /** Ends the pen's path, closed or open: the new layer is selected and the select tool comes back. */
  finish(): void
  /**
   * A press while a path's points are being edited: on a handle of a selected anchor, a drag of
   * it; on an anchor, a drag of the selected ones, Shift adding it or taking it away; on a
   * segment, a new anchor there and a drag of it. Each starts an undo step that lasts until the
   * drag is released. Anywhere else leaves the path's points and returns null, so the press does
   * what it would have done.
   */
  pressPoints(e: PointerInput, at: { frame: Frame; p: Point } | null): PathDrag | null
  /** Whether a press at a point of a frame lands on the points of the path being edited, which `pressPoints` drags. */
  pointsAt(at: { frame: Frame; p: Point } | null): boolean
  /** Drags anchors (Shift along one axis) or a handle (Shift in 45° steps; Alt lets a smooth anchor's other handle be). */
  dragPoints(g: PathDrag, p: Point, shift: boolean, alt: boolean): void
  /** Ends a drag of a path's points, closing its undo step; the groups around the path fit it again. */
  releasePoints(g: PathDrag): void
  /** Takes the selected anchors out of the path being edited, or the layer once none would be left. One undo step. */
  deletePoints(): boolean
  /** The path the pen is drawing, or whose points are being edited; null with neither. */
  shown(): ShownPath | null
}

/**
 * The path the pen is drawing (#45), from its first click until it closes or is finished: its
 * anchors in its parent's coordinates, the one a drag is pulling handles from, and the layer
 * once there are two anchors to draw.
 */
interface OpenPath {
  frame: Frame
  around: Box[]
  parentId: string
  anchors: Anchor[]
  closing: boolean
  dragging: number | null
  hover: Point | null
  layer: Reshaping | null
  step: GestureStep
}

/** How near, in screen pixels, a press picks a path's point, handle or segment (#45). */
const POINT_REACH = 6

export function editorPen({
  hold,
  dragStart,
  session,
  selection,
  tools,
  typing,
  camera,
  drawn,
  frameOf,
  boxes: { containersOf, drawnHolders, pathIn, parentFor, storedNewBox },
  hug,
  shownChanged,
}: PenDeps): EditorPen {
  /** The path the pen is drawing, or null. */
  let pen: OpenPath | null = null

  /** Whether the pen is drawing a path. */
  function drawing() {
    return pen !== null
  }
  /**
   * The path the pen is drawing or whose points are being edited (#45), with the anchors in play
   * and, for the pen, the next segment to where the pointer is.
   */
  function shown(): ShownPath | null {
    const pathEditing = selection.pathEditing()
    if (pen) {
      // Copies: the pen goes on adding anchors and pulling handles out of the ones it has.
      const anchors = pen.anchors.map((anchor) => ({ ...anchor }))
      const last = anchors.length - 1
      const from = anchors[last]
      const [first] = anchors
      return {
        frame: pen.frame,
        around: pen.around,
        path: [{ anchors, closed: pen.closing }],
        handles: [{ contour: 0, index: pen.dragging ?? last }],
        picked: Boolean(pathEditing),
        preview: from && pen.hover && pen.dragging === null ? [from, pen.hover] : null,
        // The pen's first anchor shows when a click on it would close the path.
        closing:
          first !== undefined &&
          anchors.length >= 2 &&
          pen.hover !== null &&
          Math.hypot(pen.hover.x - first.x, pen.hover.y - first.y) * camera().zoom <= POINT_REACH,
      }
    }
    if (!pathEditing) return null
    const frame = frameOf(pathEditing.frameId)
    const found = frame && pathIn(frame, pathEditing.id, drawn())
    if (!frame || !found) return null
    return {
      frame,
      around: found.around,
      path: found.path,
      handles: pathEditing.selected,
      picked: true,
      preview: null,
      closing: false,
    }
  }

  /**
   * Writes a path drawn or edited in the coordinates its layer had when that began (#45), as drawn:
   * the data from the outline's corner, mirrored back about that box's centre as the layer is
   * flipped now, and the box moved by what the corner moved since the last write.
   */
  function reshape(layer: Reshaping, drawnPath: PenPath) {
    const node = session.design().nodes[layer.id]
    const path = node ? flipPath(drawnPath, { ...layer.start, ...flipsOf(node.props) }) : drawnPath
    const b = pathBounds(path)
    if (!b) return
    const corner = { x: round(b.x), y: round(b.y) }
    const moved = { x: round(corner.x - layer.start.x), y: round(corner.y - layer.start.y) }
    const input = {
      id: layer.id,
      d: formatPath(path, corner),
      dx: round(moved.x - layer.applied.x),
      dy: round(moved.y - layer.applied.y),
      width: round(b.width),
      height: round(b.height),
    }
    if (runQuietly(() => session.run('node.reshape', input))) layer.applied = moved
  }
  /**
   * What a press at a point of a frame grabs of the path whose points are edited: a handle of a
   * selected anchor, an anchor or a segment, with the path, its frame and the point as the path's
   * layers see it; null for none.
   */
  function pointUnder(at: { frame: Frame; p: Point } | null) {
    const editingPath = selection.pathEditing()
    const frame = editingPath && frameOf(editingPath.frameId)
    const found = frame && editingPath && pathIn(frame, editingPath.id)
    const q = found && at?.frame.id === frame.id ? localTo(at.p, found.around) : null
    const hit = found && q && hitPath(found.path, q, POINT_REACH / camera().zoom, editingPath.selected)
    return editingPath && frame && found && q && hit ? { editingPath, frame, found, q, hit } : null
  }
  function pointsAt(at: { frame: Frame; p: Point } | null) {
    return pointUnder(at) !== null
  }
  /**
   * A press while a path's points are being edited (#45): on a handle of a selected anchor, drag
   * it; on an anchor, select it (Shift adds or takes it away) and drag the selected ones; on a
   * segment, add an anchor there and drag it, all one undo step. Anywhere else leaves the path,
   * and the press does what it would have done. Returns the drag the press starts.
   */
  function startPathEdit(e: PointerInput, at: { frame: Frame; p: Point } | null): PathDrag | null {
    const grabbed = pointUnder(at)
    if (!grabbed) {
      selection.editPath(null)
      shownChanged()
      return null
    }
    const { editingPath, frame, found, q, hit } = grabbed
    let path = found.path
    const layer: Reshaping = { id: editingPath.id, start: found.box, applied: { x: 0, y: 0 } }
    const step = session.beginGesture()
    let drag: PathDrag['drag']
    if (hit.kind === 'control') {
      drag = {
        ref: hit.ref,
        side: hit.side,
        from: anchorOf(path, hit.ref)?.[hit.side] ?? q,
        mirror: isSmooth(anchorOf(path, hit.ref) as Anchor),
      }
    } else if (hit.kind === 'anchor') {
      const picked = editingPath.selected.some((r) => sameRef(r, hit.ref))
      if (e.shiftKey)
        selection.pickAnchors(
          picked ? editingPath.selected.filter((r) => !sameRef(r, hit.ref)) : [...editingPath.selected, hit.ref],
        )
      else if (!picked) selection.pickAnchors([hit.ref])
      drag = { anchors: editingPath.selected }
    } else {
      const split = splitSegment(path, hit.contour, hit.from, hit.t)
      path = split.path
      reshape(layer, path)
      selection.pickAnchors([split.ref])
      drag = { anchors: [split.ref] }
    }
    hold()
    return {
      kind: 'path',
      frame,
      around: found.around,
      layer,
      path,
      grab: q,
      roots: [editingPath.id],
      step,
      drag,
    }
  }
  /** Drags anchors (Shift along one axis) or a handle (Shift in 45° steps; Alt lets a smooth anchor's other handle be). */
  function pathTo(g: PathDrag, p: Point, shift: boolean, alt: boolean) {
    let dx = p.x - g.grab.x
    let dy = p.y - g.grab.y
    if ('anchors' in g.drag) {
      if (shift) {
        if (Math.abs(dx) > Math.abs(dy)) dy = 0
        else dx = 0
      }
      reshape(g.layer, moveAnchors(g.path, g.drag.anchors, round(dx), round(dy)))
      return
    }
    const anchor = anchorOf(g.path, g.drag.ref)
    if (!anchor) return
    const to = { x: g.drag.from.x + dx, y: g.drag.from.y + dy }
    const placed = shift ? constrain(anchor, to) : to
    reshape(
      g.layer,
      moveControl(g.path, g.drag.ref, g.drag.side, { x: round(placed.x), y: round(placed.y) }, g.drag.mirror && !alt),
    )
  }
  /** Ends a drag of a path's points: the groups around it fit it again, and its undo step closes. */
  function releasePoints(g: PathDrag) {
    hug(g.roots)
    g.step.end()
  }
  /** Takes the selected anchors out of the path being edited, or the layer once none would be left. One undo step. */
  function deletePoints() {
    const editingPath = selection.pathEditing()
    const frame = editingPath && frameOf(editingPath.frameId)
    const found = frame && editingPath && pathIn(frame, editingPath.id)
    if (!editingPath || !found || editingPath.selected.length === 0) return false
    const next = deleteAnchors(found.path, editingPath.selected)
    const parent = session.design().nodes[editingPath.id]?.parentId ?? ''
    session.gesture(() => {
      if (next.length === 0) runQuietly(() => deleteLayers(session, { drawnHolders }, [editingPath.id]))
      else {
        reshape({ id: editingPath.id, start: found.box, applied: { x: 0, y: 0 } }, next)
        hug(session.design().nodes[parent] ? [parent] : [editingPath.id])
      }
    })
    selection.pickAnchors([])
    return true
  }

  /**
   * A press with the pen (#45): a click adds a corner, a drag pulls out smooth handles, Shift turns
   * the new segment to 45°, and a press on the first anchor closes the path. The first press
   * starts one undo step that lasts until the path is closed or finished; the layer appears with
   * the second anchor, inside the group, box or boolean double-clicked into if it can hold it.
   */
  function penDown(e: PointerInput, at: { frame: Frame; p: Point }) {
    typing.stop()
    if (pen && pen.frame.id !== at.frame.id) finishPen()
    if (!pen) {
      const now = session.design()
      const parentId = parentFor(at.frame, 'graphic', now)
      const around = containersOf(at.frame, parentId, now)
      pen = {
        frame: at.frame,
        around,
        parentId,
        anchors: [],
        closing: false,
        dragging: null,
        hover: null,
        layer: null,
        step: session.beginGesture(),
      }
      selection.selectKeepingModes(null)
    }
    hold()
    const p = localTo(at.p, pen.around)
    const first = pen.anchors[0]
    const last = pen.anchors.at(-1)
    if (first && pen.anchors.length >= 2 && Math.hypot(p.x - first.x, p.y - first.y) * camera().zoom <= POINT_REACH) {
      pen.closing = true
      pen.dragging = 0
    } else {
      const placed = e.shiftKey && last ? constrain(last, p) : p
      pen.anchors.push({ x: round(placed.x), y: round(placed.y) })
      pen.dragging = pen.anchors.length - 1
    }
    writePen()
    shownChanged()
  }
  /** Pulls the handles out of the anchor just placed (Shift in 45° steps, Alt only the one ahead), or shows the next segment to the pointer. */
  function penMove(e: PointerInput, screen: Point) {
    if (!pen) return
    const world = toWorld(camera(), screen)
    const p = localTo({ x: world.x - pen.frame.x, y: world.y - pen.frame.y }, pen.around)
    const anchor = pen.dragging === null ? undefined : pen.anchors[pen.dragging]
    if (!anchor) {
      pen.hover = e.shiftKey && pen.anchors.at(-1) ? constrain(pen.anchors.at(-1) as Anchor, p) : p
      shownChanged()
      return
    }
    // The anchor placed stays a corner until the press is a drag.
    if (!dragStart.moved(screen)) return
    const out = e.shiftKey ? constrain(anchor, p) : p
    anchor.out = { x: round(out.x), y: round(out.y) }
    if (!e.altKey) anchor.in = { x: round(2 * anchor.x - out.x), y: round(2 * anchor.y - out.y) }
    writePen()
    shownChanged()
  }
  /** The press is over: a closing one finishes the path. */
  function penUp() {
    if (!pen) return
    pen.dragging = null
    if (pen.closing) finishPen()
    else shownChanged()
  }
  /** Writes the pen's path to its layer, making the layer at the second anchor. */
  function writePen() {
    if (!pen || pen.anchors.length < 2) return
    const path: PenPath = [{ anchors: pen.anchors, closed: pen.closing }]
    if (pen.layer) {
      reshape(pen.layer, path)
      return
    }
    const b = pathBounds(path)
    if (!b) return
    const box = { x: round(b.x), y: round(b.y), width: round(b.width), height: round(b.height), rotation: 0 }
    const { parentId } = pen
    let id = ''
    // The path's data is drawn from the corner it is drawn at; the layer is stored where that is drawn.
    const layer = newPath(formatPath(path, box), storedNewBox(box, parentId))
    if (
      runQuietly(() => {
        id = session.run('node.create', { parentId, layer })
      })
    )
      pen.layer = { id, start: box, applied: { x: 0, y: 0 } }
  }
  /** Ends the pen's path, closed or open: the undo step ends, the new layer is selected, and the select tool comes back. */
  function finishPen() {
    const done = pen
    if (!done) return
    pen = null
    if (done.layer) hug([done.layer.id])
    done.step.end()
    if (done.layer && session.design().nodes[done.layer.id]) selection.select([done.layer.id], done.frame.id)
    tools.setTool('select')
    shownChanged()
  }

  return {
    drawing,
    down: penDown,
    move: penMove,
    up: penUp,
    finish: finishPen,
    pointsAt,
    pressPoints: startPathEdit,
    dragPoints: pathTo,
    releasePoints,
    deletePoints,
    shown,
  }
}
