import { createHash } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { FALLBACK_FAMILIES } from '@dazbee/fonts'
import { loadFontFiles } from '@dazbee/fonts/node'

import { loadCanvasKit } from '../node.ts'
import { renderDesign } from '../seam.ts'
import { imageBeyond, imagePlacement, imageRect, radialRadius } from './paint.ts'
import { mirrorGap } from './test-mirror.ts'

const ck = await loadCanvasKit()
const fonts = loadFontFiles()

/** A 2:1 image in a square box. */
const image = { width: 2000, height: 1000 }
const box = { x: 100, y: 100, width: 400, height: 400 }

/** A radial from black at its centre to white at its radius. */
const radial = (center: { x: number; y: number }, radius: number) => ({
  type: 'radial',
  center,
  radius,
  stops: [
    { offset: 0, color: '#000000FF' },
    { offset: 1, color: '#FFFFFFFF' },
  ],
})

/** A frame of a size filled with `fill`, drawn on the CPU as exports are. */
const framed = (width: number, height: number, fill: unknown) =>
  renderDesign(
    ck,
    {
      meta: { designId: 'd', name: 'Paints' },
      pages: { p: { name: 'P', order: 'a0' } },
      frames: { f: { pageId: 'p', name: 'F', x: 0, y: 0, order: 'a0', width, height, fills: [fill] } },
      nodes: {},
    },
    'f',
    { fonts, fallbackFamilies: [...FALLBACK_FAMILIES], images: {} },
  )

/** A 4 × 2 PNG of eight colours, none the mirror of another, so a mirrored image shows. */
const quilt = (() => {
  const colours = [
    [255, 0, 0],
    [0, 255, 0],
    [0, 0, 255],
    [255, 255, 0],
    [0, 255, 255],
    [255, 0, 255],
    [40, 40, 40],
    [220, 220, 220],
  ]
  const pixels = Uint8Array.from(colours.flatMap((c) => [...c, 255]))
  const info = {
    width: 4,
    height: 2,
    colorType: ck.ColorType.RGBA_8888,
    alphaType: ck.AlphaType.Unpremul,
    colorSpace: ck.ColorSpace.SRGB,
  }
  const made = ck.MakeImage(info, pixels, 16)
  const png = made?.encodeToBytes()
  made?.delete()
  if (!png) throw new Error('could not make the quilt')
  return png
})()

/** A frame of a size covered by one rect filled with `fill`, flipped as `flips` says, drawn on the CPU. */
const covered = (width: number, height: number, fill: unknown, flips: object = {}) =>
  renderDesign(
    ck,
    {
      meta: { designId: 'd', name: 'Flips' },
      pages: { p: { name: 'P', order: 'a0' } },
      frames: { f: { pageId: 'p', name: 'F', x: 0, y: 0, order: 'a0', width, height } },
      nodes: {
        r: {
          type: 'graphic',
          parentId: 'f',
          link: 'r',
          index: 'a0',
          name: 'R',
          props: { x: 0, y: 0, width, height, shape: { kind: 'rect' }, fills: [fill], ...flips },
        },
      },
    },
    'f',
    { fonts, fallbackFamilies: [...FALLBACK_FAMILIES], images: { quilt } },
  )

describe('paintFor', () => {
  const stops = [
    { offset: 0, color: '#000000FF' },
    { offset: 0.4, color: '#FF3366FF' },
    { offset: 1, color: '#FFFFFFFF' },
  ]
  it.each([
    ['a linear gradient', { type: 'linear', from: { x: 0.1, y: 0.2 }, to: { x: 0.8, y: 0.9 }, stops }],
    ['a radial gradient', { type: 'radial', center: { x: 0.2, y: 0.3 }, radius: 0.6, stops }],
    ['an angular gradient', { type: 'angular', center: { x: 0.3, y: 0.6 }, angle: 30, stops }],
    ['an image', { type: 'image', assetId: 'quilt', fit: 'fill' }],
  ])("mirrors %s with a flipped layer, across the layer's own centre line", (_, fill) => {
    const plain = covered(64, 48, fill)
    expect(mirrorGap(covered(64, 48, fill, { flipX: true }), plain, 'x')).toBeLessThanOrEqual(1)
    expect(mirrorGap(covered(64, 48, fill, { flipY: true }), plain, 'y')).toBeLessThanOrEqual(1)
  })

  it('draws a radial round in a 2:1 box, as grey 50 px above its centre as 50 px to its right', () => {
    const r = framed(400, 200, radial({ x: 0.5, y: 0.5 }, 0.5))
    const red = (x: number, y: number) => r.pixels[(y * r.width + x) * 4] ?? 0
    // Its radius is half the shorter side, 100 px: both pixel centres are 49.5 px out, 126 grey.
    expect(Math.abs(red(199, 50) - red(249, 99))).toBeLessThanOrEqual(1)
    expect(Math.abs(red(249, 99) - 126)).toBeLessThanOrEqual(2)
  })

  it('draws the same bytes as before in a square box', () => {
    const r = framed(300, 300, radial({ x: 0.3, y: 0.6 }, 0.7))
    expect(createHash('sha256').update(r.pixels).digest('hex').slice(0, 16)).toBe('b67b078042119e9b')
  })
})

