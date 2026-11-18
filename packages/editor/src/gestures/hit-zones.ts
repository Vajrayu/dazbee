// Where a press on the selection grabs it, in screen pixels at any zoom: its four corners and its
// edges resize it, a ring just outside its corners turns it, a line's two ends move them, and a
// radius dot rounds its corners; and where a press grabs the picked frame's corners and edges. The
// handles it has on screen, drawn and grabbed, are decided here too. The press, the cursors and the
// overlay all read these zones and sizes.
import type { Point } from '@dazbee/schema'

import { type Camera, toScreen } from '../canvas/camera.ts'
import { LINE_REACH, NEAR_REACH, screenReach } from '../canvas/hit-test.ts'
import { type Box, CORNERS, cornersOf, type Handle, HANDLES, holdsPoint, isCorner } from '../layers/transform.ts'

/** A line's start, at the middle of its box's west side, or its end, at the middle of its east side. */
export type LineEnd = 'w' | 'e'
/** What a press on the selection grabs: a corner or edge to resize by, the ring outside the corners to turn by, or a line's end. */
export type Grab =
  /** `drawn`: whether the handle is drawn on screen, as a corner or a flat selection's end is; an edge never is. */
  | { kind: 'resize'; handle: Handle; drawn: boolean }
  /** `angle`: the direction from the selection's centre to the nearest corner on screen, in degrees, 0 to the right and 90 down. */
  | { kind: 'rotate'; angle: number }
  /** `drawn`: whether the line's ends are drawn on screen. */
  | { kind: 'end'; end: LineEnd; drawn: boolean }
  /** A radius dot, by its corner from the top left clockwise, 0 for a polygon's or a star's top point; it is always drawn. */
  | { kind: 'radius'; corner: number; drawn: true }

export interface ZoneOptions {
  /** The corners and edges a resize may drag; none on a selection that can't be resized. */
  handles: readonly Handle[]
  /** Whether the ring outside the corners turns the selection. */
  rotate: boolean
  /** One line: its two ends are its handles. */
  line?: boolean
  /** A finger's press, which reaches TOUCH_REACH from a corner. */
  touch?: boolean
  /**
   * The camera's zoom, 1 by default: beside a thin layer or a line, a press as near as the hit test
   * picks it at this zoom is on it.
   */
  zoom?: number
  /**
   * How far either side of a line's axis, on screen, a press is on it, as the hit test picks the
   * selected line (`lineReach`); the hit test's LINE_REACH at `zoom` by default.
   */
  lineReach?: number | undefined
  /** Where each radius dot is on screen, by its corner; none on a selection that shows no dots. */
  dots?: readonly Point[] | undefined
}

/** A line's two ends, its start first. */
export const LINE_ENDS: readonly LineEnd[] = ['w', 'e']
/** The drawn size of a handle. */
export const HANDLE_SIZE = 8
/** How far from a corner a press grabs it. */
export const CORNER_REACH = 8
/** How far either side of an edge a press grabs it. */
export const EDGE_REACH = 5
/** How far from a corner, outside the layer, a press turns the selection. */
export const ROTATE_REACH = 18
/**
 * The side on screen under which a press inside the layer grabs no edge across it, and under which,
 * on both sides, no handles are drawn; the zones outside still answer.
 */
export const SMALL_BOX = 16
/** How far from a corner a finger's press grabs it: a 44 px target. */
export const TOUCH_REACH = 22
/** How far from a radius dot's centre a press grabs it. */
export const DOT_REACH = 6
/**
 * How near a side of its layer's box a radius dot's centre comes: past an edge's reach and the
 * dot's own, and past a corner's along the diagonal, so no press is both a dot's and a resize's.
 */
export const DOT_INSET = 12
/** The side on screen under which a layer shows no radius dots. */
export const DOT_MIN_SIDE = 48

/** The screen pixels under which a side is taken for none: what rounding leaves in a turned flat box's corners. */
const FLAT = 1e-6
/** How far a drawn corner handle reaches into the layer: to the far corner of the quarter of it drawn there. */
const HANDLE_REACH = Math.hypot(HANDLE_SIZE / 2, HANDLE_SIZE / 2)
/** The edges of a box by their corners' places in `cornersOf`: nw, ne, se, sw. */
const EDGES: readonly { handle: Handle; from: number; to: number }[] = [
  { handle: 'n', from: 0, to: 1 },
  { handle: 'e', from: 1, to: 2 },
  { handle: 's', from: 2, to: 3 },
  { handle: 'w', from: 3, to: 0 },
]

