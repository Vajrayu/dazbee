import { describe, expect, it } from 'vitest'

import type { Design } from '@dazbee/schema'

import { align, distribute, lineUpOf, mirrorOffsets, SPREAD_MIN } from './arrange.ts'

const frame = { x: 0, y: 0, width: 1080, height: 1080 }

const boxes = [
  { x: 100, y: 100, width: 100, height: 50 },
  { x: 300, y: 220, width: 50, height: 100 },
  { x: 600, y: 160, width: 80, height: 80 },
]

describe('SPREAD_MIN', () => {
  it('is three: distribute moves fewer than that not at all', () => {
    expect(SPREAD_MIN).toBe(3)
    const fewer = distribute(boxes.slice(0, SPREAD_MIN - 1), 'horizontal')
    expect(fewer.every(({ dx, dy }) => dx === 0 && dy === 0)).toBe(true)
    expect(distribute(boxes.slice(0, SPREAD_MIN), 'horizontal').some(({ dx }) => dx !== 0)).toBe(true)
  })
})

describe('lineUpOf', () => {
  it('keeps the layers no flow places, and leaves out the ones a row lays out', () => {
    const design = {
      nodes: {
        free: { type: 'graphic', parentId: 'sq', props: {} },
        row: { type: 'box', parentId: 'sq', props: { layout: { direction: 'row' } } },
        inRow: { type: 'graphic', parentId: 'row', props: { visible: true } },
        kept: { type: 'graphic', parentId: 'row', props: { visible: true, absolute: true } },
      },
    } as unknown as Design
    expect(lineUpOf(design, ['free', 'row', 'inRow', 'kept'])).toEqual(['free', 'row', 'kept'])
  })
})

describe('align', () => {
  it('lines several layers up with the box around them', () => {
    expect(align(boxes, 'left', frame).map((o) => o.dx)).toEqual([0, -200, -500])
    expect(align(boxes, 'right', frame).map((o) => o.dx)).toEqual([480, 330, 0])
    expect(align(boxes, 'centre', frame).map((o) => o.dx)).toEqual([240, 65, -250])
    expect(align(boxes, 'bottom', frame).map((o) => o.dy)).toEqual([170, 0, 80])
    expect(align(boxes, 'middle', frame).map((o) => o.dy)).toEqual([85, -60, 10])
  })

  it('lines one layer up with what holds it', () => {
    expect(align([boxes[0] as never], 'centre', frame)).toEqual([{ dx: 390, dy: 0 }])
    expect(align([boxes[0] as never], 'bottom', { x: 0, y: 0, width: 500, height: 400 })).toEqual([{ dx: 0, dy: 250 }])
  })
})

describe('mirrorOffsets', () => {
  const boxes = [
    { x: 0, y: 0, width: 100, height: 50 },
    { x: 300, y: 100, width: 100, height: 100 },
  ]

  it('moves each box to its mirror across the centre of the box round them all, along the axis alone', () => {
    expect(mirrorOffsets(boxes, 'horizontal')).toEqual([
      { dx: 300, dy: 0 },
      { dx: -300, dy: 0 },
    ])
    expect(mirrorOffsets(boxes, 'vertical')).toEqual([
      { dx: 0, dy: 150 },
      { dx: 0, dy: -100 },
    ])
  })

  it('mirrors across the centre of the box it is given', () => {
    expect(mirrorOffsets([boxes[0] as (typeof boxes)[0]], 'horizontal', { x: 0, y: 0, width: 400, height: 0 })).toEqual(
      [{ dx: 300, dy: 0 }],
    )
  })
})

describe('distribute', () => {
  it('spaces three or more out evenly between the first and the last', () => {
    // 680 - 100 = 580 across, 230 of it boxes: gaps of 175.
    expect(distribute(boxes, 'horizontal')).toEqual([
      { dx: 0, dy: 0 },
      { dx: 75, dy: 0 },
      { dx: 0, dy: 0 },
    ])
    expect(distribute(boxes.slice(0, 2), 'vertical')).toEqual([
      { dx: 0, dy: 0 },
      { dx: 0, dy: 0 },
    ])
  })
})
