import { describe, expect, it } from 'vitest'

import {
  boundsOf,
  type Box,
  carry,
  centreOf,
  flippedPoint,
  flippedRect,
  flipsOf,
  normalAngle,
  round,
  scaleWithin,
} from './geometry.ts'

const near = (b: Box) => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, Math.round(v * 1000) / 1000]))

describe('boundsOf', () => {
  it('bounds turned boxes as they are drawn', () => {
    const b = boundsOf([
      { x: 0, y: 0, width: 100, height: 100, rotation: 45 },
      { x: 200, y: 0, width: 10, height: 10, rotation: 0 },
    ])
    expect(near(b)).toEqual({ x: -20.711, y: -20.711, width: 230.711, height: 141.421, rotation: 0 })
  })
})

describe('flipsOf', () => {
  it("gives a layer's flags alone", () => {
    expect(flipsOf({ x: 1, flipX: true })).toEqual({ flipX: true, flipY: undefined })
  })
})

describe('flippedPoint', () => {
  const box = { x: 100, y: 50, width: 40, height: 20 }

  it('mirrors a point across the box centre lines its flips name, and back again', () => {
    const p = { x: 110, y: 55 }
    expect(flippedPoint(p, box)).toEqual(p)
    expect(flippedPoint(p, { ...box, flipX: true })).toEqual({ x: 130, y: 55 })
    expect(flippedPoint(p, { ...box, flipY: true })).toEqual({ x: 110, y: 65 })
    const both = { ...box, flipX: true, flipY: true }
    expect(flippedPoint(flippedPoint(p, both), both)).toEqual(p)
  })
})

describe('flippedRect', () => {
  it('mirrors a rect about the box centre its flips name, keeping its size', () => {
    const box = { x: 0, y: 0, width: 100, height: 50, flipX: true, flipY: true }
    expect(flippedRect({ x: 10, y: 5, width: 20, height: 10 }, box)).toEqual({ x: 70, y: 35, width: 20, height: 10 })
  })
})

describe('carrying layers along', () => {
  const box: Box = { x: 100, y: 100, width: 200, height: 100, rotation: 0 }

  it('scales a layer inside a resized group with it', () => {
    const inner = { x: 150, y: 125, width: 50, height: 50, rotation: 30 }
    expect(carry(inner, box, { x: 100, y: 100, width: 400, height: 50 })).toEqual({
      x: 200,
      y: 112.5,
      width: 100,
      height: 25,
      rotation: 30,
    })
  })

  it('scales a layer within a selection about the selection, sized along its own sides', () => {
    const from = { x: 0, y: 0, width: 100, height: 100, rotation: 0 }
    const to = { x: 0, y: 0, width: 200, height: 100, rotation: 0 }
    expect(scaleWithin({ x: 10, y: 10, width: 20, height: 10, rotation: 0 }, from, to)).toEqual({
      x: 20,
      y: 10,
      width: 40,
      height: 10,
      rotation: 0,
    })
    const quarter = scaleWithin({ x: 10, y: 10, width: 20, height: 10, rotation: 90 }, from, to)
    expect(near(quarter)).toMatchObject({ width: 20, height: 20, rotation: 90 })
    expect(centreOf(quarter)).toEqual({ x: 40, y: 15 })
  })
})

describe('normalAngle', () => {
  it('keeps angles in (-180, 180]', () => {
    expect(normalAngle(190)).toBe(-170)
    expect(normalAngle(-180)).toBe(180)
  })
})

describe('round', () => {
  it('rounds to hundredths, and gives a number too large to scale as it is', () => {
    expect(round(12.346)).toBe(12.35)
    expect(round(-0.004)).toBe(-0)
    expect(round(Number.MIN_VALUE)).toBe(0)
    expect(round(Number.MAX_VALUE)).toBe(Number.MAX_VALUE)
    expect(round(-Number.MAX_VALUE)).toBe(-Number.MAX_VALUE)
  })
})
