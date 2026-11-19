// A PNG of random pixels, so each upload is a new image the API stores and makes a thumbnail of, not
// one it already has under the same hash.
import { randomBytes } from 'node:crypto'
import { crc32, deflateSync } from 'node:zlib'

const SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)

/** A `width` by `height` PNG of random opaque RGB pixels. */
export function noisePng(width: number, height: number): Uint8Array {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  // 8 bits a channel, RGB, the default compression, filter and no interlace.
  header.set([8, 2, 0, 0, 0], 8)
  const rowBytes = 1 + width * 3
  const pixels = randomBytes(rowBytes * height)
  // Each row starts with its filter type, none.
  for (let row = 0; row < height; row++) pixels[row * rowBytes] = 0
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** One PNG chunk: its length, type, data and the CRC of its type and data. */
function chunk(type: string, data: Uint8Array): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const out = Buffer.alloc(8 + body.length)
  out.writeUInt32BE(data.length, 0)
  out.set(body, 4)
  out.writeUInt32BE(crc32(body), 4 + body.length)
  return out
}
