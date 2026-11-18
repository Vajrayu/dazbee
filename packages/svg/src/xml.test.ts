import { describe, expect, it } from 'vitest'

import { parseXml } from './xml.ts'

describe('parseXml', () => {
  it('reads an attribute of any length up to its closing quote, as an embedded picture writes one', () => {
    const long = 'A'.repeat(4_000_000)
    const root = parseXml(`<svg><image href="data:image/png;base64,${long}" width='10'/></svg>`)
    const image = root.children[0] ?? ''
    expect(typeof image !== 'string' && image.attrs.href?.length).toBe(long.length + 22)
    expect(typeof image !== 'string' && image.attrs.width).toBe('10')
  })

  it('reads an attribute however many spaces stand around its equals sign', () => {
    // Past a million characters from the name to the quote, which the reader once looked no further than.
    const root = parseXml(`<svg><image width${' '.repeat(600_000)}=${' '.repeat(600_000)}"60"/></svg>`)
    const image = root.children[0] ?? ''
    expect(typeof image !== 'string' && image.attrs.width).toBe('60')
  })

  // A guard: the reader refused this before it read attributes to their closing quote too.
  it('refuses an attribute whose quote never closes', () => {
    expect(() => parseXml('<svg width="10/>')).toThrow()
  })
})
