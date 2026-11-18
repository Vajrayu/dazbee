import { describe, expect, it } from 'vitest'

import { draggedHeight, snapHeight } from './sheet-heights.ts'

/** A sheet 300 px tall low and 620 px tall full, as on a 390 × 844 phone. */
const SHEET = { low: 300, full: 620 }

describe('snapHeight', () => {
  it('settles a slow drag on the height it is nearer', () => {
    expect(snapHeight({ ...SHEET, at: 450, speed: 0 })).toBe('low')
    expect(snapHeight({ ...SHEET, at: 470, speed: 0 })).toBe('full')
    expect(snapHeight({ ...SHEET, at: 610, speed: -0.1 })).toBe('full')
    expect(snapHeight({ ...SHEET, at: 310, speed: 0.1 })).toBe('low')
  })

  it('follows a flick the way it goes, however far it went', () => {
    expect(snapHeight({ ...SHEET, at: 320, speed: 0.8 })).toBe('full')
    expect(snapHeight({ ...SHEET, at: 600, speed: -0.8 })).toBe('low')
  })

  it('stays low when all of the sheet shows low already', () => {
    expect(snapHeight({ low: 240, full: 240, at: 240, speed: 0.8 })).toBe('low')
  })
})

describe('draggedHeight', () => {
  it('follows the finger between the two heights', () => {
    expect(draggedHeight({ ...SHEET, from: 300, by: -100 })).toBe(400)
    expect(draggedHeight({ ...SHEET, from: 620, by: 200 })).toBe(420)
  })

  it('goes no lower than low and no higher than full', () => {
    expect(draggedHeight({ ...SHEET, from: 300, by: 80 })).toBe(300)
    expect(draggedHeight({ ...SHEET, from: 300, by: -500 })).toBe(620)
  })
})
