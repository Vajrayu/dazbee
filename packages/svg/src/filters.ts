// SVG filters as layer effects, ported from FigCraft's `fx.rs`. Each filter's primitives are worked
// out symbolically: what each result is (the layer, the layer blurred, a shadow made from the
// layer's alpha, a flood, a stack of those) rather than its pixels. A filter whose result is the
// layer with shadows under it, shadows cut into it, or blurred, is drop shadows, inner shadows and
// a layer blur: `feDropShadow`, Illustrator's and Inkscape's chains (blur, offset, flood, composite,
// merge), and Figma's (a colour matrix tint of the alpha, with `feMorphology` as spread and an
// arithmetic or `out` composite for an inner shadow). Anything else maps to nothing, and the caller
// draws the layer without it.

import { type Effect, withAlpha } from '@dazbee/schema'

import { parseColor } from './color.ts'
import { clamp01, numbers } from './lengths.ts'
import { type Style, styleOf } from './style.ts'
import { lengthScale, type Matrix } from './transform.ts'
import type { Context } from './types.ts'
import type { XmlElement } from './xml.ts'

/** A colour as #RRGGBB and its alpha, from 0 to 1. */
interface Tint {
  rgb: string
  alpha: number
}

/** A shadow-like image: the layer's alpha, moved, spread, blurred and tinted. */
interface Shadow {
  dx: number
  dy: number
  sigma: number
  /** Grown by an `feMorphology` dilate, or shrunk (below 0) by an erode. */
  spread: number
  color: Tint
  /** Cut out where the layer is: a drop shadow hidden behind it. */
  knockout: boolean
  /** Inside the layer where the moved copy isn't: an inner shadow. */
  inner: boolean
  /** Everything but the shadow (a flood with the shadow cut out): an inner shadow once cut to the layer. */
  inverted: boolean
  /**
   * Cast from the layer blurred by this sigma, which `sigma` holds too: the renderer casts a
   * shadow from the layer before its layer blur.
   */
  cast: number
}

/** What a primitive's result is. A stack lists its images bottom to top. */
type Image =
  | { kind: 'layer'; sigma: number }
  /** The layer, blurred and moved as the shadow says: its alpha is that shadow. */
  | { kind: 'moved'; shadow: Shadow }
  | { kind: 'shadow'; shadow: Shadow }
  | { kind: 'flood'; color: Tint }
  | { kind: 'clear' }
  | { kind: 'stack'; images: Image[] }
  /** What the canvas holds behind the layer, or its paints: nothing a layer's effects draw. */
  | { kind: 'unread' }

/** More primitives than this in one filter, or images in one stack, and it maps to nothing. */
const MAX_PRIMITIVES = 64
const MAX_IMAGES = 64
/** The widest blur an effect is given, in design pixels: far past where a shadow still shows. */
const MAX_BLUR = 1000
/** Inputs that are not the layer: what is behind it, and its paints. */
const UNREAD = new Set(['BackgroundImage', 'BackgroundAlpha', 'FillPaint', 'StrokePaint'])
const BLACK: Tint = { rgb: '#000000', alpha: 1 }
const ALPHA: Shadow = {
  dx: 0,
  dy: 0,
  sigma: 0,
  spread: 0,
  color: BLACK,
  knockout: false,
  inner: false,
  inverted: false,
  cast: 0,
}

/**
 * The effects an element's `filter` property amounts to, bottom to top, on a layer whose user
 * space reaches the design through `m` and which the renderer turns by `rotation` degrees before
 * drawing its effects; null when any part of it can't be effects: a CSS filter function, a list of
 * filters (each drawn over the last's result), a missing id, a primitive or a combination of them
 * that has no effect to become.
 */
export function filterEffects(
  context: Pick<Context, 'ids' | 'parents' | 'rules'>,
  value: string,
  m: Matrix,
  rotation: number,
): Effect[] | null {
  const id = /^url\(\s*['"]?#([^'")\s]+)['"]?\s*\)$/.exec(value.trim())?.[1]
  const element = id ? context.ids.get(id) : undefined
  if (element?.name !== 'filter' || element.attrs.primitiveUnits === 'objectBoundingBox') return null
  const result = evaluate(context, element)
  return result && toEffects(result, m, rotation)
}

