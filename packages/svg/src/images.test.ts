import { describe, expect, it } from 'vitest'

import { loadCanvasKit } from '@dazbee/renderer/node'
import type { ImagePaint } from '@dazbee/schema'

import { type ConvertOptions, svgToLayers } from './convert.ts'
import { dataUrl, gifHeader, jpegHeader, pngHeader } from './test-pictures.ts'

const ck = await loadCanvasKit()
const svg = (body: string, attrs = 'width="100" height="100"') =>
  `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>`
const PNG = dataUrl(pngHeader(40, 20))
/** The file's layers, its pictures and what it left out. */
const read = (text: string, options: ConvertOptions = {}) => {
  const out = svgToLayers(ck, text, options)
  const list = Object.values(out.tree.nodes)
  const pictured = list.filter((n) => n.type === 'graphic' && n.props.fills.some((f) => f.type === 'image'))
  return { ...out, list, pictured }
}
/** Each pictured layer's box, rounded to a thousandth, with its rotation and image fill. */
const placed = (text: string, options: ConvertOptions = {}) =>
  read(text, options).pictured.map((n) => {
    const r = (v: number) => Math.round(v * 1000) / 1000
    const fill = (n.type === 'graphic' ? n.props.fills[0] : undefined) as ImagePaint
    return {
      box: [r(n.props.x), r(n.props.y), r(n.props.width), r(n.props.height)],
      rotation: r(n.props.rotation),
      fit: fill.fit,
      crop: fill.crop ? [fill.crop.x, fill.crop.y, fill.crop.width, fill.crop.height].map(r) : undefined,
      assetId: fill.assetId,
    }
  })
const image = (attrs: string, href = PNG) => `<image href="${href}" ${attrs}/>`

