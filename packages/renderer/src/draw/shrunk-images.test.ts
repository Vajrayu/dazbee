// Image fills drawn smaller than their pixels: sampled from the image's mipmaps, so a photo shrunk
// a lot keeps its look instead of turning to grain and moiré.
import { describe, expect, it } from 'vitest'

import { loadCanvasKit } from '../node.ts'
import { renderDesign } from '../seam.ts'

const ck = await loadCanvasKit()
const SIDE = 1600

/** A zone plate: grey rings whose frequency rises to the edge, which shows aliasing at a glance. */
function zonePlate(): Uint8Array {
  const pixels = new Uint8Array(SIDE * SIDE * 4)
  for (let y = 0; y < SIDE; y++)
    for (let x = 0; x < SIDE; x++) {
      const r2 = (x - SIDE / 2) ** 2 + (y - SIDE / 2) ** 2
      const v = Math.round(127.5 + 127.5 * Math.cos((Math.PI * r2) / SIDE))
      pixels.set([v, v, v, 255], (y * SIDE + x) * 4)
    }
  const info = {
    width: SIDE,
    height: SIDE,
    colorType: ck.ColorType.RGBA_8888,
    alphaType: ck.AlphaType.Unpremul,
    colorSpace: ck.ColorSpace.SRGB,
  }
  const image = ck.MakeImage(info, pixels, SIDE * 4)
  const png = image?.encodeToBytes()
  image?.delete()
  if (!png) throw new Error('could not make the zone plate')
  return png
}
const plate = zonePlate()
const plateGrey = (() => {
  const image = ck.MakeImageFromEncoded(plate)
  const info = {
    width: SIDE,
    height: SIDE,
    colorType: ck.ColorType.RGBA_8888,
    alphaType: ck.AlphaType.Unpremul,
    colorSpace: ck.ColorSpace.SRGB,
  }
  const pixels = image?.readPixels(0, 0, info) as Uint8Array
  image?.delete()
  return pixels
})()

/** The zone plate drawn as a frame's fill, shrunk to `side` pixels square. */
function drawnAt(side: number) {
  const design = {
    meta: { designId: 'd', name: 'Shrunk' },
    pages: { p: { name: 'P', order: 'a0' } },
    frames: { f: { pageId: 'p', name: 'F', width: side, height: side, x: 0, y: 0, fills: [], order: 'a0' } },
    nodes: {
      photo: {
        type: 'graphic',
        parentId: 'f',
        index: 'a0',
        link: 'photo',
        name: 'Photo',
        props: {
          x: 0,
          y: 0,
          width: side,
          height: side,
          shape: { kind: 'rect' },
          fills: [{ type: 'image', assetId: 'plate', fit: 'fill' }],
        },
      },
    },
  }
  return renderDesign(ck, design, 'f', { fonts: [], fallbackFamilies: [], images: { plate } })
}

/** How close `drawn` is to the exact average of the source pixels each drawn pixel covers, in dB. */
function psnr(drawn: Uint8Array, side: number) {
  const step = SIDE / side
  let error = 0
  for (let y = 0; y < side; y++)
    for (let x = 0; x < side; x++) {
      let sum = 0
      let weight = 0
      const [x0, x1, y0, y1] = [x * step, (x + 1) * step, y * step, (y + 1) * step]
      for (let sy = Math.floor(y0); sy < Math.ceil(y1); sy++)
        for (let sx = Math.floor(x0); sx < Math.ceil(x1); sx++) {
          const w = (Math.min(x1, sx + 1) - Math.max(x0, sx)) * (Math.min(y1, sy + 1) - Math.max(y0, sy))
          sum += (plateGrey[(sy * SIDE + sx) * 4] ?? 0) * w
          weight += w
        }
      error += ((drawn[(y * side + x) * 4] ?? 0) - sum / weight) ** 2
    }
  return 10 * Math.log10(255 ** 2 / (error / (side * side)))
}

describe('renderDesign', () => {
  it('draws a photo shrunk a lot close to the average of the pixels it covers, the same every time', () => {
    // Linear sampling without mipmaps gave 13.8, 9.2 and 15.4 dB.
    for (const [side, least] of [
      [485, 22],
      [320, 24],
      [200, 40],
    ] as const) {
      const { pixels } = drawnAt(side)
      expect(psnr(pixels, side), `${SIDE} shrunk to ${side}`).toBeGreaterThan(least)
    }
    expect(drawnAt(320).png).toEqual(drawnAt(320).png)
    // Five renders of a 1600 px photo and an exact average per pixel: about 1 s alone, past 5 s
    // beside the other workspaces' tests in CI.
  }, 30_000)
})
