import { describe, expect, it } from 'vitest'

import { GOOGLE_FONTS } from './google.ts'
import { FONT_FACES } from './index.ts'
import { SCRIPT_FONTS } from './scripts.ts'

/** Families designs are already set in: the list keeps them, so no such design loses its font. */
const FAMILIES_IN_USE = [
  'Inter',
  'Roboto',
  'Open Sans',
  'Montserrat',
  'Poppins',
  'Lato',
  'Oswald',
  'Raleway',
  'Nunito',
  'Work Sans',
  'DM Sans',
  'Space Grotesk',
  'Rubik',
  'Bebas Neue',
  'Anton',
  'Archivo Black',
  'Playfair Display',
  'Merriweather',
  'Lora',
  'DM Serif Display',
  'Abril Fatface',
  'Lobster',
  'Pacifico',
  'Dancing Script',
  'Caveat',
  'Permanent Marker',
  'Space Mono',
  'Cairo',
  'Tajawal',
  'Hind',
]

describe('GOOGLE_FONTS', () => {
  const names = GOOGLE_FONTS.map((f) => f.family)

  it('offers about 300 families', () => {
    expect(names.length).toBeGreaterThanOrEqual(280)
    expect(names.length).toBeLessThanOrEqual(320)
  })

  it('has every category', () => {
    expect(new Set(GOOGLE_FONTS.map((f) => f.category))).toEqual(
      new Set(['sans-serif', 'serif', 'display', 'handwriting', 'monospace']),
    )
  })

  it('names each family once', () => {
    expect(names.filter((name, i) => names.indexOf(name) !== i)).toEqual([])
  })

  it('names no script font and no font we ship', () => {
    expect(names.filter((name) => SCRIPT_FONTS.some((f) => f.family === name))).toEqual([])
    expect(names.filter((name) => FONT_FACES.some((f) => f.family === name))).toEqual([])
  })

  it('names no barcode font, whose preview would show bars instead of its name', () => {
    expect(names.filter((name) => /barcode/i.test(name))).toEqual([])
  })

  it('keeps every family designs are set in', () => {
    expect(FAMILIES_IN_USE.filter((name) => !names.includes(name))).toEqual([])
  })

  it('gives each family weights in rising order, each a hundred from 400 to 900', () => {
    const bad = GOOGLE_FONTS.filter(
      ({ weights }) =>
        weights.length === 0 ||
        weights.some((w, i) => w % 100 !== 0 || w < 400 || w > 900 || (i > 0 && w <= (weights[i - 1] ?? 0))),
    )
    expect(bad.map((f) => f.family)).toEqual([])
  })
})
