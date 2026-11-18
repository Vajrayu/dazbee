import { describe, expect, it } from 'vitest'

import { type Box, measureInsets } from './stage-insets.ts'

/** A box from its left, top, width and height, as `getBoundingClientRect` gives it. */
const box = (left: number, top: number, width: number, height: number): Box => ({
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height,
})

const DESKTOP = box(0, 0, 1440, 900)
const PHONE = box(0, 0, 390, 844)
/** The two islands at the top, each 52 px tall from 24 px down. */
const ISLANDS = [box(24, 24, 360, 52), box(1100, 24, 316, 52)]
/** The tool dock at the bottom's middle, holding the flyouts' buttons at its end. */
const DOCK = box(440, 832, 560, 52)

describe('measureInsets', () => {
  it('keeps the edit panel and the gap clear on the end side, the dock at the bottom, and nothing on the start side', () => {
    const insets = measureInsets(DESKTOP, { islands: ISLANDS, tabBar: null, dock: [DOCK] }, false)
    // 12 px from the edge, 300 px wide, and 12 px of gap; the dock's 68 px and the gap.
    expect(insets).toEqual({ top: 88, right: 324, bottom: 80, left: 0 })
  })

  it('keeps the panel clear on the left in right-to-left, and nothing on the right', () => {
    const insets = measureInsets(DESKTOP, { islands: ISLANDS, tabBar: null, dock: [DOCK] }, true)
    expect(insets).toEqual({ top: 88, right: 0, bottom: 80, left: 324 })
  })

  it('keeps the top clear of the islands, and of none while they are hidden', () => {
    expect(measureInsets(DESKTOP, { islands: ISLANDS, tabBar: null, dock: [] }, false).top).toBe(88)
    expect(measureInsets(DESKTOP, { islands: [null, box(0, 0, 0, 0)], tabBar: null, dock: [] }, false).top).toBe(0)
  })

  it('adds no panel on a tablet narrower than 1024 px, where the panel is a sheet, and the panel’s place from 1024 px up', () => {
    const tablet = box(0, 0, 768, 1024)
    const dock = box(104, 956, 560, 52)
    // The zoom pill and Pages beside it, above the dock.
    const zoom = box(605, 908, 147, 40)
    const pages = box(505, 908, 92, 40)
    const chrome = { islands: [box(24, 24, 330, 40), box(632, 24, 120, 40)], tabBar: null, dock: [dock, zoom, pages] }
    // Nothing on the start side; the zoom pill and Pages, the highest of the bottom pieces, and the gap at the bottom.
    expect(measureInsets(tablet, chrome, false)).toEqual({ top: 76, right: 0, bottom: 128, left: 0 })
    expect(measureInsets(box(0, 0, 1023, 1024), chrome, true).left).toBe(0)
    expect(measureInsets(box(0, 0, 1024, 1024), chrome, true).left).toBe(324)
  })

  it('adds no panel on a phone, where the panel is a sheet, keeps the islands clear, and counts only the tab bar', () => {
    const tabBar = box(12, 780, 366, 52)
    const tray = box(12, 700, 366, 72)
    const chrome = { islands: [box(12, 12, 200, 44)], tabBar, dock: [tray] }
    // The islands end 56 px down, and 12 px of gap.
    expect(measureInsets(PHONE, chrome, false)).toEqual({ top: 68, right: 0, bottom: 76, left: 0 })
    expect(measureInsets(PHONE, { islands: [], tabBar: null, dock: [] }, true)).toEqual({
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    })
  })
})
