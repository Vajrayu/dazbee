// Image files pasted from outside: each read as bytes and known by its header (a PNG, JPEG or WebP
// a tab can draw), never by the browser's decoder, uploaded into the brand's library, then placed
// once nothing is open on the stage, as one undo step: as new layers, or as the fill of the layer
// they were pasted onto.
import { frameIdOf, type Session } from '@dazbee/doc'
import { imageFits, type Paint, readImageHeader } from '@dazbee/schema'
import { SVG_TYPE } from '@dazbee/svg'

import type { EditorView, Spot } from './canvas/view.ts'
import type { ClipboardFile } from './clipboard.ts'
import type { NoticeDetail } from './core-interface.ts'
import { newImage, withImage } from './gestures/drawing/draw-tools.ts'
import type { EditorPlaceSvg } from './place-svg.ts'
import { runQuietly } from './run-quietly.ts'
import type { EditorSelection } from './selection.ts'
import { stepOf } from './shortcuts.ts'
import type { EditorTools, PlacedAsset } from './tools.ts'
import type { EditorUploads, Upload } from './uploads.ts'

/** Where pasted images go, read when they were pasted: a pan, a zoom or a click while they upload moves nothing. */
export interface ImagesWhere {
  /** The spot the first goes on, centred; the rest cascade from it. */
  spot: Spot
  /** The layer one image file pasted fills in place of a new layer; null for new layers. */
  into: string | null
}

export interface PlaceImagesDeps {
  session: Session
  view: Pick<EditorView, 'frameOf' | 'camera'>
  tools: Pick<EditorTools, 'setTool'>
  selection: Pick<EditorSelection, 'select'>
  /** Waits for the stage to settle before placing. */
  svg: Pick<EditorPlaceSvg, 'whenSettled'>
  /** Uploads the pictures, telling the page they upload. */
  uploads: Pick<EditorUploads, 'upload'>
  /** Whether the editor was given an uploader: without one, no image is pasted. */
  canUpload: boolean
  /** Whether the tab may only view the design: then nothing is read or uploaded. */
  readOnly: () => boolean
  /** Tells the page the tab may only view the design. */
  tellViewOnly: () => void
  /** Tells the page the files that weren't placed. */
  notify: (...told: NoticeDetail<'imagesNotPasted'>) => void
  /** Aborted when the editor is destroyed: nothing is read or placed after that. */
  signal: AbortSignal
}

export interface EditorPlaceImages {
  /** Whether a paste of these files is one of images to place: one claims to be an image other than SVG, and there is an uploader. */
  takes(files: readonly ClipboardFile[]): boolean
  /**
   * Reads each of the files that claims to be an image other than SVG, keeps those whose header is
   * a PNG, JPEG or WebP a tab can draw, and uploads them, named after their files (a browser's
   * copied picture, `image`, as PASTED_NAME). Then, once nothing is open on the stage, places what
   * uploaded as one undo step called paste, selected in its frame, with the select tool back: the
   * one image file pasted into `into` as its fill while that layer still takes one, or else each as
   * a new layer at its own size scaled down to half the frame, the first centred on `spot` and each
   * next CASCADE screen pixels lower and to the right, while that stays in the frame. Tells the
   * names of the files it read that weren't placed. Gives the layers it placed or filled: none in a
   * tab that may only view, which is told, or when their frame has gone.
   */
  paste(files: readonly ClipboardFile[], where: ImagesWhere): Promise<string[]>
}

/** How far apart, in screen pixels at the paste, the images of one paste are laid, as a drop's are. */
export const CASCADE = 24
/** The name of a picture copied from a page or a screenshot, which a browser names `image`. */
export const PASTED_NAME = 'Pasted image'

export function editorPlaceImages({
  session,
  view,
  tools,
  selection,
  svg,
  uploads,
  canUpload,
  readOnly,
  tellViewOnly,
  notify,
  signal,
}: PlaceImagesDeps): EditorPlaceImages {
  function takes(files: readonly ClipboardFile[]) {
    return canUpload && files.some(isImageFile)
  }

  async function paste(files: readonly ClipboardFile[], where: ImagesWhere): Promise<string[]> {
    if (readOnly()) {
      tellViewOnly()
      return []
    }
    const step = CASCADE / view.camera().zoom
    const images = files.filter(isImageFile)
    const read = await Promise.all(images.map(readImage))
    if (signal.aborted) return []
    const pictures = read.flatMap((image) => (image ? [image] : []))
    const assets = pictures.length > 0 ? await uploads.upload(pictures) : {}
    const placed = pictures.flatMap(({ key }) => assets[key] ?? [])
    const notPlaced = images.filter((_, i) => !assets[String(i)]).map((file) => file.name)
    if (notPlaced.length > 0 && !signal.aborted) notify('imagesNotPasted', { names: notPlaced })
    if (placed.length === 0 || !(await svg.whenSettled())) return []
    const [only] = placed
    if (only && images.length === 1 && where.into && fill(where.into, only)) return [where.into]
    return put(placed, where.spot, step)
  }

  /** The file's bytes as a picture to upload, keyed by its place among the images pasted; null when its header is no image a tab can draw. */
  async function readImage(file: ClipboardFile, i: number): Promise<Upload | null> {
    const bytes = await file.bytes().catch(() => null)
    const header = bytes && readImageHeader(bytes)
    if (!bytes || !header || !imageFits(header)) return null
    return { key: String(i), bytes, contentType: header.contentType, name: nameOf(file) }
  }

  /** Puts the image into the layer as its fill as one undo step, selected in its frame; false when the layer no longer takes one. */
  function fill(id: string, asset: PlacedAsset) {
    const now = session.design()
    const node = now.nodes[id]
    const frameId = frameIdOf(now, id)
    if (signal.aborted || !node || !('fills' in node.props) || node.lock?.style || frameId === undefined) return false
    const fills = withImage(node.props.fills as Paint[], asset.id)
    if (
      !runQuietly(() =>
        session.gesture(stepOf('paste'), () => session.run('node.update', { ids: [id], patch: { fills } })),
      )
    )
      return false
    tools.setTool('select')
    selection.select([id], frameId)
    return true
  }

  /** Places the uploaded images as new layers as one undo step, as `paste` says, and selects them. */
  function put(assets: PlacedAsset[], spot: Spot, step: number): string[] {
    const frame = view.frameOf(spot.frameId)
    if (signal.aborted || !frame || !session.design().frames[frame.id]) return []
    let ids: string[] = []
    const ok = runQuietly(() =>
      session.gesture(stepOf('paste'), () => {
        ids = assets.map((asset, i) => {
          const next = { x: spot.x + i * step, y: spot.y + i * step }
          const at = next.x <= frame.width && next.y <= frame.height ? next : spot
          return session.run('node.create', { parentId: frame.id, layer: newImage(asset, at, frame) })
        })
      }),
    )
    if (!ok) return []
    tools.setTool('select')
    selection.select(ids, frame.id)
    return ids
  }

  return { takes, paste }
}

/** Whether a file claims to be an image other than SVG, which is placed as layers of its own. */
function isImageFile(file: ClipboardFile) {
  return file.type.startsWith('image/') && file.type !== SVG_TYPE
}

/** The name a pasted image is uploaded by: its file's, without the extension, or PASTED_NAME for a browser's copied picture. */
function nameOf(file: ClipboardFile) {
  const base = file.name.replace(/\.[^.]*$/, '').trim()
  return base === '' || base.toLowerCase() === 'image' ? PASTED_NAME : base
}
