import { describe, expect, it } from 'vitest'

import { ALL_PLATFORMS, isNineBySixteen, SAFE_ZONES, safeZoneBands, type SafeZoneChoice } from './safe-zones.ts'

describe('SAFE_ZONES', () => {
  it('keeps each platform’s figure with a source on the platform’s own site', () => {
    const own: Record<string, RegExp> = {
      Meta: /^https:\/\/www\.facebook\.com\/business\//,
      YouTube: /^https:\/\/(support|services)\.google\.com\//,
      TikTok: /^https:\/\/(ads\.tiktok\.com|lf-tt4b\.tiktokcdn\.com)\//,
    }
    expect(SAFE_ZONES.map((zone) => zone.platform)).toEqual(['Meta', 'YouTube', 'TikTok'])
    for (const zone of SAFE_ZONES) {
      expect(zone.sources.length).toBeGreaterThan(0)
      for (const source of zone.sources) expect(source).toMatch(own[zone.platform] ?? /^$/)
    }
  })
})

describe('isNineBySixteen', () => {
  it('holds for 9:16 frames at any size, and a pixel off, and for no other shape', () => {
    expect([
      isNineBySixteen(1080, 1920),
      isNineBySixteen(1440, 2560),
      isNineBySixteen(750, 1334),
      isNineBySixteen(1080, 1350),
      isNineBySixteen(0, 0),
    ]).toEqual([true, true, true, false, false])
  })
})

describe('safeZoneBands', () => {
  it('covers a 1080 × 1920 frame as deep as the deepest platform on each edge: YouTube’s top and right, TikTok’s left, Meta’s and YouTube’s bottom', () => {
    // Meta: 14% top (268.8), 35% bottom (672), 6% sides (64.8). YouTube: 288 top, 672 bottom, 48 left, 192 right.
    // TikTok: 160, 440 and 80 of 720 × 1280, so 240 top, 660 bottom, 120 sides.
    const [top, bottom, left, right] = safeZoneBands(1080, 1920, ALL_PLATFORMS)
    expect(top).toEqual({ x: 0, y: 0, width: 1080, height: 288 })
    expect(bottom).toEqual({ x: 0, y: 1248, width: 1080, height: 672 })
    expect(left?.x).toBe(0)
    expect(left?.y).toBe(288)
    expect(left?.width).toBeCloseTo(120)
    expect(left?.height).toBe(960)
    expect(right).toEqual({ x: 888, y: 288, width: 192, height: 960 })
  })

  it('covers a 1080 × 1920 frame with one platform’s figures alone when given its name', () => {
    const rounded = (platform: SafeZoneChoice) =>
      safeZoneBands(1080, 1920, platform).map((band) =>
        [band.x, band.y, band.width, band.height].map((n) => Math.round(n)),
      )
    // Meta: 14% top, 35% bottom, 6% each side.
    expect(rounded('Meta')).toEqual([
      [0, 0, 1080, 269],
      [0, 1248, 1080, 672],
      [0, 269, 65, 979],
      [1015, 269, 65, 979],
    ])
    expect(rounded('YouTube')).toEqual([
      [0, 0, 1080, 288],
      [0, 1248, 1080, 672],
      [0, 288, 48, 960],
      [888, 288, 192, 960],
    ])
    expect(rounded('TikTok')).toEqual([
      [0, 0, 1080, 240],
      [0, 1260, 1080, 660],
      [0, 240, 120, 1020],
      [960, 240, 120, 1020],
    ])
  })

  it('scales with a 9:16 frame of another size, and gives none for another shape', () => {
    expect(safeZoneBands(1440, 2560, ALL_PLATFORMS)[0]).toEqual({ x: 0, y: 0, width: 1440, height: 384 })
    expect(safeZoneBands(1080, 1080, ALL_PLATFORMS)).toEqual([])
  })
})
