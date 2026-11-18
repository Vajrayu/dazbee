// Cropping an image fill on the stage (#48): where the whole image starts, the crop that shows it
// in a window, and what a drag of the image, one of its corners or one of the window's handles
// gives. All in the layer's own, unturned coordinates. Kept free of the editor so it can be tested
// on its own.
import { imagePlacement } from '@dazbee/renderer'
import type { ImagePaint, Point, Rect } from '@dazbee/schema'

import { type Handle, handleAt, HANDLES } from '../../layers/transform.ts'

export interface Size {
  width: number
  height: number
}

/** What a press while cropping grabs: a handle of the window, or a corner of the image to zoom it by. */
export type CropHandle = { kind: 'window'; handle: Handle } | { kind: 'zoom'; corner: number }

/** The least width and height a window keeps. */
export const MIN_WINDOW = 1
/** How long each arm of a window's corner bracket is drawn, in screen pixels. */
const BRACKET = 18
/** How long the bar on a window's side is drawn, in screen pixels. */
const BAR = 22

/**
 * Where cropping starts the whole image of a fill in a box: where the layer draws it. A tile has
 * no one place, so it starts where fill draws it.
 */
export function cropStart(image: Size, fill: Pick<ImagePaint, 'fit' | 'crop'>, box: Rect): Rect {
  return imagePlacement(image, fill.fit === 'tile' ? { fit: 'fill' } : fill, box)
}

/** The crop of an image placed at a rect that a box shows. */
export function cropOf(rect: Rect, image: Size, box: Rect): Rect {
  const sx = rect.width / image.width
  const sy = rect.height / image.height
  return { x: (box.x - rect.x) / sx, y: (box.y - rect.y) / sy, width: box.width / sx, height: box.height / sy }
}

/**
 * The image moved as little as it takes to sit right in the window: along an axis where it is at
 * least as big as the window it covers it, and along one where it is smaller it stays inside it.
 */
export function inWindow(rect: Rect, win: Rect): Rect {
  const along = (at: number, size: number, start: number, room: number) => {
    const far = start + room - size
    return Math.min(Math.max(at, Math.min(start, far)), Math.max(start, far))
  }
  return { ...rect, x: along(rect.x, rect.width, win.x, win.width), y: along(rect.y, rect.height, win.y, win.height) }
}

/** The image moved by a drag, kept in the window as `inWindow` says. */
export function panned(rect: Rect, win: Rect, dx: number, dy: number): Rect {
  return inWindow({ ...rect, x: rect.x + dx, y: rect.y + dy }, win)
}

/**
 * The image scaled by dragging one of its corners (0 top start, 1 top end, 2 bottom end, 3 bottom
 * start) to a point: the opposite corner stays and the aspect is kept. Zoomed out, it stops at the
 * size at which the whole image fits inside the window, and it is kept in the window as `inWindow`
 * says, which can move the corner that stays.
 */
export function scaled(rect: Rect, win: Rect, corner: number, p: Point): Rect {
  const right = corner === 1 || corner === 2
  const bottom = corner === 2 || corner === 3
  const fixed = { x: right ? rect.x : rect.x + rect.width, y: bottom ? rect.y : rect.y + rect.height }
  // How big the pointer asks for, along the image's diagonal.
  const along = Math.max(Math.abs(p.x - fixed.x) / rect.width, Math.abs(p.y - fixed.y) / rect.height)
  // The size at which the whole image just fits inside the window.
  const least = Math.min(win.width / rect.width, win.height / rect.height)
  const k = Math.max(along, least)
  const width = rect.width * k
  const height = rect.height * k
  return inWindow({ x: right ? fixed.x : fixed.x - width, y: bottom ? fixed.y : fixed.y - height, width, height }, win)
}

/**
 * The window a drag of one of its handles to a point gives: the side or sides the handle moves
 * follow the point and the others stay. It never grows past the image's edges, except on a side
 * that already reached past them, which can come back in but not go further out; and it keeps at
 * least MIN_WINDOW across.
 */
export function windowed(win: Rect, image: Rect, handle: Handle, to: Point): Rect {
  const at = handleAt(handle)
  let left = win.x
  let top = win.y
  let right = win.x + win.width
  let bottom = win.y + win.height
  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi)
  if (at.x === 0) left = clamp(to.x, Math.min(left, image.x), right - MIN_WINDOW)
  if (at.x === 1) right = clamp(to.x, left + MIN_WINDOW, Math.max(right, image.x + image.width))
  if (at.y === 0) top = clamp(to.y, Math.min(top, image.y), bottom - MIN_WINDOW)
  if (at.y === 1) bottom = clamp(to.y, top + MIN_WINDOW, Math.max(bottom, image.y + image.height))
  return { x: left, y: top, width: right - left, height: bottom - top }
}

/**
 * The handle a press at a point grabs while cropping, if any is within `reach` screen pixels of it:
 * the window's corner brackets and side bars as the overlay draws them, and the image's corners.
 * The nearest wins, and an image corner wins a tie. `perPixel` is how many layer units a screen
 * pixel spans.
 */
export function cropHandleAt(win: Rect, image: Rect, p: Point, reach: number, perPixel: number): CropHandle | null {
  const near: { grab: CropHandle; distance: number }[] = [
    ...HANDLES.map((handle) => ({
      grab: { kind: 'window', handle } as const,
      distance: Math.min(...handleShape(win, handle, perPixel).map((s) => toSegment(p, s))),
    })),
    ...cornersOfRect(image).map((q, corner) => ({
      grab: { kind: 'zoom', corner } as const,
      distance: Math.hypot(p.x - q.x, p.y - q.y),
    })),
  ].filter(({ distance }) => distance <= reach * perPixel)
  // The image's corners come last, so they win a tie.
  const nearest = near.reduce<(typeof near)[number] | null>((a, b) => (a && a.distance < b.distance ? a : b), null)
  return nearest?.grab ?? null
}

/** A rect's corners in the order `scaled` numbers them. */
export function cornersOfRect(r: Rect): Point[] {
  return [
    { x: r.x, y: r.y },
    { x: r.x + r.width, y: r.y },
    { x: r.x + r.width, y: r.y + r.height },
    { x: r.x, y: r.y + r.height },
  ]
}

/** The segments a window's handle is drawn as: a corner's two arms, running in along its sides, or a side's bar across its middle. */
function handleShape(win: Rect, handle: Handle, perPixel: number): [Point, Point][] {
  const at = handleAt(handle)
  const p = { x: win.x + at.x * win.width, y: win.y + at.y * win.height }
  const arm = Math.min(BRACKET * perPixel, win.width / 2, win.height / 2)
  const half = (BAR / 2) * perPixel
  if (at.x !== 0.5 && at.y !== 0.5) {
    const inX = at.x === 0 ? arm : -arm
    const inY = at.y === 0 ? arm : -arm
    return [
      [p, { x: p.x + inX, y: p.y }],
      [p, { x: p.x, y: p.y + inY }],
    ]
  }
  return at.x === 0.5
    ? [
        [
          { x: p.x - Math.min(half, win.width / 2), y: p.y },
          { x: p.x + Math.min(half, win.width / 2), y: p.y },
        ],
      ]
    : [
        [
          { x: p.x, y: p.y - Math.min(half, win.height / 2) },
          { x: p.x, y: p.y + Math.min(half, win.height / 2) },
        ],
      ]
}

/** How far a point is from a segment. */
function toSegment(p: Point, [a, b]: [Point, Point]) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const length = dx * dx + dy * dy
  const t = length === 0 ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}
