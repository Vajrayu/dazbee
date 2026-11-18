import { describe, expect, it } from 'vitest'

import { loadCanvasKit } from '@dazbee/renderer/node'
import type { Paint } from '@dazbee/schema'

import { type ConvertOptions, svgToLayers } from './convert.ts'
import { dataUrl, pngHeader } from './test-pictures.ts'

const ck = await loadCanvasKit()
const svg = (body: string, attrs = 'width="300" height="200"') =>
  `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ${attrs}>${body}</svg>`
const PNG = dataUrl(pngHeader(40, 20))
const r = (v: number) => Math.round(v * 1000) / 1000 + 0
/** The file's graphic layers, each with its box, rotation, first fill and first stroke's paint. */
const read = (text: string, options: ConvertOptions = {}) => {
  const out = svgToLayers(ck, text, options)
  const graphics = Object.values(out.tree.nodes).flatMap((n) =>
    n.type === 'graphic'
      ? [
          {
            name: n.name,
            box: [n.props.x, n.props.y, n.props.width, n.props.height].map(r),
            rotation: r(n.props.rotation),
            fill: n.props.fills[0] as Paint | undefined,
            stroke: n.props.strokes[0]?.paint,
          },
        ]
      : [],
  )
  return { ...out, graphics }
}
const crop = (paint: Paint | undefined) =>
  paint?.type === 'image' && paint.crop
    ? [paint.crop.x, paint.crop.y, paint.crop.width, paint.crop.height].map(r)
    : null
/** A Figma image fill: a 1 × 1 bounding-box pattern holding a <use> of the picture in <defs>, placed by `matrix`. */
const figma = (
  matrix: string,
  shape = '<rect id="Photo" x="20" y="10" width="240" height="180" rx="16" fill="url(#p)"/>',
) =>
  `${shape}<defs><pattern id="p" patternContentUnits="objectBoundingBox" width="1" height="1"><use xlink:href="#img" transform="matrix(${matrix})"/></pattern><image id="img" width="40" height="20" xlink:href="${PNG}"/></defs>`

