import { describe, expect, it } from 'vitest'

import { type Design, parseDesign } from '@dazbee/schema'

import type { Frame } from './frames.ts'
import { guideNow, guideOffset, guidesShown, guideUnder, onItsRuler, rulerAt } from './guides.ts'

/** A design whose one frame, 1080 by 1080 at the page's origin, holds the guides given. */
function withGuides(guides: { axis: 'x' | 'y'; at: number }[]): Design {
  const parsed = parseDesign({
    meta: { designId: 'd', name: 'D' },
    pages: { p1: { name: 'One', order: 'a0' } },
    frames: { sq: { pageId: 'p1', name: 'Square', width: 1080, height: 1080, x: 0, y: 0, order: 'a0', guides } },
    nodes: {},
  })
  if (!parsed.success) throw new Error(parsed.errors.join('\n'))
  return parsed.design
}
const SQUARE: Frame = { id: 'sq', pageId: 'p1', name: 'Square', x: 0, y: 0, width: 1080, height: 1080 }
/** Half size, the page's origin 100 px in from the stage's corner. */
const CAMERA = { x: 100, y: 100, zoom: 0.5 }

describe('rulerAt', () => {
  it('gives vertical guides on the start ruler, horizontal ones on the top ruler, and none in their corner or off them', () => {
    expect([
      rulerAt({ x: 10, y: 300 }),
      rulerAt({ x: 300, y: 10 }),
      rulerAt({ x: 10, y: 10 }),
      rulerAt({ x: 30, y: 30 }),
    ]).toEqual(['x', 'y', null, null])
  })
})

describe('onItsRuler', () => {
  it('is on the start ruler for a vertical guide and on the top one for a horizontal guide', () => {
    expect([
      onItsRuler('x', { x: 19, y: 400 }),
      onItsRuler('x', { x: 400, y: 10 }),
      onItsRuler('y', { x: 400, y: 10 }),
    ]).toEqual([true, false, true])
  })
})

describe('guidesShown', () => {
  it('gives the guides within the frame with their indexes, leaving out one past its edge', () => {
    expect(
      guidesShown(
        withGuides([
          { axis: 'x', at: 1200 },
          { axis: 'y', at: 1080 },
        ]),
        SQUARE,
      ),
    ).toEqual([{ frameId: 'sq', index: 1, axis: 'y', at: 1080 }])
  })
})

describe('guideUnder', () => {
  it('finds a guide within 3 screen pixels along its frame, the one added last first', () => {
    const design = withGuides([
      { axis: 'x', at: 200 },
      { axis: 'x', at: 204 },
    ])
    // x 200 is at 200 on the stage, 204 at 202.
    expect(guideUnder(design, [SQUARE], CAMERA, { x: 201, y: 400 })).toMatchObject({ index: 1, at: 204 })
    expect(guideUnder(design, [SQUARE], CAMERA, { x: 197.5, y: 400 })).toMatchObject({ index: 0 })
    expect(guideUnder(design, [SQUARE], CAMERA, { x: 196.5, y: 400 })).toBeNull()
    // Past the frame's bottom, at 640 on the stage.
    expect(guideUnder(design, [SQUARE], CAMERA, { x: 200, y: 650 })).toBeNull()
  })
})

describe('guideOffset', () => {
  it('gives the place in the frame under a stage point along the guide’s axis', () => {
    expect([
      guideOffset(CAMERA, SQUARE, 'x', { x: 300, y: 0 }),
      guideOffset(CAMERA, SQUARE, 'y', { x: 0, y: 150 }),
    ]).toEqual([400, 100])
  })
})

describe('guideNow', () => {
  it('keeps the index while the guide is there, finds it by axis and place once it moved up, and none once it is gone', () => {
    const design = withGuides([
      { axis: 'y', at: 400 },
      { axis: 'y', at: 400 },
    ])
    expect(guideNow(design, { frameId: 'sq', index: 1, axis: 'y', at: 400 })).toBe(1)
    expect(guideNow(design, { frameId: 'sq', index: 3, axis: 'y', at: 400 })).toBe(0)
    expect(guideNow(design, { frameId: 'sq', index: 0, axis: 'x', at: 400 })).toBeNull()
    expect(guideNow(design, { frameId: 'gone', index: 0, axis: 'y', at: 400 })).toBeNull()
  })
})
