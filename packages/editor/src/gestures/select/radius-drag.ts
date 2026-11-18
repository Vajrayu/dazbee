// The radius dots of one selected box, rectangle, polygon or star: which layer has them and whether
// they show, where each sits, which one the pointer is over, and the drag of one, which rounds every
// corner or, with Alt, its own, with the words of the radius it asks for. The corners a dot rounds
// and the radii a drag asks for are `layers/radius.ts`'s.
import type { GestureStep, Session } from '@dazbee/doc'
import type { Point } from '@dazbee/schema'

import { type Camera, toScreen } from '../../canvas/camera.ts'
import type { Frame } from '../../canvas/frames.ts'
import { type EditorBoxes, type SelectionBox, shownIn } from '../../layers/boxes.ts'
import {
  type CornerRadii,
  draggedRadii,
  radiiOf,
  radiiPatch,
  type RadiusCorner,
  radiusCorners,
} from '../../layers/radius.ts'
import { type Box, centreOf, round, turn } from '../../layers/transform.ts'
import { runQuietly } from '../../run-quietly.ts'
import type { EditorSelection } from '../../selection.ts'
import type { EditorTyping } from '../../text/typing.ts'
import type { EditorTools } from '../../tools.ts'
import { DOT_INSET, DOT_MIN_SIDE, type Grab } from '../hit-zones.ts'

/** A drag of a radius dot, from the press until it ends: one undo step. */
export interface RadiusDrag {
  kind: 'radius'
  frame: Frame
  around: Box[]
  id: string
  /** The dot's corner, from the top left clockwise; 0 for a polygon's or a star's top point. */
  corner: number
  /** The layer's box as the press found it, as the layers in its containers see it. */
  box: Box
  /** Where the press went down, as the layers in its containers see it. */
  grab: Point
  /** The layer's corners as the press found them, each with the radius drawn there. */
  corners: RadiusCorner[]
  /** The layer's radii as the press found them stored, which the drag puts back while its value is the one at the press. */
  stored: CornerRadii
  /** The radius the drag last asked for: the one drawn at the dot's corner from the press until a move asks for one. */
  value: number
  step: GestureStep
}

/** A radius dot as the overlay draws it: in its layer's box on screen, from the box's top left along its sides. */
export interface ShownDot {
  corner: number
  x: number
  y: number
  /** Under the pointer, or dragged. */
  big: boolean
}

/** What the radius dots show: the dots, and the words of the radius a drag of one asks for, null with no drag. */
export interface ShownDots {
  dots: ShownDot[]
  label: string | null
}

export interface RadiusDragDeps {
  /** Asks for the pointer to be held from the press being handled. */
  hold: () => void
  session: Session
  selection: Pick<EditorSelection, 'current' | 'cropping' | 'pathEditing'>
  typing: Pick<EditorTyping, 'editing'>
  tools: Pick<EditorTools, 'tool'>
  boxes: Pick<EditorBoxes, 'selectionBox'>
  camera: () => Camera
  /** A radius in the app's words, as the pill beside the pointer reads it. */
  radiusLabel: (radius: number) => string
  /** Tells that what is shown changed. */
  shownChanged: () => void
}

export interface EditorRadiusDrag {
  /**
   * Notes the type of the pointer last seen on the stage, after its input is routed: a mouse or a
   * pen shows the dots, a finger none. Returns whether that changed whether they show.
   */
  saw(pointerType: string): boolean
  /** Where each dot of the selection with the box `outer` is on the stage, by its corner; none when it has no dots. */
  dotsOn(outer: SelectionBox): Point[]
  /**
   * Notes the dot under a stage point, null for none to look for, `grabAt` giving what a press there
   * grabs, asked only while the selection has dots; returns whether the dot under the pointer changed.
   */
  hover(screen: Point | null, grabAt: (screen: Point) => Grab | null): boolean
  /** A press on the dot of a corner, with `own` the corner alone: the drag of it, one undo step until it is released. */
  press(corner: number, outer: SelectionBox, grab: Point, own: boolean): RadiusDrag
  /** Follows the pointer: every corner takes the radius, or with `own` the dragged one of four alone; what is shown changes on each move. */
  dragTo(g: RadiusDrag, p: Point, own: boolean): void
  /**
   * The dots of the selection, the dragged one big while `g` drags it, with the words of the radius
   * `g` asked for last, to two decimals at most; no dots and no words when the selection has none.
   */
  shown(g: RadiusDrag | null): ShownDots
}