/** What the filter's last primitive makes, or null for one that isn't read. */
function evaluate(context: Pick<Context, 'parents' | 'rules'>, filter: XmlElement): Image | null {
  const primitives = filter.children.filter((c): c is XmlElement => typeof c !== 'string' && c.name.startsWith('fe'))
  if (primitives.length > MAX_PRIMITIVES) return null
  // What the primitives inherit from the filter and the elements around it.
  const chain: XmlElement[] = []
  for (let at: XmlElement | undefined = filter; at; at = context.parents.get(at)) chain.unshift(at)
  const inherited = chain.reduce<Style>((parent, element) => styleOf(element, parent, context.rules), {})
  const results = new Map<string, Image>()
  let last: Image = { kind: 'layer', sigma: 0 }
  // A missing input, or one naming no result, is the previous primitive's result.
  const input = (name: string | undefined): Image => {
    if (name === 'SourceGraphic') return { kind: 'layer', sigma: 0 }
    if (name === 'SourceAlpha') return { kind: 'shadow', shadow: ALPHA }
    if (name && UNREAD.has(name)) return { kind: 'unread' }
    return (name && results.get(name)) || last
  }
  for (const primitive of primitives) {
    const image = read(styleOf(primitive, inherited, context.rules), primitive, input)
    if (!image) return null
    if (primitive.attrs.result) results.set(primitive.attrs.result, image)
    last = image
  }
  return last
}

/** What one primitive, with its own style, makes of its inputs, or null when it can't be told as effects. */
function read(style: Style, primitive: XmlElement, input: (name: string | undefined) => Image): Image | null {
  const a = primitive.attrs
  const source = () => input(a.in)
  switch (primitive.name) {
    case 'feOffset': {
      const [dx, dy] = [number(a.dx, 0), number(a.dy, 0)]
      const from = source()
      if (from.kind === 'shadow' || from.kind === 'moved') {
        return { ...from, shadow: { ...from.shadow, dx: from.shadow.dx + dx, dy: from.shadow.dy + dy } }
      }
      if (from.kind === 'layer') {
        return dx === 0 && dy === 0 ? from : { kind: 'moved', shadow: { ...ALPHA, sigma: from.sigma, dx, dy } }
      }
      return from.kind === 'clear' ? from : null
    }
    case 'feGaussianBlur': {
      const sigma = deviation(a.stdDeviation, 0)
      if (sigma === null) return null
      const from = source()
      if (from.kind === 'shadow' || from.kind === 'moved') {
        return { ...from, shadow: { ...from.shadow, sigma: Math.hypot(from.shadow.sigma, sigma) } }
      }
      if (from.kind === 'layer') return { kind: 'layer', sigma: Math.hypot(from.sigma, sigma) }
      return from.kind === 'clear' ? from : null
    }
    case 'feFlood': {
      const color = floodOf(style)
      return color.alpha <= 0 ? { kind: 'clear' } : { kind: 'flood', color }
    }
    case 'feMorphology': {
      const from = source()
      if (from.kind !== 'shadow') return null
      const s = from.shadow
      if (s.sigma !== 0 || s.spread !== 0 || s.inner || s.inverted) return null
      const [rx = 0, ry = rx] = numbers(a.radius)
      if (!(rx >= 0 && ry >= 0)) return null
      const r = (rx + ry) / 2
      return shadow({ ...s, spread: a.operator === 'dilate' ? r : -r })
    }
    case 'feColorMatrix': {
      const matrix = (a.type ?? 'matrix') === 'matrix' ? tint(numbers(a.values), style) : null
      if (!matrix) return null
      const from = source()
      if (from.kind === 'flood') {
        const alpha = clamp01(from.color.alpha * matrix.scale)
        return alpha > 0 ? { kind: 'flood', color: { rgb: matrix.rgb, alpha } } : { kind: 'clear' }
      }
      // A tint reads only the alpha, so it tints the layer's alpha, or casts from the blurred layer.
      const s =
        from.kind === 'shadow' || from.kind === 'moved'
          ? from.shadow
          : from.kind === 'layer'
            ? { ...ALPHA, sigma: from.sigma, cast: from.sigma }
            : null
      // An alpha scaled past opaque is cut off there: a blurred one no longer has a blur's shape.
      if (!s || (matrix.scale > 1 && s.sigma > 0)) return null
      return shadow({ ...s, color: { rgb: matrix.rgb, alpha: clamp01(s.color.alpha * matrix.scale) } })
    }
    case 'feComposite':
      return composite(input(a.in), input(a.in2), a)
    case 'feMerge': {
      let merged: Image | null = { kind: 'clear' }
      for (const node of primitive.children) {
        if (typeof node === 'string' || node.name !== 'feMergeNode') continue
        merged = merged && stack(merged, input(node.attrs.in))
      }
      return merged
    }
    case 'feBlend':
      return (a.mode ?? 'normal') === 'normal' ? stack(input(a.in2), input(a.in)) : null
    case 'feDropShadow': {
      const sigma = deviation(a.stdDeviation, 2)
      const from = source()
      if (sigma === null || from.kind !== 'layer') return null
      const cast = {
        ...ALPHA,
        dx: number(a.dx, 2),
        dy: number(a.dy, 2),
        sigma: Math.hypot(from.sigma, sigma),
        cast: from.sigma,
        color: floodOf(style),
      }
      return stack(shadow(cast), from)
    }
    default:
      return null
  }
}

