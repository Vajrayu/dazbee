import { describe, expect, it } from 'vitest'

import { draggedRadii, radiiAsDrawn, radiiOf, radiiPatch, radiusCorners, radiusPatch } from './radius.ts'

const polygon = { shape: { kind: 'polygon', sides: 5, cornerRadius: 8 } }
const star = { shape: { kind: 'star', points: 5, innerRadius: 0.4, cornerRadius: 8 } }
const rect = (shape: object = {}) => ({ shape: { kind: 'rect', cornerRadius: 0, ...shape } })
const triangle = { shape: { kind: 'polygon', sides: 3, cornerRadius: 0 } }
const r2 = (n: number) => Math.round(n * 100) / 100 + 0
/** The corners of a layer 200 by 120, with each number to hundredths. */
const cornersOf = (type: string, props: Record<string, unknown>, width = 200, height = 120) =>
  radiusCorners(type, props, width, height).map((c) => ({
    at: [r2(c.at.x), r2(c.at.y)],
    into: [r2(c.into.x), r2(c.into.y)],
    half: r2(c.half),
    drawn: r2(c.drawn),
    limit: r2(c.limit),
  }))
/** A drag of a corner of a 200 by 120 rectangle with these props by `along` along its bisector, its own alone with `own`. */
function dragged(props: Record<string, unknown>, corner: number, along: number, own = false, across = 0) {
  const corners = radiusCorners('graphic', props, 200, 120)
  const c = corners[corner]
  if (!c) throw new Error(`no corner ${corner}`)
  const by = { x: c.into.x * along - c.into.y * across, y: c.into.y * along + c.into.x * across }
  return draggedRadii(corners, corner, { x: by.x / Math.sin(c.half), y: by.y / Math.sin(c.half) }, own, 200, 120)
}

describe('radiiOf', () => {
  it('reads one radius or each corner’s own where each type keeps them, nothing for a type without', () => {
    expect(radiiOf('box', { cornerRadius: 8 })).toBe(8)
    expect(radiiOf('box', { cornerRadius: [1, 2, 3, 4] })).toEqual([1, 2, 3, 4])
    expect(radiiOf('graphic', { shape: { kind: 'rect', cornerRadius: 5 } })).toBe(5)
    expect(radiiOf('graphic', { shape: { kind: 'rect', cornerRadius: 5, corners: [1, 2, 3, 4] } })).toEqual([
      1, 2, 3, 4,
    ])
    expect(radiiOf('graphic', polygon)).toBe(8)
    expect(radiiOf('graphic', star)).toBe(8)
    expect(radiiOf('graphic', { shape: { kind: 'ellipse' } })).toBeUndefined()
    expect(radiiOf('text', { text: 'Hi' })).toBeUndefined()
  })
})

describe('radiiAsDrawn', () => {
  it('reads each corner’s own radius where it is drawn, a flipped layer’s mirrored', () => {
    const each = { cornerRadius: [1, 2, 3, 4] }
    expect(radiiAsDrawn('box', each)).toEqual([1, 2, 3, 4])
    expect(radiiAsDrawn('box', { ...each, flipX: true })).toEqual([2, 1, 4, 3])
    expect(radiiAsDrawn('box', { ...each, flipY: true })).toEqual([4, 3, 2, 1])
    expect(radiiAsDrawn('graphic', { ...rect({ corners: [1, 2, 3, 4] }), flipX: true, flipY: true })).toEqual([
      3, 4, 1, 2,
    ])
    expect(radiiAsDrawn('box', { cornerRadius: 8, flipX: true })).toBe(8)
    expect(radiiAsDrawn('group', { flipX: true })).toBeUndefined()
  })
})

