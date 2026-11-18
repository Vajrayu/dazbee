// Image files dropped from the computer on the stage: each uploads once into the brand's asset
// library, as the library's own upload sends it, then goes on the design where it was dropped,
// the way an asset dragged from the library does. An SVG file is placed from its own bytes, read
// as text by the editor, never by the browser's image decoder, once the pictures it shows have
// uploaded too.
import type { Editor, Point, Spot, SvgRead } from '@dazbee/editor'
import { type AssetSummary, isVectorAsset } from '@dazbee/schema'

import { IMAGE_ACCEPT, sendAsset } from '@/lib/upload-asset.ts'

/** Where a drop goes, read when it lands, so a pan or zoom while the files upload doesn't move it. */
export interface Drop {
  /** The point on the design it was dropped on; null off every frame. */
  spot: Spot | null
  /** The layer the one image fills, lit while it was dragged over it; null for new layers. */
  into: string | null
  /** How far apart the new layers go, in design pixels. */
  step: number
}

export interface DropResult {
  /** The files that didn't upload, and why. */
  failed: { name: string; reason: string }[]
  /** How many uploaded but weren't placed, having been dropped on no frame or one gone since. */
  unplaced: number
}

/** The image types a fill takes. */
const FILL_TYPES = IMAGE_ACCEPT.split(',')
const SVG_TYPE = 'image/svg+xml'
/** How far apart, in screen pixels at the drop, the images of one drop are laid: each lower and to the right of the one before. */
const CASCADE = 24

/** Whether a drag carries files from the computer. */
export const carriesFiles = (transfer: DataTransfer) => transfer.types.includes('Files')

/** Whether a file is one the asset library takes: a PNG, JPEG or WebP image, or an SVG file. */
export const isAssetFile = (file: { name: string; type: string }) =>
  FILL_TYPES.includes(file.type) || file.type === SVG_TYPE || /\.svg$/i.test(file.name)

/**
 * Whether files of these types, all a drop holds, fill the shape under them: one is an image a fill
 * takes and no other may be one the library takes. A file without a type may be an SVG file, known
 * by its name only once dropped, so it counts as one that may. Read from the types alone, the same
 * while dragging, when only they can be read, and on the drop.
 */
const fillsByTypes = (types: string[]) => {
  const maybe = types.filter((type) => type === '' || isAssetFile({ name: '', type }))
  return maybe.length === 1 && FILL_TYPES.includes(maybe[0] ?? '')
}

/** Whether a drag of files would fill the shape under it, so the shape lights up. */
export const dragFills = (transfer: DataTransfer) =>
  fillsByTypes(
    Array.from(transfer.items)
      .filter((item) => item.kind === 'file')
      .map((item) => item.type),
  )

/**
 * Uploads the files and places what uploaded where `drop` says: one image dropped on a layer that
 * takes an image fills it, otherwise each goes on as a new layer, the first centred on the drop
 * point and the rest cascading from it. An SVG file is read by the editor where it was dropped,
 * which uploads its pictures. Placing waits for any gesture open on the editor to end, and ends
 * typing, so everything placed is one undo step of its own, and selected. `sent` is told of each
 * file once it is sent, uploaded or not, before an SVG file's pictures upload.
 */
export async function placeDroppedFiles(
  editor: Editor,
  workspaceId: string,
  brandId: string,
  files: File[],
  drop: Drop,
  sent: (file: File) => void = () => {},
): Promise<DropResult> {
  const { spot, into, step } = drop
  const settled = await Promise.allSettled(
    files.map(async (file) => {
      const asset = await sendAsset(workspaceId, brandId, file, () => undefined).finally(() => sent(file))
      if (!isVectorAsset(asset)) return { asset, svg: false, read: null, offPage: false }
      const text = await file.text()
      // Dropped on no frame, or on one no longer shown, it isn't read and is counted as unplaced;
      // one that can't be read is noticed by the editor.
      const shown = !!spot && editor.frames().some((f) => f.id === spot.frameId)
      const read = shown ? await editor.readSvg(text, asset.name || 'SVG', spot) : null
      return { asset, svg: true, read, offPage: !shown }
    }),
  )
  const failed: DropResult['failed'] = []
  const done: { asset: AssetSummary; svg: boolean; read: SvgRead | null; offPage: boolean }[] = []
  settled.forEach((result, i) => {
    if (result.status === 'fulfilled') done.push(result.value)
    else
      failed.push({
        name: files[i]?.name ?? '',
        reason: result.reason instanceof Error ? result.reason.message : String(result.reason),
      })
  })
  if (!spot || done.length === 0) return { failed, unplaced: done.length }

  if (!(await editor.whenSettled())) return { failed, unplaced: 0 }
  // The frame dropped on may have gone, or its page be no longer shown, while the files uploaded.
  const frame = editor.frames().find((f) => f.id === spot.frameId)
  if (!frame) return { failed, unplaced: done.length }
  const ids: string[] = []
  let unplaced = 0
  const [only] = done
  const end = editor.beginGesture()
  try {
    if (into && only && done.length === 1 && !only.svg && editor.fillWithImage(into, only.asset))
      return { failed, unplaced }
    done.forEach(({ asset, svg, read, offPage }, i) => {
      const next: Spot = { frameId: spot.frameId, x: spot.x + i * step, y: spot.y + i * step }
      const at = next.x <= frame.width && next.y <= frame.height ? next : spot
      const id = svg ? read && editor.placeSvg({ ...read, spot: at }) : editor.placeImage(asset, at)
      if (id) ids.push(id)
      else if (!svg || offPage) unplaced++
    })
  } finally {
    end()
  }
  if (ids.length > 1) editor.select(ids)
  return { failed, unplaced }
}

/** Reads where `files`, every file dropped at `client`, go, and clears the lit shape. */
export function dropAt(editor: Editor, client: Point, files: File[]): Drop {
  const into = fillsByTypes(files.map((file) => file.type)) ? editor.imageTarget(client) : null
  editor.imageTarget(null)
  return { spot: editor.spotAt(client), into, step: CASCADE / editor.camera().zoom }
}