/** The effects a filter's result is on the layer, bottom to top, or null when it is anything else. */
function toEffects(result: Image, m: Matrix, rotation: number): Effect[] | null {
  const images = layersOf(result)
  const at = images.findIndex((i) => i.kind === 'layer')
  const layer = images[at]
  if (layer?.kind !== 'layer' || images.filter((i) => i.kind === 'layer').length !== 1) return null
  const k = lengthScale(m)
  const out: Effect[] = []
  for (const [i, image] of images.entries()) {
    if (image.kind === 'layer') {
      if (image.sigma > 0) out.push({ type: 'layerBlur', radius: blurOf(image.sigma, k) })
      continue
    }
    if (image.kind !== 'shadow') return null
    const s = image.shadow
    // A shadow cut out of a blurred layer is hidden behind it only when that is the layer drawn.
    if (s.inverted || (s.cast > 0 && (s.inner || (s.knockout && s.cast !== layer.sigma)))) return null
    const { x, y } = offsetOf(m, rotation, s.dx, s.dy)
    const blur = blurOf(s.sigma, k)
    const color = withAlpha(`${s.color.rgb}FF`, s.color.alpha)
    if (!s.inner && i < at) {
      out.push({
        type: 'dropShadow',
        x,
        y,
        blur,
        spread: tidy(s.spread * k),
        color,
        ...(s.knockout ? {} : { showBehind: true }),
      })
    } else if (s.inner && i > at && s.spread <= 0) {
      // An eroded alpha casts from a smaller shape: the shadow reaches further in.
      out.push({ type: 'innerShadow', x, y, blur, spread: tidy(-s.spread * k), color })
    } else {
      return null
    }
  }
  return out.every(finite) ? out : null
}

/**
 * The colour a colour matrix sets every pixel to and how much it scales the alpha by, or null for
 * one that does anything else. Its colour is in linear light unless the filter works in sRGB.
 */
function tint(v: number[], style: Style): { rgb: string; scale: number } | null {
  if (v.length !== 20) return null
  const row = (r: number) => v.slice(r * 5, r * 5 + 5)
  const [red, green, blue, alpha] = [row(0), row(1), row(2), row(3)]
  const constant = (r: number[]) => r.slice(0, 4).every((c) => c === 0)
  if (![red, green, blue].every(constant) || alpha.slice(0, 3).some((c) => c !== 0) || alpha[4] !== 0) return null
  const linear = (style['color-interpolation-filters'] ?? 'linearRGB').toLowerCase() === 'linearrgb'
  const hex = (r: number[]) => {
    const c = clamp01(r[4] ?? 0)
    const encoded = !linear ? c : c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055
    return Math.round(encoded * 255)
      .toString(16)
      .padStart(2, '0')
      .toUpperCase()
  }
  return { rgb: `#${hex(red)}${hex(green)}${hex(blue)}`, scale: alpha[3] ?? 0 }
}

