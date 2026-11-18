// How far a corner radius draws, as plain numbers: the radii a box or a rectangle draws, a
// polygon's and a star's corners in their box, and each corner's bisector, half angle and limit,
// and the radius drawn there.
import type { Rect, Shape } from '@dazbee/schema'

/** Four radii, from the top left clockwise. */
export type Radii = readonly [number, number, number, number]
type Pt = readonly [number, number]

/** The largest radius a box or a rectangle of a size draws with one radius on every corner: half its shorter side. */
export function oneRadiusLimit(width: number, height: number): number {
  return Math.min(width, height) / 2
}

/**
 * The radii a box or a rectangle of a size draws: one radius no more than `oneRadiusLimit`; each
 * corner's own scaled down with the others where two would overlap along a side, as CSS does.
 */
export function drawnRadii(width: number, height: number, radii: number | Radii): [number, number, number, number] {
  if (typeof radii === 'number') {
    const r = Math.min(radii, oneRadiusLimit(width, height))
    return [r, r, r, r]
  }
  const sides = [
    [radii[0], radii[1], width],
    [radii[3], radii[2], width],
    [radii[0], radii[3], height],
    [radii[1], radii[2], height],
  ] as const
  const scale = Math.min(1, ...sides.map(([one, other, side]) => (one + other > 0 ? side / (one + other) : 1)))
  return radii.map((r) => r * scale) as [number, number, number, number]
}

/** A polygon's or a star's corners in its box, the first at the top, clockwise. */
export function shapePoints(box: Rect, shape: Extract<Shape, { kind: 'polygon' | 'star' }>): [number, number][] {
  return shape.kind === 'polygon'
    ? around(box, shape.sides, () => 1)
    : around(box, shape.points * 2, (i) => (i % 2 === 0 ? 1 : shape.innerRadius))
}

/**
 * The corner at `at` between `prev` and `next`: the unit bisector into the shape, half its angle in
 * radians, and the largest radius it draws, whose arc never runs past half of either edge it meets.
 */
export function cornerAt(prev: Pt, at: Pt, next: Pt): { into: Pt; half: number; limit: number } {
  const a = Math.hypot(prev[0] - at[0], prev[1] - at[1])
  const b = Math.hypot(next[0] - at[0], next[1] - at[1])
  const angle = Math.acos(
    Math.max(
      -1,
      Math.min(1, ((prev[0] - at[0]) * (next[0] - at[0]) + (prev[1] - at[1]) * (next[1] - at[1])) / (a * b || 1)),
    ),
  )
  const ix = (prev[0] - at[0]) / (a || 1) + (next[0] - at[0]) / (b || 1)
  const iy = (prev[1] - at[1]) / (a || 1) + (next[1] - at[1]) / (b || 1)
  const length = Math.hypot(ix, iy) || 1
  return { into: [ix / length, iy / length], half: angle / 2, limit: (Math.min(a, b) / 2) * Math.tan(angle / 2) }
}

/** The radius a polygon or a star draws at a corner whose limit is `limit` (`cornerAt`): `radius`, no more than the limit. */
export function drawnAtCorner(radius: number, limit: number): number {
  return Math.min(radius, limit)
}

/**
 * `count` corners evenly round a circle, the first at the top, each at `scale(i)` of the way out
 * from the centre (a regular polygon, or a star's outer and inner corners), then stretched so
 * they fill the box: a triangle's base sits on the box's bottom edge, as in other design tools.
 */
function around(box: Rect, count: number, scale: (i: number) => number): [number, number][] {
  const unit = Array.from({ length: count }, (_, i) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / count
    return [scale(i) * Math.cos(a), scale(i) * Math.sin(a)] as const
  })
  const xs = unit.map(([x]) => x)
  const ys = unit.map(([, y]) => y)
  const left = Math.min(...xs)
  const top = Math.min(...ys)
  const sx = box.width / (Math.max(...xs) - left || 1)
  const sy = box.height / (Math.max(...ys) - top || 1)
  return unit.map(([x, y]) => [box.x + (x - left) * sx, box.y + (y - top) * sy])
}
