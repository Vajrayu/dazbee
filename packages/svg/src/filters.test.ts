import { describe, expect, it } from 'vitest'

import { filterEffects } from './filters.ts'
import { readSheets } from './style.ts'
import { IDENTITY, type Matrix, parseTransform } from './transform.ts'
import { parseXml, type XmlElement } from './xml.ts'

/** The effects `value` amounts to, with `defs` in the file, on a layer drawn through `m` and turned by `rotation`. */
function effectsOf(defs: string, value = 'url(#f)', m: Matrix = IDENTITY, rotation = 0) {
  const root = parseXml(`<svg xmlns="http://www.w3.org/2000/svg">${defs}</svg>`)
  const ids = new Map<string, XmlElement>()
  const parents = new Map<XmlElement, XmlElement>()
  const index = (element: XmlElement) => {
    if (element.attrs.id) ids.set(element.attrs.id, element)
    for (const child of element.children) {
      if (typeof child === 'string') continue
      parents.set(child, element)
      index(child)
    }
  }
  index(root)
  return filterEffects({ ids, parents, rules: readSheets(root) }, value, m, rotation)
}
const filter = (body: string, attrs = '') => `<filter id="f" ${attrs}>${body}</filter>`
/** A colour matrix that sets every pixel's colour to `rgb` and scales its alpha by `alpha`. */
const tintRows = ([r, g, b]: number[], alpha: number) =>
  `${[r, g, b].map((c) => `0 0 0 0 ${c}`).join(' ')} 0 0 0 ${alpha} 0`
/** A shadow of the layer's alpha tinted by `rows`, moved 4 down and merged under the layer. */
const tintedShadow = (rows: string, attrs = '') =>
  filter(
    `<feColorMatrix in="SourceAlpha" type="matrix" values="${rows}"/><feOffset dy="4"/>
    <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>`,
    attrs,
  )
const HARD_ALPHA =
  '<feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="hardAlpha"/>'
/** A drop shadow as Figma writes it, knocked out of the layer unless it shows behind it. */
const figmaShadow = (n: number, under: string, cast: string, tint: string, showBehind = false) =>
  `${HARD_ALPHA}${cast}${showBehind ? '' : '<feComposite in2="hardAlpha" operator="out"/>'}
  <feColorMatrix type="matrix" values="${tint}"/>
  <feBlend mode="normal" in2="${under}" result="effect${n}_dropShadow"/>`
const FIGMA_START = '<feFlood flood-opacity="0" result="BackgroundImageFix"/>'
const figmaEnd = (n: number) => `<feBlend mode="normal" in="SourceGraphic" in2="effect${n}_dropShadow" result="shape"/>`
const ILLUSTRATOR = filter(
  `<feGaussianBlur in="SourceAlpha" stdDeviation="5" result="blur"/>
  <feOffset in="blur" dx="7" dy="7" result="offsetBlurredAlpha"/>
  <feMerge><feMergeNode in="offsetBlurredAlpha"/><feMergeNode in="SourceGraphic"/></feMerge>`,
  'filterUnits="objectBoundingBox" x="-20%" y="-20%" width="140%" height="140%"',
)
const FIGMA_ONE = filter(
  `${FIGMA_START}${figmaShadow(1, 'BackgroundImageFix', '<feOffset dy="4"/><feGaussianBlur stdDeviation="5"/>', '0 0 0 0 0.0627451 0 0 0 0 0.0941176 0 0 0 0 0.156863 0 0 0 0.12 0')}${figmaEnd(1)}`,
  'filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"',
)
const figmaInner = (operator: string) =>
  filter(
    `${FIGMA_START}
  <feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape"/>
  ${HARD_ALPHA}
  <feMorphology radius="2" operator="${operator}" in="SourceAlpha" result="effect1_innerShadow"/>
  <feOffset dy="4"/>
  <feGaussianBlur stdDeviation="3"/>
  <feComposite in2="hardAlpha" operator="arithmetic" k2="-1" k3="1"/>
  <feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.25 0"/>
  <feBlend mode="normal" in2="shape" result="effect1_innerShadow"/>`,
    'color-interpolation-filters="sRGB"',
  )

