import { describe, expect, it } from 'vitest'

import { ar } from '@/lib/i18n/ar.ts'
import { en } from '@/lib/i18n/en.ts'

import { brandsLabel } from './brands-choice.tsx'

const brands = [
  { id: 'coffee', name: 'Harbour Coffee' },
  { id: 'cycles', name: 'Northline Cycles' },
]

describe('brandsLabel', () => {
  it('names every brand, the brands given in the order of the list, or none', () => {
    const words = en.settings.brands
    expect(brandsLabel(null, brands, words)).toBe('All brands')
    expect(brandsLabel(['cycles', 'coffee'], brands, words)).toBe('Harbour Coffee, Northline Cycles')
    expect(brandsLabel([], brands, words)).toBe('No brands')
    // A brand the viewer doesn't see is left out.
    expect(brandsLabel(['cycles', 'gone'], brands, words)).toBe('Northline Cycles')
  })

  it('joins the names with the comma of the person’s language', () => {
    expect(brandsLabel(['coffee', 'cycles'], brands, ar.settings.brands)).toBe('Harbour Coffee، Northline Cycles')
  })
})
