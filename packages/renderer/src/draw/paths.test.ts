import { describe, expect, it } from 'vitest'

import { loadCanvasKit } from '../node.ts'
import type { SceneLayer } from '../scene.ts'
import { cornerAt, shapePoints } from './corners.ts'
import { boxPath, shapePath } from './paths.ts'

type GraphicLayer = Extract<SceneLayer, { type: 'graphic' }>
type PointedShape = Parameters<typeof shapePoints>[1]
type Radii = [number, number, number, number]
type Place = { x?: number; y?: number; width: number; height: number }
type Flips = { flipX?: boolean; flipY?: boolean }

/** A place and size with each corner's own radius, from the top left clockwise. */
interface Swept {
  x: number
  y: number
  width: number
  height: number
  corners: Radii
}

const ck = await loadCanvasKit()

/** How far a number of an outline may be from the one Skia's own scaling of the radii gives, in px. */
const TOLERANCE = 0.001

/** How many numbers follow each verb in `Path.toCmds`: move, line, quad, conic, cubic and close. */
const ARGS = [2, 2, 4, 5, 6, 0]

/** Places, sizes and four radii from a seed, the same each run; radii run past the longer side, so most are drawn smaller. */
const SWEPT = swept(300, 619)

/** The outline of a shape in a box, as commands. */
function shapeCmds(box: Place, shape: GraphicLayer['props']['shape'], flips: Flips = {}) {
  return cmdsOf(
    shapePath(ck, { id: 'a', type: 'graphic', props: { x: 0, y: 0, ...box, ...flips, shape } } as GraphicLayer),
  )
}

/** The outline of a box with these corners, as commands. */
function boxCmds(box: Place, cornerRadius: number | Radii, flips: Flips = {}) {
  return cmdsOf(boxPath(ck, { x: 0, y: 0, ...box, ...flips, cornerRadius }))
}

/** Commands with every point mirrored across the box's centre lines the flips name; conic weights stay. */
function mirroredCmds(cmds: number[], { x = 0, y = 0, width, height }: Place, { flipX, flipY }: Flips) {
  const out = [...cmds]
  for (let i = 0; i < out.length;) {
    const verb = out[i] ?? 0
    const args = ARGS[verb] ?? 0
    const points = verb === ck.CONIC_VERB ? 4 : args
    for (let k = 0; k < points; k += 2) {
      const at = i + 1 + k
      if (flipX) out[at] = 2 * x + width - (out[at] ?? 0)
      if (flipY) out[at + 1] = 2 * y + height - (out[at + 1] ?? 0)
    }
    i += 1 + args
  }
  return out
}

/** The limit of each corner of a polygon or a star, from its top point clockwise. */
function limitsOf(box: { width: number; height: number }, shape: PointedShape) {
  const points = shapePoints({ x: 0, y: 0, ...box }, shape)
  return points.map((at, i) => {
    const prev = points.at(i - 1) ?? at
    const next = points[(i + 1) % points.length] ?? at
    return cornerAt(prev, at, next).limit
  })
}

/** A path's commands, the path freed. */
function cmdsOf(path: { toCmds(): Float32Array; delete(): void }) {
  const cmds = [...path.toCmds()]
  path.delete()
  return cmds
}

/** The outline Skia builds from a rounded rect with these radii unscaled: scaled by Skia itself, as CSS scales them. */
function skiaCmds({ x, y, width, height, corners: [a, b, c, d] }: Swept) {
  return cmdsOf(
    new ck.PathBuilder()
      .addRRect(Float32Array.of(x, y, x + width, y + height, a, a, b, b, c, c, d, d))
      .detachAndDelete(),
  )
}

/** A path's corner arcs, each as its conic's control point and end, sorted by control point. */
function arcsOf(cmds: number[]) {
  const arcs: number[][] = []
  for (let i = 0; i < cmds.length;) {
    const verb = cmds[i] ?? 0
    if (verb === ck.CONIC_VERB) arcs.push(cmds.slice(i + 1, i + 5))
    i += 1 + (ARGS[verb] ?? 0)
  }
  return arcs.sort((p, q) => (p[0] ?? 0) - (q[0] ?? 0) || (p[1] ?? 0) - (q[1] ?? 0))
}

/** Whether two lists of numbers are as long and each pair within the tolerance. */
function near(a: number[], b: number[]) {
  return a.length === b.length && a.every((n, i) => Math.abs(n - (b[i] ?? NaN)) <= TOLERANCE)
}

/** `count` places, sizes and radii from `seed` (mulberry32), to hundredths; a radius is 0 one time in about seven. */
function swept(count: number, seed: number): Swept[] {
  let state = seed >>> 0
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const pick = (from: number, to: number) => Math.round((from + next() * (to - from)) * 100) / 100
  return Array.from({ length: count }, () => {
    const place = { x: pick(-500, 1500), y: pick(-500, 1500), width: pick(1, 1200), height: pick(1, 1200) }
    const radius = () => (next() < 0.15 ? 0 : pick(0, Math.max(place.width, place.height) * 1.2))
    return { ...place, corners: [radius(), radius(), radius(), radius()] }
  })
}

