// Cropping an image fill on the stage: starting it where the layer draws the image, a press on
// the window's handles, the image's corners or the image, the drag that sizes the window, zooms
// the image or moves it, and what is shown of the crop: the window and the whole image as drawn.
// A flipped layer's image is worked on where it is drawn, mirrored, and stored unmirrored.
import { flippedRect, type Flips, flipsOf, type GestureStep, type Session } from '@dazbee/doc'
import type { Point, Rect } from '@dazbee/schema'

import { type Camera, toWorld } from '../../canvas/camera.ts'
import { resizeCursor } from '../../canvas/cursors.ts'
import type { Frame } from '../../canvas/frames.ts'
import type { ThumbnailCache } from '../../canvas/thumbnails.ts'
import type { CropTarget, EditorBoxes } from '../../layers/boxes.ts'
import { type Box, centreOf, CORNERS, drawnFrom, handleAt, localTo, round, turn } from '../../layers/transform.ts'
import { runQuietly } from '../../run-quietly.ts'
import type { EditorSelection } from '../../selection.ts'
import type { EditorTyping } from '../../text/typing.ts'
import { CORNER_REACH, TOUCH_REACH } from '../hit-zones.ts'
import type { PointerInput } from '../inputs.ts'
import type { ResizePart } from '../select/resize-drag.ts'
import type { EditorTransformDrag } from '../select/transform-drag.ts'
import { type CropHandle, cropHandleAt, cropOf, panned, scaled, windowed } from './crop.ts'

/**
 * A drag while cropping, from the press until it ends: one undo step. `grabbed` is the window's
 * handle or the image's corner it drags, or null when it moves the image. A window drag resizes
 * the layer through `resize`.
 */
export interface CropDrag {
  kind: 'crop'
  frame: Frame
  around: Box[]
  id: string
  grabbed: CropHandle | null
  grab: Point
  start: CropTarget
  resize: ResizePart | null
  step: GestureStep
}

/** The crop being made, as it is shown, with the layer's flips, which mirror its image. */
export interface ShownCrop extends Flips {
  frame: Frame
  /** The layer whose image fill is cropped. */
  id: string
  /** The crop's window, the layer's box, as drawn in the frame. */
  window: Box
  /** The whole image as drawn in the frame. */
  whole: Box
  /** The window and the whole image as the layer's containers hold them: where the window lies in the image. */
  box: Rect
  rect: Rect
  /** The faint picture of the image, as a URL. */
  ghost: string
}

export interface CroppingDeps {
  /** Asks for the pointer to be held from the press being handled. */
  hold: () => void
  session: Session
  selection: Pick<EditorSelection, 'cropping' | 'crop' | 'select'>
  typing: Pick<EditorTyping, 'stop'>
  thumbnails: Pick<ThumbnailCache, 'ghost'>
  camera: () => Camera
  /** The shown page's frame with an id, as last drawn, if there is one. */
  frameOf: (id: string | undefined) => Frame | undefined
  boxes: Pick<EditorBoxes, 'cropTarget'>
  /** The one way a layer is resized, which a window drag goes through. */
  transformDrag: Pick<EditorTransformDrag, 'resizePart' | 'resizePartTo'>
  /** Groups fit what they hold again after a change inside them, in the same undo step. */
  hug: (ids: string[]) => void
  /** Tells that what is shown changed. */
  shownChanged: () => void
}

export interface EditorCropping {
  /**
   * Starts cropping a layer's image fill in a frame, the layer selected alone, when it has one and
   * its style isn't locked; false when it can't be cropped. A tiled fill first takes fill's place
   * as its crop, one undo step, so the layer is drawn where the crop shows the image.
   */
  start(frame: Frame, id: string): boolean
  /** The cursor over a point on the stage while cropping: a resize one on a handle, a move one on the image or in the window. */
  cursorAt(screen: Point): string
  /**
   * A press while cropping: on a handle of the window, a drag that sizes it; on a corner of the
   * image, one that zooms it; on the image or in the window, one that moves it. Each drag is one
   * undo step. Anywhere else ends the crop and returns null, so the press does what a press does.
   */
  press(e: PointerInput, screen: Point): CropDrag | null
  /** Writes what a drag gives: the window as the layer's box, and the fill's own crop. */
  drag(g: CropDrag, p: Point): void
  /** Ends a crop drag: groups around a resized layer fit it again, closing its undo step. */
  release(g: CropDrag): void
  /** The crop being made; null with none. */
  shown(): ShownCrop | null
}

