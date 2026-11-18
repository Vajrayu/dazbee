import { z } from 'zod'

import { framesOf } from './frames.ts'
import { FrameId } from './primitives.ts'

/** The image files an export makes. JPG has no transparency, so it is drawn over white. */
export const ExportType = z.enum(['png', 'jpg', 'webp', 'pdf', 'svg'])
export type ExportType = z.infer<typeof ExportType>
/** The types drawn as pixels, which a scale makes denser; PDF and SVG are vectors and ignore it. */
export const RASTER_EXPORT_TYPES = ['png', 'jpg', 'webp'] as const satisfies readonly ExportType[]
export const EXPORT_SCALES = [1, 2, 3] as const
/** The longest side WebP holds, which every raster export keeps to, so a frame exports the same in every type. */
export const MAX_EXPORT_SIDE = 16_383
/** The most pixels an export draws, so a browser tab's export worker never runs out of memory. */
export const MAX_EXPORT_PIXELS = 50_000_000

/** The tokens a file name is built from: the design's, the page's and the frame's names. */
export const EXPORT_NAME_TOKENS = ['design', 'page', 'frame'] as const
export type ExportNameToken = (typeof EXPORT_NAME_TOKENS)[number]
/** The name a file takes when the request names none: its frame's. */
export const DEFAULT_EXPORT_NAME = '{frame}'

/** Path separators, the characters some file systems reserve, and control characters. */
// eslint-disable-next-line no-control-regex
const UNSAFE_IN_NAMES = /[/\\:*?"<>|\u0000-\u001f]/g

/** How many pixels of the file to one of the frame, each way. */
export const ExportScale = z.literal(EXPORT_SCALES)
export type ExportScale = z.infer<typeof ExportScale>

/**
 * What to export from a design: some frames, as one file type. The same request runs in the
 * browser's export worker and in Node. More than one file comes as one zip.
 */
export const ExportRequest = z.object({
  frameIds: FrameId.array().min(1),
  type: ExportType,
  /** JPG and WebP quality, 1 to 100; WebP at 100 is lossless. */
  quality: z.number().int().min(1).max(100).default(90),
  /** PNG, JPG and WebP are drawn this many times the frame's size; PDF and SVG ignore it. */
  scale: ExportScale.default(1),
  /** The file name, from `{design}`, `{page}` and `{frame}`; the extension is added. */
  name: z.string().min(1).max(200).default(DEFAULT_EXPORT_NAME),
})
export type ExportRequest = z.infer<typeof ExportRequest>
/** A request as a caller writes it, before the defaults are filled in. */
export type ExportRequestInput = z.input<typeof ExportRequest>

export const isRasterExport = (type: ExportType) => (RASTER_EXPORT_TYPES as readonly ExportType[]).includes(type)

/** A frame's width and height in pixels when drawn at `scale`. */
export function exportedSize(frame: { readonly width: number; readonly height: number }, scale: number) {
  return { width: Math.ceil(frame.width * scale), height: Math.ceil(frame.height * scale) }
}

/** Whether a frame drawn at `scale` is within the side and the pixels a raster export may have. */
export function exportFits(frame: { readonly width: number; readonly height: number }, scale: number): boolean {
  const { width, height } = exportedSize(frame, scale)
  return width <= MAX_EXPORT_SIDE && height <= MAX_EXPORT_SIDE && width * height <= MAX_EXPORT_PIXELS
}

/** The name a frame's file takes, and the number added to it to keep it apart from the others. */
export interface NumberedName {
  /** The frame's own name made safe for files, then the number, if one was added. */
  name: string
  /** The number added after the name, which Export lists after the frame's own; null with none. */
  number: number | null
}

/**
 * The names a page's frames' files take, as Export lists them, by the page's order. Each name is
 * first made safe for files (safeFileName), so names that file alike count as one. A frame whose
 * name no other frame has, in any case, keeps it; so does the first of a repeated name. Each later
 * repeat gets the lowest number from 2 whose name no frame has and no earlier frame was given, so
 * no two are alike.
 */
export function numberedFrameNames<
  F extends { readonly pageId: string; readonly order: string; readonly name: string },
>(design: { readonly frames: Readonly<Record<string, F>> }, pageId: string): Map<string, NumberedName> {
  const frames = framesOf(design, pageId)
  const had = new Set(frames.map(([, frame]) => safeFileName(frame.name).toLowerCase()))
  const given = new Set<string>()
  const free = (name: string) => !had.has(name.toLowerCase()) && !given.has(name.toLowerCase())
  const names = new Map<string, NumberedName>()
  for (const [frameId, frame] of frames) {
    const base = safeFileName(frame.name)
    let numbered: NumberedName = { name: base, number: null }
    if (given.has(base.toLowerCase())) {
      let n = 2
      while (!free(`${base} ${n}`)) n++
      numbered = { name: `${base} ${n}`, number: n }
    }
    given.add(numbered.name.toLowerCase())
    names.set(frameId, numbered)
  }
  return names
}

/**
 * A name safe on every file system: no path separators or reserved characters, no leading dot,
 * never empty. A name it gives comes back the same.
 */
export function safeFileName(part: string) {
  const cleaned = part
    .replace(UNSAFE_IN_NAMES, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|\s+$/g, '')
  return cleaned || 'untitled'
}
