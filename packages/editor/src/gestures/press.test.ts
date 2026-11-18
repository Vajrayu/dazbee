import { describe, expect, it } from 'vitest'

import { CLICK_SLOP, pastSlop, slopFor } from './press.ts'

describe('CLICK_SLOP', () => {
  it('lets a finger wander further than a mouse or a pen', () => {
    expect(CLICK_SLOP).toEqual({ mouse: 3, pen: 3, touch: 8 })
  })
})

describe('slopFor', () => {
  it("gives each pointer type's slop, and a mouse's for a type it does not know", () => {
    expect([slopFor('mouse'), slopFor('pen'), slopFor('touch'), slopFor('')]).toEqual([3, 3, 8, 3])
  })
})

describe('pastSlop', () => {
  const from = { x: 100, y: 100 }

  it('answers no at the slop and yes past it, by mouse, pen and finger', () => {
    expect(pastSlop(from, { x: 103, y: 100 }, 'mouse')).toBe(false)
    expect(pastSlop(from, { x: 103.1, y: 100 }, 'mouse')).toBe(true)
    expect(pastSlop(from, { x: 100, y: 97 }, 'pen')).toBe(false)
    expect(pastSlop(from, { x: 100, y: 96.9 }, 'pen')).toBe(true)
    expect(pastSlop(from, { x: 108, y: 100 }, 'touch')).toBe(false)
    expect(pastSlop(from, { x: 108.1, y: 100 }, 'touch')).toBe(true)
  })

  it('measures a straight line, so a step of 2.5 each way is past a mouse slop of 3', () => {
    expect(pastSlop(from, { x: 102, y: 102 }, 'mouse')).toBe(false)
    expect(pastSlop(from, { x: 102.5, y: 102.5 }, 'mouse')).toBe(true)
  })
})