export function editorRadiusDrag({
  hold,
  session,
  selection,
  typing,
  tools,
  boxes,
  camera,
  radiusLabel,
  shownChanged,
}: RadiusDragDeps): EditorRadiusDrag {
  /** Whether the pointer last seen on the stage was a mouse or a pen; none before the first. */
  let fine = false
  /** The corner of the dot under the pointer, or null. */
  let hovered: number | null = null

  function saw(pointerType: string) {
    const was = fine
    fine = pointerType !== 'touch'
    return fine !== was
  }
  /**
   * The one selected layer that has dots, with its corners in its box as drawn: a box, a rectangle,
   * a polygon or a star, with the Select tool, both sides at least DOT_MIN_SIDE on screen, its style
   * not locked and it drawn, the pointer last seen a mouse or a pen; none while typing, cropping or
   * editing points. `outer` gives the selection's box, read only once one layer alone may have them.
   */
  function rounded(outer: () => SelectionBox | null) {
    const current = selection.current()
    const only = current?.length === 1 ? current[0] : undefined
    if (!fine || !only || tools.tool() !== 'select') return null
    if (typing.editing() || selection.cropping() || selection.pathEditing()) return null
    const now = session.design()
    const node = now.nodes[only.id]
    if (!node || node.lock?.style || !shownIn(now, only.id)) return null
    const box = outer()?.box
    if (!box) return null
    const { width, height } = box
    if (Math.min(width, height) * camera().zoom < DOT_MIN_SIDE) return null
    const corners = radiusCorners(node.type, node.props, width, height)
    const stored = radiiOf(node.type, node.props)
    return corners.length > 0 && stored !== undefined ? { id: only.id, corners, stored, width, height } : null
  }
  /**
   * A dot's place in its layer's box, in design pixels: on its corner's bisector at the centre of the
   * arc as drawn, never nearer than DOT_INSET on screen to a side of the box.
   */
  function dotIn(c: RadiusCorner, width: number, height: number): Point {
    const inset = DOT_INSET / camera().zoom
    let low = 0
    let high = Number.POSITIVE_INFINITY
    for (const [at, into, size] of [
      [c.at.x, c.into.x, width],
      [c.at.y, c.into.y, height],
    ] as const) {
      if (Math.abs(into) < 1e-9) continue
      const ends = [(inset - at) / into, (size - inset - at) / into]
      low = Math.max(low, Math.min(...ends))
      high = Math.min(high, Math.max(...ends))
    }
    const along = Math.min(Math.max(c.drawn / Math.sin(c.half), low), Math.max(low, high))
    return { x: c.at.x + c.into.x * along, y: c.at.y + c.into.y * along }
  }
  function dotsOn(outer: SelectionBox): Point[] {
    const layer = rounded(() => outer)
    if (!layer) return []
    const { drawn, frame } = outer
    const centre = centreOf(drawn)
    return layer.corners.map((c) => {
      const q = dotIn(c, layer.width, layer.height)
      const p = turn({ x: drawn.x + q.x, y: drawn.y + q.y }, centre, drawn.rotation)
      return toScreen(camera(), { x: frame.x + p.x, y: frame.y + p.y })
    })
  }
  function hover(screen: Point | null, grabAt: (screen: Point) => Grab | null) {
    const grab = screen && rounded(boxes.selectionBox) ? grabAt(screen) : null
    const was = hovered
    hovered = grab?.kind === 'radius' ? grab.corner : null
    return was !== hovered
  }
  function press(corner: number, outer: SelectionBox, grab: Point, own: boolean): RadiusDrag {
    const layer = rounded(() => outer)
    if (!layer) throw new Error('a press on a radius dot of a selection without dots')
    hold()
    const { frame, around, box } = outer
    const { id, corners, stored } = layer
    const value = draggedRadii(corners, corner, { x: 0, y: 0 }, own, box.width, box.height).value
    const step = session.beginGesture('edit')
    return { kind: 'radius', frame, around, id, corner, box, grab, corners, stored, value, step }
  }
  /** A point as the layers in the drag's containers see it, in the layer's own axes before its turn. */
  const ownPoint = (g: RadiusDrag, p: Point) => turn(p, centreOf(g.box), -g.box.rotation)
  function dragTo(g: RadiusDrag, p: Point, own: boolean) {
    const node = session.design().nodes[g.id]
    if (!node) return
    const from = ownPoint(g, g.grab)
    const to = ownPoint(g, p)
    const by = { x: to.x - from.x, y: to.y - from.y }
    const asked = draggedRadii(g.corners, g.corner, by, own, g.box.width, g.box.height)
    g.value = asked.value
    const patch = radiiPatch(node.type, node.props, asked.radii ?? g.stored)
    // Another tab may delete or lock the layer mid-drag; the drag then just leaves it be.
    if (patch) runQuietly(() => session.run('node.update', { ids: [g.id], patch }))
    // The pill follows the pointer whether the radius changed or not.
    shownChanged()
  }
  function shown(g: RadiusDrag | null): ShownDots {
    const layer = rounded(boxes.selectionBox)
    if (!layer) return { dots: [], label: null }
    const { zoom } = camera()
    const dots = layer.corners.map((c, corner) => {
      const q = dotIn(c, layer.width, layer.height)
      return { corner, x: q.x * zoom, y: q.y * zoom, big: g ? g.corner === corner : hovered === corner }
    })
    return { dots, label: g ? radiusLabel(round(g.value, 2)) : null }
  }

  return { saw, dotsOn, hover, press, dragTo, shown }
}
