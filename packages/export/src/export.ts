// Exports (#55, #56): one function per file type. PNG, JPG and WebP are drawn on the CPU surface
// (ADR-0005), at the request's scale, and PDF and SVG on Skia's PDF and SVG canvases, by the render
// seam, so the browser's export worker and Node make the same bytes from the same design.
import type { CanvasKit } from '@dazbee/canvaskit'
import { renderEncoded, renderPixels, renderVector, type ResourceBytes, type ResourceCache } from '@dazbee/renderer'
import {
  type Design,
  EXPORT_NAME_TOKENS,
  exportFits,
  type ExportNameToken,
  ExportRequest,
  type ExportType,
  type Frame,
  isRasterExport,
  numberedFrameNames,
  type NumberedName,
  type Page,
  parseDesign,
  safeFileName,
} from '@dazbee/schema'

import { zip } from './zip.ts'

export interface ExportedFile {
  /** The file's name, or its path inside the zip. */
  name: string
  type: string
  bytes: Uint8Array
}

const MIME: Record<ExportType | 'zip', string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  pdf: 'application/pdf',
  svg: 'image/svg+xml',
  zip: 'application/zip',
}

const TOKENS = new RegExp(`\\{(${EXPORT_NAME_TOKENS.join('|')})\\}`, 'g')

/**
 * The request's frames, in its order, each one file, named from the request's template. A frame's
 * name is the one its page's frames give it (numberedFrameNames), numbered by its place among them
 * once made safe for files, whichever frames are asked for, so a file takes the name Export lists
 * its frame by; a file name still taken, in any case, gets " 2", " 3" and so on. A PNG, JPG or
 * WebP past 1x ends in its scale (`Sale 2@2x.png`). One file comes as itself; more come as one flat
 * zip named after the design. A raster request with any frame too big at its scale (exportFits) is
 * refused before one is drawn. `onFile` hears each file as it is made, so a caller can show progress.
 */
