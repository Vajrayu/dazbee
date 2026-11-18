// SVG patterns as image paints, as FigCraft reads them (paint.rs): a pattern holding one picture,
// directly or by <use> through plain groups, becomes that picture. Where one copy of it shows in
// the layer's box it is fill or fit when they place it exactly, else the crop that does; where it
// repeats, upright, evenly scaled and filling its tile, it tiles at its scale, its offset dropped.
// Figma writes every image fill this way. Any other pattern is reported, and its paint falls back.

import { type ImagePaint, type Rect, TILE_SCALE } from '@dazbee/schema'

import { askedView, EXACT, fitOf, pictureOf, placement, showPicture, type SvgImage, viewIn } from './images.ts'
import { clamp01, length } from './lengths.ts'
import { styleOf } from './style.ts'
import {
  apply,
  IDENTITY,
  invert,
  type Matrix,
  multiply,
  parseTransform,
  scale,
  translate,
  viewBoxMatrix,
} from './transform.ts'
import type { Context } from './types.ts'
import type { XmlElement } from './xml.ts'

/** The image paint a pattern makes, without its opacity; 'nothing' when no copy shows in the box. */
export type PatternPaint = Pick<ImagePaint, 'type' | 'assetId' | 'fit' | 'crop' | 'tileScale'> | 'nothing'

/** The one picture a pattern holds: its <image>, and its user space in the pattern's content's. */
interface Lone {
  image: XmlElement
  m: Matrix
}

/** How deep a pattern's groups and uses are followed to its one picture. */
const MAX_DEPTH = 16
/** Elements that draw nothing, which a pattern may hold beside its picture. */
const SILENT = new Set(['title', 'desc', 'metadata'])
/** Whether the pattern holds one picture, which a layer shows only unturned. */
export function holdsPicture(context: Pick<Context, 'ids' | 'rules'>, pattern: XmlElement): boolean {
  return loneImage(context, patternOf(context, pattern).children, IDENTITY, 0) !== null
}

/**
 * The pattern as an image paint for a layer whose user space reaches its frame through `m`: `user`
 * is the outline's box in its own user space, which a bounding-box pattern spans, and `box` the
 * layer's box in its frame. Null, and reported, when it isn't one picture placed as a paint can
 * place it, or when the picture has no asset (not reported).
 */
export function patternPaint(
  context: Context,
  pattern: XmlElement,
  m: Matrix,
  user: Rect,
  box: Rect,
  layerName: string,
): PatternPaint | null {
  const { skipped, viewport, pictures } = context
  const { attrs, children } = patternOf(context, pattern)
  const lone = loneImage(context, children, IDENTITY, 0)
  const href = (lone?.image.attrs.href ?? '').trim()
  if (!lone || !/^data:/i.test(href)) {
    skipped.add(lone && href ? 'external-reference' : 'pattern')
    return null
  }
  const asked = askedView(lone.image, viewport)
  if (!asked) return 'nothing'

  const bounding = attrs.patternUnits !== 'userSpaceOnUse'
  if (bounding && !(user.width > 0 && user.height > 0)) return 'nothing'
  // The tile in the pattern's space: a share of the outline's box, or lengths in user space.
  const unit = (key: string, whole: number, origin: number, span: number) => {
    // A number that can't be read is 0, as resvg reads it.
    const raw = attrs[key] ?? '0'
    return bounding ? origin + length(raw, 1) * span : length(raw, whole)
  }
  const tile = {
    x: unit('x', viewport.width, user.x, user.width),
    y: unit('y', viewport.height, user.y, user.height),
    width: unit('width', viewport.width, 0, user.width),
    height: unit('height', viewport.height, 0, user.height),
  }
  if (!(tile.width > 0 && tile.height > 0)) return 'nothing'

  const picture = pictureOf(pictures, href, layerName)
  if (!picture) {
    skipped.add('image')
    return null
  }
  const { drawn, crop } = placement(picture, viewIn(asked, picture), lone.image.attrs.preserveAspectRatio ?? '')
  // A picture sliced inside the pattern shows less than all of it, which no paint can cut.
  const whole = Math.max(picture.width, picture.height) * 1e-9
  if (
    Math.abs(crop.x) > whole ||
    Math.abs(crop.y) > whole ||
    Math.abs(crop.width - picture.width) > whole ||
    Math.abs(crop.height - picture.height) > whole
  ) {
    skipped.add('pattern')
    return null
  }
  // The picture's pixels in the pattern's space: placed, through the use and groups, into the tile.
  const contentUnits = attrs.viewBox
    ? viewBoxMatrix(attrs.viewBox, tile.width, tile.height, attrs.preserveAspectRatio)
    : attrs.patternContentUnits === 'objectBoundingBox'
      ? scale(user.width, user.height)
      : IDENTITY
  const content = multiply(
    translate(tile.x, tile.y),
    multiply(
      contentUnits,
      multiply(
        lone.m,
        multiply(translate(drawn.x, drawn.y), scale(drawn.width / picture.width, drawn.height / picture.height)),
      ),
    ),
  )
  const toFrame = multiply(m, parseTransform(attrs.patternTransform ?? ''))
  const fromFrame = invert(toFrame)
  if (!fromFrame) return 'nothing'
  const node = bounds(fromFrame, box)
  const image = bounds(content, { x: 0, y: 0, width: picture.width, height: picture.height })
  const copyAt = (kx: number, ky: number) =>
    multiply(toFrame, multiply(translate(kx * tile.width, ky * tile.height), content))

  // One tile holding the whole box shows its copy, cut there as the tile would cut it.
  const inTile = (lo: number, hi: number, start: number, size: number) => {
    const k = Math.floor((lo - start) / size + EXACT)
    return hi <= start + (k + 1) * size + EXACT * size ? k : null
  }
  const kx = inTile(node.x, node.x + node.width, tile.x, tile.width)
  const ky = inTile(node.y, node.y + node.height, tile.y, tile.height)
  if (kx !== null && ky !== null) return placed(context, picture, copyAt(kx, ky), box)

  // Otherwise the copies of a picture inside its tile that reach the box.
  const slack = EXACT * Math.max(tile.width, tile.height)
  if (
    image.x < tile.x - slack ||
    image.y < tile.y - slack ||
    image.x + image.width > tile.x + tile.width + slack ||
    image.y + image.height > tile.y + tile.height + slack
  ) {
    skipped.add('pattern')
    return null
  }
  const copies = (lo: number, hi: number, from: number, to: number, period: number) => [
    Math.ceil((lo - to) / period + EXACT),
    Math.floor((hi - from) / period - EXACT),
  ]
  const [x0 = 0, x1 = -1] = copies(node.x, node.x + node.width, image.x, image.x + image.width, tile.width)
  const [y0 = 0, y1 = -1] = copies(node.y, node.y + node.height, image.y, image.y + image.height, tile.height)
  if (x0 > x1 || y0 > y1) return 'nothing'
  if (x0 === x1 && y0 === y1) return placed(context, picture, copyAt(x0, y0), box)

  // It repeats: as tiles from the box's corner, when the picture is its whole tile, upright and even.
  const [a, b, c, d] = copyAt(0, 0)
  const wholeTile = Math.abs(image.width - tile.width) <= slack && Math.abs(image.height - tile.height) <= slack
  const upright = a > 0 && Math.abs(b) <= 1e-9 * a && Math.abs(c) <= 1e-9 * a && Math.abs(a - d) <= EXACT * a
  if (!wholeTile || !upright || a < TILE_SCALE.min || a > TILE_SCALE.max) {
    skipped.add('pattern')
    return null
  }
  const assetId = showPicture(pictures, picture)
  return assetId ? { type: 'image', assetId, fit: 'tile', tileScale: a } : null
}

