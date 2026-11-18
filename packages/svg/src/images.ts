// An SVG's embedded pictures as layers: each <image> whose href is a base64 data URL of a PNG, JPEG
// or WebP becomes a rect filled with that picture, placed and cropped as preserveAspectRatio places
// it. The picture's bytes are only read for their header, never decoded: the layer names it by a
// key until the caller has an asset for it. A linked picture is never fetched.

import { imageFits, type ImagePaint, MAX_IMAGE_PIXELS, readImageHeader, type Rect } from '@dazbee/schema'

import { clamp01, length } from './lengths.ts'
import { nameOf } from './names.ts'
import { BLEND_MODES, type Style } from './style.ts'
import { apply, type Matrix, turnAndFlipOf, turnedBounds } from './transform.ts'
import type { Context, Piece } from './types.ts'
import type { XmlElement } from './xml.ts'

/** A picture the file embeds, kept under its key until it has an asset. */
export interface SvgImage {
  /** What its paints name in place of an asset id: `svg-image-1`, `svg-image-2`… */
  key: string
  bytes: Uint8Array
  contentType: 'image/png' | 'image/jpeg' | 'image/webp'
  width: number
  height: number
  /** The first layer's name that shows it, then the file's: `Photo · Card`. */
  name: string
}

/** The pictures one file embeds, each read once. */
export interface Pictures {
  /** The file's own name, which each picture's ends with. */
  fileName: string
  /** Each picture by its data URL; null for one that is left out. */
  byUrl: Map<string, SvgImage | null>
  /** Every picture read, in reading order: what the keys count and the limits hold. */
  read: SvgImage[]
  /** The pictures a layer shows, in the order they are first shown. */
  list: SvgImage[]
  /** The assets the keys stand for, when the caller has them; a key with none leaves its layer out. */
  assetIds: Readonly<Record<string, string>> | undefined
}

/** Where an <image> asks to be drawn: a side left undefined is the picture's own. */
export interface AskedView {
  x: number
  y: number
  width: number | undefined
  height: number | undefined
}

/** More distinct pictures than this in one file, or more pixels in all, and the rest are left out. */
const MAX_PICTURES = 50
const MAX_PICTURE_PIXELS = MAX_IMAGE_PIXELS

/**
 * How far a picture may sit from where fill or fit puts it and still be written as that fit, as a
 * share of the box's longer side: 0.16 px on the largest box (16,384 px), and well over the few
 * millionths that Figma's 6-digit matrices and an outline's single-precision box are off by. A
 * pattern's tile is measured against the same share of its own size.
 */
export const EXACT = 1e-5

/** The key prefix of a picture with no asset yet. */
const KEY = 'svg-image-'

/** No pictures read yet, for the file of this name, with the assets the caller has for their keys. */
export function newPictures(fileName: string, assetIds: Pictures['assetIds']): Pictures {
  return { fileName, byUrl: new Map(), read: [], list: [], assetIds }
}

/**
 * The <image> as a rect filled with its picture, in the design's coordinates, turned with it: its
 * box is the picture as drawn, or the viewport a slice fills, and its crop the part of the picture
 * that shows there, flipped where the file mirrors it. Null, and named as left out, for a linked,
 * unreadable or skewed one.
 */
export function imageLayer(context: Context, element: XmlElement, style: Style, m: Matrix): Piece | null {
  const { viewport, nodes, skipped, newId, pictures } = context
  if (style.visibility === 'hidden' || style.visibility === 'collapse') return null
  const href = (element.attrs.href ?? '').trim()
  if (!/^data:/i.test(href)) {
    if (href) skipped.add('external-reference')
    return null
  }
  // Turned, mirrored and scaled along its own sides only: a skew has no box to turn.
  const turned = turnAndFlipOf(m)
  if (turned === null) {
    skipped.add('image')
    return null
  }
  const { rotation, ...flips } = turned
  const asked = askedView(element, viewport)
  if (!asked) return null

  const name = nameOf(element, 'Image')
  const picture = pictureOf(pictures, href, name)
  if (!picture) {
    skipped.add('image')
    return null
  }
  const assetId = showPicture(pictures, picture)
  if (!assetId) return null
  const { drawn, crop } = placement(picture, viewIn(asked, picture), element.attrs.preserveAspectRatio ?? '')

  const centre = apply(m, drawn.x + drawn.width / 2, drawn.y + drawn.height / 2)
  const width = drawn.width * Math.hypot(m[0], m[1])
  const height = drawn.height * Math.hypot(m[2], m[3])
  const box = { x: centre.x - width / 2, y: centre.y - height / 2, width, height }

  const id = newId()
  const opacity = clamp01(Number.parseFloat(style.opacity ?? '1'))
  const blend = style['mix-blend-mode']
  // Fill where it shows exactly the same part of the picture, which is what an editor's user would pick.
  // Where the whole picture lands when its crop covers the box.
  const kx = box.width / crop.width
  const ky = box.height / crop.height
  const at = { x: box.x - crop.x * kx, y: box.y - crop.y * ky, width: picture.width * kx, height: picture.height * ky }
  const fit = fitOf(picture, at, box)
  const fill: Pick<ImagePaint, 'type' | 'assetId' | 'fit' | 'crop'> = fit
    ? { type: 'image', assetId, fit }
    : { type: 'image', assetId, fit: 'crop', crop }
  nodes[id] = {
    type: 'graphic',
    parentId: 'root',
    link: id,
    index: 'a0',
    name,
    props: {
      ...box,
      ...(Math.abs(rotation) > 1e-9 ? { rotation } : {}),
      ...flips,
      shape: { kind: 'rect' },
      fills: [fill],
      ...(opacity < 1 ? { opacity } : {}),
      ...(blend && BLEND_MODES.has(blend) ? { blendMode: blend as never } : {}),
    },
  }
  return { id, box: turnedBounds(box, rotation) }
}

