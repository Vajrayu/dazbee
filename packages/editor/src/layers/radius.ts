// A layer's corner radius, read and set by one rule for every type that has one: a box's, a
// rectangle's, a polygon's and a star's. A radius is never below 0 and is kept to hundredths; it
// has no top, since a radius too large for the shape is drawn smaller. Where each type keeps it is
// the schema's (`cornerRadiiOf`, `keepsEachCorner`, `withCorners`). For the radius dots: the
// corners a dot rounds, and the radii a drag of one asks for. A flipped layer draws each corner's
// radius at the corner mirrored from where it stores it.
import { flippedPoint, flipsOf } from '@dazbee/doc'
import { cornerAt, drawnAtCorner, drawnRadii, oneRadiusLimit, shapePoints } from '@dazbee/renderer'
import { cornerRadiiOf, keepsEachCorner, type Point, withCorners } from '@dazbee/schema'

import { round } from './transform.ts'

/** A layer's radii: one for every corner, or each corner's own from the top left clockwise. */
export type CornerRadii = NonNullable<ReturnType<typeof cornerRadiiOf>>

/** One of a layer's corners that a radius dot rounds, in the layer's own box from its top left. */
export interface RadiusCorner {
  /** The corner's point. */
  at: Point
  /** The unit bisector into the shape. */
  into: Point
  /** Half the corner's angle, in radians. */
  half: number
  /** The radius drawn there now. */
  drawn: number
  /** The largest radius drawn there when every corner has it. */
  limit: number
}

type Props = Readonly<Record<string, unknown>>
type Radii = [number, number, number, number]

/** The corner across each corner, from the top left clockwise: along its side, and down it. A flip of that axis draws one at the other. */
const ACROSS_X: readonly number[] = [1, 0, 3, 2]
const ACROSS_Y: readonly number[] = [3, 2, 1, 0]

/** The radii of a layer of this type with these props; undefined for a type without a radius. */
export function radiiOf(type: string, props: Props): CornerRadii | undefined {
  return cornerRadiiOf(typed(type, props))
}

/**
 * A layer's radii as drawn: one for every corner, or each corner's own from the top left clockwise
 * where it is drawn, a flipped layer's mirrored; undefined for a type without a radius.
 */
export function radiiAsDrawn(type: string, props: Props): CornerRadii | undefined {
  const radii = radiiOf(type, props)
  if (radii === undefined || typeof radii === 'number') return radii
  return eachRadius(radii, (_, i) => radii[storedCorner(i, props)] ?? 0)
}

/**
 * The props that give a layer these radii, one for every corner or each corner's own from the top
 * left clockwise (a polygon and a star take the first): each never below 0 and kept to hundredths.
 * Null for a layer without a radius, and for one that has these radii already.
 */
export function radiiPatch(type: string, props: Props, radii: CornerRadii): Record<string, unknown> | null {
  const now = radiiOf(type, props)
  if (now === undefined) return null
  const each = typeof radii === 'number' || !keepsEachCorner(typed(type, props)) ? firstOf(radii) : radii
  const next = typeof each === 'number' ? radiusOf(each) : eachRadius(each, radiusOf)
  if (JSON.stringify(next) === JSON.stringify(now)) return null
  return withCorners(typed(type, props), next)
}

/**
 * The props that give a layer a radius worked out by `to`: every corner, from the radius the layer
 * shows (the first corner's while they differ); or with `corner`, from the top left clockwise as
 * drawn, only that corner of a box or a rectangle. A polygon and a star have one radius whatever is
 * asked. Null as `radiiPatch` gives it.
 */
export function radiusPatch(
  type: string,
  props: Props,
  to: (radius: number) => number,
  corner?: number,
): Record<string, unknown> | null {
  const now = radiiOf(type, props)
  if (now === undefined) return null
  if (corner === undefined || !keepsEachCorner(typed(type, props)))
    return radiiPatch(type, props, to(firstOf(radiiAsDrawn(type, props) ?? now)))
  const each: Radii = typeof now === 'number' ? [now, now, now, now] : now
  const stored = storedCorner(corner, props)
  return radiiPatch(
    type,
    props,
    eachRadius(each, (r, i) => (i === stored ? to(r) : r)),
  )
}

/**
 * The corners of a layer that a radius dot rounds, in its own box of `width` by `height` as drawn: a
 * box's or a rectangle's four, in the order it stores them from the top left clockwise, or a
 * polygon's or a star's top point; each where it is drawn, mirrored as the layer is flipped. None
 * for a layer without a radius.
 */
export function radiusCorners(type: string, props: Props, width: number, height: number): RadiusCorner[] {
  const box = { x: 0, y: 0, width, height, ...flipsOf(props) }
  const mirror = (c: RadiusCorner): RadiusCorner => ({
    ...c,
    at: flippedPoint(c.at, box),
    into: { x: box.flipX ? -c.into.x : c.into.x, y: box.flipY ? -c.into.y : c.into.y },
  })
  return unflippedCorners(type, props, width, height).map(mirror)
}

