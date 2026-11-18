import { describe, expect, it } from 'vitest'

import { SNAP_DISTANCE, snapMove, snapResize, snapTargets } from './snap.ts'
import { boundsOf } from './transform.ts'

const frame = { x: 0, y: 0, width: 1080, height: 1080 }
const a = { x: 100, y: 100, width: 200, height: 100 }
const b = { x: 600, y: 400, width: 100, height: 100 }

describe('snapTargets', () => {
  it('snaps to the lines of the boxes the layers are within, and measures no equal gap to them', () => {
    // A parent box 100 to 200 and a layer beside 500 to 600: centred between them, a box would be
    // 100 from each, but a parent holds the layer and is not beside it.
    const parent = { x: 100, y: 500, width: 100, height: 100 }
    const right = { x: 500, y: 500, width: 100, height: 100 }
    const targets = snapTargets([right], [parent, frame], 'sq')
    expect(targets.beside).toEqual([right])
    expect(snapMove({ x: 297, y: 520, width: 100, height: 60 }, targets, 6)).toMatchObject({ dx: 0, gaps: [] })
    // Its lines snap: a left side 3 past the parent's right side snaps back onto it.
    const s = snapMove({ x: 203, y: 520, width: 100, height: 60 }, targets, 6)
    expect(s.dx).toBe(-3)
    expect(s.snapLines).toContainEqual(expect.objectContaining({ axis: 'x', at: 200 }))
  })

  it('gives none of the lines of a box within on a side its sides and middle follow the dragged layers', () => {
    const parent = { x: 100, y: 500, width: 300, height: 100, follows: { width: true, height: false } }
    const targets = snapTargets([], [parent], 'row')
    expect(targets.xs).toEqual([])
    expect(targets.ys.map((line) => line.at)).toEqual([500, 550, 600])
    expect(snapTargets([], [{ ...parent, follows: { width: false, height: true } }], 'row').ys).toEqual([])
  })

  it('snaps to the frame’s guides, each snap line across the frame and crossed only where the box meets it', () => {
    const targets = snapTargets([], [frame], 'sq', [
      { axis: 'x', at: 333, from: 0, to: 1080 },
      { axis: 'y', at: 900, from: 0, to: 1080 },
    ])
    expect(targets.xs.at(-1)).toEqual({ at: 333, box: -1, span: { from: 0, to: 1080 } })
    const s = snapMove({ x: 129, y: 400, width: 200, height: 100 }, targets, 6)
    expect(s.dx).toBe(4)
    expect(s.snapLines).toEqual([{ axis: 'x', at: 333, from: 0, to: 1080, points: [400, 500] }])
    expect(snapResize({ x: 100, y: 700, width: 100, height: 197 }, 's', targets, 6).dy).toBe(3)
  })
})

