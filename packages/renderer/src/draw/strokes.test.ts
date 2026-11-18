import { describe, expect, it } from 'vitest'

import { FALLBACK_FAMILIES } from '@dazbee/fonts'
import { loadFontFiles } from '@dazbee/fonts/node'

import { loadCanvasKit } from '../node.ts'
import { renderDesign } from '../seam.ts'
import { mirrorGap } from './test-mirror.ts'

const ck = await loadCanvasKit()
const fonts = loadFontFiles()

const WIDTH = 240
const HEIGHT = 80

/** A frame holding one line across its middle, with an arrow at its start and a circle at its end, dashed. */
const lined = (flips: object = {}) =>
  renderDesign(
    ck,
    {
      meta: { designId: 'd', name: 'Lines' },
      pages: { p: { name: 'P', order: 'a0' } },
      frames: { f: { pageId: 'p', name: 'F', x: 0, y: 0, order: 'a0', width: WIDTH, height: HEIGHT } },
      nodes: {
        l: {
          type: 'graphic',
          parentId: 'f',
          link: 'l',
          index: 'a0',
          name: 'L',
          props: {
            x: 20,
            y: 20,
            width: 200,
            height: 40,
            shape: { kind: 'line', start: 'arrow', end: 'triangle' },
            strokes: [{ paint: { type: 'solid', color: '#202020FF' }, width: 6, dashes: [30, 10, 5] }],
            ...flips,
          },
        },
      },
    },
    'f',
    { fonts, fallbackFamilies: [...FALLBACK_FAMILIES], images: {} },
  )

describe('strokePath', () => {
  it("draws a line flipped across its box's vertical centre line as its mirror, its ends and dashes swapping sides, and across its horizontal one as it was", () => {
    // The line's box is centred in the frame, so mirroring the frame mirrors the line in place.
    const plain = lined()
    expect(mirrorGap(plain, plain, 'x'), 'the line is not its own mirror').toBeGreaterThan(8)
    expect(mirrorGap(lined({ flipX: true }), plain, 'x')).toBeLessThanOrEqual(8)
    // Its ends are symmetric about its horizontal centre line, so flipped across that it is as it was.
    expect(lined({ flipY: true }).pixels).toEqual(plain.pixels)
  })
})
