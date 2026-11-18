// The loupe picking a colour shows over the stage: a circle of the design pixels
// round the hot spot, each a cell of at least 10 px, over a checker where the frame is see-through
// and the pasteboard off it, the middle cell boxed and a ring in its colour; under it a pill with
// the colour's hex. A mouse's or a pen's is centred on the hot spot, where the stage hides the
// cursor; a finger's stands over the touch, or under it where there is no room over it. It stays in
// the part of the stage the chrome leaves clear, and takes no pointer.
import type { Rect } from '@dazbee/schema'

import { px } from '../canvas/rulers.ts'
import { cellSide, LOUPE_SIDE, type PickShown, type PickWindow, windowSide } from './colour-pick.ts'

/** How far a finger's loupe stands from the touch, in pixels: its bottom over it, or its top under it. */
const FINGER_GAP = 72
/** The room the pill under the circle takes, its gap included, in pixels. */
const PILL_ROOM = 30
/** What the pill says while the frame is drawn, and where there is no colour to pick. */
const DRAWING = '…'
const NONE = '—'

/** The loupe for what picking shows, at the zoom, inside `room`, the stage clear of its chrome; none with nothing shown. */
export function loupeParts(shown: PickShown | null, zoom: number, room: Rect): HTMLElement[] {
  if (!shown) return []
  const loupe = document.createElement('div')
  loupe.className = 'loupe'
  loupe.dataset.state = shown.state
  loupe.setAttribute('aria-hidden', 'true')
  const at = placeOf(shown, room)
  Object.assign(loupe.style, { left: px(at.x), top: px(at.y), width: px(LOUPE_SIDE), height: px(LOUPE_SIDE) })
  const lens = document.createElement('div')
  lens.className = 'loupe-lens'
  // The ring is drawn in the lens's own colour.
  if (shown.state === 'colour' && shown.hex) lens.style.color = shown.hex
  const cells = shown.state === 'colour' || shown.state === 'clear' ? shown.window : null
  if (cells || shown.state === 'drawing') lens.append(gridOf(cells, zoom))
  const pill = document.createElement('span')
  pill.className = 'loupe-hex'
  pill.setAttribute('dir', 'ltr')
  pill.textContent = shown.state === 'colour' && shown.hex ? shown.hex : shown.state === 'drawing' ? DRAWING : NONE
  loupe.append(lens, pill)
  return [loupe]
}

/** Where the loupe's top start corner goes on the stage, inside `room`. */
function placeOf({ at, pointerType }: PickShown, room: Rect) {
  const half = LOUPE_SIDE / 2
  let top = at.y - half
  if (pointerType === 'touch') {
    top = at.y - FINGER_GAP - LOUPE_SIDE
    if (top < room.y) top = at.y + FINGER_GAP
  }
  // A room too small for it keeps it at its top start corner.
  const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(n, high))
  return {
    x: clamp(at.x - half, room.x, room.x + room.width - LOUPE_SIDE),
    y: clamp(top, room.y, room.y + room.height - LOUPE_SIDE - PILL_ROOM),
  }
}

/**
 * The window's cells, centred in the circle, with the checker under those on the frame and the
 * middle one boxed; with no window, an empty grid.
 */
function gridOf(window: PickWindow | null, zoom: number) {
  const cell = cellSide(zoom)
  const size = window?.size ?? windowSide(zoom)
  const side = size * cell
  const grid = document.createElement('div')
  grid.className = 'loupe-grid'
  const inset = (LOUPE_SIDE - side) / 2
  Object.assign(grid.style, { left: px(inset), top: px(inset), width: px(side), height: px(side) })
  // An empty grid's lines, one a cell.
  grid.style.backgroundSize = `${px(cell)} ${px(cell)}`
  if (window) {
    grid.append(checkerOf(window, cell), cellsOf(window, side))
  } else {
    grid.dataset.empty = ''
  }
  const centre = document.createElement('div')
  centre.className = 'loupe-centre'
  const middle = ((size - 1) / 2) * cell
  Object.assign(centre.style, { left: px(middle), top: px(middle), width: px(cell), height: px(cell) })
  grid.append(centre)
  return grid
}

/** The checker under the cells on the frame, which shows where they are see-through. */
function checkerOf({ x, y, width, height, size }: PickWindow, cell: number) {
  const half = (size - 1) / 2
  const from = { x: Math.max(0, half - x), y: Math.max(0, half - y) }
  const to = { x: Math.min(size, half + width - x), y: Math.min(size, half + height - y) }
  const checker = document.createElement('div')
  checker.className = 'loupe-checker'
  Object.assign(checker.style, {
    left: px(from.x * cell),
    top: px(from.y * cell),
    width: px(Math.max(0, to.x - from.x) * cell),
    height: px(Math.max(0, to.y - from.y) * cell),
  })
  return checker
}

/** The window's pixels on a canvas of one pixel a cell, stretched to the grid without smoothing. */
function cellsOf({ size, pixels }: PickWindow, side: number) {
  const canvas = document.createElement('canvas')
  canvas.className = 'loupe-cells'
  canvas.width = size
  canvas.height = size
  Object.assign(canvas.style, { width: px(side), height: px(side) })
  const context = canvas.getContext('2d')
  if (context) {
    const image = context.createImageData(size, size)
    image.data.set(pixels)
    context.putImageData(image, 0, 0)
  }
  return canvas
}
