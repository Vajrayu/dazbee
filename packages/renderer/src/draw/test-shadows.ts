// What the shadow tests draw and measure with: one-frame designs rendered on the CPU, as exports
// are, and the alpha, reach, bytes and time read from them. Test-only.
import { createHash } from 'node:crypto'

import { expect } from 'vitest'

import type { Canvas } from '@dazbee/canvaskit'
import { holdOf } from '@dazbee/doc/test-holds'
import { FALLBACK_FAMILIES } from '@dazbee/fonts'
import { loadFontFiles } from '@dazbee/fonts/node'

import { loadCanvasKit } from '../node.ts'
import { renderDesign, type Rendered, renderPixels } from '../seam.ts'

export interface TestLayer {
  type: 'graphic' | 'boolean' | 'box' | 'group' | 'text'
  props: Record<string, unknown>
  children?: TestLayer[]
}

/** How many times longer one drawing takes than another, from the fastest run of each, in ms. */
export interface Cost {
  times: number
  ms: number
  than: number
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

/** The timed rounds of `slower`, each drawing both sides once, after one untimed round. */
const ROUNDS = 3

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
 * How many times longer drawing `layers` in `frame` takes than drawing `than` in it, at `scale`
 * times its size: the pixels only, as a raster export draws them before it encodes them.
 *
 * Both are drawn once untimed, so the code they run is compiled, then once each in each of ROUNDS
 * rounds, in turn and in the other order each round, so a busy spell slows both alike; the fastest
 * run of each counts. A run's time is how long it holds the thread (`holdOf`), which leaves out the
 * time a busy machine keeps the thread waiting.
 */
export function slower(layers: TestLayer[], than: TestLayer[], frame: Frame, scale = 1): Cost {
  const bytes = { fonts, fallbackFamilies: [...FALLBACK_FAMILIES], images: {} }
  const draws = [layers, than].map((drawn) => {
    const json = design(drawn, frame)
    return () => void renderPixels(ck, json, 'f', bytes, undefined, scale)
  })
  const fastest = draws.map(() => Infinity)
  for (let round = 0; round <= ROUNDS; round++) {
    for (const run of round % 2 === 0 ? draws : [...draws].reverse()) {
      const ms = holdOf(run)
      const side = draws.indexOf(run)
      if (round > 0) fastest[side] = Math.min(fastest[side] ?? Infinity, ms)
    }
  }
  const [ms = Infinity, thanMs = Infinity] = fastest
  return { times: ms / thanMs, ms, than: thanMs }
}

/** The costs `slower` gave, one line for a test's log: each as its time, how many times, and the time it is compared with. */
export function costsLine(costs: Record<string, Cost>) {
  return Object.entries(costs)
    .map(([name, c]) => `${name} ${c.ms.toFixed(0)} ms = ${c.times.toFixed(2)} × ${c.than.toFixed(0)} ms`)
    .join('; ')
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
