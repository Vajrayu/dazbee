// SVG files with pictures for the tests of placing them, and an uploader that holds or fails each
// picture as storage would.
import type { PlacedAsset } from './tools.ts'

/** What one call of the uploader was given. */
export interface Upload {
  type: string
  name: string
  bytes: number
}

/**
 * A file 400 × 300 of a card filling it and `count` distinct PNG pictures, `Photo 1`…, four to a
 * row, 100 apart; with `twice`, the first picture shown again below the others, and with `gif`, a
 * GIF picture, which no layer shows.
 */
export function photoSvg(count: number, { twice = false, gif = false } = {}) {
  const image = (name: string, i: number, href: string) =>
    `<image id="${name}" x="${(i % 4) * 100}" y="${Math.floor(i / 4) * 100}" width="80" height="80" href="${href}"/>`
  const pictures = Array.from({ length: count }, (_, i) => image(`Photo ${i + 1}`, i, pngUrl(4 + i, 4)))
  if (twice) pictures.push(image('Again', 8, pngUrl(4, 4)))
  if (gif) pictures.push(image('Moving', 9, `data:image/gif;base64,${base64(gifHeader(4, 4))}`))
  return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect id="Card" width="400" height="300" fill="#eeeeee"/>${pictures.join('')}</svg>`
}

/**
 * An uploader that answers each picture with an asset, `asset-<n>` by the order it was asked for,
 * keeping what it was given and how many ran at once at most. With `hold`, every upload waits for
 * `release`; the pictures named in `fail` fail with "Storage is down".
 */
export function uploader({ hold = false, fail = [] as readonly string[] } = {}) {
  const calls: Upload[] = []
  let running = 0
  let most = 0
  let release = () => {}
  const held = hold ? new Promise<void>((resolve) => (release = resolve)) : Promise.resolve()
  async function upload(bytes: Uint8Array, type: string, name: string): Promise<PlacedAsset> {
    calls.push({ type, name, bytes: bytes.length })
    const n = calls.length
    running++
    most = Math.max(most, running)
    try {
      await held
      if (fail.includes(name)) throw new Error('Storage is down')
      return { id: `asset-${n}`, name, width: 40, height: 30 }
    } finally {
      running--
    }
  }
  return { upload, calls, most: () => most, release: () => release() }
}

/** A PNG picture's data URL: its signature and a header saying `width` × `height`, all the converter reads. */
function pngUrl(width: number, height: number) {
  const bytes = new Uint8Array(33)
  const view = new DataView(bytes.buffer)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  view.setUint32(8, 13)
  bytes.set([0x49, 0x48, 0x44, 0x52], 12)
  view.setUint32(16, width)
  view.setUint32(20, height)
  bytes.set([8, 6, 0, 0, 0], 24)
  return `data:image/png;base64,${base64(bytes)}`
}

/** A GIF's header saying `width` × `height`. */
function gifHeader(width: number, height: number) {
  const bytes = new Uint8Array(13)
  const view = new DataView(bytes.buffer)
  bytes.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
  view.setUint16(6, width, true)
  view.setUint16(8, height, true)
  return bytes
}

function base64(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
}
