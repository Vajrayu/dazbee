import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Frame } from '../../canvas/frames.ts'
import { drawingParts } from './drawing-parts.ts'

/** An element as the parts build one: its class, data and style. */
const fakeElement = () => ({
  className: '',
  dataset: {} as Record<string, string>,
  style: {} as Record<string, string>,
})
const SQUARE: Frame = { id: 'sq', pageId: 'p1', name: 'Square', x: 0, y: 0, width: 1080, height: 1080 }
const CAMERA = { x: 10, y: 20, zoom: 2 }

beforeEach(() => {
  vi.stubGlobal('document', { createElement: fakeElement })
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('drawingParts', () => {
  it('builds nothing with nothing drawn', () => {
    expect(drawingParts(null, CAMERA, () => {})).toEqual([])
  })

  it("places a text box's marquee over its box in its frame, marked with its kind", () => {
    const placed: unknown[] = []
    const rect = { x: 100, y: 400, width: 200, height: 50 }
    const [shown] = drawingParts({ kind: 'textBox', frame: SQUARE, rect }, CAMERA, (_el, frame, box) =>
      placed.push([frame.id, box]),
    ) as unknown as ReturnType<typeof fakeElement>[]
    expect(shown).toMatchObject({ className: 'marquee', dataset: { textBox: '' } })
    expect(placed).toEqual([['sq', rect]])
  })

  it("places a frame's marquee from its world units, at the camera", () => {
    const [shown] = drawingParts(
      { kind: 'frameDraw', frame: null, rect: { x: 1200, y: 100, width: 300, height: 300 } },
      CAMERA,
      () => {},
    ) as unknown as ReturnType<typeof fakeElement>[]
    expect(shown).toMatchObject({
      className: 'marquee',
      dataset: { frameDraw: '' },
      style: { left: '2410px', top: '220px', width: '600px', height: '600px' },
    })
  })
})
