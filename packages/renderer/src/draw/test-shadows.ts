// What the shadow tests draw and measure with: one-frame designs rendered on the CPU, as exports
// are, and the alpha, reach, bytes and time read from them. Test-only.
import { createHash } from 'node:crypto'

import { expect } from 'vitest'

import type { Canvas } from '@dazbee/canvaskit'
import { FALLBACK_FAMILIES } from '@dazbee/fonts'
import { loadFontFiles } from '@dazbee/fonts/node'

import { loadCanvasKit } from '../node.ts'
import { renderDesign, type Rendered } from '../seam.ts'

export interface TestLayer {
  type: 'graphic' | 'boolean' | 'box' | 'group' | 'text'
  props: Record<string, unknown>
  children?: TestLayer[]
}

interface Frame {
  width: number
  height: number
  fills?: unknown[]
}

// Above the exported constants: the images among them are drawn with it as the module loads.
const ck = await loadCanvasKit()
const fonts = loadFontFiles()

export const BLACK = '#000000FF'
export const WHITE = '#FFFFFFFF'

export const solid = (color: string, opacity?: number) => ({
  type: 'solid',
  color,
  ...(opacity === undefined ? {} : { opacity }),
})

export const shadow = (spread: number, more: Record<string, unknown> = {}) => ({
  type: 'dropShadow',
  x: 0,
  y: 0,
  blur: 0,
  spread,
  color: BLACK,
  ...more,
})

export const graphic = (shape: Record<string, unknown>, props: Record<string, unknown>): TestLayer => ({
  type: 'graphic',
  props: { shape, fills: [solid(WHITE)], ...props },
})

export const at200 = { x: 200, y: 200, width: 200, height: 200 }

export const pixel = ({ width, pixels }: Rendered, x: number, y: number) => [
  ...pixels.subarray((y * width + x) * 4, (y * width + x) * 4 + 4),
]

export const hash = (r: Rendered) => createHash('sha256').update(r.pixels).digest('hex').slice(0, 16)

/** An encoded image of a size drawn by `paint`, as PNG, or JPEG (which decodes opaque). */
function encoded(width: number, height: number, paint: (canvas: Canvas) => void, jpeg = false) {
  const surface = ck.MakeSurface(width, height)
  if (!surface) throw new Error('no surface')
  const canvas = surface.getCanvas()
  canvas.clear(ck.TRANSPARENT)
  paint(canvas)
  const image = surface.makeImageSnapshot()
  const bytes = jpeg ? image.encodeToBytes(ck.ImageFormat.JPEG, 90) : image.encodeToBytes()
  image.delete()
  surface.dispose()
  if (!bytes) throw new Error('could not encode')
  return bytes
}

/** A disc on clear, as a PNG: a cutout, whose pixels have alpha. */
export const cutout = encoded(200, 200, (canvas) => {
  const paint = new ck.Paint()
  paint.setColor(ck.Color(200, 40, 40, 1))
  canvas.drawCircle(100, 100, 70, paint)
  paint.delete()
})

/** A photo with no alpha, as a JPEG. */
export const photo = encoded(
  200,
  200,
  (canvas) => {
    const paint = new ck.Paint()
    paint.setColor(ck.Color(30, 120, 200, 1))
    canvas.drawRect(ck.XYWHRect(0, 0, 200, 200), paint)
    paint.setColor(ck.Color(240, 200, 40, 1))
    canvas.drawCircle(100, 100, 60, paint)
    paint.delete()
  },
  true,
)

export function draw(
  layers: TestLayer[],
  frame: Frame = { width: 600, height: 600 },
  images: Record<string, Uint8Array> = {},
) {
  return renderDesign(ck, design(layers, frame), 'f', { fonts, fallbackFamilies: [...FALLBACK_FAMILIES], images })
}

/** The alpha at a point, blended between the four nearest pixel centres. */
export function alphaAt({ width, height, pixels }: Rendered, x: number, y: number) {
  const px = x - 0.5
  const py = y - 0.5
  const x0 = Math.floor(px)
  const y0 = Math.floor(py)
  const at = (ix: number, iy: number) =>
    ix < 0 || iy < 0 || ix >= width || iy >= height ? 0 : (pixels[(iy * width + ix) * 4 + 3] ?? 0)
  const fx = px - x0
  const fy = py - y0
  const top = at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx
  const bottom = at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx
  return top * (1 - fy) + bottom * fy
}

/** Checks `value` is within a pixel of `expected`. */
export function expectNear(value: number, expected: number) {
  expect(value).toBeGreaterThanOrEqual(expected - 1)
  expect(value).toBeLessThanOrEqual(expected + 1)
}

/** How far from (x, y) along the direction (dx, dy) the drawing stays at least half opaque. */
export function reach(r: Rendered, x: number, y: number, dx: number, dy: number) {
  const length = Math.hypot(dx, dy)
  let last = 0
  for (let t = 0; t < 1000; t += 0.05) {
    if (alphaAt(r, x + (t * dx) / length, y + (t * dy) / length) < 127.5) break
    last = t
  }
  return last
}

/** How many pixels in the rect from (x, y), `width` × `height`, have any alpha. */
export function covered(r: Rendered, x: number, y: number, width: number, height: number) {
  let count = 0
  for (let j = y; j < y + height; j++) for (let i = x; i < x + width; i++) if ((pixel(r, i, j)[3] ?? 0) > 0) count++
  return count
}

export function largestDifference(a: Rendered, b: Rendered) {
  let most = 0
  for (let i = 0; i < a.pixels.length; i++) most = Math.max(most, Math.abs((a.pixels[i] ?? 0) - (b.pixels[i] ?? 0)))
  return most
}

/**
 * How many times longer `spread` takes than `zero`: each the fastest of `runs` after one to warm
 * up, run in turn, so a busy machine slows both alike.
 */
export function slower(spread: () => void, zero: () => void, runs: number) {
  const fastest = [Infinity, Infinity]
  for (let i = 0; i <= runs; i++) {
    for (const [j, run] of [spread, zero].entries()) {
      const start = performance.now()
      run()
      if (i > 0) fastest[j] = Math.min(fastest[j] ?? Infinity, performance.now() - start)
    }
  }
  return (fastest[0] ?? 0) / (fastest[1] ?? 1)
}

/** A design of one frame holding `layers`, as the schema reads it. */
function design(layers: TestLayer[], frame: Frame) {
  const nodes: Record<string, unknown> = {}
  let count = 0
  const add = (layer: TestLayer, parentId: string, i: number) => {
    const id = `n${count++}`
    const index = `a${String(i).padStart(3, '0')}`
    nodes[id] = { type: layer.type, parentId, index, link: id, name: id, props: layer.props }
    layer.children?.forEach((child, j) => add(child, id, j))
  }
  layers.forEach((layer, i) => add(layer, 'f', i))
  return {
    meta: { designId: 'd', name: 'Shadows' },
    pages: { p: { name: 'P', order: 'a0' } },
    frames: { f: { pageId: 'p', name: 'F', x: 0, y: 0, order: 'a0', fills: [], ...frame } },
    nodes,
  }
}