function composite(top: Image, bottom: Image, a: Record<string, string>): Image | null {
  const operator = a.operator ?? 'over'
  if (operator === 'over') return stack(bottom, top)
  // `in` and `out` read only the second input's alpha, which for the layer, or the layer moved, is a shadow.
  const under =
    bottom.kind === 'layer' && bottom.sigma === 0
      ? shadow(ALPHA)
      : bottom.kind === 'moved'
        ? shadow(bottom.shadow)
        : bottom
  const plain = (i: Image) => i.kind === 'shadow' && same(i.shadow, ALPHA)
  const tinted = (s: Shadow, c: Tint, rgb: string) => ({
    ...s,
    color: { rgb, alpha: clamp01(c.alpha * s.color.alpha) },
  })
  if (operator === 'in') {
    if (top.kind === 'flood' && under.kind === 'shadow') return shadow(tinted(under.shadow, top.color, top.color.rgb))
    if (top.kind === 'shadow' && under.kind === 'flood')
      return shadow(tinted(top.shadow, under.color, top.shadow.color.rgb))
    // Everything but a shadow, cut to the layer: an inner shadow.
    if (top.kind === 'shadow' && top.shadow.inverted && plain(under))
      return shadow({ ...top.shadow, inverted: false, inner: true })
    return null
  }
  if (operator === 'out') {
    if (top.kind === 'flood' && under.kind === 'shadow' && !under.shadow.inner && !under.shadow.inverted)
      return shadow({ ...tinted(under.shadow, top.color, top.color.rgb), inverted: true })
    if (top.kind !== 'shadow' || top.shadow.inner || top.shadow.inverted) return null
    // Cut out where the layer, or the blurred layer it was cast from, is.
    if (plain(under) || (under.kind === 'layer' && under.sigma > 0 && under.sigma === top.shadow.cast))
      return shadow({ ...top.shadow, knockout: true })
    return null
  }
  // The layer less a moved copy of it: inside the layer where the copy isn't.
  const [k1, k2, k3, k4] = ['k1', 'k2', 'k3', 'k4'].map((key) => number(a[key], 0))
  if (operator === 'arithmetic' && k1 === 0 && k2 === -1 && k3 === 1 && k4 === 0) {
    if (top.kind === 'shadow' && !top.shadow.inner && plain(under)) return shadow({ ...top.shadow, inner: true })
  }
  return null
}

/** The flood colour and opacity an `feFlood` or `feDropShadow` writes, as attributes or styles. */
function floodOf(style: Style): Tint {
  const color = parseColor(style['flood-color'] ?? 'black') ?? '#000000FF'
  const raw = style['flood-opacity'] ?? '1'
  const opacity = clamp01(Number.parseFloat(raw) / (raw.trim().endsWith('%') ? 100 : 1))
  return { rgb: color.slice(0, 7), alpha: (Number.parseInt(color.slice(7, 9), 16) / 255) * opacity }
}

/** The offset in the layer's unturned frame: through `m` without its move, then turned back by `rotation`. */
function offsetOf(m: Matrix, rotation: number, dx: number, dy: number) {
  const x = m[0] * dx + m[2] * dy
  const y = m[1] * dx + m[3] * dy
  const t = (rotation * Math.PI) / 180
  return { x: tidy(Math.cos(t) * x + Math.sin(t) * y), y: tidy(-Math.sin(t) * x + Math.cos(t) * y) }
}

function shadow(s: Shadow): Image {
  return { kind: 'shadow', shadow: s }
}

/** One image over another, or null past MAX_IMAGES, so a result stacked on itself can't double without end. */
function stack(bottom: Image, top: Image): Image | null {
  const images = [...layersOf(bottom), ...layersOf(top)]
  return images.length > MAX_IMAGES ? null : { kind: 'stack', images }
}

/** The images an image is, bottom to top: a stack flattened, nothing for a clear one. */
function layersOf(image: Image): Image[] {
  if (image.kind === 'stack') return image.images.flatMap(layersOf)
  return image.kind === 'clear' ? [] : [image]
}

function same(a: Shadow, b: Shadow) {
  return (Object.keys(a) as (keyof Shadow)[]).every((key) =>
    key === 'color' ? a.color.rgb === b.color.rgb && a.color.alpha === b.color.alpha : a[key] === b[key],
  )
}

/** A number attribute, or `fallback` when it is missing or isn't one. */
function number(raw: string | undefined, fallback: number) {
  const n = Number.parseFloat(raw ?? '')
  return Number.isFinite(n) ? n : fallback
}

/** A blur's standard deviation, the mean of its two when it has two; null for a negative one. */
function deviation(raw: string | undefined, fallback: number) {
  const [x = fallback, y = x] = numbers(raw)
  return x >= 0 && y >= 0 ? (x + y) / 2 : null
}

/** A blur radius from its deviation: twice it, scaled with the layer, and at most MAX_BLUR. */
function blurOf(sigma: number, k: number) {
  return Math.min(MAX_BLUR, tidy(2 * sigma * k))
}

/** Rounded to a millionth, without a negative zero, so turning by a right angle leaves no dust. */
function tidy(n: number) {
  return Math.round(n * 1e6) / 1e6 + 0
}

function finite(effect: Effect) {
  return Object.values(effect).every((v) => typeof v !== 'number' || Number.isFinite(v))
}