export function editorCropping({
  hold,
  session,
  selection,
  typing,
  thumbnails,
  camera,
  frameOf,
  boxes: { cropTarget },
  transformDrag,
  hug,
  shownChanged,
}: CroppingDeps): EditorCropping {
  /** The crop under way, with its frame and the image fill it works on; null when there is none to work on. */
  function current() {
    const cropping = selection.cropping()
    const frame = cropping && frameOf(cropping.frameId)
    const target = frame && cropping && cropTarget(frame, cropping.id)
    return frame && target && cropping ? { frame, target, id: cropping.id } : null
  }
  /** What a press at a screen point grabs while cropping: a handle, the image (null), or nothing. */
  function grabbedAt(screen: Point, reach: number): { grabbed: CropHandle | null; grab: Point } | undefined {
    const now = current()
    if (!now) return undefined
    const { frame, target } = now
    const world = toWorld(camera(), screen)
    const grab = localTo({ x: world.x - frame.x, y: world.y - frame.y }, target.around)
    const handle = cropHandleAt(target.box, target.rect, grab, reach, 1 / camera().zoom)
    if (handle) return { grabbed: handle, grab }
    const inside = (r: Rect) => grab.x >= r.x && grab.x <= r.x + r.width && grab.y >= r.y && grab.y <= r.y + r.height
    return inside(target.rect) || inside(target.box) ? { grabbed: null, grab } : undefined
  }
  function cursorAt(screen: Point) {
    const at = grabbedAt(screen, CORNER_REACH)
    if (!at) return ''
    if (!at.grabbed) return 'move'
    // Resize cursors point along the handle as the layer and its containers turn it.
    const rotation = current()?.target.around.reduce((r, b) => r + b.rotation, 0) ?? 0
    const handle = at.grabbed.kind === 'window' ? at.grabbed.handle : (CORNERS[at.grabbed.corner] ?? 'nw')
    return resizeCursor(handle, rotation)
  }
  function shown(): ShownCrop | null {
    const now = current()
    if (!now) return null
    const { frame, target, id } = now
    const { box, rect, around } = target
    return {
      frame,
      id,
      window: drawnFrom(box, around.slice(0, -1)),
      whole: drawnFrom({ ...rect, rotation: 0 }, around),
      box,
      rect,
      ghost: thumbnails.ghost(target.fill.assetId, target.image),
      ...target.flips,
    }
  }
  function start(frame: Frame, id: string) {
    const target = cropTarget(frame, id)
    if (!target || session.design().nodes[id]?.lock?.style) return false
    typing.stop()
    selection.select([id], frame.id)
    // A tile has no one place: the crop starts at fill's, and the layer is drawn there from now on.
    if (target.fill.fit === 'tile') writeCrop(id, target, target.rect, target.box)
    selection.crop({ id, frameId: frame.id })
    shownChanged()
    return true
  }
  function press(e: PointerInput, screen: Point): CropDrag | null {
    const now = current()
    if (!now) {
      selection.crop(null)
      return null
    }
    const at = grabbedAt(screen, e.pointerType === 'touch' ? TOUCH_REACH : CORNER_REACH)
    if (!at) {
      selection.crop(null)
      shownChanged()
      return null
    }
    const { frame, target, id } = now
    hold()
    const step = session.beginGesture('crop')
    const resize =
      at.grabbed?.kind === 'window'
        ? transformDrag.resizePart(
            { frame, around: target.around.slice(0, -1), box: target.box },
            [id],
            at.grabbed.handle,
          )
        : null
    return {
      kind: 'crop',
      frame,
      around: target.around,
      id,
      grabbed: at.grabbed,
      grab: at.grab,
      start: target,
      resize,
      step,
    }
  }
  function drag(g: CropDrag, p: Point) {
    const { start, grabbed } = g
    if (grabbed?.kind === 'window' && g.resize) {
      const at = handleAt(grabbed.handle)
      const from = { x: start.box.x + at.x * start.box.width, y: start.box.y + at.y * start.box.height }
      const win = windowed(start.box, start.rect, grabbed.handle, {
        x: from.x + p.x - g.grab.x,
        y: from.y + p.y - g.grab.y,
      })
      // The window's sides stay where they are drawn, so the layer's box turns about its new centre.
      const c = turn(centreOf({ ...win, rotation: 0 }), centreOf(start.box), start.box.rotation)
      const box = { ...win, x: c.x - win.width / 2, y: c.y - win.height / 2, rotation: start.box.rotation }
      // A crop window keeps what a box holds where it is on the page.
      transformDrag.resizePartTo(g.resize, box, grabbed.handle, false, true)
      writeCrop(g.id, start, start.rect, win)
    } else {
      const rect =
        grabbed?.kind === 'zoom'
          ? scaled(start.rect, start.box, grabbed.corner, p)
          : panned(start.rect, start.box, p.x - g.grab.x, p.y - g.grab.y)
      writeCrop(g.id, start, rect, start.box)
    }
    shownChanged()
  }
  function release(g: CropDrag) {
    if (g.resize) hug([g.id])
    g.step.end()
  }
  /**
   * Writes the crop that shows the whole image drawn at `rect` in the window `win` as the fill's
   * own crop: where it is placed before the layer's flip, as it is now, mirrors it there.
   */
  function writeCrop(id: string, target: CropTarget, rect: Rect, win: Rect) {
    const node = session.design().nodes[id]
    const flips = node ? flipsOf(node.props) : target.flips
    const c = cropOf(flippedRect(rect, { ...win, ...flips }), target.size, win)
    const crop = { x: round(c.x), y: round(c.y), width: round(c.width), height: round(c.height) }
    const fills = target.fills.map((f, i) => (i === target.index ? { ...target.fill, fit: 'crop' as const, crop } : f))
    runQuietly(() => session.run('node.update', { ids: [id], patch: { fills } }))
  }

  return {
    cursorAt,
    shown,
    start,
    press,
    drag,
    release,
  }
}
