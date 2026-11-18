// SVG files turned into layers (#225) draw as resvg draws the files themselves: each logo, written
// the way a design tool or icon set writes it, is converted, placed in a frame its own size and
// drawn by the CPU renderer, then compared with resvg's drawing of the original file. A turned
// layer's shadow is checked against Chrome instead, as resvg doesn't turn a filter's offset.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { Resvg } from '@resvg/resvg-js'
import { describe, expect, it } from 'vitest'

import { renderDesign } from '@dazbee/renderer'
import { loadCanvasKit } from '@dazbee/renderer/node'
import { svgToLayers } from '@dazbee/svg'

import { ASSETS_DIR, encodePng, fixtureResources, mirrored, OUTPUT_DIR } from './pixels.ts'
import { vectorDifference } from './vector.ts'

const ck = await loadCanvasKit()
const bytes = fixtureResources()
const LOGOS = join(ASSETS_DIR, 'svg')
/** The share of pixels, in percent, that may differ from resvg's drawing: curves are flattened and anti-aliased differently. */
const LIMIT = 1
/**
 * Files whose share differs from LIMIT, and why. css-colours fills a 100 × 80 ellipse with a radial
 * stretched over it, an ellipse as SVG draws it; a design's radial is round in any box, so the
 * import draws the circle of the same area, 1.17 % of pixels apart. The files whose shadows or
 * pictures are the point have few curves: 0.3 % is low enough that a shadow 3 px off or blurred half
 * as much fails each of them (0.5 % or more), and so do inkscape-shadow.svg's translucent diamond
 * hiding the shadow it shows through and a sliced picture cropped 2 of its pixels off (0.54 %), and
 * mirrored-images.svg with its mirrored pictures left out (20 %).
 * image-patterns.svg samples its picture's edges a little differently from resvg (0.27 %); a crop 2
 * of its pixels off fails it (1.16 %), and so does a tile 10 % too big (11.8 %).
 */
const LIMITS: Record<string, number> = {
  'css-colours.svg': 1.25,
  'figma-shadows.svg': 0.3,
  'figma-photo-card.svg': 0.3,
  'illustrator-shadow.svg': 0.3,
  'inkscape-shadow.svg': 0.3,
  'image-placements.svg': 0.3,
  'mirrored-images.svg': 0.3,
  'image-patterns.svg': 0.5,
}
/** How far, in pixels, a turned layer's shadow may sit from where Chrome draws it. */
const CHROME_DRIFT = 2

/** The file drawn by resvg over white, as the frame is. */
function rasterise(text: string) {
  const image = new Resvg(text, {
    background: '#FFFFFF',
    fitTo: { mode: 'original' },
    font: { loadSystemFonts: false },
  }).render()
  return { width: image.width, height: image.height, pixels: new Uint8Array(image.pixels) }
}

function draw(text: string) {
  const { tree, root, width, height, skipped, images } = svgToLayers(ck, text)
  const nodes = Object.fromEntries(
    Object.entries(tree.nodes).map(([id, node]) => [id, id === root ? { ...node, parentId: 'f', index: 'a0' } : node]),
  )
  const design = {
    meta: { designId: 'd', name: 'Logo' },
    pages: { p1: { name: 'Page', order: 'a0' } },
    frames: {
      f: {
        pageId: 'p1',
        name: 'Logo',
        width: Math.round(width),
        height: Math.round(height),
        x: 0,
        y: 0,
        fills: [{ type: 'solid', color: '#FFFFFFFF' }],
        order: 'a0',
      },
    },
    nodes,
  }
  // The file's pictures are drawn by the keys its paints name.
  const resources = {
    ...bytes,
    images: { ...bytes.images, ...Object.fromEntries(images.map((i) => [i.key, i.bytes])) },
  }
  return { drawn: renderDesign(ck, design, 'f', resources), skipped, layers: Object.keys(nodes).length }
}