describe('radialRadius', () => {
  it("is the paint's radius times the box's shorter side, in design pixels", () => {
    expect(radialRadius({ radius: 0.5 }, { width: 400, height: 200 })).toBe(100)
    expect(radialRadius({ radius: 0.25 }, { width: 120, height: 480 })).toBe(30)
  })
})

describe('imagePlacement', () => {
  it('covers the box with fill, centred', () => {
    expect(imagePlacement(image, { fit: 'fill' }, box)).toEqual({ x: -100, y: 100, width: 800, height: 400 })
  })

  it('fits the whole image inside the box with fit, centred', () => {
    expect(imagePlacement(image, { fit: 'fit' }, box)).toEqual({ x: 100, y: 200, width: 400, height: 200 })
  })

  it("stretches crop's rect over the box, past the image too, and places it as fill without one", () => {
    const crop = { x: 500, y: 0, width: 1000, height: 1000 }
    expect(imagePlacement(image, { fit: 'crop', crop }, box)).toEqual({ x: -100, y: 100, width: 800, height: 400 })
    const past = { x: 0, y: -500, width: 2000, height: 2000 }
    expect(imagePlacement(image, { fit: 'crop', crop: past }, box)).toEqual({ x: 100, y: 200, width: 400, height: 200 })
    expect(imagePlacement(image, { fit: 'crop' }, box)).toEqual(imagePlacement(image, { fit: 'fill' }, box))
  })

  it("starts tile's image at the box's corner, at its own size", () => {
    expect(imagePlacement(image, { fit: 'tile' }, box)).toEqual({ x: 100, y: 100, width: 2000, height: 1000 })
  })

  it("sizes tile's image by its tile scale, so at 50 % it repeats twice as often, and no other fit by it", () => {
    expect(imagePlacement(image, { fit: 'tile', tileScale: 0.5 }, box)).toEqual({
      x: 100,
      y: 100,
      width: 1000,
      height: 500,
    })
    expect(imagePlacement(image, { fit: 'fit', tileScale: 0.5 }, box)).toEqual(
      imagePlacement(image, { fit: 'fit' }, box),
    )
  })
})

describe('imageRect', () => {
  it('places the whole image so the crop covers the box', () => {
    expect(imageRect({ x: 500, y: 0, width: 1000, height: 1000 }, image, box)).toEqual({
      x: -100,
      y: 100,
      width: 800,
      height: 400,
    })
  })
})

describe('imageBeyond', () => {
  it('repeats a tile, leaves fit clear, and stretches the edges of fill and a crop inside the image', () => {
    expect(imageBeyond(image, { fit: 'tile' })).toEqual({ x: 'repeat', y: 'repeat' })
    expect(imageBeyond(image, { fit: 'fit' })).toEqual({ x: 'clear', y: 'clear' })
    expect(imageBeyond(image, { fit: 'fill' })).toEqual({ x: 'edge', y: 'edge' })
    expect(imageBeyond(image, { fit: 'crop', crop: { x: 0, y: 0, width: 2000, height: 1000 } })).toEqual({
      x: 'edge',
      y: 'edge',
    })
  })

  it('leaves clear each axis along which a crop reaches past the image', () => {
    expect(imageBeyond(image, { fit: 'crop', crop: { x: -1, y: 0, width: 800, height: 1000 } })).toEqual({
      x: 'clear',
      y: 'edge',
    })
    expect(imageBeyond(image, { fit: 'crop', crop: { x: 0, y: 200, width: 800, height: 900 } })).toEqual({
      x: 'edge',
      y: 'clear',
    })
  })
})