describe('boxPath', () => {
  it('draws one radius the same at half the shorter side and past it', () => {
    const size = { width: 200, height: 120 }
    expect(boxCmds(size, 600)).toEqual(boxCmds(size, 60))
    expect(boxCmds(size, 59)).not.toEqual(boxCmds(size, 60))
  })

  it('draws each corner’s own radius with the arcs of a rectangle that has them', () => {
    // Skia builds four radii of 0 as a plain rect, with no arcs to compare.
    const rounded = SWEPT.filter(({ corners }) => corners.some((r) => r > 0))
    const off = rounded.filter((layer) => {
      const box = arcsOf(boxCmds(layer, layer.corners))
      const rect = arcsOf(skiaCmds(layer))
      return !(box.length === 4 && rect.length === 4 && box.every((arc, i) => near(arc, rect[i] ?? [])))
    })
    expect(off).toEqual([])
  })

  it.each([{ flipX: true }, { flipY: true }, { flipX: true, flipY: true }])(
    'draws a box flipped %o as the mirror of the unflipped one, each corner where the mirror puts it',
    (flips) => {
      const place = { x: 40, y: 20, width: 200, height: 120 }
      const corners: Radii = [0, 10, 30, 60]
      expect(near(boxCmds(place, corners, flips), mirroredCmds(boxCmds(place, corners), place, flips))).toBe(true)
    },
  )
})

describe('shapePath', () => {
  it('draws a rectangle with one radius the same at half the shorter side and past it', () => {
    const size = { width: 200, height: 120 }
    expect(shapeCmds(size, { kind: 'rect', cornerRadius: 600 })).toEqual(
      shapeCmds(size, { kind: 'rect', cornerRadius: 60 }),
    )
    expect(shapeCmds(size, { kind: 'rect', cornerRadius: 59 })).not.toEqual(
      shapeCmds(size, { kind: 'rect', cornerRadius: 60 }),
    )
  })

  it('draws a rectangle’s own corners where Skia’s own scaling of the radii puts them', () => {
    // Skia builds a square whose four equal radii reach half its side as an oval, four arcs with no
    // lines between them, where the radii drawn a hair under half can give four lines of no length.
    const notOvals = SWEPT.filter(
      ({ width, height, corners: [first, ...rest] }) =>
        !(width === height && first * 2 >= width && rest.every((r) => r === first)),
    )
    const off = notOvals.filter(
      (layer) => !near(shapeCmds(layer, { kind: 'rect', cornerRadius: 0, corners: layer.corners }), skiaCmds(layer)),
    )
    expect(off).toEqual([])
  })

  it.each([
    ['a triangle', { width: 100, height: 200 }, { kind: 'polygon', sides: 3, cornerRadius: 0 }, 39.04, 25.77],
    ['a pentagon', { width: 200, height: 200 }, { kind: 'polygon', sides: 5, cornerRadius: 0 }, 90.2, 82.36],
    [
      'a five-point star',
      { width: 200, height: 200 },
      { kind: 'star', points: 5, innerRadius: 0.382, cornerRadius: 0 },
      55.75,
      12.36,
    ],
  ] as const)(
    'draws %s the same at the largest of its corners’ limits and past it, and not at its top point’s',
    (_, size, shape, largest, top) => {
      const limits = limitsOf(size, shape)
      const most = Math.max(...limits)
      expect(most).toBeCloseTo(largest, 2)
      expect(limits[0]).toBeCloseTo(top, 2)
      const at = (cornerRadius: number) => shapeCmds(size, { ...shape, cornerRadius })
      expect(at(most * 10)).toEqual(at(most))
      expect(at(limits[0] ?? 0)).not.toEqual(at(most))
    },
  )

  it.each<[string, GraphicLayer['props']['shape']]>([
    ['a rectangle with its own corners', { kind: 'rect', cornerRadius: 0, corners: [0, 10, 30, 60] }],
    ['a star', { kind: 'star', points: 5, innerRadius: 0.382, cornerRadius: 6 }],
    ['a path', { kind: 'path', d: 'M0 0 L60 20 L10 90 Z', fillRule: 'evenodd', drawnIn: { width: 100, height: 100 } }],
  ])('draws %s flipped on either axis or both as the mirror of the unflipped one', (_, shape) => {
    const place = { x: 40, y: 20, width: 200, height: 120 }
    for (const flips of [{ flipX: true }, { flipY: true }, { flipX: true, flipY: true }]) {
      const flipped = shapeCmds(place, shape, flips)
      expect(near(flipped, mirroredCmds(shapeCmds(place, shape), place, flips)), JSON.stringify(flips)).toBe(true)
    }
  })
})