/**
 * What a press at `p` grabs on a selection whose box has `corners` on screen (nw, ne, se, sw, as
 * `cornersOf` gives them): the nearest corner in reach, else the nearest edge, else a radius dot,
 * else the ring outside the corners. Inside the box, a corner reaches in a quarter of its shorter side and never
 * less than its drawn handle, and an edge no further than a quarter of the box's extent across
 * it, none where that is under SMALL_BOX. Across a side under SMALL_BOX, a press as near the layer
 * as the hit test picks it is on it, so it moves it, and the edges there start past that.
 */
export function zoneAt(corners: readonly Point[], p: Point, options: ZoneOptions): Grab | null {
  const { handles, rotate, line = false, touch = false, zoom = 1, lineReach = screenReach(LINE_REACH, zoom) } = options
  const grabbed = grabbedHandles(corners, handles, line)
  const dot = dotAt(corners, p, options.dots ?? [])
  if (grabbed.length === 0) return dot
  const drawn = drawnHandles(corners, handles, line)
  const cornerReach = touch ? TOUCH_REACH : CORNER_REACH
  const edgeReach = (EDGE_REACH * cornerReach) / CORNER_REACH
  const [width, height] = sides(corners)
  const shorter = Math.min(width, height)
  const within = !line && inside(corners, p)
  const onThin = !line && !within && onSelection(corners, p, zoom)
  if (line) {
    const end = nearest(lineEnds(corners).map((at, i) => ({ at: distance(at, p), end: LINE_ENDS[i] ?? 'w' })))
    if (end && end.at <= cornerReach) return { kind: 'end', end: end.end, drawn: drawn.includes(end.end) }
  } else {
    const corner = nearest(
      CORNERS.flatMap((handle, i) => (grabbed.includes(handle) ? [{ at: distance(at(corners, i), p), handle }] : [])),
    )
    const handleIn = corner && drawn.includes(corner.handle) ? HANDLE_REACH : 0
    const cornerIn = within ? Math.min(cornerReach, Math.max(shorter / 4, handleIn)) : cornerReach
    if (corner && reaches(corner.at, cornerIn))
      return { kind: 'resize', handle: corner.handle, drawn: drawn.includes(corner.handle) }
    const edge = nearest(
      EDGES.flatMap(({ handle, from, to }) => {
        const across = handle === 'n' || handle === 's' ? height : width
        if (!grabbed.includes(handle) || (onThin && across < SMALL_BOX)) return []
        // A flat selection's ends reach as far as a line's.
        const reach = shorter === 0 ? cornerReach : within ? Math.min(edgeReach, inward(across)) : edgeReach
        const d = alongSegment(at(corners, from), at(corners, to), p).distance
        return reaches(d, reach) ? [{ at: d, handle }] : []
      }),
    )
    if (edge) return { kind: 'resize', handle: edge.handle, drawn: drawn.includes(edge.handle) }
  }
  if (dot) return dot
  if (!rotate || within || onThin || along(corners, p, line, lineReach)) return null
  const ends = line ? lineEnds(corners) : corners
  const corner = nearest(ends.map((c) => ({ at: distance(c, p), c })))
  if (!corner || corner.at > cornerReach + ROTATE_REACH - CORNER_REACH) return null
  const centre = centreOf(corners)
  return { kind: 'rotate', angle: (Math.atan2(corner.c.y - centre.y, corner.c.x - centre.x) * 180) / Math.PI }
}

/**
 * What a press at `p` grabs on a picked frame whose box has `corners` on screen: a corner or an
 * edge, as far as a layer's handles reach, by a mouse or, with `touch`, a finger; it is never turned.
 */
export function frameZoneAt(corners: readonly Point[], p: Point, touch = false): Grab | null {
  return zoneAt(corners, p, { handles: HANDLES, rotate: false, touch })
}

/**
 * Whether a press at `p` is on a selection whose box has `corners` on screen, so it moves the
 * selection whatever the hit test finds there: inside the box or, across a side under SMALL_BOX,
 * as near it as the hit test picks a layer at `zoom`.
 */
export function onSelection(corners: readonly Point[], p: Point, zoom = 1): boolean {
  if (inside(corners, p)) return true
  return Math.min(...sides(corners)) < SMALL_BOX && toBox(corners, p) <= screenReach(NEAR_REACH, zoom)
}

/** The corners on screen, nw, ne, se, sw, of a box drawn in a frame, as `camera` shows it. */
export function screenCorners(box: Box, frame: Point, camera: Camera): Point[] {
  return cornersOf(box).map((p) => toScreen(camera, { x: frame.x + p.x, y: frame.y + p.y }))
}

/**
 * The handles a press grabs on a selection whose box has `corners` on screen, of the `handles` it
 * has: one line's two ends; else each corner and edge that drags only sides the box has extent
 * along, so a flat selection is resized along its length from its two ends.
 */
