import { describe, expect, it } from 'vitest'

import { wrapLines } from './wrap-lines.ts'

const at = (x: number, y: number, width = 40, height = 40) => ({ x, y, width, height })

describe('wrapLines', () => {
  it('groups a wrapping row’s layers into the lines they are drawn on, in flow order', () => {
    expect(wrapLines([at(0, 0), at(50, 0), at(100, 0), at(0, 50), at(50, 50)], true)).toEqual([
      [0, 1, 2],
      [3, 4],
    ])
  })

  it('starts a line where a layer sits past the one before across the flow, though not before it along', () => {
    // A line of one wide layer, then a narrower one under it at the same start.
    expect(wrapLines([at(0, 0, 200), at(0, 50), at(50, 50)], true)).toEqual([[0], [1, 2]])
    // Centred lines: the second line starts right of the first's start, under it.
    expect(wrapLines([at(10, 0), at(60, 0), at(110, 0), at(35, 50)], true)).toEqual([[0, 1, 2], [3]])
  })

  it('keeps layers of different heights on one line, lined up across it', () => {
    expect(wrapLines([at(0, 10, 40, 20), at(50, 0, 40, 40), at(100, 5, 40, 30)], true)).toEqual([[0, 1, 2]])
  })

  it('reads a wrapping column’s lines down its columns', () => {
    expect(wrapLines([at(0, 0), at(0, 50), at(50, 0), at(50, 50)], false)).toEqual([
      [0, 1],
      [2, 3],
    ])
  })

  it('gives no lines for no layers', () => {
    expect(wrapLines([], true)).toEqual([])
  })
})
