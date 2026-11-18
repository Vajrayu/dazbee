// Resizing the picked frame on the stage by its handles, and routing the frame gestures the pointer
// holds: a frame's move by its label too. Each move of a resize works from the design as it began:
// the handle lands on whole design pixels, the frame stays inside SIZE_LIMITS and never flips, Shift
// keeps its shape and Alt its middle; its layers follow their constraints, or with the deep key held
// stay where they are on the page, its guides with them, and the texts whose width changed are fitted
// to their words. The whole drag is one undo step called `resize`.
import { descendants, followingBoxes, type GestureStep, type Session, stayedBoxes, stayedGuides } from '@dazbee/doc'
import { type Design, type Guide, type Layer, type Point, type Rect, SIZE_LIMITS } from '@dazbee/schema'

import { toWorld } from '../../canvas/camera.ts'
import type { Frame } from '../../canvas/frames.ts'
import type { EditorView } from '../../canvas/view.ts'
import { fitResizedTexts } from '../../frame-actions.ts'
import { type Handle, handleAt } from '../../layers/transform.ts'
import { runQuietly } from '../../run-quietly.ts'
import type { EditorSelection } from '../../selection.ts'
import { deepKeyHeld } from '../../shortcuts.ts'
import type { EditorTyping } from '../../text/typing.ts'
import type { EditorTools } from '../../tools.ts'
import { frameZoneAt, type Grab, screenCorners } from '../hit-zones.ts'
import type { PointerInput } from '../inputs.ts'
import type { EditorFrameMove, FrameMoveDrag } from './frame-move.ts'
import type { EditorTransformDrag } from './transform-drag.ts'

/** A drag of one of the picked frame's handles, from the press until it is let go. */
export interface FrameResizeDrag {
  kind: 'frameResize'
  frameId: string
  handle: Handle
  /** The frame's box on its page as the drag began. */
  from: Rect
  /** Where the press went down, in world units. */
  grab: Point
  /** The design as the drag began: its frames and the frame's layers, which every move works from. */
  start: Design
  /** The texts in the frame as the drag began, which a move fits to their words when their width changes. */
  texts: string[]
  /** The frame's values the drag has written so far: its sides and place, and its guides. */
  wrote: Set<string>
  /** Ends the drag's undo step; null until the drag first writes. */
  step: GestureStep | null
}
/** A drag of a frame: its move by its label, or its resize by a handle. */
export type FrameGesture = FrameMoveDrag | FrameResizeDrag

export interface FrameResizeDeps {
  /** Asks for the pointer to be held from the press being handled. */
  hold: () => void
  session: Pick<Session, 'design' | 'readOnly' | 'run' | 'beginGesture'>
  view: Pick<EditorView, 'camera' | 'frameOf'>
  tools: Pick<EditorTools, 'tool'>
  selection: Pick<EditorSelection, 'current' | 'pickedFrame'>
  typing: Pick<EditorTyping, 'fitText'>
  transformDrag: Pick<EditorTransformDrag, 'writeStoredBoxes'>
  frameMove: Pick<EditorFrameMove, 'drag' | 'release'>
  /** Whether this computer is Apple's, whose deep key is ⌘. */
  onMac: () => boolean
}

export interface EditorFrameResize {
  /**
   * The frame that shows handles: the picked frame, with the Select tool, nothing selected, to a tab
   * that may edit; null when there is none.
   */
  handled(): Frame | null
  /** The corner or edge of the frame that shows handles a press at a stage point grabs (`frameZoneAt`); `touch` for a finger's. */
  handleUnder(screen: Point, touch?: boolean): Grab | null
  /** A press at a stage point: the resize of the frame whose handle it grabs, holding the pointer; null on none. */
  press(e: PointerInput, screen: Point): FrameResizeDrag | null
  /**
   * Follows the pointer at `world` on the page, once the press is a drag: a move goes by the move's
   * rule; a resize keeps the frame's shape with Shift, resizes about its middle with Alt, and with
   * the deep key leaves its layers where they are on the page.
   */
  drag(gesture: FrameGesture, world: Point, e: PointerInput): void
  /** Ends the drag, closing its undo step. */
  release(gesture: FrameGesture): void
  /**
   * The resizes' work since the editor opened, for the checks that count it: `moves` pointer moves
   * of a resize, and `written` the layers those moves wrote.
   */
  work(): { moves: number; written: number }
}