describe('radiiPatch', () => {
  it('gives a box and a rectangle each corner’s own radius, and a polygon and a star the first', () => {
    expect(radiiPatch('box', { cornerRadius: 8 }, [1, 2.345, -3, 400])).toEqual({ cornerRadius: [1, 2.35, 0, 400] })
    expect(radiiPatch('graphic', { shape: { kind: 'rect', cornerRadius: 8 } }, [1, 2, 3, 4])).toEqual({
      shape: { kind: 'rect', cornerRadius: 8, corners: [1, 2, 3, 4] },
    })
    expect(radiiPatch('graphic', star, [3, 2, 1, 0])).toEqual({ shape: { ...star.shape, cornerRadius: 3 } })
  })

  it('gives four corners of one radius that radius alone', () => {
    expect(radiiPatch('box', { cornerRadius: [8, 8, 8, 8] }, 8)).toEqual({ cornerRadius: 8 })
    expect(radiiPatch('box', { cornerRadius: [8, 8, 8, 8] }, [8, 8, 8, 8])).toBeNull()
  })

  it('keeps four equal radii set as four, each corner’s own', () => {
    const rect = { shape: { kind: 'rect', cornerRadius: 0, corners: [8, 8, 8, 5] } }
    expect(radiiPatch('graphic', rect, [8, 8, 8, 8])).toEqual({
      shape: { kind: 'rect', cornerRadius: 0, corners: [8, 8, 8, 8] },
    })
    expect(radiiPatch('graphic', rect, 8)).toEqual({ shape: { kind: 'rect', cornerRadius: 8 } })
    expect(radiiPatch('box', { cornerRadius: [8, 8, 8, 5] }, [8, 8, 8, 8])).toEqual({ cornerRadius: [8, 8, 8, 8] })
  })
})

describe('radiusPatch', () => {
  it('sets every corner to a radius past 200, kept to hundredths, never below 0', () => {
    expect(radiusPatch('box', { cornerRadius: 8 }, () => 300)).toEqual({ cornerRadius: 300 })
    expect(radiusPatch('graphic', polygon, () => 12.345)).toEqual({ shape: { ...polygon.shape, cornerRadius: 12.35 } })
    expect(radiusPatch('graphic', star, () => -4)).toEqual({ shape: { ...star.shape, cornerRadius: 0 } })
  })

  it('steps from the first corner while each corner has its own', () => {
    expect(radiusPatch('box', { cornerRadius: [4, 9, 9, 9] }, (r) => r + 1)).toEqual({ cornerRadius: 5 })
    expect(
      radiusPatch('graphic', { shape: { kind: 'rect', cornerRadius: 0, corners: [4, 9, 9, 9] } }, (r) => r + 1),
    ).toEqual({ shape: { kind: 'rect', cornerRadius: 5 } })
  })

  it('sets one corner of a box or a rectangle by the same rule as every corner, the others kept', () => {
    expect(radiusPatch('box', { cornerRadius: 8 }, () => 300, 1)).toEqual({ cornerRadius: [8, 300, 8, 8] })
    expect(
      radiusPatch('graphic', { shape: { kind: 'rect', cornerRadius: 0, corners: [1, 2, 3, 4] } }, () => 12.345, 2),
    ).toEqual({ shape: { kind: 'rect', cornerRadius: 0, corners: [1, 2, 12.35, 4] } })
    expect(radiusPatch('box', { cornerRadius: [1, 2, 3, 4] }, (r) => r - 5, 0)).toEqual({
      cornerRadius: [0, 2, 3, 4],
    })
  })

  it('sets the corner drawn where it is asked on a flipped layer: the one mirrored there', () => {
    const each = { cornerRadius: [1, 2, 3, 4] }
    expect(radiusPatch('box', { ...each, flipX: true }, () => 9, 0)).toEqual({ cornerRadius: [1, 9, 3, 4] })
    expect(radiusPatch('box', { ...each, flipY: true }, () => 9, 0)).toEqual({ cornerRadius: [1, 2, 3, 9] })
    expect(radiusPatch('box', { ...each, flipX: true, flipY: true }, () => 9, 1)).toEqual({
      cornerRadius: [1, 2, 3, 9],
    })
    // Every corner steps from the one drawn at the top left.
    expect(radiusPatch('box', { cornerRadius: [20, 10, 10, 10], flipX: true }, (r) => r + 1)).toEqual({
      cornerRadius: 11,
    })
  })

  it('sets a polygon’s and a star’s one radius whatever corner is asked', () => {
    expect(radiusPatch('graphic', polygon, (r) => r + 2, 3)).toEqual({ shape: { ...polygon.shape, cornerRadius: 10 } })
    expect(radiusPatch('graphic', star, () => 20, 1)).toEqual({ shape: { ...star.shape, cornerRadius: 20 } })
  })

  it('gives null for a layer without a radius, and for one that keeps the radius it has', () => {
    expect(radiusPatch('graphic', { shape: { kind: 'ellipse' } }, () => 10)).toBeNull()
    expect(radiusPatch('group', {}, () => 10)).toBeNull()
    expect(radiusPatch('box', { cornerRadius: 8 }, () => 8)).toBeNull()
    expect(radiusPatch('graphic', polygon, () => 8.001)).toBeNull()
  })
})