describe('filterEffects', () => {
  it('reads feDropShadow as a drop shadow that shows behind the layer, blurred twice its deviation', () => {
    expect(
      effectsOf(filter('<feDropShadow dx="3" dy="5" stdDeviation="4" flood-color="#336699" flood-opacity="0.5"/>')),
    ).toEqual([{ type: 'dropShadow', x: 3, y: 5, blur: 8, spread: 0, color: '#33669980', showBehind: true }])
    // Its defaults: 2, 2, a deviation of 2, opaque black.
    expect(effectsOf(filter('<feDropShadow/>'))).toEqual([
      { type: 'dropShadow', x: 2, y: 2, blur: 4, spread: 0, color: '#000000FF', showBehind: true },
    ])
  })

  it("reads Illustrator's shadow, a blurred alpha moved and merged under the layer", () => {
    expect(effectsOf(ILLUSTRATOR)).toEqual([
      { type: 'dropShadow', x: 7, y: 7, blur: 10, spread: 0, color: '#000000FF', showBehind: true },
    ])
  })

  it("reads Inkscape's shadow, a flood cut to the layer, blurred, moved and put under it", () => {
    const inkscape = filter(
      `<feFlood flood-opacity="0.498039" flood-color="rgb(0,0,0)" result="flood"/>
      <feComposite in="flood" in2="SourceGraphic" operator="in" result="composite1"/>
      <feGaussianBlur in="composite1" stdDeviation="3" result="blur"/>
      <feOffset dx="6" dy="6" result="offset"/>
      <feComposite in="SourceGraphic" in2="offset" operator="over" result="composite2"/>`,
      'style="color-interpolation-filters:sRGB"',
    )
    expect(effectsOf(inkscape)).toEqual([
      { type: 'dropShadow', x: 6, y: 6, blur: 6, spread: 0, color: '#0000007F', showBehind: true },
    ])
    // Inkscape 1's order: the layer blurred and moved, then cut to the flood.
    const inkscape1 = filter(
      `<feFlood result="flood" in="SourceGraphic" flood-opacity="0.498039" flood-color="rgb(0,0,0)"/>
      <feGaussianBlur result="blur" in="SourceGraphic" stdDeviation="3.000000"/>
      <feOffset result="offset" in="blur" dx="6.000000" dy="6.000000"/>
      <feComposite result="comp1" operator="in" in="flood" in2="offset"/>
      <feComposite result="comp2" operator="over" in="SourceGraphic" in2="comp1"/>`,
    )
    expect(effectsOf(inkscape1)).toEqual(effectsOf(inkscape))
    // The flood's colour from its style attribute, as Inkscape also writes it.
    expect(
      effectsOf(
        inkscape.replace(
          'flood-opacity="0.498039" flood-color="rgb(0,0,0)"',
          'style="flood-color:#f00;flood-opacity:1"',
        ),
      ),
    ).toMatchObject([{ color: '#FF0000FF' }])
  })

  it("reads Figma's shadow as one hidden behind the layer, its colour from the matrix", () => {
    expect(effectsOf(FIGMA_ONE)).toEqual([{ type: 'dropShadow', x: 0, y: 4, blur: 10, spread: 0, color: '#1018281F' }])
  })

  it("reads Figma's shadow that shows behind the layer, and its spread", () => {
    const shown = filter(
      `${FIGMA_START}${figmaShadow(1, 'BackgroundImageFix', '<feMorphology radius="4" operator="dilate" in="SourceAlpha" result="effect1_dropShadow"/><feOffset dy="2"/><feGaussianBlur stdDeviation="3"/>', '0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.3 0', true)}${figmaEnd(1)}`,
    )
    expect(effectsOf(shown)).toEqual([
      { type: 'dropShadow', x: 0, y: 2, blur: 6, spread: 4, color: '#0000004D', showBehind: true },
    ])
  })

  it("reads Figma's two shadows bottom first, the second with a spread", () => {
    const two = filter(
      `${FIGMA_START}
      ${figmaShadow(1, 'BackgroundImageFix', '<feOffset dy="4"/><feGaussianBlur stdDeviation="5"/>', '0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.25 0')}
      ${figmaShadow(2, 'effect1_dropShadow', '<feMorphology radius="4" operator="dilate" in="SourceAlpha" result="effect2_dropShadow"/><feOffset dx="2" dy="8"/><feGaussianBlur stdDeviation="8"/>', '0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 0 0 0.5 0')}
      ${figmaEnd(2)}`,
    )
    expect(effectsOf(two)).toEqual([
      { type: 'dropShadow', x: 0, y: 4, blur: 10, spread: 0, color: '#00000040' },
      { type: 'dropShadow', x: 2, y: 8, blur: 16, spread: 4, color: '#FF000080' },
    ])
  })

  it("reads Figma's inner shadow, its eroded alpha as a spread inward", () => {
    expect(effectsOf(figmaInner('erode'))).toEqual([
      { type: 'innerShadow', x: 0, y: 4, blur: 6, spread: 2, color: '#00000040' },
    ])
  })

  it('reads an inner shadow written as a flood out of the moved alpha, cut to the layer', () => {
    const out = filter(
      `<feOffset in="SourceAlpha" dx="3" dy="3"/>
      <feGaussianBlur stdDeviation="2" result="moved"/>
      <feFlood flood-color="#123456" flood-opacity="0.5"/>
      <feComposite in2="moved" operator="out"/>
      <feComposite in2="SourceAlpha" operator="in" result="inner"/>
      <feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="inner"/></feMerge>`,
    )
    expect(effectsOf(out)).toEqual([{ type: 'innerShadow', x: 3, y: 3, blur: 4, spread: 0, color: '#12345680' }])
  })

  it('reads a blur of the layer as a layer blur', () => {
    expect(effectsOf(filter('<feGaussianBlur stdDeviation="4"/>'))).toEqual([{ type: 'layerBlur', radius: 8 }])
    expect(effectsOf(filter('<feGaussianBlur in="SourceGraphic" stdDeviation="2 6"/>'))).toEqual([
      { type: 'layerBlur', radius: 8 },
    ])
  })

  it('scales blur, spread and offset with the layer, and turns the offset with it', () => {
    const under = parseTransform('scale(2) rotate(90)')
    const [shadow] = effectsOf(
      filter(
        `${FIGMA_START}${figmaShadow(1, 'BackgroundImageFix', '<feMorphology radius="3" operator="dilate" in="SourceAlpha" result="effect1_dropShadow"/><feOffset dy="4"/><feGaussianBlur stdDeviation="5"/>', '0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.25 0')}${figmaEnd(1)}`,
      ),
      'url(#f)',
      under,
    ) ?? [{}]
    expect(shadow).toMatchObject({ x: -8, y: 0, blur: 20, spread: 6 })
  })

  it("keeps a turned layer's offset in its own unturned frame", () => {
    // The renderer turns the layer before drawing its shadow, so a shadow 4 down the page is 4 down the layer at any turn.
    const [shadow] = effectsOf(FIGMA_ONE, 'url(#f)', parseTransform('rotate(30)'), 30) ?? [{}]
    expect(shadow).toMatchObject({ x: 0, y: 4 })
    const [sideways] = effectsOf(FIGMA_ONE, 'url(#f)', IDENTITY, 90) ?? [{}]
    expect(sideways).toMatchObject({ x: 4, y: 0 })
  })

  it('blurs a shadow cast from the blurred layer by both blurs, as the renderer casts from the unblurred layer', () => {
    const tinted = filter(
      `<feGaussianBlur in="SourceGraphic" stdDeviation="4" result="b"/>
      <feColorMatrix in="b" type="matrix" values="${tintRows([0, 0, 0], 1)}"/>
      <feOffset dx="10" dy="10"/>
      <feMerge><feMergeNode/><feMergeNode in="b"/></feMerge>`,
    )
    expect(effectsOf(tinted)).toEqual([
      { type: 'dropShadow', x: 10, y: 10, blur: 8, spread: 0, color: '#000000FF', showBehind: true },
      { type: 'layerBlur', radius: 8 },
    ])
    const dropped = filter('<feGaussianBlur stdDeviation="4"/><feDropShadow dx="10" dy="10" stdDeviation="2"/>')
    expect(effectsOf(dropped)).toEqual([
      { type: 'dropShadow', x: 10, y: 10, blur: 8.944272, spread: 0, color: '#000000FF', showBehind: true },
      { type: 'layerBlur', radius: 8 },
    ])
  })

  it('reads a colour matrix in linear light unless the filter works in sRGB, as it inherits', () => {
    const half = tintRows([0.5, 0.5, 0.5], 1)
    expect(effectsOf(tintedShadow(half))).toMatchObject([{ color: '#BCBCBCFF' }])
    expect(effectsOf(tintedShadow(half, 'color-interpolation-filters="sRGB"'))).toMatchObject([{ color: '#808080FF' }])
    expect(
      effectsOf(`<defs style="color-interpolation-filters: sRGB">${tintedShadow(half)}</defs>`),
      'from an ancestor',
    ).toMatchObject([{ color: '#808080FF' }])
    const own = tintedShadow(half, 'color-interpolation-filters="sRGB"').replace(
      '<feColorMatrix',
      '<feColorMatrix color-interpolation-filters="linearRGB"',
    )
    expect(effectsOf(own), "the primitive's own").toMatchObject([{ color: '#BCBCBCFF' }])
  })

  it("turns a flood black with Figma's hard alpha matrix", () => {
    const hardFlood = filter(
      `<feOffset in="SourceAlpha" dy="4" result="moved"/>
      <feFlood flood-color="#f00" flood-opacity="0.3"/>
      <feColorMatrix type="matrix" values="${tintRows([0, 0, 0], 127)}"/>
      <feComposite in2="moved" operator="in"/>
      <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>`,
    )
    expect(effectsOf(hardFlood)).toMatchObject([{ type: 'dropShadow', y: 4, color: '#000000FF' }])
  })

  it('keeps a huge deviation to a blur the renderer can draw', () => {
    expect(effectsOf(filter('<feGaussianBlur stdDeviation="1e300"/>'))).toEqual([{ type: 'layerBlur', radius: 1000 }])
    const [shadow] = effectsOf(filter('<feDropShadow stdDeviation="1e300"/>')) ?? [{}]
    expect(shadow).toMatchObject({ blur: 1000 })
  })

  it('stops a filter whose results double, in a time that grows with its primitives', () => {
    const doubled = (n: number, step: string) => filter(`<feDropShadow result="a"/>${step.repeat(n)}`)
    const steps = {
      'a merge of a result with itself': '<feMerge result="a"><feMergeNode in="a"/><feMergeNode in="a"/></feMerge>',
      'a composite over itself': '<feComposite in="a" in2="a" operator="over" result="a"/>',
      'a blend with itself': '<feBlend in="a" in2="a" result="a"/>',
    }
    for (const [name, step] of Object.entries(steps)) {
      const started = performance.now()
      expect(effectsOf(doubled(60, step)), name).toBeNull()
      expect(performance.now() - started, name).toBeLessThan(200)
    }
  })

  it('maps none of a filter it cannot read whole', () => {
    const cases = {
      'another primitive': filter('<feTurbulence baseFrequency="0.05"/><feGaussianBlur stdDeviation="2"/>'),
      'primitives in the box': filter('<feGaussianBlur stdDeviation="0.1"/>', 'primitiveUnits="objectBoundingBox"'),
      'an inner shadow spread outward': figmaInner('dilate'),
      'a blend that is not normal': filter(
        '<feOffset in="SourceAlpha" dy="4"/><feBlend mode="multiply" in="SourceGraphic"/>',
      ),
      'more than one layer': filter(
        '<feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="SourceGraphic"/></feMerge>',
      ),
    }
    for (const [name, defs] of Object.entries(cases)) expect(effectsOf(defs), name).toBeNull()
    expect(effectsOf(ILLUSTRATOR, 'drop-shadow(2px 2px 4px black)'), 'a CSS filter function').toBeNull()
    expect(effectsOf(ILLUSTRATOR, 'url(#missing)'), 'a missing id').toBeNull()
    expect(
      effectsOf(
        `${ILLUSTRATOR}${filter('<feGaussianBlur stdDeviation="2"/>').replace('id="f"', 'id="g"')}`,
        'url(#f) url(#g)',
      ),
      'a list of filters',
    ).toBeNull()
    const hardened = filter(
      `<feGaussianBlur in="SourceAlpha" stdDeviation="3"/><feColorMatrix type="matrix" values="${tintRows([0, 0, 0], 127)}"/>
      <feOffset dy="4"/><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>`,
    )
    expect(effectsOf(hardened), 'a blurred alpha hardened').toBeNull()
  })
})
