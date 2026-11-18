import { describe, expect, it } from 'vitest'

import { measureBetween, pillBeside, placePills } from './measure.ts'

const rect = (x: number, y: number, width: number, height: number) => ({ x, y, width, height })
/** Each line as `axis from→to value`, a dashed one with no value. */
const shown = (a: ReturnType<typeof rect>, b: ReturnType<typeof rect>) =>
  measureBetween(a, b).map(
    (l) => `${l.axis} ${l.from.x},${l.from.y}→${l.to.x},${l.to.y}${l.value === null ? ' dashed' : ` ${l.value}`}`,
  )

describe('measureBetween', () => {
  it('measures a selection inside the other box to each of its four sides, along its middle', () => {
    expect(shown(rect(20, 30, 40, 20), rect(0, 0, 100, 100))).toEqual([
      'x 0,40→20,40 20',
      'x 60,40→100,40 40',
      'y 40,0→40,30 30',
      'y 40,50→40,100 50',
    ])
  })

  it('measures a box inside the selection to the selection’s sides', () => {
    expect(shown(rect(0, 0, 100, 100), rect(20, 30, 40, 20))).toEqual([
      'x 0,40→20,40 20',
      'x 60,40→100,40 40',
      'y 40,0→40,30 30',
      'y 40,50→40,100 50',
    ])
  })

  it('leaves out a side the inner box touches', () => {
    expect(shown(rect(0, 30, 40, 20), rect(0, 0, 100, 100))).toEqual([
      'x 40,40→100,40 60',
      'y 20,0→20,30 30',
      'y 20,50→20,100 50',
    ])
  })

  it('measures the gap between boxes apart on one axis across the rows they share, with no dashes', () => {
    expect(shown(rect(0, 0, 40, 40), rect(70, 20, 30, 40))).toEqual(['x 40,30→70,30 30'])
    expect(shown(rect(0, 50, 40, 40), rect(10, 0, 40, 20))).toEqual(['y 25,50→25,20 30'])
  })

  it('measures boxes apart on both axes from the selection’s middle, dashed on to the other box', () => {
    expect(shown(rect(0, 0, 40, 40), rect(100, 80, 20, 20))).toEqual([
      'x 40,20→100,20 60',
      'y 100,20→100,80 dashed',
      'y 20,40→20,80 40',
      'x 20,80→100,80 dashed',
    ])
  })

  it('measures overlapping boxes between their matching sides, across the middle of the overlap', () => {
    expect(shown(rect(0, 0, 60, 60), rect(40, 20, 60, 60))).toEqual([
      'x 0,40→40,40 40',
      'x 60,40→100,40 40',
      'y 50,0→50,20 20',
      'y 50,60→50,80 20',
    ])
  })

  it('writes values with at most two decimals and no trailing zeros', () => {
    expect(shown(rect(0, 0, 10.5, 10), rect(20.125, 0, 10, 10))).toEqual(['x 10.5,5→20.125,5 9.63'])
    expect(shown(rect(0, 0, 10, 10), rect(30.5, 0, 10, 10))).toEqual(['x 10,5→30.5,5 20.5'])
  })

  it('shows nothing between boxes that only touch, or are the same', () => {
    expect(shown(rect(0, 0, 10, 10), rect(10, 0, 10, 10))).toEqual([])
    expect(shown(rect(0, 0, 10, 10), rect(0, 0, 10, 10))).toEqual([])
  })

  it('draws no dashed extension along a side the boxes only touch on', () => {
    // Below and touching on one side: the gap down the column they share, nothing across.
    expect(shown(rect(0, 0, 10, 10), rect(10, 20, 10, 10))).toEqual(['y 10,10→10,20 10'])
  })
})

describe('placePills', () => {
  const pill = (from: [number, number], to: [number, number], width = 20, height = 14) => ({
    from: { x: from[0], y: from[1] },
    to: { x: to[0], y: to[1] },
    width,
    height,
  })

  it('puts each pill at the middle of its line', () => {
    expect(placePills([pill([0, 50], [100, 50]), pill([200, 0], [200, 100])], [])).toEqual([
      rect(40, 43, 20, 14),
      rect(190, 43, 20, 14),
    ])
  })

  it('moves a pill that would cover one placed before along its own line, away from it', () => {
    // Two lines crossing at their middles: the second pill slides down its line.
    const [first, second] = placePills([pill([0, 50], [100, 50]), pill([50, 0], [50, 100])], [])
    expect(first).toEqual(rect(40, 43, 20, 14))
    expect(second).toEqual(rect(40, 59, 20, 14))
  })

  it('moves a pill off the size label along its line, away from the label', () => {
    // The label sits a little right of the line's middle: the pill slides left.
    const [placed] = placePills([pill([0, 50], [100, 50])], [rect(45, 40, 40, 20)])
    expect(placed).toEqual(rect(23, 43, 20, 14))
  })

  it('moves a pill past its line’s end when the line has no room beside what it would cover', () => {
    const [placed] = placePills([pill([40, 50], [60, 50])], [rect(30, 40, 40, 20)])
    expect(placed).toEqual(rect(72, 43, 20, 14))
  })

  it('keeps moving the same way past each thing it would cover in turn', () => {
    const [placed] = placePills([pill([0, 50], [100, 50])], [rect(45, 40, 20, 20), rect(20, 40, 20, 20)])
    expect(placed).toEqual(rect(-2, 43, 20, 14))
  })
})

describe('pillBeside', () => {
  const STAGE = rect(0, 0, 1280, 760)
  const SIZE = { width: 64, height: 14 }

  it('puts the pill 12px right of and below the pointer', () => {
    expect(pillBeside({ x: 400, y: 300 }, SIZE, [], STAGE)).toEqual({ x: 412, y: 312 })
  })

  it('puts it above the pointer where it would cover the size label, or come within 2px of it', () => {
    expect(pillBeside({ x: 400, y: 300 }, SIZE, [rect(380, 310, 90, 20)], STAGE)).toEqual({ x: 412, y: 274 })
    expect(pillBeside({ x: 400, y: 300 }, SIZE, [rect(380, 327, 90, 20)], STAGE)).toEqual({ x: 412, y: 274 })
    expect(pillBeside({ x: 400, y: 300 }, SIZE, [rect(380, 328, 90, 20)], STAGE)).toEqual({ x: 412, y: 312 })
  })

  it('puts it above the pointer where it would cross the stage’s bottom', () => {
    expect(pillBeside({ x: 400, y: 750 }, SIZE, [], STAGE)).toEqual({ x: 412, y: 724 })
  })

  it('puts it left of the pointer at the stage’s right side, and above it too in the bottom corner', () => {
    expect(pillBeside({ x: 1270, y: 300 }, SIZE, [], STAGE)).toEqual({ x: 1194, y: 312 })
    expect(pillBeside({ x: 1270, y: 750 }, SIZE, [], STAGE)).toEqual({ x: 1194, y: 724 })
  })

  it('keeps it right of and below the pointer when no place beside it is free', () => {
    expect(pillBeside({ x: 40, y: 20 }, SIZE, [], rect(0, 0, 60, 30))).toEqual({ x: 52, y: 32 })
  })
})