describe('radiusCorners', () => {
  it('gives a rectangle’s and a box’s four corners from the top left clockwise, each with the radius drawn there', () => {
    const s = r2(Math.SQRT1_2)
    const q = r2(Math.PI / 4)
    expect(cornersOf('graphic', rect())).toEqual([
      { at: [0, 0], into: [s, s], half: q, drawn: 0, limit: 60 },
      { at: [200, 0], into: [-s, s], half: q, drawn: 0, limit: 60 },
      { at: [200, 120], into: [-s, -s], half: q, drawn: 0, limit: 60 },
      { at: [0, 120], into: [s, -s], half: q, drawn: 0, limit: 60 },
    ])
    expect(cornersOf('box', { cornerRadius: 300 }).map((c) => c.drawn)).toEqual([60, 60, 60, 60])
    expect(cornersOf('graphic', rect({ corners: [10, 40, 0, 20] })).map((c) => c.drawn)).toEqual([10, 40, 0, 20])
    expect(cornersOf('box', { cornerRadius: [100, 100, 0, 0] }).map((c) => c.drawn)).toEqual([100, 100, 0, 0])
    expect(cornersOf('box', { cornerRadius: [200, 200, 0, 0] }).map((c) => c.drawn)).toEqual([100, 100, 0, 0])
  })

  it('gives a polygon’s and a star’s top point alone, its radius drawn no larger than that corner’s limit', () => {
    expect(cornersOf('graphic', triangle, 200, 100)).toEqual([
      { at: [100, 0], into: [0, 1], half: r2(Math.PI / 4), drawn: 0, limit: 70.71 },
    ])
    const [tip] = cornersOf('graphic', { shape: { ...star.shape, cornerRadius: 40 } }, 200, 200)
    expect(tip?.at).toEqual([100, 0])
    expect(tip?.into).toEqual([0, 1])
    expect(tip?.drawn).toBe(tip?.limit)
    expect(tip?.limit).toBeLessThan(40)
  })

  it('gives a flipped layer’s corners where they are drawn, mirrored, each still by the corner it stores', () => {
    const s = r2(Math.SQRT1_2)
    const across = cornersOf('graphic', { ...rect({ corners: [10, 40, 0, 20] }), flipX: true })
    expect(across.map((c) => [c.at, c.into, c.drawn])).toEqual([
      [[200, 0], [-s, s], 10],
      [[0, 0], [s, s], 40],
      [[0, 120], [s, -s], 0],
      [[200, 120], [-s, -s], 20],
    ])
    const [tip] = cornersOf('graphic', { ...triangle, flipY: true }, 200, 100)
    expect([tip?.at, tip?.into]).toEqual([
      [100, 100],
      [0, -1],
    ])
  })

  it('gives none for a layer without a radius', () => {
    expect(cornersOf('graphic', { shape: { kind: 'ellipse' } })).toEqual([])
    expect(cornersOf('text', { text: 'Hi' })).toEqual([])
  })
})

