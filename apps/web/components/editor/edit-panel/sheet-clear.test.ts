import { describe, expect, it } from 'vitest'

import { press, pressDown, pressMove, sheetCover } from './sheet-clear.ts'

/** Whether a press by a pointer of a type, moved `by` pixels across from where it went down, is a drag. */
function dragged(pointerType: string, by: number) {
  pressDown({ clientX: 100, clientY: 100, pointerType })
  pressMove({ clientX: 100 + by, clientY: 100 })
  return press.dragged
}

/** A 390 × 844 phone's stage, from the window's top. */
const STAGE = { top: 0, bottom: 844 }
/** The edit panel's sheet, low, with nothing in its place. */
const LOW = { open: null, rightClick: false, sheetHeight: 'low' } as const
/** A layer whose bottom, its size label's, is 470 px down the stage, under a low sheet from 437 down. */
const UNDER = { x: 100, y: 400, width: 100, height: 70 }

describe('sheetCover', () => {
  it("keeps the stage's bottom clear of the low sheet, 12 px past its top, for a part under it", () => {
    expect(sheetCover(STAGE, 437, LOW, UNDER)).toEqual({ bottom: 844 - 437 + 12 })
    expect(sheetCover({ top: 100, bottom: 944 }, 537, LOW, UNDER)).toEqual({ bottom: 944 - 537 + 12 })
  })

  it('moves nothing for a part clear of the sheet and its gap, wherever it is above it', () => {
    expect(sheetCover(STAGE, 437, LOW, { x: 100, y: 300, width: 100, height: 125 })).toBeNull()
    expect(sheetCover(STAGE, 437, LOW, { x: 100, y: -40, width: 100, height: 70 })).toBeNull()
    expect(sheetCover(STAGE, 437, LOW, { x: 100, y: 300, width: 100, height: 126 })).toEqual({ bottom: 419 })
  })

  it('keeps clear of the font chooser in the panel’s place, whatever height the sheet was left at', () => {
    expect(sheetCover(STAGE, 450, { ...LOW, open: 'font', sheetHeight: 'full' }, UNDER)).toEqual({ bottom: 406 })
  })

  it('moves nothing with no sheet open, for the full sheet, or for a menu’s sheet', () => {
    expect(sheetCover(STAGE, null, LOW, UNDER)).toBeNull()
    expect(sheetCover(STAGE, 188, { ...LOW, sheetHeight: 'full' }, UNDER)).toBeNull()
    expect(sheetCover(STAGE, 300, { ...LOW, open: 'more' }, UNDER)).toBeNull()
    expect(sheetCover(STAGE, 300, { ...LOW, rightClick: true }, UNDER)).toBeNull()
  })
})

describe('pressMove', () => {
  it("calls a finger's press a drag once it goes past the stage's slop for a finger", () => {
    expect(dragged('touch', 6)).toBe(false)
    expect(dragged('touch', 9)).toBe(true)
  })

  it("calls a mouse's press a drag once it goes past the stage's slop for a mouse", () => {
    expect(dragged('mouse', 2)).toBe(false)
    expect(dragged('mouse', 4)).toBe(true)
  })

  it('counts a drag as an act, once', () => {
    pressDown({ clientX: 100, clientY: 100, pointerType: 'mouse' })
    const acts = press.acts
    pressMove({ clientX: 102, clientY: 100 })
    pressMove({ clientX: 110, clientY: 100 })
    pressMove({ clientX: 120, clientY: 100 })
    expect(press.acts).toBe(acts + 1)
  })
})