export function grabbedHandles(corners: readonly Point[], handles: readonly Handle[], line = false): readonly Handle[] {
  if (handles.length === 0) return []
  if (line) return LINE_ENDS
  const [width, height] = sides(corners)
  return handles.filter((h) => (width > 0 || !/[ew]/.test(h)) && (height > 0 || !/[ns]/.test(h)))
}

/**
 * The handles drawn on a selection whose box has `corners` on screen: none while both its sides are
 * under SMALL_BOX; else its corners of those a press grabs, or, with none, the two ends of a flat
 * selection or of one line.
 */
export function drawnHandles(corners: readonly Point[], handles: readonly Handle[], line = false): readonly Handle[] {
  if (Math.max(...sides(corners)) < SMALL_BOX) return []
  const grabbed = grabbedHandles(corners, handles, line)
  const drawn = line ? [] : grabbed.filter(isCorner)
  return drawn.length > 0 ? drawn : grabbed
}

/** Where a line in a box with `corners` starts and ends: the middles of the box's west and east sides. */
export function lineEnds(corners: readonly Point[]): [Point, Point] {
  return [middle(at(corners, 3), at(corners, 0)), middle(at(corners, 1), at(corners, 2))]
}

/**
 * The radius dot a press at `p` grabs, of `dots` on a box with `corners`: of the dots within
 * DOT_REACH, the one whose corner is nearest, so dots that meet, as a fully rounded square's do,
 * are told apart by where the press is. A lone dot is the top point's.
 */
function dotAt(corners: readonly Point[], p: Point, dots: readonly Point[]): Grab | null {
  const near = dots.flatMap((dot, corner) =>
    distance(dot, p) <= DOT_REACH ? [{ at: distance(at(corners, dots.length === 1 ? 0 : corner), p), corner }] : [],
  )
  const hit = nearest(near)
  return hit ? { kind: 'radius', corner: hit.corner, drawn: true } : null
}

/** The width and height on screen of the box with `corners`, none for what a turn's rounding leaves. */
function sides(corners: readonly Point[]): [number, number] {
  const side = (i: number) => {
    const d = distance(at(corners, 0), at(corners, i))
    return d < FLAT ? 0 : d
  }
  return [side(1), side(3)]
}

/** Whether a point is inside the box with `corners`, its edges included; never for a box with no area. */
function inside(corners: readonly Point[], p: Point) {
  return Math.min(...sides(corners)) > 0 && holdsPoint(boxOf(corners), p)
}

function nearest<T extends { at: number }>(hits: T[]): T | null {
  let best: T | null = null
  for (const hit of hits) if (!best || hit.at < best.at) best = hit
  return best
}

function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function at(corners: readonly Point[], i: number): Point {
  return corners[i] ?? { x: 0, y: 0 }
}

/** Whether a press `d` from a handle is within a reach it has. */
function reaches(d: number, reach: number) {
  return reach > 0 && d <= reach
}

/** How far into a layer an edge reaches across an extent of it: a quarter of it, none under SMALL_BOX. */
function inward(extent: number) {
  return extent < SMALL_BOX ? 0 : extent / 4
}

/** How far a point is from the segment `a`–`b`, and how far along it, from 0 at `a` to 1 at `b`, its nearest point is. */
function alongSegment(a: Point, b: Point, p: Point) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const length = dx * dx + dy * dy
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length))
  return { t, distance: Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y) }
}

/**
 * Whether a point lies along a flat selection or a line, between its two ends and within `reach`
 * of it, as near as the hit test picks a line: a press there is on the layer, so it never turns it.
 */
function along(corners: readonly Point[], p: Point, line: boolean, reach: number) {
  if (!line && Math.min(...sides(corners)) > 0) return false
  const [a, b] = line ? lineEnds(corners) : [at(corners, 0), at(corners, 2)]
  const { t, distance } = alongSegment(a, b, p)
  return t > 0 && t < 1 && distance <= reach
}

function centreOf(corners: readonly Point[]): Point {
  return middle(at(corners, 0), at(corners, 2))
}

/** How far a point outside the box with `corners` is from it. */
function toBox(corners: readonly Point[], p: Point) {
  return Math.min(...EDGES.map(({ from, to }) => alongSegment(at(corners, from), at(corners, to), p).distance))
}

function middle(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

/** The box with `corners` on screen, turned about its centre as they are. */
function boxOf(corners: readonly Point[]): Box {
  const [width, height] = sides(corners)
  const centre = centreOf(corners)
  const nw = at(corners, 0)
  const ne = at(corners, 1)
  const rotation = (Math.atan2(ne.y - nw.y, ne.x - nw.x) * 180) / Math.PI
  return { x: centre.x - width / 2, y: centre.y - height / 2, width, height, rotation }
}
