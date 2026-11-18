import { describe, expect, it } from 'vitest'

import type { FontFamily } from '@dazbee/schema'

import { categoryOf, offeredFamilies, weightsOf } from './font-catalog.ts'

const family = (name: string, source: FontFamily['source']): FontFamily => ({
  family: name,
  source,
  category: null,
  faces: [{ id: `${name}-400`, family: name, weight: 400, style: 'normal', source, byteSize: 1 }],
})

describe('categoryOf', () => {
  it('reads Google’s category, and gives each font we ship its own', () => {
    expect(categoryOf({ ...family('Lora', 'google'), category: 'serif' })).toBe('serif')
    expect(categoryOf(family('Noto Sans', 'builtin'))).toBe('sans-serif')
    expect(categoryOf(family('Noto Sans Devanagari', 'builtin'))).toBe('sans-serif')
    expect(categoryOf(family('Noto Naskh Arabic', 'builtin'))).toBe('serif')
  })

  it('has none for an upload, or for a category it doesn’t know', () => {
    expect(categoryOf(family('Brand Grotesk', 'upload'))).toBeNull()
    expect(categoryOf({ ...family('Odd', 'google'), category: 'symbols' })).toBeNull()
  })
})

describe('offeredFamilies', () => {
  it('leaves out the script fonts we copied, which text falls back to, and keeps a brand’s upload of one', () => {
    const list = [
      family('Inter', 'google'),
      family('Noto Color Emoji', 'google'),
      family('Noto Sans JP', 'google'),
      family('Noto Sans Thai', 'upload'),
    ]
    expect(offeredFamilies(list).map((f) => f.family)).toEqual(['Inter', 'Noto Sans Thai'])
  })
})

describe('weightsOf', () => {
  const face = (weight: number, style: 'normal' | 'italic', weights?: { min: number; max: number }) => ({
    id: `f-${weight}-${style}`,
    family: 'Vary Sans',
    weight,
    ...(weights ? { weights } : {}),
    style,
    source: 'upload' as const,
    byteSize: 1,
  })
  const of = (...faces: ReturnType<typeof face>[]): FontFamily => ({
    family: 'Vary Sans',
    source: 'upload',
    category: null,
    faces,
  })

  it('lists a variable face’s weights across its range, and each face of one weight', () => {
    expect(weightsOf(of(face(400, 'normal', { min: 100, max: 900 })))).toEqual([
      100, 200, 300, 400, 500, 600, 700, 800, 900,
    ])
    expect(weightsOf(of(face(400, 'normal'), face(700, 'normal')))).toEqual([400, 700])
  })

  it('takes the upright faces where there are some, a variable italic’s range where there are none', () => {
    expect(weightsOf(of(face(400, 'normal'), face(400, 'italic', { min: 300, max: 700 })))).toEqual([400])
    expect(weightsOf(of(face(400, 'italic', { min: 300, max: 700 })))).toEqual([300, 400, 500, 600, 700])
  })
})
