import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Frame } from '../../canvas/frames.ts'
import { guideParts } from './guide-parts.ts'

/** An element as the parts build one: its class, data, style and text. */
interface Fake {
  className: string
  dataset: Record<string, string>
  style: Record<string, string>
  textContent: string
}
const fake = (): Fake => ({ className: '', dataset: {}, style: {}, textContent: '' })
/** A frame 100 across and 50 down from the page's origin, 1080 by 1920. */
const STORY: Frame = { id: 's', pageId: 'p', name: 'Story', x: 100, y: 50, width: 1080, height: 1920 }
/** Half size, the page's origin 20 px in from the stage's corner. */
const CAMERA = { x: 20, y: 20, zoom: 0.5 }

beforeEach(() => {
  vi.stubGlobal('document', { createElement: () => fake() })
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('guideParts', () => {
  it('draws a vertical guide down its frame and a horizontal one across it, where they are on the stage', () => {
    const parts = guideParts(
      [
        { frame: STORY, axis: 'x', at: 540, hot: false },
        { frame: STORY, axis: 'y', at: 200, hot: false },
      ],
      CAMERA,
    ) as unknown as Fake[]
    expect(parts.map((p) => [p.className, p.dataset, p.style])).toEqual([
      ['guide-line', { axis: 'x', frame: 's' }, { left: '340px', top: '45px', height: '960px' }],
      ['guide-line', { axis: 'y', frame: 's' }, { left: '70px', top: '145px', width: '540px' }],
    ])
  })

  it('marks a hot guide and puts its place beside it, clear of the ruler when its frame starts under it', () => {
    const parts = guideParts([{ frame: STORY, axis: 'y', at: 200, hot: true }], {
      x: -100,
      y: 20,
      zoom: 0.5,
    }) as unknown as Fake[]
    expect(parts.map((p) => [p.className, p.dataset, p.textContent, p.style])).toEqual([
      ['guide-line', { axis: 'y', frame: 's', hot: '' }, '', { left: '-50px', top: '145px', width: '540px' }],
      ['guide-place', {}, '200', { left: '24px', top: '149px' }],
    ])
  })
})
