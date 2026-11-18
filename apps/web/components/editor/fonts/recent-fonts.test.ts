import { describe, expect, it } from 'vitest'

import { recentFonts, recentFontsKey } from './recent-fonts.ts'

/** A device's storage, as a map. */
function storage() {
  const kept = new Map<string, string>()
  return {
    kept,
    place: () => ({
      getItem: (key: string) => kept.get(key) ?? null,
      setItem: (key: string, value: string) => void kept.set(key, value),
    }),
  }
}

describe('recentFonts', () => {
  it('keeps the last eight families used in a brand, newest first, each once', () => {
    const { place, kept } = storage()
    const recent = recentFonts(place)
    for (let i = 0; i < 10; i++) recent.record('brand-a', `Family ${i}`)
    recent.record('brand-a', 'Family 5')
    expect(recent.list('brand-a')).toEqual([
      'Family 5',
      'Family 9',
      'Family 8',
      'Family 7',
      'Family 6',
      'Family 4',
      'Family 3',
      'Family 2',
    ])
    expect(JSON.parse(kept.get(recentFontsKey('brand-a')) ?? 'null')).toEqual(recent.list('brand-a'))
  })

  it('keeps each brand’s apart, and reads them back on the next visit', () => {
    const { place } = storage()
    recentFonts(place).record('brand-a', 'Lora')
    recentFonts(place).record('brand-b', 'Inter')
    const next = recentFonts(place)
    expect(next.list('brand-a')).toEqual(['Lora'])
    expect(next.list('brand-b')).toEqual(['Inter'])
  })

  it('reads junk as no families', () => {
    const { place, kept } = storage()
    kept.set(recentFontsKey('brand-a'), '{oops')
    expect(recentFonts(place).list('brand-a')).toEqual([])
    kept.set(recentFontsKey('brand-a'), JSON.stringify(['Lora', 3, null, 'Lora', 'Inter']))
    expect(recentFonts(place).list('brand-a')).toEqual(['Lora', 'Inter'])
  })

  it('keeps them for the visit where the device refuses its storage', () => {
    const refused = () => ({
      getItem: (): string | null => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    })
    const recent = recentFonts(refused)
    expect(recent.list('brand-a')).toEqual([])
    recent.record('brand-a', 'Lora')
    expect(recent.list('brand-a')).toEqual(['Lora'])
  })
})