export function editorFrameResize({
  hold,
  session,
  view,
  tools,
  selection,
  typing,
  transformDrag,
  frameMove,
  onMac,
}: FrameResizeDeps): EditorFrameResize {
  /** The resizes' work since the editor opened: pointer moves, and the layers they wrote. */
  const work = { moves: 0, written: 0 }

  function handled(): Frame | null {
    const picked = selection.pickedFrame()
    if (!picked || selection.current() || session.readOnly() || tools.tool() !== 'select') return null
    return view.frameOf(picked) ?? null
  }
  function handleUnder(screen: Point, touch = false): Grab | null {
    const frame = handled()
    return frame && zoneOn(frame, screen, touch)
  }
  /** What a press at a stage point grabs on a frame's corners and edges. */
  function zoneOn(frame: Frame, screen: Point, touch: boolean): Grab | null {
    const box = { x: 0, y: 0, width: frame.width, height: frame.height, rotation: 0 }
    return frameZoneAt(screenCorners(box, frame, view.camera()), screen, touch)
  }
  function workSoFar() {
    return { ...work }
  }

  function press(e: PointerInput, screen: Point): FrameResizeDrag | null {
    const frame = handled()
    const grabbed = frame && zoneOn(frame, screen, e.pointerType === 'touch')
    if (!frame || grabbed?.kind !== 'resize') return null
    hold()
    const start = startOf(session.design(), frame.id)
    const from = { x: frame.x, y: frame.y, width: frame.width, height: frame.height }
    const texts = Object.keys(start.nodes).filter((id) => start.nodes[id]?.type === 'text')
    const grab = toWorld(view.camera(), screen)
    return {
      kind: 'frameResize',
      frameId: frame.id,
      handle: grabbed.handle,
      from,
      grab,
      start,
      texts,
      wrote: new Set(),
      step: null,
    }
  }
  function drag(gesture: FrameGesture, world: Point, e: PointerInput) {
    if (gesture.kind === 'frameMove') frameMove.drag(gesture, world, e.shiftKey)
    else resizeTo(gesture, world, e.shiftKey, e.altKey, deepKeyHeld(e, onMac()))
  }
  /**
   * Resizes the frame to where the handle follows the pointer, from where it was grabbed, writing
   * the frame, its guides and its layers' stored boxes in one batch, then fitting the texts whose
   * width changed.
   */
  function resizeTo(g: FrameResizeDrag, world: Point, keepRatio: boolean, fromCentre: boolean, stay: boolean) {
    g.step ??= session.beginGesture('resize')
    const { from, frameId, start } = g
    const at = handleAt(g.handle)
    const pointed = {
      x: from.x + at.x * from.width + world.x - g.grab.x,
      y: from.y + at.y * from.height + world.y - g.grab.y,
    }
    const to = resizedFrame(from, g.handle, pointed, keepRatio, fromCentre)
    const startFrame = start.frames[frameId]
    const boxes = stay
      ? stayedBoxes(start, frameId, from, to)
      : followingBoxes(start, frameId, sizeOf(from), sizeOf(to))
    const guides = stay ? stayedGuides(startFrame?.guides, from, to) : startFrame?.guides
    // The design is live: the widths are kept as they are before the move changes them.
    const now = session.design()
    const widths = new Map(g.texts.map((id) => [id, now.nodes[id]?.props.width]))
    const written = transformDrag.writeStoredBoxes(start, boxes, () => writeFrame(g, to, guides))
    work.moves++
    work.written += written
    fitResizedTexts(session.design(), frameId, (id) => widths.get(id), typing.fitText)
  }
  /**
   * Writes the frame's box and guides: each value that differs from the frame's as the drag began,
   * or that the drag wrote before, where it differs from the frame's own.
   */
  function writeFrame(g: FrameResizeDrag, to: Rect, guides: Guide[] | undefined) {
    const frame = session.design().frames[g.frameId]
    if (!frame) return
    const change: Partial<Rect> & { guides?: Guide[] } = {}
    for (const key of ['x', 'y', 'width', 'height'] as const)
      if ((to[key] !== g.from[key] || g.wrote.has(key)) && frame[key] !== to[key]) change[key] = to[key]
    const startGuides = JSON.stringify(g.start.frames[g.frameId]?.guides)
    const moved = JSON.stringify(guides) !== startGuides || g.wrote.has('guides')
    if (guides && moved && JSON.stringify(guides) !== JSON.stringify(frame.guides)) change.guides = guides
    for (const key of Object.keys(change)) g.wrote.add(key)
    // Another tab may delete the frame mid-drag; the drag then just leaves it be.
    if (Object.keys(change).length > 0) runQuietly(() => session.run('frame.update', { frameId: g.frameId, ...change }))
  }
  function release(gesture: FrameGesture) {
    if (gesture.kind === 'frameMove') frameMove.release(gesture)
    else gesture.step?.end()
  }

  return {
    handled,
    handleUnder,
    press,
    drag,
    release,
    work: workSoFar,
  }
}