describe('draggedRadii', () => {
  it('adds the travel along the bisector to the radius drawn at the press, in whole numbers from 0', () => {
    expect([0, 0.4, 0.6, 1, 2.5, 10].map((along) => dragged(rect(), 0, along))).toEqual([
      { value: 0, radii: null },
      { value: 0, radii: null },
      { value: 1, radii: 1 },
      { value: 1, radii: 1 },
      { value: 3, radii: 3 },
      { value: 10, radii: 10 },
    ])
    expect(dragged(rect({ cornerRadius: 20 }), 2, -30)).toEqual({ value: 0, radii: 0 })
  })

  it('stops every corner at half the shorter side, the top kept to the hundredth under it', () => {
    expect(dragged(rect(), 0, 400)).toEqual({ value: 60, radii: 60 })
    const corners = radiusCorners('graphic', triangle, 200, 100)
    expect(draggedRadii(corners, 0, { x: 0, y: 400 }, false, 200, 100).value).toBe(70.71)
    expect(draggedRadii(corners, 0, { x: 0, y: 400 }, true, 200, 100).value).toBe(70.71)
  })

  it('never asks for more than the top draws, where the top is not a hundredth', () => {
    const box = radiusCorners('box', { cornerRadius: 0 }, 150.25, 90.75)
    expect(box[0]?.limit).toBe(45.375)
    expect(draggedRadii(box, 0, { x: 400, y: 400 }, false, 150.25, 90.75)).toEqual({ value: 45.37, radii: 45.37 })
    const narrow = radiusCorners('graphic', triangle, 100, 200)
    expect(narrow[0]?.limit).toBeCloseTo(25.7694, 4)
    expect(draggedRadii(narrow, 0, { x: 0, y: 400 }, false, 100, 200)).toEqual({ value: 25.76, radii: 25.76 })
    // A corner stored above that top is drawn at it already: a drag past it asks for nothing.
    const over = radiusCorners('box', { cornerRadius: 300 }, 150.25, 90.75)
    expect(draggedRadii(over, 0, { x: 400, y: 400 }, false, 150.25, 90.75)).toEqual({ value: 45.37, radii: null })
  })

  it('starts from the radius drawn, not the one stored above it', () => {
    expect(dragged({ shape: { kind: 'rect', cornerRadius: 300 } }, 0, -4)).toEqual({ value: 56, radii: 56 })
  })

  it('gives every corner the value, corners that differ included', () => {
    expect(dragged(rect({ corners: [10, 40, 0, 20] }), 0, 10)).toEqual({ value: 20, radii: 20 })
  })

  it('with `own`, gives the dragged corner of four the value and the others the radii drawn at the press', () => {
    expect(dragged(rect({ corners: [10, 40, 0, 20] }), 0, 1, true)).toEqual({ value: 11, radii: [11, 40, 0, 20] })
    expect(dragged({ shape: { kind: 'rect', cornerRadius: 300 } }, 1, -10, true)).toEqual({
      value: 50,
      radii: [60, 50, 60, 60],
    })
  })

  it('with `own`, stops at the width less the radius along its side and the height less the one down it', () => {
    expect(dragged(rect({ corners: [10, 40, 0, 20] }), 0, 400, true).value).toBe(100)
    expect(dragged(rect(), 1, 400, true)).toEqual({ value: 120, radii: [0, 120, 0, 0] })
    expect(dragged(rect({ corners: [0, 0, 0, 150] }), 2, 400, true).value).toBe(80)
  })

  it('asks for nothing while the value is the one drawn at the press, as across the bisector', () => {
    expect(dragged(rect({ corners: [10, 40, 0, 20] }), 0, 0, false, 4)).toEqual({ value: 10, radii: null })
    expect(dragged(rect(), 0, -5)).toEqual({ value: 0, radii: null })
    expect(dragged(rect({ cornerRadius: 60 }), 0, 5)).toEqual({ value: 60, radii: null })
    const [tip] = radiusCorners('graphic', { shape: { ...star.shape, cornerRadius: 40 } }, 200, 200)
    const drawn = tip?.drawn ?? 0
    expect(drawn % 1).not.toBe(0)
    const tips = tip ? [tip] : []
    // The star is drawn at its top, which is not a hundredth: the value is the hundredth under it.
    expect(draggedRadii(tips, 0, { x: 0, y: 0.4 / Math.sin(tip?.half ?? 1) }, false, 200, 200)).toEqual({
      value: Math.floor(drawn * 100) / 100,
      radii: null,
    })
    expect(draggedRadii(tips, 0, { x: 0, y: -1 / Math.sin(tip?.half ?? 1) }, false, 200, 200).radii).toBe(
      Math.round(drawn - 1),
    )
  })
})
