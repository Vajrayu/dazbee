import { describe, expect, it } from 'vitest'

import { RECENT_KEPT, recentColours, recentKey, shownRecent } from './recent-colours.ts'

/** A device's storage, which `failing` makes throw as a blocked or full one does, and its other tabs. */
function device({ failing = false } = {}) {
  const items = new Map<string, string>()
  const heard = new Set<(key: string | null) => void>()
  const storage = {
    getItem(key: string) {
      if (failing) throw new DOMException('blocked', 'SecurityError')
      return items.get(key) ?? null
    },
    setItem(key: string, value: string) {
      if (failing) throw new DOMException('full', 'QuotaExceededError')
      items.set(key, value)
    },
  }
  const recent = recentColours({
    storage: () => storage,
    onStorage: (listener) => {
      heard.add(listener)
      return () => heard.delete(listener)
    },
  })
  /** Another tab of the device writes a brand's list, which this one hears of. */
  const otherTab = (key: string, value: string) => {
    items.set(key, value)
    for (const listener of heard) listener(key)
  }
  return { recent, items, otherTab }
}

describe('recent colours', () => {
  it('keeps colours newest first, as #RRGGBB, one of each whatever its case or alpha', () => {
    const { recent, items } = device()
    recent.add('b', '#e0301e')
    recent.add('b', '#1E50E0FF')
    recent.add('b', '#E0301E80')
    expect(recent.list('b')).toEqual(['#E0301E', '#1E50E0'])
    expect(JSON.parse(items.get(recentKey('b')) ?? '[]')).toEqual(['#E0301E', '#1E50E0'])
  })

  it('reads a colour as a hex typed is read, its # left off or spaces round it', () => {
    const { recent } = device()
    recent.add('b', 'c0ffee')
    recent.add('b', ' #12ab3480 ')
    expect(recent.list('b')).toEqual(['#12AB34', '#C0FFEE'])
  })

  it(`keeps the newest ${RECENT_KEPT}`, () => {
    const { recent } = device()
    const hexes = Array.from({ length: 20 }, (_, i) => `#0000${i.toString(16).padStart(2, '0').toUpperCase()}`)
    for (const hex of hexes) recent.add('b', hex)
    expect(recent.list('b')).toEqual(hexes.slice(-RECENT_KEPT).reverse())
  })

  it('takes no junk, given or stored', () => {
    const { recent, otherTab } = device()
    recent.add('b', 'red')
    recent.add('b', '#12345')
    recent.add('b', 'mixed')
    expect(recent.list('b')).toEqual([])
    otherTab(recentKey('b'), JSON.stringify(['#abcdef', 7, 'blue', null, '#ABCDEF', '#00ff0080']))
    expect(recent.list('b')).toEqual(['#ABCDEF', '#00FF00'])
    otherTab(recentKey('b'), '{not json')
    expect(recent.list('b')).toEqual([])
    otherTab(recentKey('b'), '{"a":1}')
    expect(recent.list('b')).toEqual([])
  })

  it('keeps each brand’s apart: a brand is a wall', () => {
    const { recent } = device()
    recent.add('one', '#111111')
    recent.add('two', '#222222')
    expect(recent.list('one')).toEqual(['#111111'])
    expect(recent.list('two')).toEqual(['#222222'])
  })

  it('keeps the list in memory while storage throws', () => {
    const { recent } = device({ failing: true })
    expect(recent.list('b')).toEqual([])
    recent.add('b', '#E0301E')
    recent.add('b', '#1E50E0')
    expect(recent.list('b')).toEqual(['#1E50E0', '#E0301E'])
  })

  it('hears another tab of the device, telling its brand’s listeners only', () => {
    const { recent, otherTab } = device()
    const told: string[] = []
    const stop = recent.subscribe('b', () => told.push('b'))
    recent.subscribe('c', () => told.push('c'))
    expect(recent.list('b')).toEqual([])
    otherTab(recentKey('b'), JSON.stringify(['#E0301E']))
    expect(recent.list('b')).toEqual(['#E0301E'])
    expect(told).toEqual(['b'])
    recent.add('b', '#1E50E0')
    expect(told).toEqual(['b', 'b'])
    stop()
    otherTab(recentKey('b'), JSON.stringify(['#000000']))
    expect(told).toEqual(['b', 'b'])
  })

  it('gives the same list until it changes, as a store React reads must', () => {
    const { recent } = device()
    recent.add('b', '#E0301E')
    expect(recent.list('b')).toBe(recent.list('b'))
  })
})

describe('shownRecent', () => {
  it('shows the first 8 not in the brand kit, so kit colours left out don’t shorten it', () => {
    const list = Array.from({ length: 12 }, (_, i) => `#0000${i.toString(16).padStart(2, '0').toUpperCase()}`)
    const kit = ['#000000ff', '#000003', '#00000A']
    expect(shownRecent(list, kit)).toEqual([
      '#000001',
      '#000002',
      '#000004',
      '#000005',
      '#000006',
      '#000007',
      '#000008',
      '#000009',
    ])
    expect(shownRecent([], kit)).toEqual([])
  })
})