describe('SVG files as layers', () => {
  const files = readdirSync(LOGOS)
    .filter((f) => f.endsWith('.svg'))
    .sort()
  it('has the logos to check', () => expect(files.length).toBeGreaterThanOrEqual(8))

  for (const file of files) {
    it(`${file} draws as resvg draws it`, () => {
      const text = readFileSync(join(LOGOS, file), 'utf8')
      const { drawn, skipped, layers } = draw(text)
      const expected = rasterise(text)
      mkdirSync(join(OUTPUT_DIR, 'svg-layers'), { recursive: true })
      writeFileSync(join(OUTPUT_DIR, 'svg-layers', file.replace('.svg', '.layers.png')), encodePng(ck, drawn))
      writeFileSync(join(OUTPUT_DIR, 'svg-layers', file.replace('.svg', '.resvg.png')), encodePng(ck, expected))
      const percent = vectorDifference(expected, drawn)
      console.log(
        `${file}: ${layers} layers, ${percent.toFixed(3)}% differ${skipped.length ? `, left out: ${skipped.join(', ')}` : ''}`,
      )
      expect(skipped).toEqual([])
      expect(percent).toBeLessThan(LIMITS[file] ?? LIMIT)
    })
  }
})

describe('A mirrored text', () => {
  /** A line of words, as the file writes it, in a transform. */
  const words = (transform: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="160">
    <text x="30" y="70" font-size="48" font-family="Noto Sans" fill="#E0115F" transform="${transform}">Sale 50%</text></svg>`

  it.each([
    ['across', 'translate(320 0) scale(-1 1)', 'x'],
    ['upside down', 'translate(0 160) scale(1 -1)', 'y'],
  ] as const)('drawn %s draws as the plain one mirrored', (_, transform, axis) => {
    const plain = draw(words('')).drawn
    const flipped = draw(words(transform)).drawn
    expect(vectorDifference(mirrored(plain, axis), flipped)).toBeLessThan(0.1)
  })
})

describe("A turned layer's shadow", () => {
  /** A shape in red, its unblurred blue shadow 50 or 60 down its own turned frame, and where Chrome drew it. */
  const turned = {
    'a turned rectangle': {
      file: `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="200">
      <filter id="s" x="-200%" y="-200%" width="500%" height="500%" color-interpolation-filters="sRGB"><feDropShadow dx="0" dy="50" stdDeviation="0" flood-color="#0000FF"/></filter>
      <rect x="60" y="40" width="60" height="40" fill="#FF0000" transform="rotate(35 90 60)" filter="url(#s)"/></svg>`,
      chrome: { x: -28.7, y: 41.0 },
    },
    'a turned text': {
      file: `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="200">
      <filter id="t" x="-500%" y="-500%" width="1100%" height="1100%" color-interpolation-filters="sRGB"><feDropShadow dx="0" dy="60" stdDeviation="0" flood-color="#0000FF"/></filter>
      <text x="40" y="50" font-size="40" font-family="Noto Sans" fill="#FF0000" transform="rotate(30 40 50)" filter="url(#t)">Sale</text></svg>`,
      chrome: { x: -30.5, y: 51.8 },
    },
  }
  /** From the middle of the red pixels to the middle of the blue ones. */
  function shadowOffset({ width, height, pixels }: { width: number; height: number; pixels: Uint8Array }) {
    const sums = { red: [0, 0, 0], blue: [0, 0, 0] }
    for (let i = 0; i < width * height; i++) {
      const [r = 0, g = 0, b = 0] = pixels.subarray(i * 4, i * 4 + 3)
      const sum = r > 200 && g < 60 && b < 60 ? sums.red : b > 200 && r < 60 && g < 60 ? sums.blue : null
      if (!sum) continue
      sum[0] = (sum[0] ?? 0) + (i % width)
      sum[1] = (sum[1] ?? 0) + Math.floor(i / width)
      sum[2] = (sum[2] ?? 0) + 1
    }
    const middle = ([x = 0, y = 0, n = 1]: number[]) => ({ x: x / n, y: y / n })
    const [red, blue] = [middle(sums.red), middle(sums.blue)]
    return { x: blue.x - red.x, y: blue.y - red.y }
  }

  for (const [name, { file, chrome }] of Object.entries(turned)) {
    it(`falls where Chrome draws it, on ${name}`, () => {
      const { drawn, skipped } = draw(file)
      expect(skipped).toEqual([])
      const offset = shadowOffset(drawn)
      expect(Math.hypot(offset.x - chrome.x, offset.y - chrome.y)).toBeLessThan(CHROME_DRIFT)
    })
  }
})
