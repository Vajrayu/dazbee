// Variable fonts (the fonts ticket, step 4): a text in a variable font draws at the weight it asks
// for on the CPU surface, in a PDF (Skia writes its glyphs as shapes) and in an SVG, where without
// the weight axis set every weight drew the font's default one.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { PDFiumLibrary } from '@hyzyla/pdfium'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { variableTestFont } from '@dazbee/fonts/test-fonts'
import { renderDesign, renderVector, type ResourceBytes } from '@dazbee/renderer'
import { loadCanvasKit } from '@dazbee/renderer/node'

import { fixtureResources, OUTPUT_DIR, type Pixels } from './pixels.ts'
import { pdfText, rasterisePdf, rasteriseSvg, startPdfium } from './vector.ts'

const ck = await loadCanvasKit()
const WORDS = 'Weight Hamburger'

/** One text in Vary Sans at `weight`, on white. */
const design = (weight: number) => ({
  meta: { designId: 'vary', name: 'Vary' },
  pages: { p1: { name: 'Page 1', order: 'a0' } },
  frames: {
    sq: {
      pageId: 'p1',
      name: 'Post',
      width: 640,
      height: 120,
      x: 0,
      y: 0,
      fills: [{ type: 'solid', color: '#FFFFFFFF' }],
      order: 'a0',
    },
  },
  nodes: {
    t: {
      type: 'text',
      parentId: 'sq',
      link: 't',
      index: 'a0',
      name: 'Words',
      props: {
        x: 16,
        y: 24,
        width: 608,
        height: 72,
        boxMode: 'fixed',
        text: WORDS,
        style: { fontFamily: 'Vary Sans', fontSize: 56, fontWeight: weight, color: '#15121AFF' },
      },
    },
  },
})

const resources = (): ResourceBytes => {
  const shipped = fixtureResources()
  return { ...shipped, fonts: [...shipped.fonts, { family: 'Vary Sans', bytes: variableTestFont() }] }
}

/** How much ink is drawn: the darkness summed over every pixel, in whole pixels of black. */
function ink({ pixels }: Pick<Pixels, 'pixels'>) {
  let sum = 0
  for (let i = 0; i < pixels.length; i += 4) sum += 255 - (pixels[i] ?? 255)
  return sum / 255
}

let pdfium: PDFiumLibrary
let free = () => {}
beforeAll(async () => {
  mkdirSync(OUTPUT_DIR, { recursive: true })
  pdfium = await startPdfium((f) => (free = f))
})
afterAll(() => free())

describe('variable fonts', () => {
  it('draw each weight on the CPU surface, heavier as the weight grows', () => {
    const drawn = [100, 400, 700, 900].map((w) => renderDesign(ck, design(w), 'sq', resources()))
    drawn.forEach((d, i) => writeFileSync(join(OUTPUT_DIR, `variable-${[100, 400, 700, 900][i]}.png`), d.png))
    const [thin, regular, bold, black] = drawn.map(ink) as [number, number, number, number]
    expect(thin).toBeLessThan(regular * 0.6)
    expect(bold).toBeGreaterThan(regular * 1.3)
    expect(black).toBeGreaterThan(bold * 1.1)
  })

  it('draw each weight in a PDF, whose text reads back, and in an SVG', async () => {
    for (const target of ['pdf', 'svg'] as const) {
      const [regular, black] = await Promise.all(
        [400, 900].map(async (w) => {
          const bytes = renderVector(ck, design(w), 'sq', resources(), target)
          writeFileSync(join(OUTPUT_DIR, `variable-${w}.${target}`), bytes)
          return ink(target === 'pdf' ? await rasterisePdf(pdfium, bytes) : rasteriseSvg(bytes))
        }),
      )
      expect(black, target).toBeGreaterThan((regular ?? 0) * 1.5)
    }
    const pdf = renderVector(ck, design(900), 'sq', resources(), 'pdf')
    expect((await pdfText(pdfium, pdf)).replace(/\s+/g, ' ').trim()).toBe(WORDS)
  })
})
