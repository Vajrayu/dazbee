// Flipped layers (`flipX`, `flipY`): what each draws itself is mirrored across its own box's centre
// line, before its rotation, on the CPU surface and in the PDF and SVG exports alike. A frame made
// of the plain frame's layers each mirrored as a flip of the whole frame would leave them draws
// as the plain frame's mirror image; shadows keep the offsets they are set to.
import { afterAll, describe, expect, it } from 'vitest'

import { loadCanvasKit } from '@dazbee/renderer/node'

import { loadFixtures } from './fixtures.ts'
import { comparePixels, fixtureResources, mirrored } from './pixels.ts'
import { renderThreeWays, startPdfium, vectorDifference, vectorLimit } from './vector.ts'

const ck = await loadCanvasKit()
const bytes = fixtureResources()
const pdfium = await startPdfium(afterAll)
const flips = loadFixtures().find((f) => f.name === 'flips')?.json
if (!flips) throw new Error('no flips fixture')
const plain = await renderThreeWays(ck, pdfium, flips, 'plain', bytes)

describe('flipped layers', () => {
  it.each([
    ['flipped-x', 'x'],
    ['flipped-y', 'y'],
  ] as const)(
    '%s draws as the plain frame mirrored on the CPU, and its PDF and SVG as near that as the plain frame’s are to it unmirrored',
    async (frameId, axis) => {
      const flipped = await renderThreeWays(ck, pdfium, flips, frameId, bytes)
      const expected = mirrored(plain.cpu, axis)
      // The text spills out of its box and is translucent, so its offscreen layer must reach the mirrored spill.
      for (const way of ['cpu', 'pdf', 'svg'] as const) {
        const own = vectorDifference(plain.cpu, plain[way])
        expect(vectorDifference(expected, flipped[way]), `${way}, plain at ${own}%`).toBeLessThanOrEqual(
          vectorLimit(own),
        )
      }
    },
  )

  it("draws a flipped layer's drop and inner shadows where their offsets put them, as for its shape mirrored by hand", async () => {
    const flipped = await renderThreeWays(ck, pdfium, flips, 'shadows', bytes)
    const byHand = await renderThreeWays(ck, pdfium, flips, 'by-hand', bytes)
    expect(comparePixels(byHand.cpu, flipped.cpu).differing).toBe(0)
    expect(vectorDifference(byHand.pdf, flipped.pdf), 'pdf').toBe(0)
    expect(vectorDifference(byHand.svg, flipped.svg), 'svg').toBe(0)
  })
})