export function exportDesign(
  ck: CanvasKit,
  json: unknown,
  input: unknown,
  bytes: ResourceBytes,
  cache?: ResourceCache,
  onFile?: (done: number, total: number) => void,
): ExportedFile {
  const parsed = parseDesign(json)
  if (!parsed.success) throw new Error(`invalid design:\n${parsed.errors.join('\n')}`)
  const design = parsed.design
  const request = ExportRequest.parse(input)
  const missing = request.frameIds.find((frameId) => !Object.hasOwn(design.frames, frameId))
  if (missing !== undefined) throw new Error(`no frame "${missing}"`)
  const { type, scale, quality } = request
  const raster = isRasterExport(type)
  if (raster) {
    const tooBig = request.frameIds.filter((frameId) => !exportFits(design.frames[frameId] as Frame, scale))
    if (tooBig.length > 0)
      throw new Error(
        `too big to export at ${scale}x: ${tooBig.map((frameId) => `"${design.frames[frameId]?.name}"`).join(', ')}`,
      )
  }
  const suffix = raster && scale !== 1 ? `@${scale}x.${type}` : `.${type}`
  const taken = new Set<string>()
  // Each page's frames' numbered names, worked out once per page.
  const numbered = new Map<string, Map<string, NumberedName>>()
  const files = request.frameIds.map((frameId, i) => {
    const frame = design.frames[frameId] as Frame
    const page = design.pages[frame.pageId] as Page
    let names = numbered.get(frame.pageId)
    if (!names) numbered.set(frame.pageId, (names = numberedFrameNames(design, frame.pageId)))
    const image = {
      png: () => exportPng(ck, design, frameId, bytes, cache, scale),
      jpg: () => exportJpg(ck, design, frameId, bytes, quality, cache, scale),
      webp: () => exportWebp(ck, design, frameId, bytes, quality, cache, scale),
      pdf: () => exportPdf(ck, design, frameId, bytes, cache),
      svg: () => exportSvg(ck, design, frameId, bytes, cache),
    }[type]()
    const base = fileName(request.name, {
      design: design.meta.name,
      page: page.name,
      frame: names.get(frameId)?.name ?? frame.name,
    })
    let name = `${base}${suffix}`
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base} ${n}${suffix}`
    taken.add(name.toLowerCase())
    onFile?.(i + 1, request.frameIds.length)
    return { name, type: MIME[type], bytes: image }
  })
  const [only] = files
  if (files.length === 1 && only) return only
  return {
    name: `${safeFileName(design.meta.name)}.zip`,
    type: MIME.zip,
    bytes: zip(files.map((f) => ({ path: f.name, bytes: f.bytes }))),
  }
}

/** One frame as a PNG, `scale` times its size, transparency kept. */
export function exportPng(
  ck: CanvasKit,
  design: Design,
  frameId: string,
  bytes: ResourceBytes,
  cache?: ResourceCache,
  scale = 1,
): Uint8Array {
  return renderEncoded(ck, design, frameId, bytes, { format: 'png', scale }, cache)
}

/**
 * One frame as a WebP, `scale` times its size, at a quality from 1 to 100, transparency kept; at
 * 100 it is lossless.
 */
export function exportWebp(
  ck: CanvasKit,
  design: Design,
  frameId: string,
  bytes: ResourceBytes,
  quality: number,
  cache?: ResourceCache,
  scale = 1,
): Uint8Array {
  return renderEncoded(ck, design, frameId, bytes, { format: 'webp', quality, scale }, cache)
}

/**
 * One frame as a JPG, `scale` times its size, at a quality from 1 to 100, over white where the
 * frame is see-through.
 */
export function exportJpg(
  ck: CanvasKit,
  design: Design,
  frameId: string,
  bytes: ResourceBytes,
  quality: number,
  cache?: ResourceCache,
  scale = 1,
): Uint8Array {
  const { width, height, pixels } = renderPixels(ck, design, frameId, bytes, cache, scale)
  const opaque = new Uint8Array(pixels.length)
  for (let i = 0; i < pixels.length; i += 4) {
    const a = pixels[i + 3] ?? 255
    // Integer blending, so every runtime rounds the same way.
    for (let c = 0; c < 3; c++) opaque[i + c] = Math.round(((pixels[i + c] ?? 0) * a + 255 * (255 - a)) / 255)
    opaque[i + 3] = 255
  }
  const image = ck.MakeImage(
    {
      width,
      height,
      colorType: ck.ColorType.RGBA_8888,
      alphaType: ck.AlphaType.Opaque,
      colorSpace: ck.ColorSpace.SRGB,
    },
    opaque,
    width * 4,
  )
  if (!image) throw new Error('CanvasKit could not make the image to encode')
  try {
    const jpg = image.encodeToBytes(ck.ImageFormat.JPEG, quality)
    if (!jpg) throw new Error('CanvasKit could not encode the JPG')
    return jpg
  } finally {
    image.delete()
  }
}

/**
 * One frame as a one-page PDF for print: shapes and text stay vectors, text keeps its fonts
 * embedded and can be selected, and a page unit is one pixel of the frame.
 */
export function exportPdf(
  ck: CanvasKit,
  design: Design,
  frameId: string,
  bytes: ResourceBytes,
  cache?: ResourceCache,
): Uint8Array {
  return renderVector(ck, design, frameId, bytes, 'pdf', cache, { title: design.meta.name })
}

/** One frame as an SVG, its text drawn as shapes so it looks the same in every app. */
export function exportSvg(
  ck: CanvasKit,
  design: Design,
  frameId: string,
  bytes: ResourceBytes,
  cache?: ResourceCache,
): Uint8Array {
  return renderVector(ck, design, frameId, bytes, 'svg', cache)
}

/** A file name from the request's template, its tokens filled in; anything else is kept as written. */
export function fileName(template: string, values: Record<ExportNameToken, string>): string {
  return safeFileName(template.replace(TOKENS, (_, token: ExportNameToken) => values[token]))
}
