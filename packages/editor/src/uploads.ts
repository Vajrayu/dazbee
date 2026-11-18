// Uploading pictures into the brand's library, an SVG file's and pasted images alike, a few at a
// time, telling the page the names of every picture uploading as they start and end.
import type { CoreOptions, NoticeDetail } from './core-interface.ts'
import type { PlacedAsset } from './tools.ts'

/** A picture to upload into the brand's library: its key among those uploading with it, its bytes, sniffed type and name. */
export interface Upload {
  key: string
  bytes: Uint8Array
  contentType: string
  name: string
}

export interface UploadsDeps {
  /** Uploads a picture into the brand's library; without it, nothing is uploaded. */
  upload?: CoreOptions['uploadImage']
  /** Whether the tab may only view the design: then nothing is uploaded. */
  readOnly: () => boolean
  /** Tells the names of the pictures uploading. */
  notify: (...told: NoticeDetail<'uploading'>) => void
  /** Aborted when the editor is destroyed: no more pictures are sent after that. */
  signal: AbortSignal
}

export interface EditorUploads {
  /** Whether pictures can be uploaded now: there is an uploader, and the tab may edit the design. */
  can(): boolean
  /**
   * Uploads pictures into the brand's library, UPLOADS_AT_ONCE at a time, telling the page the
   * names of all uploading as they start and end. Gives the asset each that uploaded became, by its
   * key: none when pictures can't be uploaded now.
   */
  upload(pictures: readonly Upload[]): Promise<Record<string, PlacedAsset>>
}

/** How many pictures upload at the same time. */
const UPLOADS_AT_ONCE = 4

export function editorUploads({ upload, readOnly, notify, signal }: UploadsDeps): EditorUploads {
  /** The names of the pictures uploading now, from every upload. */
  let uploading: string[] = []

  function can() {
    return upload !== undefined && !readOnly()
  }

  async function uploaded(images: readonly Upload[]) {
    const assets: Record<string, PlacedAsset> = {}
    const send = readOnly() ? undefined : upload
    if (images.length === 0 || !send) return assets
    const names = images.map((image) => image.name)
    uploading = [...uploading, ...names]
    notify('uploading', { names: uploading })
    let next = 0
    const take = async () => {
      // Once the editor has ended, no more pictures are sent.
      for (let image = images[next++]; image && !signal.aborted; image = images[next++]) {
        try {
          assets[image.key] = await send(image.bytes, image.contentType, image.name)
        } catch {
          // The caller tells what didn't upload.
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(UPLOADS_AT_ONCE, images.length) }, take))
    // A new list, so the one the page was told as they started stays as it was.
    const left = [...uploading]
    for (const name of names) left.splice(left.indexOf(name), 1)
    uploading = left
    if (!signal.aborted) notify('uploading', { names: uploading })
    return assets
  }

  return { can, upload: uploaded }
}