/** Whether a drag is a frame's: its move or its resize. */
export function isFrameGesture(g: { kind: string } | null): g is FrameGesture {
  return g?.kind === 'frameMove' || g?.kind === 'frameResize'
}

/** The design a resize works from: the live design's frames as they are, and a frame's layers, held. */
function startOf(design: Design, frameId: string): Design {
  const nodes: Record<string, Layer> = {}
  for (const id of descendants(design, frameId)) {
    const layer = design.nodes[id]
    if (layer) nodes[id] = layer
  }
  return { ...design, frames: { ...design.frames }, nodes }
}

/**
 * The frame's box when its handle is dragged to `p` on the page, from `from`. Each side the handle
 * drags lands a whole distance from the side across, which stays; with `fromCentre` both sides move
 * about the middle, the size whole and the place rounded. The size stays inside SIZE_LIMITS: a side
 * stops at the limit, and a handle past the side across stops at the smallest side. `keepRatio`
 * keeps the frame's shape: a corner by the side that moved more, an edge growing the other side about
 * its middle.
 */
function resizedFrame(from: Rect, handle: Handle, p: Point, keepRatio: boolean, fromCentre: boolean): Rect {
  const { minSide, maxSide, maxRatio } = SIZE_LIMITS
  const at = handleAt(handle)
  const sideX = at.x === 0.5 ? 0 : at.x === 0 ? -1 : 1
  const sideY = at.y === 0.5 ? 0 : at.y === 0 ? -1 : 1
  // The size along an axis the pointer asks for: from the side across, or twice from the middle.
  const asked = (side: number, start: number, size: number, to: number) => {
    if (side === 0) return size
    if (fromCentre) return 2 * side * (to - (start + size / 2))
    return side === 1 ? to - start : start + size - to
  }
  const clamp = (v: number, low: number, high: number) => Math.min(high, Math.max(low, v))
  let width = asked(sideX, from.x, from.width, p.x)
  let height = asked(sideY, from.y, from.height, p.y)
  if (keepRatio) {
    const sx = width / from.width
    const sy = height / from.height
    const byX = sideY === 0 || (sideX !== 0 && sx >= sy)
    const factor = clamp(
      byX ? sx : sy,
      Math.max(minSide / from.width, minSide / from.height),
      Math.min(maxSide / from.width, maxSide / from.height),
    )
    // The side the factor is taken from is whole, and the other follows it, both inside the limits.
    if (byX) {
      width = Math.round(from.width * factor)
      height = clamp(Math.round((from.height * width) / from.width), minSide, maxSide)
    } else {
      height = Math.round(from.height * factor)
      width = clamp(Math.round((from.width * height) / from.height), minSide, maxSide)
    }
  } else {
    width = clamp(Math.round(width), minSide, maxSide)
    height = clamp(Math.round(height), minSide, maxSide)
  }
  // At most maxRatio times as long as wide: the side the handle drags stops, or of two, the one
  // that moved more from its size as the drag began.
  const moved = (size: number, start: number) => Math.abs(Math.log(size / start))
  const stops =
    sideX !== 0 && (sideY === 0 || keepRatio || moved(width, from.width) > moved(height, from.height)) ? 'x' : 'y'
  if (stops === 'x') width = clamp(width, Math.max(minSide, Math.ceil(height / maxRatio)), height * maxRatio)
  else height = clamp(height, Math.max(minSide, Math.ceil(width / maxRatio)), width * maxRatio)
  // Where a side goes: kept across from the handle, or about the middle on whole pixels.
  const place = (side: number, start: number, size: number, next: number) => {
    if (next === size) return start
    if (fromCentre || side === 0) return Math.round(start + size / 2 - next / 2)
    return side === 1 ? start : start + size - next
  }
  return {
    x: place(sideX, from.x, from.width, width),
    y: place(sideY, from.y, from.height, height),
    width,
    height,
  }
}

/** A frame's own box, in its space: 0, 0, its width and height. */
function sizeOf({ width, height }: Rect): Rect {
  return { x: 0, y: 0, width, height }
}
