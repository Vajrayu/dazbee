// Pictures the SVG tests embed: just the headers the converter reads, as data URLs.

/** A PNG's signature and IHDR chunk saying `width` × `height`. */
export function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33)
  const view = new DataView(bytes.buffer)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  view.setUint32(8, 13)
  bytes.set(ascii('IHDR'), 12)
  view.setUint32(16, width)
  view.setUint32(20, height)
  bytes.set([8, 6, 0, 0, 0], 24)
  return bytes
}

/** A JPEG's start and its frame header saying `width` × `height`. */
export function jpegHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(21)
  const view = new DataView(bytes.buffer)
  bytes.set([0xff, 0xd8, 0xff, 0xc0])
  view.setUint16(4, 17)
  bytes[6] = 8
  view.setUint16(7, height)
  view.setUint16(9, width)
  return bytes
}

/** A GIF's header saying `width` × `height`. */
export function gifHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(13)
  const view = new DataView(bytes.buffer)
  bytes.set(ascii('GIF89a'))
  view.setUint16(6, width, true)
  view.setUint16(8, height, true)
  return bytes
}

/** The bytes as a base64 data URL of `type`. */
export const dataUrl = (bytes: Uint8Array, type = 'image/png') =>
  `data:${type};base64,${Buffer.from(bytes).toString('base64')}`

function ascii(text: string) {
  return [...text].map((c) => c.charCodeAt(0))
}