/**
 * One copy of the picture whose pixels reach the frame through `m`, as a paint over `box`: fill or
 * fit where either places it there, else the crop that does. Null, and reported, for one turned or
 * mirrored in the frame.
 */
function placed(context: Context, picture: SvgImage, m: Matrix, box: Rect): PatternPaint | null {
  const [a, b, c, d, e, f] = m
  if (!(a > 0 && d > 0) || Math.abs(b) > 1e-9 * a || Math.abs(c) > 1e-9 * d) {
    context.skipped.add('pattern')
    return null
  }
  const assetId = showPicture(context.pictures, picture)
  if (!assetId) return null
  const fit = fitOf(picture, { x: e, y: f, width: a * picture.width, height: d * picture.height }, box)
  if (fit) return { type: 'image', assetId, fit }
  return {
    type: 'image',
    assetId,
    fit: 'crop',
    crop: { x: (box.x - e) / a, y: (box.y - f) / d, width: box.width / a, height: box.height / d },
  }
}

/** A pattern's attributes and children, following its href to the patterns it builds on. */
function patternOf(context: Pick<Context, 'ids'>, pattern: XmlElement) {
  const attrs: Record<string, string> = {}
  let children: XmlElement['children'] = []
  const seen = new Set<XmlElement>()
  for (
    let at: XmlElement | undefined = pattern;
    at?.name === 'pattern' && !seen.has(at);
    at = context.ids.get((at.attrs.href ?? '').replace(/^#/, ''))
  ) {
    seen.add(at)
    for (const [key, value] of Object.entries(at.attrs)) attrs[key] ??= value
    if (children.length === 0 && at.children.some((c) => typeof c !== 'string')) children = at.children
  }
  return { attrs, children }
}

/** The one <image> among `children`, through plain groups and uses, with its user space in theirs. */
function loneImage(
  context: Pick<Context, 'ids' | 'rules'>,
  children: XmlElement['children'],
  m: Matrix,
  depth: number,
): Lone | null {
  const elements = children.filter((c): c is XmlElement => typeof c !== 'string' && !SILENT.has(c.name))
  const [only] = elements
  if (elements.length !== 1 || !only || depth > MAX_DEPTH) return null
  const style = styleOf(only, {}, context.rules)
  const plain =
    style.display !== 'none' &&
    style.visibility !== 'hidden' &&
    style.visibility !== 'collapse' &&
    clamp01(Number.parseFloat(style.opacity ?? '1')) === 1 &&
    [style['clip-path'], style.mask, style.filter].every((v) => v === undefined || v === 'none')
  if (!plain) return null
  const own = multiply(m, parseTransform(only.attrs.transform ?? ''))
  if (only.name === 'image') return { image: only, m: own }
  if (only.name === 'g') return loneImage(context, only.children, own, depth + 1)
  if (only.name !== 'use') return null
  const target = context.ids.get((only.attrs.href ?? '').replace(/^#/, ''))
  const at = multiply(own, translate(length(only.attrs.x), length(only.attrs.y)))
  return target && target !== only ? loneImage(context, [target], at, depth + 1) : null
}

/** The axis-aligned box around `rect` carried through `m`. */
function bounds(m: Matrix, rect: Rect): Rect {
  const corners = [
    apply(m, rect.x, rect.y),
    apply(m, rect.x + rect.width, rect.y),
    apply(m, rect.x, rect.y + rect.height),
    apply(m, rect.x + rect.width, rect.y + rect.height),
  ]
  const xs = corners.map((p) => p.x)
  const ys = corners.map((p) => p.y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
}
