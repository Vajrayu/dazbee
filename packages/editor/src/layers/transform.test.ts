import { describe, expect, it } from 'vitest'

import { type Box, cornersOf, resize, snapAngle, unturned, uprightOnPage, wholeFrom, wholeOnPage } from './transform.ts'

const box: Box = { x: 100, y: 100, width: 200, height: 100, rotation: 0 }
const near = (b: Box) => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, Math.round(v * 1000) / 1000]))

describe('resize', () => {
  it('moves only the dragged edge or corner, keeping the opposite one', () => {
    expect(resize(box, 'se', { x: 400, y: 250 })).toEqual({ x: 100, y: 100, width: 300, height: 150, rotation: 0 })
    expect(resize(box, 'w', { x: 50, y: 999 })).toEqual({ x: 50, y: 100, width: 250, height: 100, rotation: 0 })
    expect(resize(box, 'n', { x: 0, y: 150 })).toEqual({ x: 100, y: 150, width: 200, height: 50, rotation: 0 })
  })

  it('stops at the opposite edge instead of turning the box inside out', () => {
    expect(resize(box, 'e', { x: 20, y: 0 })).toMatchObject({ x: 100, width: 0 })
  })

  it('keeps proportions with shift, following the side that moved more', () => {
    expect(resize(box, 'se', { x: 500, y: 210 }, { keepRatio: true })).toEqual({
      x: 100,
      y: 100,
      width: 400,
      height: 200,
      rotation: 0,
    })
    // An edge handle grows the other side about its middle.
    expect(resize(box, 'e', { x: 500, y: 0 }, { keepRatio: true })).toEqual({
      x: 100,
      y: 50,
      width: 400,
      height: 200,
      rotation: 0,
    })
  })

  it('works from the centre with alt', () => {
    expect(resize(box, 'e', { x: 350, y: 0 }, { fromCentre: true })).toEqual({
      x: 50,
      y: 100,
      width: 300,
      height: 100,
      rotation: 0,
    })
    expect(resize(box, 'se', { x: 400, y: 200 }, { fromCentre: true, keepRatio: true })).toEqual({
      x: 0,
      y: 50,
      width: 400,
      height: 200,
      rotation: 0,
    })
  })

  it('resizes a turned box along its own sides, keeping the opposite corner where it is on the page', () => {
    const turned = { ...box, rotation: 90 }
    const [nw] = cornersOf(turned)
    // Turned a quarter, the box's east side faces down the page.
    const se = cornersOf(turned)[2] as { x: number; y: number }
    const out = resize(turned, 'se', { x: se.x - 50, y: se.y + 100 })
    expect(near(out)).toMatchObject({ width: 300, height: 150, rotation: 90 })
    expect(cornersOf(out)[0]?.x).toBeCloseTo(nw?.x ?? 0)
    expect(cornersOf(out)[0]?.y).toBeCloseTo(nw?.y ?? 0)
  })
})

describe('snapAngle', () => {
  it('snaps to 15° steps', () => {
    expect(snapAngle(37)).toBe(30)
    expect(snapAngle(-8)).toBe(-15)
  })
})

describe('unturned', () => {
  it('says a box is unturned in the space it is kept in when its own turn is 0, whatever turns that space', () => {
    expect(unturned(box)).toBe(true)
    expect(unturned({ ...box, x: 120.5 })).toBe(true)
    expect(unturned({ ...box, rotation: 30 })).toBe(false)
    expect(unturned({ ...box, rotation: 180 })).toBe(false)
  })
})

describe('uprightOnPage', () => {
  it('says a layer is upright when neither it nor any box around it is turned', () => {
    expect(uprightOnPage([])).toBe(true)
    expect(uprightOnPage([box, { ...box, x: 120.5 }])).toBe(true)
    expect(uprightOnPage([{ ...box, rotation: 30 }, box])).toBe(false)
    expect(uprightOnPage([box, { ...box, rotation: -90 }])).toBe(false)
  })
})

describe('wholeFrom', () => {
  it('rounds a point to whole steps from another inside upright boxes, and leaves it inside a turned one', () => {
    expect(wholeFrom({ x: 201.3, y: 129.6 }, { x: 60.7, y: 100.3 }, [box])).toEqual({ x: 201.7, y: 129.3 })
    expect(wholeFrom({ x: 169.47, y: 0 }, { x: 85.7, y: 0 }, [], 0.5)).toEqual({ x: 169.7, y: 0 })
    expect(wholeFrom({ x: 201.3, y: 129.6 }, { x: 60.7, y: 0 }, [{ ...box, rotation: 30 }])).toEqual({
      x: 201.3,
      y: 129.6,
    })
  })
})

describe('wholeOnPage', () => {
  it('rounds a point to whole design pixels inside upright boxes, and leaves it inside a turned one', () => {
    expect(wholeOnPage({ x: 250.4, y: 129.6 }, [])).toEqual({ x: 250, y: 130 })
    expect(wholeOnPage({ x: -0.6, y: 489.5 }, [box])).toEqual({ x: -1, y: 490 })
    expect(wholeOnPage({ x: 250.4, y: 129.6 }, [box, { ...box, rotation: 30 }])).toEqual({ x: 250.4, y: 129.6 })
  })
})