describe('imageLayer', () => {
  it('places a file of one picture as a rect filled with it, the picture listed under a key', () => {
    const out = read(svg(image('id="Photo" x="10" y="10" width="40" height="20"')), { name: 'Logo' })
    expect(out.pictured).toMatchObject([
      {
        type: 'graphic',
        name: 'Photo',
        props: {
          x: 10,
          y: 10,
          width: 40,
          height: 20,
          shape: { kind: 'rect' },
          fills: [{ type: 'image', assetId: 'svg-image-1', fit: 'fill' }],
        },
      },
    ])
    expect(out.images).toEqual([
      {
        key: 'svg-image-1',
        bytes: pngHeader(40, 20),
        contentType: 'image/png',
        width: 40,
        height: 20,
        name: 'Photo · Logo',
      },
    ])
    expect(out.skipped).toEqual([])
  })

  it('places the picture as preserveAspectRatio says, filling the box where that draws it the same', () => {
    const at = (aspect: string) => placed(svg(image(`width="60" height="60" preserveAspectRatio="${aspect}"`)))[0]
    expect(at('xMidYMid meet')).toMatchObject({ box: [0, 15, 60, 30], fit: 'fill', crop: undefined })
    expect(at('xMidYMid slice')).toMatchObject({ box: [0, 0, 60, 60], fit: 'fill', crop: undefined })
    expect(at('xMinYMax meet')).toMatchObject({ box: [0, 30, 60, 30], fit: 'fill' })
    expect(at('xMaxYMin slice')).toMatchObject({ box: [0, 0, 60, 60], fit: 'crop', crop: [20, 0, 20, 20] })
    expect(at('none')).toMatchObject({ box: [0, 0, 60, 60], fit: 'crop', crop: [0, 0, 40, 20] })
    // Without a width or height, the picture's own size.
    expect(placed(svg(image('x="5"')))[0]).toMatchObject({ box: [5, 0, 40, 20], fit: 'fill' })
  })

  it('crops exactly under an uneven scale, from a transform, a root viewBox or a symbol', () => {
    expect(placed(svg(image('width="40" height="20" transform="scale(1.6 1)"')))[0]).toMatchObject({
      box: [0, 0, 64, 20],
      fit: 'crop',
      crop: [0, 0, 40, 20],
    })
    const slice = image('width="60" height="60" preserveAspectRatio="xMidYMid slice" transform="scale(2 1)"')
    expect(placed(svg(slice))[0]).toMatchObject({ box: [0, 0, 120, 60], fit: 'crop', crop: [10, 0, 20, 20] })
    const root = 'width="200" height="100" viewBox="0 0 100 100" preserveAspectRatio="none"'
    expect(placed(svg(image('width="40" height="20"'), root))[0]).toMatchObject({ box: [0, 0, 80, 20], fit: 'crop' })
    const symbol = `<symbol id="s" viewBox="0 0 40 20" preserveAspectRatio="none">${image('width="40" height="20"')}</symbol><use href="#s" width="80" height="80"/>`
    expect(placed(svg(symbol))[0]).toMatchObject({ box: [0, 0, 80, 80], fit: 'crop', crop: [0, 0, 40, 20] })
  })

  it('turns the picture with its box, and keeps a shadow on it in its own unturned frame', () => {
    const shadow = '<filter id="s"><feDropShadow dx="0" dy="4" stdDeviation="2"/></filter>'
    const text = svg(`${shadow}${image('width="40" height="20" transform="rotate(30 20 10)" filter="url(#s)"')}`)
    expect(placed(text)[0]).toMatchObject({ box: [0, 0, 40, 20], rotation: 30, fit: 'fill' })
    expect(read(text).pictured[0]?.props.effects).toMatchObject([{ type: 'dropShadow', x: 0, y: 4 }])
  })

  it('reads a picture written with parameters, BASE64 in capitals, or broken over lines, and each picture once', () => {
    const base64 = Buffer.from(pngHeader(40, 20)).toString('base64')
    const hrefs = [
      `data:image/png;charset=utf-8;base64,${base64}`,
      `data:image/png;BASE64,${base64}`,
      `data:image/png;base64,${base64.slice(0, 10)}&#10;  ${base64.slice(10)}`,
      `data:;base64,${base64}`,
    ]
    for (const href of hrefs) expect(read(svg(image('', href))).images, href).toHaveLength(1)
    // Percent-encoded, as the data URL standard reads it: padding, a letter and line breaks.
    const padded = Buffer.from([...pngHeader(40, 20), 0]).toString('base64')
    expect(padded.endsWith('==')).toBe(true)
    const encoded = [
      `data:image/png;base64,${padded.replace(/=/g, '%3D')}`,
      `data:image/png;base64,%${padded.charCodeAt(0).toString(16)}${padded.slice(1, 20)}%0A${padded.slice(20)}`,
    ]
    for (const href of encoded) {
      const out = read(svg(image('', href)))
      expect(
        out.images.map((i) => [i.width, i.height]),
        href,
      ).toEqual([[40, 20]])
      expect(out.skipped, href).toEqual([])
    }
    const twice = read(svg(`${image('')}${image('x="50"')}`))
    expect(twice.images).toHaveLength(1)
    expect(twice.pictured.map((n) => n.type === 'graphic' && n.props.fills[0])).toMatchObject([
      { assetId: 'svg-image-1' },
      { assetId: 'svg-image-1' },
    ])
  })

  it('scales the boxes with the file when it is fitted to a size', () => {
    expect(placed(svg(image('x="10" y="10" width="40" height="20"')), { fit: 200 })[0]).toMatchObject({
      box: [20, 20, 80, 40],
    })
  })

  it('writes the asset ids it is given for the keys, and leaves out a picture with none, keys kept', () => {
    const other = dataUrl(jpegHeader(30, 30), 'image/jpeg')
    const text = svg(`${image('id="A"')}${image('id="B" x="50"', other)}`)
    expect(read(text).images.map((i) => [i.key, i.contentType])).toEqual([
      ['svg-image-1', 'image/png'],
      ['svg-image-2', 'image/jpeg'],
    ])
    const out = read(text, { assetIds: { 'svg-image-2': 'asset-b' } })
    // Only the pictures a layer shows are listed, under the keys they had.
    expect(out.images.map((i) => i.key)).toEqual(['svg-image-2'])
    expect(out.pictured).toMatchObject([{ name: 'B', props: { fills: [{ assetId: 'asset-b' }] } }])
    // No paint placed keeps a key.
    expect(JSON.stringify(out.tree)).not.toContain('svg-image-')
  })

  it('reads a picture only for a layer that shows it, and draws one sized auto at its own size', () => {
    for (const attrs of ['width="0"', 'height="0"', 'width="-5"']) {
      const out = read(svg(`${image(attrs)}<rect width="5" height="5"/>`))
      expect(out.images, attrs).toEqual([])
      expect(out.pictured, attrs).toEqual([])
    }
    expect(placed(svg(image('x="5" width="auto" height="auto"')))[0]).toMatchObject({ box: [5, 0, 40, 20] })
    expect(placed(svg(image('width="auto" height="40"')))[0]).toMatchObject({ box: [0, 10, 40, 20] })
  })

  it('places pictures inside a mask, a symbol drawn through its viewBox and a nested svg', () => {
    const masked = read(svg(`<mask id="m">${image('')}</mask><rect width="80" height="80" mask="url(#m)"/>`))
    const mask = masked.list.find((n) => n.props.mask === 'luminance')
    expect(masked.pictured).toHaveLength(1)
    expect(masked.pictured[0]?.parentId).toBe(Object.entries(masked.tree.nodes).find(([, n]) => n === mask)?.[0])
    const symbol = `<symbol id="s" viewBox="0 0 20 10">${image('width="20" height="10"')}</symbol><use href="#s" width="40" height="20"/>`
    expect(placed(svg(symbol))[0]).toMatchObject({ box: [0, 0, 40, 20] })
    const nested = `<svg x="10" y="10" width="40" height="20" viewBox="0 0 20 10">${image('width="20" height="10"')}</svg>`
    expect(placed(svg(nested))[0]).toMatchObject({ box: [10, 10, 40, 20] })
  })

  it('names a linked picture as a link to another file, and never reads it', () => {
    for (const href of ['https://example.com/a.png', 'photo.png', 'file:///tmp/a.png']) {
      const out = read(svg(`${image('', href)}<rect width="5" height="5"/>`))
      expect(out.skipped, href).toEqual(['external-reference'])
      expect(out.images, href).toEqual([])
    }
  })

  it('keeps a mirrored picture as its box flipped, the turn what is left once the mirror is taken out', () => {
    const at = 'x="10" y="10" width="40" height="20"'
    const flipsOf = (transform: string) =>
      read(svg(image(`${at} transform="${transform}"`))).pictured.map((n) => ({
        x: Math.round(n.props.x * 1000) / 1000,
        y: Math.round(n.props.y * 1000) / 1000,
        rotation: Math.round(n.props.rotation * 1000) / 1000,
        flipX: 'flipX' in n.props ? n.props.flipX : undefined,
        flipY: 'flipY' in n.props ? n.props.flipY : undefined,
      }))
    expect(flipsOf('translate(100 0) scale(-1 1)')).toEqual([
      { x: 50, y: 10, rotation: 0, flipX: true, flipY: undefined },
    ])
    expect(flipsOf('translate(0 100) scale(1 -1)')).toEqual([
      { x: 10, y: 70, rotation: 0, flipX: undefined, flipY: true },
    ])
    // Mirrored across, its centre at (-30, 20), then turned a quarter about the origin, to (-20, -30).
    expect(flipsOf('rotate(90) scale(-1 1)')).toEqual([{ x: -40, y: -40, rotation: 90, flipX: true, flipY: undefined }])
  })

  it('names as left out a picture it cannot place or read', () => {
    const svgBytes = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')
    const cases = {
      skewed: image('transform="skewX(20)"'),
      'a GIF': image('', dataUrl(gifHeader(10, 10), 'image/gif')),
      'an SVG': image('', dataUrl(svgBytes, 'image/svg+xml')),
      'not base64': image('', 'data:image/png,abc'),
      'base64 garbage': image('', 'data:image/png;base64,!!!*'),
      'bytes that are no picture': image('', dataUrl(new Uint8Array(64).fill(7))),
      'too big to decode': image('', dataUrl(pngHeader(20_000, 1))),
    }
    for (const [name, body] of Object.entries(cases)) {
      const out = read(svg(`${body}<rect width="5" height="5"/>`))
      expect(out.skipped, name).toEqual(['image'])
      expect(out.pictured, name).toEqual([])
      expect(out.images, name).toEqual([])
    }
  })

  it('keeps at most 50 pictures and 100 million pixels a file, in reading order', () => {
    const many = Array.from({ length: 51 }, (_, i) => image('', dataUrl(pngHeader(i + 1, 1)))).join('')
    const out = read(svg(many))
    expect(out.images).toHaveLength(50)
    expect(out.images.at(-1)?.width).toBe(50)
    expect(out.skipped).toEqual(['image'])
    const big = read(
      svg(`${image('', dataUrl(pngHeader(10_000, 6_000)))}${image('', dataUrl(pngHeader(6_000, 10_000)))}`),
    )
    expect(big.images.map((i) => i.width)).toEqual([10_000])
    expect(big.skipped).toEqual(['image'])
  })
})
