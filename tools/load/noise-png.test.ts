import { crc32, inflateSync } from 'node:zlib'

import { describe, expect, it } from 'vitest'

import { readImageHeader } from '@dazbee/schema'

import { noisePng } from './noise-png.ts'

describe('noisePng', () => {
  it('is a PNG of the size asked, with one unfiltered row of RGB bytes per line, each chunk checked', () => {
    const png = noisePng(40, 30)
    expect(readImageHeader(png)).toEqual({ contentType: 'image/png', width: 40, height: 30 })
    const bytes = Buffer.from(png)
    const chunks: { type: string; data: Buffer }[] = []
    for (let at = 8; at < bytes.length;) {
      const length = bytes.readUInt32BE(at)
      const body = bytes.subarray(at + 4, at + 8 + length)
      expect(bytes.readUInt32BE(at + 8 + length)).toBe(crc32(body))
      chunks.push({ type: body.subarray(0, 4).toString('ascii'), data: body.subarray(4) })
      at += 12 + length
    }
    expect(chunks.map((c) => c.type)).toEqual(['IHDR', 'IDAT', 'IEND'])
    const pixels = inflateSync(chunks[1]?.data ?? Buffer.alloc(0))
    expect(pixels.length).toBe(30 * (1 + 40 * 3))
    expect(pixels[0]).toBe(0)
  })

  it('is a new image each time', () => {
    expect(Buffer.from(noisePng(8, 8)).equals(Buffer.from(noisePng(8, 8)))).toBe(false)
  })
})