/**
 * What a drag of the dot of corner `i` of `corners` asks for, the pointer gone `by` from the press
 * in the layer's own axes, the layer `width` by `height`: its value, the radius drawn at the press
 * plus the travel along the bisector times the sine of half the corner's angle, a whole number from
 * 0 to the top, the top itself kept to the hundredth under it, so the radius stored there is never
 * more than the one drawn; and the radii, every corner at the value, or with `own` only that corner
 * of four, the others as drawn at the press. While the travel rounds to nothing, or the value is the
 * one drawn at the press (the top, for a corner drawn there), the value is that one and `radii` is
 * null: the layer keeps the radii the press found.
 */
export function draggedRadii(
  corners: readonly RadiusCorner[],
  i: number,
  by: Point,
  own: boolean,
  width: number,
  height: number,
): { value: number; radii: CornerRadii | null } {
  const c = corners[i]
  if (!c) return { value: 0, radii: null }
  const travel = (by.x * c.into.x + by.y * c.into.y) * Math.sin(c.half)
  const drawn = corners.map((corner) => corner.drawn)
  const alone = own && corners.length === 4
  const top = hundredthsUnder(alone ? loneTop(drawn as Radii, i, width, height) : c.limit)
  if (Math.round(travel) === 0) return { value: Math.min(c.drawn, top), radii: null }
  const whole = Math.round(c.drawn + travel)
  const value = whole >= top ? top : Math.max(0, whole)
  // A corner drawn past the top, as one stored above it is, is at the top already.
  if (value === Math.min(c.drawn, top)) return { value, radii: null }
  return { value, radii: alone ? eachRadius(drawn as Radii, (r, at) => (at === i ? value : r)) : value }
}

/** A type and its props as the schema reads a layer's. */
function typed(type: string, props: Props) {
  return { type, props } as Parameters<typeof cornerRadiiOf>[0]
}

/** One radius, or the first of four. */
function firstOf(radii: CornerRadii) {
  return typeof radii === 'number' ? radii : radii[0]
}

function radiusOf(n: number) {
  return round(Math.max(0, n))
}

/** Four radii, each worked out by `to` from its own radius and its corner, from the top left clockwise. */
function eachRadius(radii: Radii, to: (radius: number, corner: number) => number): Radii {
  const [tl, tr, br, bl] = radii
  return [to(tl, 0), to(tr, 1), to(br, 2), to(bl, 3)]
}

/** The corner a layer stores, from the top left clockwise, that it draws at corner `i`: the same both ways. */
function storedCorner(i: number, props: Props): number {
  const across = props.flipX ? (ACROSS_X[i] ?? i) : i
  return props.flipY ? (ACROSS_Y[across] ?? across) : across
}

/** The corners `radiusCorners` gives, before the layer's flip. */
function unflippedCorners(type: string, props: Props, width: number, height: number): RadiusCorner[] {
  const radii = radiiOf(type, props)
  if (radii === undefined) return []
  if (!keepsEachCorner(typed(type, props))) {
    const points = shapePoints({ x: 0, y: 0, width, height }, props.shape as Parameters<typeof shapePoints>[1])
    const [top, next] = points
    const last = points.at(-1)
    if (!top || !next || !last) return []
    const { into, half, limit } = cornerAt(last, top, next)
    const at = { x: top[0], y: top[1] }
    return [{ at, into: { x: into[0], y: into[1] }, half, drawn: drawnAtCorner(firstOf(radii), limit), limit }]
  }
  const drawn = drawnRadii(width, height, radii)
  const s = Math.SQRT1_2
  const corners = [
    { at: { x: 0, y: 0 }, into: { x: s, y: s } },
    { at: { x: width, y: 0 }, into: { x: -s, y: s } },
    { at: { x: width, y: height }, into: { x: -s, y: -s } },
    { at: { x: 0, y: height }, into: { x: s, y: -s } },
  ]
  const limit = oneRadiusLimit(width, height)
  return corners.map((c, i) => ({ ...c, half: Math.PI / 4, drawn: drawn[i] ?? 0, limit }))
}

/** The largest number in hundredths no more than `n`, as a radius stored to hundredths keeps it. */
function hundredthsUnder(n: number) {
  const near = round(n)
  return near <= n ? near : round(near - 0.01)
}

/**
 * The largest radius corner `i` of a box or a rectangle draws alone, the others drawn as `drawn`:
 * `drawnRadii`'s scaling inverted, the width less the radius along its side, or the height less the
 * one down it, whichever is less, so no side has two radii that overlap.
 */
function loneTop(drawn: Radii, i: number, width: number, height: number) {
  const along = drawn[ACROSS_X[i] ?? 0] ?? 0
  const down = drawn[ACROSS_Y[i] ?? 0] ?? 0
  return Math.max(0, Math.min(width - along, height - down))
}
