import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ALL_PLATFORMS, type Rect } from '@dazbee/schema'

import type { Frame } from './frames.ts'
import { safeZoneParts } from './safe-zone-parts.ts'

/** An element as the parts build one: its class, data and the box it was placed at. */
interface Fake {
  className: string
  dataset: Record<string, string>
  box?: string
}
const STORY: Frame = { id: 'story', pageId: 'p', name: 'Story', x: 0, y: 0, width: 1080, height: 1920 }
const SQUARE: Frame = { id: 'square', pageId: 'p', name: 'Square', x: 1200, y: 0, width: 1080, height: 1080 }

beforeEach(() => {
  vi.stubGlobal('document', { createElement: (): Fake => ({ className: '', dataset: {} }) })
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('safeZoneParts', () => {
  const place = (el: HTMLElement, frame: Frame, box: Rect) => {
    ;(el as unknown as Fake).box =
      `${frame.id} ${[box.x, box.y, box.width, box.height].map((n) => Math.round(n)).join(' ')}`
  }

  it('places the four bands of each 9:16 frame over it, and none over a frame of another shape', () => {
    const parts = safeZoneParts([STORY, SQUARE], place, ALL_PLATFORMS) as unknown as Fake[]
    expect(parts.map((p) => [p.className, p.dataset.frame, p.box])).toEqual([
      ['safe-zone', 'story', 'story 0 0 1080 288'],
      ['safe-zone', 'story', 'story 0 1248 1080 672'],
      ['safe-zone', 'story', 'story 0 288 120 960'],
      ['safe-zone', 'story', 'story 888 288 192 960'],
    ])
  })

  it('places the chosen platform’s bands alone', () => {
    const parts = safeZoneParts([STORY], place, 'Meta') as unknown as Fake[]
    expect(parts.map((p) => p.box)).toEqual([
      'story 0 0 1080 269',
      'story 0 1248 1080 672',
      'story 0 269 65 979',
      'story 1015 269 65 979',
    ])
  })
})
