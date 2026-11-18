import { describe, expect, it } from 'vitest'

import { alphaChange, hexChange, hexOf, hexText, holdsColour, parseHex, typedHexChange } from './colour.ts'

describe('hexOf', () => {
  it('is the #RRGGBB part of an 8-digit and a 6-digit hex, its case kept', () => {
    expect(hexOf('#12ab34CC')).toBe('#12ab34')
    expect(hexOf('#12AB34')).toBe('#12AB34')
  })
})

describe('holdsColour', () => {
  it('is whether colours hold a #RRGGBB, case and alpha aside', () => {
    const kit = ['#12ab34ff', '#E0301E']
    expect(holdsColour(kit, '#12AB34')).toBe(true)
    expect(holdsColour(kit, '#e0301e80')).toBe(true)
    expect(holdsColour(kit, '#1E50E0')).toBe(false)
    expect(holdsColour([], '#12AB34')).toBe(false)
  })
})

describe('hexChange', () => {
  it('sets the #RRGGBB and keeps the alpha of an 8-digit hex', () => {
    expect(hexChange('#FFFFFF')('#12AB3480')).toBe('#FFFFFF80')
  })

  it('makes a 6-digit hex, an empty one or no colour opaque', () => {
    expect(hexChange('#FFFFFF')('#12AB34')).toBe('#FFFFFFFF')
    expect(hexChange('#FFFFFF')('')).toBe('#FFFFFFFF')
    expect(hexChange('#FFFFFF')(undefined)).toBe('#FFFFFFFF')
  })
})

describe('alphaChange', () => {
  it('sets the alpha of an 8-digit and a 6-digit hex, in upper case', () => {
    expect(alphaChange(0.5)('#12ab34FF')).toBe('#12ab3480')
    expect(alphaChange(0.04)('#12AB34')).toBe('#12AB340A')
  })

  it('is cut short at 0 and 1', () => {
    expect(alphaChange(2)('#12AB3400')).toBe('#12AB34FF')
    expect(alphaChange(-1)('#12AB34FF')).toBe('#12AB3400')
  })

  it('starts from black with an empty colour or none', () => {
    expect(alphaChange(1)('')).toBe('#000000FF')
    expect(alphaChange(0)(undefined)).toBe('#00000000')
  })
})

describe('hexText', () => {
  it('drops an opaque alpha, in either case', () => {
    expect(hexText('#12ab34FF')).toBe('#12AB34')
    expect(hexText('#12AB34ff')).toBe('#12AB34')
  })

  it('keeps an alpha that is not opaque', () => {
    expect(hexText('#12ab3480')).toBe('#12AB3480')
    expect(hexText('#12AB3400')).toBe('#12AB3400')
  })

  it('shows a 6-digit hex in upper case', () => {
    expect(hexText('#12ab34')).toBe('#12AB34')
  })
})

describe('typedHexChange', () => {
  it('sets the #RRGGBB of a 6-digit hex typed and keeps the alpha', () => {
    expect(typedHexChange('12ab34')?.('#FFFFFF80')).toBe('#12AB3480')
    expect(typedHexChange(' #12AB34 ')?.(undefined)).toBe('#12AB34FF')
  })

  it('sets the colour and its alpha both from an 8-digit hex typed', () => {
    expect(typedHexChange('#12ab3440')?.('#FFFFFF80')).toBe('#12AB3440')
    expect(typedHexChange('12AB34FF')?.('#FFFFFF80')).toBe('#12AB34FF')
  })

  it('is null for anything else', () => {
    expect(typedHexChange('#12ab3')).toBeNull()
    expect(typedHexChange('red')).toBeNull()
  })
})

describe('parseHex', () => {
  it('reads a 6-digit or 8-digit hex, with or without its #, as #RRGGBBAA in upper case', () => {
    expect(parseHex('12ab34')).toBe('#12AB34FF')
    expect(parseHex(' #12ab3480 ')).toBe('#12AB3480')
  })

  it('is null for anything else', () => {
    expect(parseHex('#12ab3')).toBeNull()
    expect(parseHex('#12ab34f')).toBeNull()
    expect(parseHex('red')).toBeNull()
  })
})
