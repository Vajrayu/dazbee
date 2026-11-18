// A display copy, smaller than its image, drawn by its image's own size: placed, cropped and tiled
// where the image itself would be.
import { describe, expect, it } from 'vitest'

import { parseDesign } from '@dazbee/schema'

import { loadCanvasKit } from '../node.ts'
import { resourceCache, type Resources } from '../resources.ts'
import { render } from '../scene.ts'
import { drawScene } from './draw.ts'

const ck = await loadCanvasKit()
const [W, H] = [800, 600]
const info = (width: number, height: number) => ({
  width,
  height,
  colorType: ck.ColorType.RGBA_8888,
  alphaType: ck.AlphaType.Unpremul,
  colorSpace: ck.ColorSpace.SRGB,
})

/** An 800 × 600 image of smooth colour bands, so where it is placed shows in every pixel. */
const photo = (() => {
  const pixels = new Uint8Array(W * H * 4)
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      pixels.set([(x * 255) / W, (y * 255) / H, ((x + y) * 127) / (W + H), 255], (y * W + x) * 4)
  const image = ck.MakeImage(info(W, H), pixels, W * 4)
  const png = image?.encodeToBytes()
  image?.delete()
  if (!png) throw new Error('could not make the photo')
  return png
})()

const layer = (name: string, index: string, x: number, y: number, fill: Record<string, unknown>) => ({
  type: 'graphic',
  parentId: 'f',
  index,
  link: name,
  name,
  props: {
    x,
    y,
    width: 90,
    height: 120,
    shape: { kind: 'rect' },
    fills: [{ type: 'image', assetId: 'photo', ...fill }],
  },
})
const design = {
  meta: { designId: 'd', name: 'Copies' },
  pages: { p: { name: 'P', order: 'a0' } },
  frames: { f: { pageId: 'p', name: 'F', width: 420, height: 140, x: 0, y: 0, fills: [], order: 'a0' } },
  nodes: {
    fill: layer('fill', 'a0', 10, 10, { fit: 'fill' }),
    fit: layer('fit', 'a1', 110, 10, { fit: 'fit' }),
    crop: layer('crop', 'a2', 210, 10, { fit: 'crop', crop: { x: 500, y: 100, width: 150, height: 200 } }),
    tile: layer('tile', 'a3', 310, 10, { fit: 'tile' }),
  },
}

/** The frame drawn with the photo decoded as given, its own size given or not. */
function drawn(copySide: number | null, sized: boolean) {
  const cache = resourceCache(ck)
  try {
    const resources = cache.resources({ fonts: [], fallbackFamilies: [], images: { photo } })
    let image = resources.images.get('photo')
    if (copySide !== null && image) {
      const [width, height] = [copySide, (copySide * H) / W]
      const surface = ck.MakeSurface(width, height)
      surface
        ?.getCanvas()
        .drawImageRectOptions(
          image,
          ck.XYWHRect(0, 0, W, H),
          ck.XYWHRect(0, 0, width, height),
          ck.FilterMode.Linear,
          ck.MipmapMode.Nearest,
          null,
        )
      const pixels = surface?.getCanvas().readPixels(0, 0, info(width, height))
      surface?.dispose()
      image = ck.MakeImage(info(width, height), pixels as Uint8Array, width * 4) ?? undefined
    }
    if (!image) throw new Error('no photo')
    const withCopy: Resources = {
      ...resources,
      images: new Map([['photo', image]]),
      ...(sized ? { imageSizes: new Map([['photo', { width: W, height: H }]]) } : {}),
    }
    const surface = ck.MakeSurface(420, 140)
    if (!surface) throw new Error('no surface')
    const parsed = parseDesign(design)
    if (!parsed.success) throw new Error(parsed.errors.join('\n'))
    drawScene(ck, surface.getCanvas(), render(parsed.design, 'f'), withCopy)
    const pixels = surface.getCanvas().readPixels(0, 0, info(420, 140)) as Uint8Array
    surface.dispose()
    if (copySide !== null) image.delete()
    return { pixels }
  } finally {
    cache.delete()
  }
}

describe('renderDesign', () => {
  it('draws a display copy by its image’s own size: fill, fit, crop and tile land as the image’s own', () => {
    const own = drawn(null, false).pixels
    expect(own.filter((v, i) => i % 4 === 3 && v === 255).length).toBeGreaterThan(30_000)
    const differing = (pixels: Uint8Array) => {
      let count = 0
      for (let i = 0; i < own.length; i++) if (Math.abs((pixels[i] ?? 0) - (own[i] ?? 0)) > 6) count++
      return count
    }
    // A 400-pixel copy is more than these 90-pixel boxes draw of it: only a few edge pixels differ.
    expect(differing(drawn(400, true).pixels)).toBeLessThan(own.length / 200)
    // Without its own size, the copy's crop and tile land elsewhere.
    expect(differing(drawn(400, false).pixels)).toBeGreaterThan(5_000)
  })
})
