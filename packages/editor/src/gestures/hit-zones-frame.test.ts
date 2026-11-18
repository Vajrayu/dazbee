import { describe, expect, it } from 'vitest'

import { cornersOf } from '../layers/transform.ts'
import { CORNER_REACH, EDGE_REACH, frameZoneAt, ROTATE_REACH, TOUCH_REACH } from './hit-zones.ts'

/** A picked frame 400 × 300 on screen at (100, 100). */
const FRAME = cornersOf({ x: 100, y: 100, width: 400, height: 300, rotation: 0 })

describe('frameZoneAt', () => {
  it('grabs each corner within CORNER_REACH by a mouse, outside the frame and inside', () => {
    expect(frameZoneAt(FRAME, { x: 100, y: 100 })).toEqual({ kind: 'resize', handle: 'nw', drawn: true })
    expect(frameZoneAt(FRAME, { x: 500 + 5, y: 100 - 5 })).toEqual({ kind: 'resize', handle: 'ne', drawn: true })
    expect(frameZoneAt(FRAME, { x: 500 - 5, y: 400 - 5 })).toEqual({ kind: 'resize', handle: 'se', drawn: true })
    expect(frameZoneAt(FRAME, { x: 100 - CORNER_REACH, y: 400 })).toEqual({ kind: 'resize', handle: 'sw', drawn: true })
    expect(frameZoneAt(FRAME, { x: 100 - CORNER_REACH - 1, y: 400 })).toBeNull()
  })

  it('grabs each edge along its whole length within EDGE_REACH by a mouse, none drawn', () => {
    expect(frameZoneAt(FRAME, { x: 300, y: 100 - EDGE_REACH })).toEqual({ kind: 'resize', handle: 'n', drawn: false })
    expect(frameZoneAt(FRAME, { x: 500 + EDGE_REACH, y: 130 })).toEqual({ kind: 'resize', handle: 'e', drawn: false })
    expect(frameZoneAt(FRAME, { x: 470, y: 400 - EDGE_REACH })).toEqual({ kind: 'resize', handle: 's', drawn: false })
    expect(frameZoneAt(FRAME, { x: 100, y: 250 })).toEqual({ kind: 'resize', handle: 'w', drawn: false })
    expect(frameZoneAt(FRAME, { x: 300, y: 100 - EDGE_REACH - 1 })).toBeNull()
    // Inside, away from the edges, a press is on the frame's area.
    expect(frameZoneAt(FRAME, { x: 300, y: 250 })).toBeNull()
  })

  it('reaches TOUCH_REACH from a corner, and an edge as far in proportion, by a finger', () => {
    expect(frameZoneAt(FRAME, { x: 100 - TOUCH_REACH, y: 100 }, true)).toMatchObject({ handle: 'nw' })
    expect(frameZoneAt(FRAME, { x: 100 - TOUCH_REACH, y: 100 })).toBeNull()
    const edgeReach = (EDGE_REACH * TOUCH_REACH) / CORNER_REACH
    expect(frameZoneAt(FRAME, { x: 300, y: 400 + edgeReach }, true)).toMatchObject({ handle: 's' })
    expect(frameZoneAt(FRAME, { x: 300, y: 400 + edgeReach + 1 }, true)).toBeNull()
  })

  it('has no ring outside the corners that turns the frame', () => {
    const out = (CORNER_REACH + ROTATE_REACH) / 2 / Math.SQRT2
    expect(frameZoneAt(FRAME, { x: 500 + out, y: 100 - out })).toBeNull()
    // Past a finger's reach of the corner, where its turning band would be.
    const outByFinger = (TOUCH_REACH + TOUCH_REACH + ROTATE_REACH - CORNER_REACH) / 2 / Math.SQRT2
    expect(frameZoneAt(FRAME, { x: 500 + outByFinger, y: 100 - outByFinger }, true)).toBeNull()
  })
})
