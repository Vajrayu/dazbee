import { describe, expect, it } from 'vitest'

import { justMade, madeHref, nameFromWebsite, withoutMade } from './brand-start.ts'

describe('nameFromWebsite', () => {
  it('names a brand from its website', () => {
    expect(nameFromWebsite('harbourcoffee.com')).toBe('Harbourcoffee')
    expect(nameFromWebsite('https://www.harbour-coffee.com/menu?x=1')).toBe('Harbour Coffee')
    expect(nameFromWebsite('northline-cycles.co.uk')).toBe('Northline Cycles')
    expect(nameFromWebsite('http://shop.kite_studio.io')).toBe('Kite Studio')
    expect(nameFromWebsite('localhost')).toBe('Localhost')
    expect(nameFromWebsite('')).toBeNull()
    expect(nameFromWebsite('not a site at all')).toBeNull()
  })
})

describe('madeHref', () => {
  it('opens a brand just made on its home in its workspace, marked as just made', () => {
    expect(madeHref('w1', '0198c0de-0000-7000-8000-000000000001')).toBe(
      '/w/w1/brands/0198c0de-0000-7000-8000-000000000001?made=1',
    )
  })
})

describe('justMade', () => {
  it('is true only for the mark madeHref leaves', () => {
    expect(justMade('1')).toBe(true)
    expect(justMade(undefined)).toBe(false)
    expect(justMade('')).toBe(false)
    expect(justMade('yes')).toBe(false)
  })
})

describe('withoutMade', () => {
  it('takes the mark off an address, so a reload no longer shows the brand as just made', () => {
    expect(withoutMade('http://localhost:3000/w/w1/brands/b1?made=1')).toBe('/w/w1/brands/b1')
    expect(withoutMade('http://localhost:3000/w/w1/brands/b1?made=1&x=2#top')).toBe('/w/w1/brands/b1?x=2#top')
    expect(withoutMade('http://localhost:3000/w/w1/brands/b1')).toBe('/w/w1/brands/b1')
  })
})