describe('snapMove', () => {
  it('lines up edges and centres with other layers and the frame, showing why', () => {
    const targets = snapTargets([a, b], [frame], 'sq')
    // Its left edge 4 px past A's: it snaps back onto it, and a snap line spans both.
    const s = snapMove({ x: 104, y: 300, width: 80, height: 80 }, targets, 6)
    expect(s.dx).toBe(-4)
    expect(s.snapLines).toContainEqual({ axis: 'x', at: 100, from: 100, to: 380, points: [100, 200, 300, 380] })
    // Its centre near the frame's centre lines up with it.
    const c = snapMove({ x: 497, y: 700, width: 80, height: 80 }, targets, 6)
    expect(c.dx).toBe(3)
    expect(c.snapLines.some((g) => g.axis === 'x' && g.at === 540)).toBe(true)
  })

  it('marks the points that lined up: the corners on an edge, the middle on a centre line', () => {
    const targets = snapTargets([a, b], [frame], 'sq')
    const c = snapMove({ x: 497, y: 700, width: 80, height: 80 }, targets, 6)
    expect(c.snapLines.find((g) => g.axis === 'x' && g.at === 540)?.points).toEqual([540, 740])
  })

  it('reaches as many screen pixels at any zoom', () => {
    const targets = snapTargets([a], [frame], 'sq')
    const moving = { x: 112, y: 600, width: 60, height: 60 }
    // 12 design pixels away: out of reach at 100%, in reach at 50% where they are 6 on screen.
    expect(snapMove(moving, targets, SNAP_DISTANCE / 1).dx).toBe(0)
    expect(snapMove(moving, targets, SNAP_DISTANCE / 0.5).dx).toBe(-12)
    expect(snapMove(moving, targets, SNAP_DISTANCE / 4).dx).toBe(0)
  })

  it('snaps a turned layer by the box around it as drawn', () => {
    const turned = boundsOf([{ x: 300, y: 600, width: 100, height: 100, rotation: 45 }])
    const s = snapMove(turned, snapTargets([a], [frame], 'sq'), 6)
    // Its drawn left edge is at 279.3: 20.7 from A's right edge, so out of reach; its centre 350
    // is not near A's lines either. Moved so its drawn left edge is 3 past A's right, it snaps.
    expect(s.dx).toBe(0)
    const near = { ...turned, x: 303 }
    expect(snapMove(near, snapTargets([a], [frame], 'sq'), 6).dx).toBeCloseTo(-3)
  })

  it('keeps an axis held still by shift', () => {
    const s = snapMove({ x: 104, y: 103, width: 80, height: 80 }, snapTargets([a], [frame], 'sq'), 6, { y: true })
    expect(s).toMatchObject({ dx: -4, dy: 0 })
  })

  it('snaps to equal spacing: centred between neighbours, or as far as two others are apart', () => {
    const left = { x: 100, y: 500, width: 100, height: 100 }
    const right = { x: 500, y: 500, width: 100, height: 100 }
    const targets = snapTargets([left, right], [frame], 'sq')
    // Centred between them, 100 from each.
    const centred = snapMove({ x: 297, y: 520, width: 100, height: 60 }, targets, 6)
    expect(centred.dx).toBe(3)
    expect(centred.gaps.map((g) => [g.from, g.to])).toEqual([
      [200, 300],
      [400, 500],
    ])
    // Past the right one at the same 300 gap the other two have.
    const after = snapMove({ x: 896, y: 520, width: 100, height: 60 }, targets, 6)
    expect(after.dx).toBe(4)
    expect(after.gaps.map((g) => [g.from, g.to])).toEqual([
      [200, 500],
      [600, 900],
    ])
  })

  it('stays put with nothing in reach', () => {
    expect(snapMove({ x: 830, y: 820, width: 50, height: 50 }, snapTargets([a, b], [frame], 'sq'), 6)).toEqual({
      dx: 0,
      dy: 0,
      snapLines: [],
      gaps: [],
    })
  })
})

describe('snapResize', () => {
  it('snaps only the edges the handle moves', () => {
    const targets = snapTargets([a], [frame], 'sq')
    // Dragging the east edge to 297: it snaps to A's right edge at 300.
    const s = snapResize({ x: 200, y: 400, width: 97, height: 103 }, 'e', targets, 6)
    expect(s).toMatchObject({ dx: 3, dy: 0 })
    expect(s.snapLines.every((g) => g.axis === 'x' && g.at === 300)).toBe(true)
    // The south-west corner moves the west and south edges: west to A's left, south to the frame's centre.
    const sw = snapResize({ x: 98, y: 400, width: 200, height: 138 }, 'sw', targets, 6)
    expect(sw).toMatchObject({ dx: 2, dy: 2 })
  })

  it('with the shape kept, snaps the corner edge nearest a snap line and leaves the other to follow', () => {
    const targets = snapTargets([a], [frame], 'sq')
    // The same corner, the west edge 2 off a snap line and the south edge 2 off one: only the nearer, by its axis order, snaps.
    const sw = snapResize({ x: 97, y: 400, width: 200, height: 139 }, 'sw', targets, 6, true)
    expect(sw.dx !== 0 && sw.dy !== 0).toBe(false)
    expect(Math.abs(sw.dx) + Math.abs(sw.dy)).toBeGreaterThan(0)
    // Its snap lines are the snapped axis's only.
    const axis = sw.dx !== 0 ? 'x' : 'y'
    expect(sw.snapLines.every((g) => g.axis === axis)).toBe(true)
  })
})