describe('patternPaint', () => {
  it("reads Figma's image fill as the picture, fill and fit picked only where they place it exactly", () => {
    // Covering the 240 × 180 box: 9 times the picture, 60 px off its left.
    const fill = read(svg(figma('0.0375 0 0 0.05 -0.25 0')), { name: 'Card' })
    expect(fill.graphics).toMatchObject([
      { name: 'Photo', box: [20, 10, 240, 180], fill: { type: 'image', assetId: 'svg-image-1', fit: 'fill' } },
    ])
    expect(crop(fill.graphics[0]?.fill)).toBeNull()
    expect(fill.images).toMatchObject([{ key: 'svg-image-1', width: 40, height: 20, name: 'Photo · Card' }])
    expect(fill.skipped).toEqual([])
    // Inside it, as Figma writes it to 7 digits.
    expect(read(svg(figma('0.025 0 0 0.0333333 0 0.166667'))).graphics[0]?.fill).toMatchObject({ fit: 'fit' })
    // A pixel off covering is a crop.
    const off = read(svg(figma(`0.0375 0 0 0.05 ${-0.25 + 1 / 240} 0`))).graphics[0]?.fill
    expect(off).toMatchObject({ fit: 'crop' })
    expect(crop(off)).toEqual([6.556, 0, 26.667, 20])
    // On a large box, a third of a pixel off is a crop too: 9 × 150 px of picture, from 1,000 px left.
    const large = '<rect id="Large" width="4000" height="3000" fill="url(#p)"/>'
    const big = (dx: number) =>
      read(svg(figma(`0.0375 0 0 0.05 ${-0.25 + dx / 4000} 0`, large), 'width="4000" height="3000"')).graphics[0]?.fill
    expect(big(0)).toMatchObject({ fit: 'fill' })
    expect(big(0.3)).toMatchObject({ fit: 'crop' })
  })

  it("reads Figma's cropped image fill as the same crop of the picture", () => {
    // 480 × 360 of picture, from 120 px left of the box and 45 px above it.
    const out = read(svg(figma('0.05 0 0 0.1 -0.5 -0.25')))
    expect(out.graphics[0]?.fill).toMatchObject({ type: 'image', fit: 'crop' })
    expect(crop(out.graphics[0]?.fill)).toEqual([10, 2.5, 20, 10])
  })

  it('crops a picture the drawing stretches unevenly', () => {
    const out = read(
      svg(`<g transform="scale(2 1)">${figma('0.0375 0 0 0.05 -0.25 0')}</g>`, 'width="600" height="200"'),
    )
    expect(out.graphics[0]).toMatchObject({ box: [40, 10, 480, 180], fill: { fit: 'crop' } })
    expect(crop(out.graphics[0]?.fill)).toEqual([6.667, 0, 26.667, 20])
  })

  it('tiles a picture that repeats upright and evenly, at its scale, its offset dropped, as a fill or a stroke', () => {
    const tile = `<pattern id="t" patternUnits="userSpaceOnUse" x="3" y="2" width="20" height="10"><image width="20" height="10" href="${PNG}"/></pattern>`
    const out = read(
      svg(`<defs>${tile}</defs><rect width="100" height="50" fill="url(#t)" stroke="url(#t)" stroke-width="4"/>`),
    )
    expect(out.graphics[0]).toMatchObject({
      fill: { type: 'image', fit: 'tile', tileScale: 0.5 },
      stroke: { type: 'image', fit: 'tile', tileScale: 0.5 },
    })
    expect(out.images).toHaveLength(1)
    const scaled = read(svg(`<defs>${tile}</defs><rect width="50" height="25" fill="url(#t)" transform="scale(2)"/>`))
    expect(scaled.graphics[0]?.fill).toMatchObject({ fit: 'tile', tileScale: 1 })
  })

  it('bakes a turned shape with an image fill unturned, its gradient stroke in that frame too', () => {
    const gradient =
      '<linearGradient id="g"><stop offset="0" stop-color="#FF0000"/><stop offset="1" stop-color="#0000FF"/></linearGradient>'
    const shape =
      '<rect id="Photo" x="20" y="10" width="240" height="180" fill="url(#p)" stroke="url(#g)" stroke-width="4" transform="rotate(30 140 100)"/>'
    const out = read(svg(`${gradient}${figma('0.0375 0 0 0.05 -0.25 0', shape)}`))
    expect(out.graphics[0]).toMatchObject({
      box: [20, 10, 240, 180],
      rotation: 30,
      fill: { type: 'image', fit: 'fill' },
      stroke: { type: 'linear' },
    })
    // The gradient runs along the unturned rect, left to right.
    const stroke = out.graphics[0]?.stroke
    const ends = stroke?.type === 'linear' ? [stroke.from.x, stroke.from.y, stroke.to.x, stroke.to.y].map(r) : null
    expect(ends).toEqual([0, 0, 1, 0])
    // Turned about a point other than its middle, it lands where the drawing puts it.
    const about = read(svg(`${gradient}${figma('0.0375 0 0 0.05 -0.25 0', shape.replace('140 100', '20 10'))}`))
    const t = Math.PI / 6
    const centre = { x: 20 + 120 * Math.cos(t) - 90 * Math.sin(t), y: 10 + 120 * Math.sin(t) + 90 * Math.cos(t) }
    expect(about.graphics[0]).toMatchObject({ box: [r(centre.x - 120), r(centre.y - 90), 240, 180], rotation: 30 })
  })

  it('falls back to the paint’s colour, or to nothing, for a picture with no asset', () => {
    const fallback = figma('0.0375 0 0 0.05 -0.25 0').replace('fill="url(#p)"', 'fill="url(#p) #FF0000"')
    const out = read(svg(fallback), { assetIds: {} })
    expect(out.graphics[0]?.fill).toEqual({ type: 'solid', color: '#FF0000FF' })
    expect(out.images).toEqual([])
    expect(out.skipped).toEqual([])
    const bare = read(svg(`${figma('0.0375 0 0 0.05 -0.25 0')}<rect width="5" height="5"/>`), { assetIds: {} })
    expect(bare.graphics.map((g) => g.name)).toEqual(['Rectangle'])
    expect(JSON.stringify(bare.tree)).not.toContain('svg-image-')
  })

  it('reports a pattern it can’t place as a picture, drawn with its fallback', () => {
    const cases = {
      'a vector pattern':
        '<pattern id="p" width="10" height="10" patternUnits="userSpaceOnUse"><rect width="5" height="5"/></pattern>',
      'spaced tiles': `<pattern id="p" width="30" height="10" patternUnits="userSpaceOnUse"><image width="20" height="10" href="${PNG}"/></pattern>`,
      'turned tiles': `<pattern id="p" width="20" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(10)"><image width="20" height="10" href="${PNG}"/></pattern>`,
      'two pictures': `<pattern id="p" width="1" height="1"><image width="20" height="10" href="${PNG}"/><image width="20" height="10" href="${PNG}"/></pattern>`,
    }
    for (const [name, pattern] of Object.entries(cases)) {
      const out = read(svg(`<defs>${pattern}</defs><rect width="100" height="50" fill="url(#p) #00FF00"/>`))
      expect(out.skipped, name).toEqual(['pattern'])
      expect(out.graphics[0]?.fill, name).toMatchObject({ type: 'solid', color: '#00FF00FF' })
      expect(out.images, name).toEqual([])
    }
    // A picture sliced inside its pattern shows only part of itself, across or down.
    for (const [name, picture] of Object.entries({ across: PNG, down: dataUrl(pngHeader(20, 40)) })) {
      const sliced = `<pattern id="p" width="200" height="200" patternUnits="userSpaceOnUse"><image width="200" height="200" preserveAspectRatio="xMidYMin slice" href="${picture}"/></pattern>`
      const out = read(svg(`<defs>${sliced}</defs><rect width="200" height="200" fill="url(#p) #00FF00"/>`))
      expect(out.skipped, name).toEqual(['pattern'])
      expect(out.graphics[0]?.fill, name).toMatchObject({ type: 'solid', color: '#00FF00FF' })
      expect(out.images, name).toEqual([])
    }
    const gif = `<pattern id="p" width="1" height="1"><image width="20" height="10" href="data:image/gif;base64,R0lGODlhAQABAAAAACw="/></pattern>`
    expect(read(svg(`<defs>${gif}</defs><rect width="100" height="50" fill="url(#p) #00FF00"/>`)).skipped).toEqual([
      'image',
    ])
  })

  it('lists no picture for a paint nothing shows: a line’s fill, or a stroke of no width', () => {
    for (const [name, shape] of Object.entries({
      line: '<line x1="0" y1="0" x2="100" y2="50" stroke="black" fill="url(#p)"/>',
      'stroke of no width': '<rect width="100" height="50" fill="#000000" stroke="url(#p)" stroke-width="0"/>',
    })) {
      const out = read(svg(figma('0.0375 0 0 0.05 -0.25 0', shape)))
      expect(out.images, name).toEqual([])
      expect(out.graphics, name).toHaveLength(1)
      expect(JSON.stringify(out.tree), name).not.toContain('svg-image-')
    }
  })

  it('reads a pattern number it can’t parse as 0, as resvg does', () => {
    const bad = figma('0.0375 0 0 0.05 -0.25 0').replace('<pattern id="p"', '<pattern id="p" x="abc" y="1px?"')
    const out = read(svg(bad))
    expect(out.skipped).toEqual([])
    expect(out.graphics[0]?.fill).toMatchObject({ type: 'image', fit: 'fill' })
  })

  it('follows a pattern’s href to the pattern it builds on', () => {
    const base = `<pattern id="base" patternContentUnits="objectBoundingBox" width="1" height="1"><use xlink:href="#img" transform="matrix(0.0375 0 0 0.05 -0.25 0)"/></pattern><image id="img" width="40" height="20" xlink:href="${PNG}"/>`
    const out = read(
      svg(
        `<defs>${base}<pattern id="p" href="#base"/></defs><rect x="20" y="10" width="240" height="180" fill="url(#p)"/>`,
      ),
    )
    expect(out.graphics[0]?.fill).toMatchObject({ type: 'image', fit: 'fill' })
  })
})
