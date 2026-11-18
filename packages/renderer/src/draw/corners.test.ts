import { describe, expect, it } from 'vitest'

import { cornerAt, drawnAtCorner, drawnRadii, oneRadiusLimit, shapePoints } from './corners.ts'

describe('oneRadiusLimit', () => {
  it('is half the shorter side, to the last bit', () => {
    expect([oneRadiusLimit(200, 120), oneRadiusLimit(150.25, 90.75), oneRadiusLimit(30, 300)]).toEqual([60, 45.375, 15])
  })
})

describe('drawnRadii', () => {
  it('draws one radius at most half the shorter side', () => {
    expect(drawnRadii(200, 120, 20)).toEqual([20, 20, 20, 20])
    expect(drawnRadii(200, 120, 300)).toEqual([60, 60, 60, 60])
  })

  it('scales four radii down together where two would overlap along a side', () => {
    expect(drawnRadii(200, 120, [10, 20, 30, 40])).toEqual([10, 20, 30, 40])
    const [tl, tr, br, bl] = drawnRadii(200, 120, [30, 300, 30, 30])
    expect(tl).toBeCloseTo(10.909, 3)
    expect(tr).toBeCloseTo(109.091, 3)
    expect(br).toBeCloseTo(10.909, 3)
    expect(bl).toBeCloseTo(10.909, 3)
  })

  it('draws a lone corner up to the shorter side', () => {
    expect(drawnRadii(200, 120, [300, 0, 0, 0])).toEqual([120, 0, 0, 0])
  })
})

describe('shapePoints', () => {
  it('places a polygon’s corners round its box, the first at the top centre, stretched to fill it', () => {
    const points = shapePoints(
      { x: 10, y: 20, width: 160, height: 160 },
      { kind: 'polygon', sides: 3, cornerRadius: 0 },
    )
    expect(points.map(([x, y]) => [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000])).toEqual([
      [90, 20],
      [170, 180],
      [10, 180],
    ])
  })

  it('puts a star’s inner corners between its points, at its inner radius', () => {
    const points = shapePoints(
      { x: 0, y: 0, width: 200, height: 200 },
      { kind: 'star', points: 4, innerRadius: 0.5, cornerRadius: 0 },
    )
    expect(points).toHaveLength(8)
    const [top, inner] = points
    expect(top?.[0]).toBeCloseTo(100)
    expect(top?.[1]).toBeCloseTo(0)
    expect(inner?.[0]).toBeCloseTo(100 + 50 * Math.SQRT1_2)
    expect(inner?.[1]).toBeCloseTo(100 - 50 * Math.SQRT1_2)
  })
})

describe('cornerAt', () => {
  it('gives a square corner’s bisector into the shape, half its angle, and half its shorter edge as its limit', () => {
    const { into, half, limit } = cornerAt([0, 100], [0, 0], [60, 0])
    expect(into[0]).toBeCloseTo(Math.SQRT1_2)
    expect(into[1]).toBeCloseTo(Math.SQRT1_2)
    expect(half).toBeCloseTo(Math.PI / 4)
    expect(limit).toBeCloseTo(30)
  })
})

describe('drawnAtCorner', () => {
  it('draws a radius at a corner up to the corner’s limit', () => {
    const { limit } = cornerAt([0, 100], [0, 0], [60, 0])
    expect([drawnAtCorner(20, limit), drawnAtCorner(300, limit), drawnAtCorner(0, limit)]).toEqual([20, limit, 0])
  })
})
