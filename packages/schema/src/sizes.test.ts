import { describe, expect, it } from 'vitest'

import { BLANK_SIZE, presetOf, shapeOf, SIZE_CHANNELS, SIZE_PRESETS, sizeIssue, sizeProblem } from './sizes.ts'

describe('SIZE_PRESETS', () => {
  it('offers presets a frame may take, Leaderboard included', () => {
    for (const preset of SIZE_PRESETS) expect(sizeIssue(preset.width, preset.height), preset.id).toBeUndefined()
    expect(SIZE_PRESETS.find((p) => p.id === 'leaderboard')).toMatchObject({ width: 728, height: 90 })
  })

  it('lists the presets by channel, in the order the channels are shown', () => {
    const channels = SIZE_PRESETS.map((p) => p.channel)
    expect([...new Set(channels)]).toEqual([...SIZE_CHANNELS])
    expect(channels).toEqual([...channels].sort((a, b) => SIZE_CHANNELS.indexOf(a) - SIZE_CHANNELS.indexOf(b)))
  })

  it('gives each preset an id of its own, so a tile names its frame by it', () => {
    const ids = SIZE_PRESETS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('offers each channel the sizes its own pages give, Google Display last', () => {
    const byChannel = Object.fromEntries(
      SIZE_CHANNELS.map((channel) => [
        channel,
        SIZE_PRESETS.filter((p) => p.channel === channel).map((p) => `${p.id} ${p.width}×${p.height}`),
      ]),
    )
    expect(byChannel).toEqual({
      meta: ['feed-square 1080×1080', 'feed-portrait 1080×1350', 'story 1080×1920'],
      'tiktok-youtube': ['tiktok-video 1080×1920', 'youtube-thumbnail 1280×720', 'youtube-shorts 1080×1920'],
      // LinkedIn's sizes only until X's are verified, under the channel id linkedin-x.
      'linkedin-x': ['link-image 1200×628', 'linkedin-square 1200×1200', 'linkedin-vertical 720×900'],
      pinterest: ['pin 1000×1500'],
      google: [
        'medium-rectangle 300×250',
        'leaderboard 728×90',
        'half-page 300×600',
        'large-rectangle 336×280',
        'large-mobile-banner 320×100',
        'mobile-leaderboard 320×50',
        'wide-skyscraper 160×600',
        'billboard 970×250',
      ],
    })
  })
})

describe('BLANK_SIZE', () => {
  it('is Feed square, 1080 × 1080', () => {
    expect(BLANK_SIZE).toMatchObject({ id: 'feed-square', width: 1080, height: 1080 })
  })
})

describe('sizeIssue', () => {
  it('takes sides from 50 to 8000 px', () => {
    expect(sizeIssue(50, 50)).toBeUndefined()
    expect(sizeIssue(8000, 8000)).toBeUndefined()
    expect(sizeIssue(49, 100)).toBe('short')
    expect(sizeIssue(100, 49)).toBe('short')
    expect(sizeIssue(8001, 100)).toBe('long')
    expect(sizeIssue(100, 8001)).toBe('long')
  })

  it('takes a size up to 12 times as long as it is wide', () => {
    expect(sizeIssue(600, 50)).toBeUndefined()
    expect(sizeIssue(50, 600)).toBeUndefined()
    expect(sizeIssue(601, 50)).toBe('ratio')
    expect(sizeIssue(50, 601)).toBe('ratio')
  })

  it('takes whole pixels only', () => {
    expect(sizeIssue(100.5, 200)).toBe('whole')
    expect(sizeIssue(100, 200.5)).toBe('whole')
  })
})

describe('sizeProblem', () => {
  it('says in English why a frame can not be this size', () => {
    expect(sizeProblem(1080, 1080)).toBeUndefined()
    expect(sizeProblem(100.5, 200)).toBe('a frame is a whole number of pixels')
    expect(sizeProblem(49, 100)).toBe("a frame's sides are at least 50 px")
    expect(sizeProblem(8001, 100)).toBe("a frame's sides are at most 8000 px")
    expect(sizeProblem(601, 50)).toBe('a frame is at most 12 times as long as it is wide')
  })
})

describe('presetOf', () => {
  it('finds the first preset of exactly this size: Story and Reel before TikTok video and YouTube Shorts', () => {
    expect(presetOf(728, 90)?.id).toBe('leaderboard')
    expect(presetOf(1080, 1920)?.id).toBe('story')
    expect(presetOf(970, 250)?.id).toBe('billboard')
    expect(presetOf(90, 728)).toBeUndefined()
    expect(presetOf(1000, 1000)).toBeUndefined()
  })
})

describe('shapeOf', () => {
  it('reads a size as square, portrait, tall, landscape or wide', () => {
    expect(shapeOf(1080, 1080)).toBe('square')
    expect(shapeOf(1000, 1040)).toBe('square')
    expect(shapeOf(1080, 1350)).toBe('portrait')
    expect(shapeOf(1080, 1920)).toBe('tall')
    expect(shapeOf(1024, 768)).toBe('landscape')
    expect(shapeOf(1200, 628)).toBe('wide')
    expect(shapeOf(728, 90)).toBe('wide')
  })

  it('draws the lines between shapes where it always has', () => {
    expect(shapeOf(1750, 1000)).toBe('wide')
    expect(shapeOf(1749, 1000)).toBe('landscape')
    expect(shapeOf(1051, 1000)).toBe('landscape')
    expect(shapeOf(1050, 1000)).toBe('square')
    expect(shapeOf(950, 1000)).toBe('square')
    expect(shapeOf(949, 1000)).toBe('portrait')
    expect(shapeOf(621, 1000)).toBe('portrait')
    expect(shapeOf(620, 1000)).toBe('tall')
  })
})