/**
 * Where an <image> asks to be drawn, in its own user space. A side not given, or auto, is left for
 * the picture's own, as resvg draws it; null when a side is given as no size, which shows nothing.
 */
export function askedView(element: XmlElement, viewport: Context['viewport']): AskedView | null {
  const side = (raw: string | undefined, whole: number) =>
    raw === undefined || raw.trim() === 'auto' ? undefined : length(raw, whole)
  const width = side(element.attrs.width, viewport.width)
  const height = side(element.attrs.height, viewport.height)
  if ((width !== undefined && !(width > 0)) || (height !== undefined && !(height > 0))) return null
  return { x: length(element.attrs.x, viewport.width), y: length(element.attrs.y, viewport.height), width, height }
}

/** The view an <image> asked for, its missing sides the picture's own. */
export function viewIn(asked: AskedView, picture: SvgImage): Rect {
  return { x: asked.x, y: asked.y, width: asked.width ?? picture.width, height: asked.height ?? picture.height }
}

/** The asset a picture's paint names, listing the picture as shown; null when the caller has none for it. */
export function showPicture(pictures: Pictures, picture: SvgImage): string | null {
  const assetId = pictures.assetIds ? pictures.assetIds[picture.key] : picture.key
  if (!assetId) return null
  if (!pictures.list.includes(picture)) pictures.list.push(picture)
  return assetId
}

/**
 * The picture a data URL holds, read once: base64 of a PNG, JPEG or WebP, by its bytes whatever
 * type it claims, small enough to decode, and within the file's limits. Null for anything else.
 */
export function pictureOf(pictures: Pictures, url: string, layerName: string): SvgImage | null {
  const known = pictures.byUrl.get(url)
  if (known !== undefined) return known
  const picture = readPicture(pictures, url, layerName)
  pictures.byUrl.set(url, picture)
  if (picture) pictures.read.push(picture)
  return picture
}

/**
 * Where the picture is drawn in the viewport, in the image's user space, and the part of it that
 * shows there, in picture pixels: `meet` draws all of it in a box of its own shape, `slice` fills
 * the viewport with the part of it that fits, and `none` stretches all of it over the viewport.
 */
export function placement(picture: SvgImage, view: Rect, aspect: string): { drawn: Rect; crop: Rect } {
  const whole = { x: 0, y: 0, width: picture.width, height: picture.height }
  const [first = 'xMidYMid', second = 'meet'] = aspect
    .trim()
    .replace(/^defer\s+/, '')
    .split(/\s+/)
  if (first === 'none') return { drawn: view, crop: whole }
  const scales = [view.width / picture.width, view.height / picture.height]
  const s = second === 'slice' ? Math.max(...scales) : Math.min(...scales)
  const share = (axis: 'x' | 'Y') => (first.includes(`${axis}Min`) ? 0 : first.includes(`${axis}Max`) ? 1 : 0.5)
  const at = {
    x: view.x + (view.width - picture.width * s) * share('x'),
    y: view.y + (view.height - picture.height * s) * share('Y'),
  }
  if (second !== 'slice') return { drawn: { ...at, width: picture.width * s, height: picture.height * s }, crop: whole }
  return {
    drawn: view,
    crop: { x: (view.x - at.x) / s, y: (view.y - at.y) / s, width: view.width / s, height: view.height / s },
  }
}

/**
 * The fit that draws the whole picture at `at` over `box`, both in the same space: fill where it
 * covers the box, centred, or fit where it sits inside it, centred, each within EXACT; null for
 * neither, which takes a crop.
 */
export function fitOf(picture: { width: number; height: number }, at: Rect, box: Rect): 'fill' | 'fit' | null {
  const tolerance = EXACT * Math.max(box.width, box.height)
  for (const fit of ['fill', 'fit'] as const) {
    const k = (fit === 'fill' ? Math.max : Math.min)(box.width / picture.width, box.height / picture.height)
    const width = picture.width * k
    const height = picture.height * k
    const x = box.x + (box.width - width) / 2
    const y = box.y + (box.height - height) / 2
    if (
      Math.abs(at.x - x) <= tolerance &&
      Math.abs(at.y - y) <= tolerance &&
      Math.abs(at.width - width) <= tolerance &&
      Math.abs(at.height - height) <= tolerance
    )
      return fit
  }
  return null
}

function readPicture(pictures: Pictures, url: string, layerName: string): SvgImage | null {
  if (pictures.read.length >= MAX_PICTURES) return null
  const comma = url.indexOf(',')
  const params = url.slice(5, comma < 0 ? 0 : comma).split(';')
  if (comma < 0 || !params.some((p) => p.replace(/\s+/g, '').toLowerCase() === 'base64')) return null
  let bytes: Uint8Array
  try {
    // The body percent-decoded, as the data URL standard reads it, then base64 with its spaces dropped.
    const body = url
      .slice(comma + 1)
      .replace(/%([0-9a-f]{2})/gi, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
    const binary = atob(body.replace(/\s+/g, ''))
    bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  } catch {
    return null
  }
  const header = readImageHeader(bytes)
  if (!header || header.contentType === 'image/svg+xml' || !imageFits(header)) return null
  const pixels = pictures.read.reduce((sum, p) => sum + p.width * p.height, 0)
  if (pixels + header.width * header.height > MAX_PICTURE_PIXELS) return null
  return {
    key: `${KEY}${pictures.read.length + 1}`,
    bytes,
    contentType: header.contentType,
    width: header.width,
    height: header.height,
    // The layer's name first, so a list that cuts long names still tells the file's pictures apart.
    name: [layerName, pictures.fileName].filter(Boolean).join(' · '),
  }
}
