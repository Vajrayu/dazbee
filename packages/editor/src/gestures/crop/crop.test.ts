import { describe, expect, it } from 'vitest'

import { imagePlacement } from '@dazbee/renderer'

import { cropHandleAt, cropOf, cropStart, inWindow, panned, scaled, windowed } from './crop.ts'

/** A 2:1 image in a square window: fill shows its middle, 800 × 400 across the window's 400. */
const image = { width: 2000, height: 1000 }
const box = { x: 100, y: 100, width: 400, height: 400 }
const filled = { x: -100, y: 100, width: 800, height: 400 }
/** The same image fitted inside the window: 400 × 200 across its middle, with bands above and below. */
const fitted = { x: 100, y: 200, width: 400, height: 200 }

describe('crop', () => {
  describe('cropStart', () => {
    it('starts where the layer draws the image: fill covers the window, fit inside sits in it with its bands', () => {
      expect(cropStart(image, { fit: 'fill' }, box)).toEqual(filled)
      expect(cropStart(image, { fit: 'fit' }, box)).toEqual(fitted)
      expect(cropStart(image, { fit: 'fit' }, box)).toEqual(imagePlacement(image, { fit: 'fit' }, box))
    })

    it('starts a crop where its crop puts it, and a tile where fill puts it', () => {
      const crop = { x: 0, y: 0, width: 1000, height: 1000 }
      expect(cropStart(image, { fit: 'crop', crop }, box)).toEqual({ x: 100, y: 100, width: 800, height: 400 })
      expect(cropStart(image, { fit: 'tile' }, box)).toEqual(filled)
    })
  })

  describe('cropOf', () => {
    it("gives the crop that shows the image's rect in the window, past the image's edges too", () => {
      expect(cropOf(filled, image, box)).toEqual({ x: 500, y: 0, width: 1000, height: 1000 })
      expect(cropOf(fitted, image, box)).toEqual({ x: 0, y: -500, width: 2000, height: 2000 })
      expect(imagePlacement(image, { fit: 'crop', crop: cropOf(fitted, image, box) }, box)).toEqual(fitted)
    })
  })

  describe('inWindow', () => {
    it('keeps an image as big as the window covering it, and a smaller one inside it', () => {
      expect(inWindow({ ...filled, x: 150 }, box)).toEqual({ ...filled, x: 100 })
      expect(inWindow({ ...filled, x: -500 }, box)).toEqual({ ...filled, x: -300 })
      expect(inWindow({ ...fitted, y: 50 }, box)).toEqual({ ...fitted, y: 100 })
      expect(inWindow({ ...fitted, y: 450 }, box)).toEqual({ ...fitted, y: 300 })
      expect(inWindow(fitted, box)).toEqual(fitted)
    })
  })

  describe('panned', () => {
    it('pans the image, stopping where an edge would come into the window', () => {
      expect(panned(filled, box, 50, 0).x).toBe(-50)
      expect(panned(filled, box, 500, 0).x).toBe(100)
      expect(panned(filled, box, -500, 0).x).toBe(-300)
      // It is exactly as tall as the window: it can't move up or down.
      expect(panned(filled, box, 0, 30).y).toBe(100)
    })

    it('moves an image smaller than the window freely along that axis, staying inside it', () => {
      expect(panned(fitted, box, 0, -60)).toEqual({ ...fitted, y: 140 })
      expect(panned(fitted, box, 0, -300)).toEqual({ ...fitted, y: 100 })
      expect(panned(fitted, box, 0, 300)).toEqual({ ...fitted, y: 300 })
      // As wide as the window, it can't move across.
      expect(panned(fitted, box, 40, 0).x).toBe(100)
    })
  })

  describe('scaled', () => {
    it('scales from a corner about the opposite one, keeping its aspect', () => {
      // Bottom end corner dragged out by half again: the top start corner stays.
      const bigger = scaled(filled, box, 2, { x: -100 + 1200, y: 100 + 600 })
      expect(bigger).toEqual({ x: -100, y: 100, width: 1200, height: 600 })
      const crop = cropOf(bigger, image, box)
      expect([crop.x, crop.y, crop.width, crop.height].map((v) => v.toFixed(6))).toEqual(
        [1000 / 3, 0, 2000 / 3, 2000 / 3].map((v) => v.toFixed(6)),
      )
      // The top start corner, dragged out: the bottom end corner stays.
      const fromStart = scaled(bigger, box, 0, { x: -400, y: -50 })
      expect(fromStart.x + fromStart.width).toBe(1100)
      expect(fromStart.y + fromStart.height).toBe(700)
      expect(fromStart.width / fromStart.height).toBe(2)
    })

    it('zooms out no further than the whole image fitting inside the window, kept inside it', () => {
      // Dragged in past the window, it stops at fit inside's size, as wide as the window.
      expect(scaled(filled, box, 2, { x: 0, y: 0 })).toEqual({ x: 100, y: 100, width: 400, height: 200 })
      // Half way there it still covers the window across, and sits inside it down.
      const half = scaled(filled, box, 2, { x: -100 + 600, y: 100 + 300 })
      expect(half).toEqual({ x: -100, y: 100, width: 600, height: 300 })
    })

    it('zooms an image smaller than the window up from fit inside, kept in the window', () => {
      const up = scaled(fitted, box, 2, { x: 100 + 600, y: 200 + 300 })
      expect(up).toEqual({ x: 100, y: 200, width: 600, height: 300 })
      expect(scaled(fitted, box, 2, { x: 0, y: 0 })).toEqual(fitted)
    })
  })

  describe('windowed', () => {
    const win = { x: 200, y: 150, width: 200, height: 300 }
    const photo = { x: 100, y: 100, width: 400, height: 400 }

    it("moves only the side a side's bar is dragged to", () => {
      expect(windowed(win, photo, 'w', { x: 250, y: 999 })).toEqual({ x: 250, y: 150, width: 150, height: 300 })
      expect(windowed(win, photo, 'e', { x: 450, y: 0 })).toEqual({ x: 200, y: 150, width: 250, height: 300 })
      expect(windowed(win, photo, 'n', { x: 0, y: 120 })).toEqual({ x: 200, y: 120, width: 200, height: 330 })
      expect(windowed(win, photo, 's', { x: 0, y: 300 })).toEqual({ x: 200, y: 150, width: 200, height: 150 })
    })

    it('moves both sides of a corner, the opposite ones staying', () => {
      expect(windowed(win, photo, 'nw', { x: 150, y: 200 })).toEqual({ x: 150, y: 200, width: 250, height: 250 })
      expect(windowed(win, photo, 'ne', { x: 300, y: 100 })).toEqual({ x: 200, y: 100, width: 100, height: 350 })
      expect(windowed(win, photo, 'se', { x: 480, y: 480 })).toEqual({ x: 200, y: 150, width: 280, height: 330 })
      expect(windowed(win, photo, 'sw', { x: 120, y: 160 })).toEqual({ x: 120, y: 150, width: 280, height: 10 })
    })

    it("can't grow past the image's edges", () => {
      expect(windowed(win, photo, 'w', { x: 0, y: 0 }).x).toBe(100)
      expect(windowed(win, photo, 'se', { x: 900, y: 900 })).toEqual({ x: 200, y: 150, width: 300, height: 350 })
    })

    it('can come back in on a side that reached past the image, but not go further out', () => {
      // Fit inside: the window reaches 100 past the image above and below it.
      expect(windowed(box, fitted, 'n', { x: 0, y: 150 })).toEqual({ x: 100, y: 150, width: 400, height: 350 })
      expect(windowed(box, fitted, 'n', { x: 0, y: 20 })).toEqual(box)
      expect(windowed(box, fitted, 's', { x: 0, y: 700 })).toEqual(box)
    })

    it('keeps at least 1 px across', () => {
      expect(windowed(win, photo, 'e', { x: 0, y: 0 })).toEqual({ x: 200, y: 150, width: 1, height: 300 })
      expect(windowed(win, photo, 'nw', { x: 999, y: 999 })).toEqual({ x: 399, y: 449, width: 1, height: 1 })
    })
  })

  describe('cropHandleAt', () => {
    it("grabs the window's corner brackets and side bars along their length, at any zoom", () => {
      expect(cropHandleAt(box, filled, { x: 103, y: 104 }, 7, 1)).toEqual({ kind: 'window', handle: 'nw' })
      // Along the bracket's arm, 15 px in from the corner.
      expect(cropHandleAt(box, filled, { x: 115, y: 98 }, 7, 1)).toEqual({ kind: 'window', handle: 'nw' })
      expect(cropHandleAt(box, filled, { x: 305, y: 102 }, 7, 1)).toEqual({ kind: 'window', handle: 'n' })
      expect(cropHandleAt(box, filled, { x: 497, y: 290 }, 7, 1)).toEqual({ kind: 'window', handle: 'e' })
      // At half zoom a screen pixel is two layer units: 10 units off is 5 px.
      expect(cropHandleAt(box, filled, { x: 300, y: 510 }, 7, 2)).toEqual({ kind: 'window', handle: 's' })
      expect(cropHandleAt(box, filled, { x: 300, y: 510 }, 7, 1)).toBeNull()
    })

    it("grabs the image's corners to zoom it, and nothing in the middle", () => {
      expect(cropHandleAt(box, filled, { x: -98, y: 103 }, 7, 1)).toEqual({ kind: 'zoom', corner: 0 })
      expect(cropHandleAt(box, filled, { x: 702, y: 497 }, 7, 1)).toEqual({ kind: 'zoom', corner: 2 })
      expect(cropHandleAt(box, filled, { x: 300, y: 300 }, 7, 1)).toBeNull()
    })

    it('grabs the nearest handle, an image corner winning a tie, and reaches further for a finger', () => {
      // Fit inside's top start corner is 100 below the window's: nearer it, it zooms.
      expect(cropHandleAt(box, fitted, { x: 100, y: 196 }, 7, 1)).toEqual({ kind: 'zoom', corner: 0 })
      // An image exactly the window's size: its corners are the window's, and zoom.
      expect(cropHandleAt(box, box, { x: 100, y: 100 }, 7, 1)).toEqual({ kind: 'zoom', corner: 0 })
      expect(cropHandleAt(box, filled, { x: 300, y: 120 }, 7, 1)).toBeNull()
      expect(cropHandleAt(box, filled, { x: 300, y: 120 }, 22, 1)).toEqual({ kind: 'window', handle: 'n' })
    })
  })
})
