import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { imageFits, readImageHeader } from './image-header.ts'

/** A PNG's signature and IHDR chunk saying `width` × `height`: all the header reader reads. */
const png = (width: number, height: number) => {
  const bytes = new Uint8Array(33)
  const view = new DataView(bytes.buffer)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  view.setUint32(8, 13)
  bytes.set(
    [...'IHDR'].map((c) => c.charCodeAt(0)),
    12,
  )
  view.setUint32(16, width)
  view.setUint32(20, height)
  bytes.set([8, 6, 0, 0, 0], 24)
  return bytes
}

describe('image headers', () => {
  it('reads a PNG', () => {
    expect(readImageHeader(png(37, 12))).toEqual({ contentType: 'image/png', width: 37, height: 12 })
  })

  it('reads a JPEG past its other markers', () => {
    const jpeg = new Uint8Array(readFileSync(join(import.meta.dirname, '../../../tests/pixels/assets/sneaker.jpg')))
    expect(readImageHeader(jpeg)).toMatchObject({
      contentType: 'image/jpeg',
      width: expect.any(Number),
      height: expect.any(Number),
    })
  })

  it('reads each kind of WebP', () => {
    const riff = (chunkName: string, body: number[]) =>
      new Uint8Array([
        ...Buffer.from('RIFF'),
        0,
        0,
        0,
        0,
        ...Buffer.from('WEBP'),
        ...Buffer.from(chunkName),
        0,
        0,
        0,
        0,
        ...body,
        ...new Array(20).fill(0),
      ])
    // VP8X: 24-bit width and height minus one at bytes 24 and 27.
    expect(readImageHeader(riff('VP8X', [0, 0, 0, 0, 99, 0, 0, 49, 0, 0]))).toEqual({
      contentType: 'image/webp',
      width: 100,
      height: 50,
    })
    // VP8L: signature byte, then 14-bit width and height minus one.
    const bits = (300 - 1) | ((200 - 1) << 14)
    expect(
      readImageHeader(riff('VP8L', [0x2f, bits & 0xff, (bits >> 8) & 0xff, (bits >> 16) & 0xff, (bits >> 24) & 0xff])),
    ).toEqual({ contentType: 'image/webp', width: 300, height: 200 })
  })

  it('refuses what is not an image, or claims an absurd size', () => {
    expect(readImageHeader(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull()
    expect(readImageHeader(new Uint8Array([0xff, 0xd8, 0x00]))).toBeNull()
    expect(readImageHeader(png(0, 1))).toBeNull()
  })

  it('reads an image too big to decode, which imageFits tells apart', () => {
    const big = readImageHeader(png(20_000, 1))
    expect(big).toEqual({ contentType: 'image/png', width: 20_000, height: 1 })
    expect(imageFits({ width: 20_000, height: 1 })).toBe(false)
    expect(imageFits({ width: 16_384, height: 6_103 })).toBe(true)
    expect(imageFits({ width: 16_385, height: 1 })).toBe(false)
    // 100 million pixels at most.
    expect(imageFits({ width: 10_000, height: 10_000 })).toBe(true)
    expect(imageFits({ width: 10_000, height: 10_001 })).toBe(false)
  })
})
