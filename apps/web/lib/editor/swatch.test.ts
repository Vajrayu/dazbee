import { describe, expect, it } from 'vitest'

import type { Paint } from '@dazbee/schema'

import { swatchOf } from './swatch.ts'

const paints = (list: unknown[]) => list as Paint[]

describe('swatchOf', () => {
  it('gives the top paint that shows as it looks, its alpha and its opacity kept', () => {
    expect(swatchOf(paints([{ type: 'solid', color: '#FF000080' }]))).toBe('#FF000080')
    expect(swatchOf(paints([{ type: 'solid', color: '#218A5CFF', opacity: 0.5 }]))).toBe('#218A5C80')
    expect(
      swatchOf(
        paints([
          { type: 'solid', color: '#218A5CFF' },
          { type: 'solid', color: '#FFFFFFFF', visible: false },
        ]),
      ),
    ).toBe('#218A5CFF')
  })

  it('gives a gradient’s first stop, mixed for an image, and none for no paint that shows', () => {
    const stops = [
      { color: '#FFD23FFF', at: 0 },
      { color: '#000000FF', at: 1 },
    ]
    expect(swatchOf(paints([{ type: 'linear', stops }]))).toBe('#FFD23FFF')
    expect(swatchOf(paints([{ type: 'image', assetId: 'a' }]))).toBe('mixed')
    expect(swatchOf(paints([{ type: 'solid', color: '#FFFFFFFF', visible: false }]))).toBe('none')
    expect(swatchOf([])).toBe('none')
  })
})
