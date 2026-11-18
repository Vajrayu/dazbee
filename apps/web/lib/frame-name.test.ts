// The name a new frame takes from its size.
import { describe, expect, it } from 'vitest'

import { ar } from '@/lib/i18n/ar.ts'
import { en } from '@/lib/i18n/en.ts'

import { frameName } from './frame-name.ts'

describe('frameName', () => {
  it('names a frame of a preset size after the preset', () => {
    expect(frameName(en, 1080, 1080)).toBe('Feed square')
    expect(frameName(en, 1080, 1920)).toBe('Story and Reel')
    expect(frameName(en, 728, 90)).toBe('Leaderboard')
    expect(frameName(ar, 300, 250)).toBe('مستطيل متوسط')
    expect(frameName(en, 970, 250)).toBe('Billboard')
    expect(frameName(en, 1000, 1500)).toBe('Standard pin')
  })

  it('names a size two presets share after the first: a typed 1080 × 1920 is a Story and Reel, not a TikTok video', () => {
    expect(frameName(en, 1080, 1920)).toBe('Story and Reel')
    expect(frameName(ar, 1080, 1920)).toBe('قصة وريلز')
  })

  it('names a frame of any other size "Frame"', () => {
    expect(frameName(en, 1000, 1000)).toBe('Frame')
    // A preset turned on its side is a size of its own.
    expect(frameName(en, 90, 728)).toBe('Frame')
    expect(frameName(ar, 640, 480)).toBe('إطار')
  })
})
