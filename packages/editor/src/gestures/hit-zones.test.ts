import { describe, expect, it } from 'vitest'

import type { Point } from '@dazbee/schema'

import { hitTest, NEAR_REACH, screenReach } from '../canvas/hit-test.ts'
import { layer, rect, RED, shape, text } from '../canvas/test-layers.ts'
import { testLooks } from '../canvas/test-looks.ts'
import { type Box, CORNERS, cornersOf, type Handle, HANDLES, isCorner } from '../layers/transform.ts'
import {
  CORNER_REACH,
  DOT_INSET,
  DOT_REACH,
  drawnHandles,
  EDGE_REACH,
  grabbedHandles,
  HANDLE_SIZE,
  lineEnds,
  onSelection,
  ROTATE_REACH,
  SMALL_BOX,
  TOUCH_REACH,
  zoneAt,
} from './hit-zones.ts'

/** A box's corners on screen, turned by `rotation` degrees about its centre. */
const quad = (x: number, y: number, width: number, height: number, rotation = 0) =>
  cornersOf({ x, y, width, height, rotation })
/** A 100 × 60 box at (100, 100). */
const BOX = quad(100, 100, 100, 60)
const ALL = { handles: HANDLES, rotate: true }
/** What the pick reads, as a click or a hover picks. */
const looks = testLooks()

describe('zoneAt', () => {
  it('grabs each corner within CORNER_REACH, outside it and inside', () => {
    expect(zoneAt(BOX, { x: 100, y: 100 }, ALL)).toMatchObject({ kind: 'resize', handle: 'nw' })
    expect(zoneAt(BOX, { x: 200 + 5, y: 100 - 5 }, ALL)).toMatchObject({ kind: 'resize', handle: 'ne' })
    expect(zoneAt(BOX, { x: 200 - 5, y: 160 - 5 }, ALL)).toMatchObject({ kind: 'resize', handle: 'se' })
    expect(zoneAt(BOX, { x: 100 - CORNER_REACH, y: 160 }, ALL)).toMatchObject({ kind: 'resize', handle: 'sw' })
  })

  it('grabs each edge within EDGE_REACH either side, along its whole length between the corners', () => {
    expect(zoneAt(BOX, { x: 150, y: 100 - EDGE_REACH }, ALL)).toMatchObject({ kind: 'resize', handle: 'n' })
    expect(zoneAt(BOX, { x: 150, y: 100 + EDGE_REACH }, ALL)).toMatchObject({ kind: 'resize', handle: 'n' })
    expect(zoneAt(BOX, { x: 203, y: 130 }, ALL)).toMatchObject({ kind: 'resize', handle: 'e' })
    expect(zoneAt(BOX, { x: 150, y: 157 }, ALL)).toMatchObject({ kind: 'resize', handle: 's' })
    expect(zoneAt(BOX, { x: 98, y: 130 }, ALL)).toMatchObject({ kind: 'resize', handle: 'w' })
    expect(zoneAt(BOX, { x: 150, y: 100 - EDGE_REACH - 1 }, ALL)).toBeNull()
    expect(zoneAt(BOX, { x: 150, y: 130 }, ALL)).toBeNull()
  })

  it('leaves no stretch of an edge dead between its corners, inside the layer or outside it', () => {
    const long = quad(100, 100, 400, 60)
    for (let x = 100; x <= 500; x += 0.5)
      for (const y of [100 - EDGE_REACH, 99, 100, 101, 100 + EDGE_REACH])
        expect(zoneAt(long, { x, y }, ALL)?.kind, `${x}, ${y}`).toBe('resize')
  })

  it('leaves out the edges and corners a selection has no handle for', () => {
    const sides = { handles: HANDLES.filter((h) => h !== 'n' && h !== 's'), rotate: true }
    expect(zoneAt(BOX, { x: 150, y: 100 }, sides)).toBeNull()
    expect(zoneAt(BOX, { x: 200, y: 130 }, sides)).toMatchObject({ kind: 'resize', handle: 'e' })
    expect(zoneAt(BOX, { x: 150, y: 100 }, { handles: [], rotate: true })).toBeNull()
  })

  it('turns all round a corner outside the layer, within ROTATE_REACH, where no corner or edge reaches', () => {
    const grab = zoneAt(BOX, { x: 200 + 10, y: 160 + 10 }, ALL)
    expect(grab?.kind).toBe('rotate')
    // The turn's cursor faces from the centre towards the nearest corner.
    expect(grab?.kind === 'rotate' && Math.round(grab.angle)).toBe(Math.round((Math.atan2(30, 50) * 180) / Math.PI))
    expect(zoneAt(BOX, { x: 200 + ROTATE_REACH, y: 160 }, ALL)?.kind).toBe('rotate')
    expect(zoneAt(BOX, { x: 200 + ROTATE_REACH + 1, y: 160 }, ALL)).toBeNull()
    // Beside the corner along either side, towards the middle of the edge, as well as past it.
    expect(zoneAt(BOX, { x: 100 + 10, y: 100 - 12 }, ALL)).toMatchObject({ kind: 'rotate' })
    expect(zoneAt(BOX, { x: 100 - 12, y: 100 + 10 }, ALL)).toMatchObject({ kind: 'rotate' })
    expect(zoneAt(BOX, { x: 200 - 10, y: 160 + 12 }, ALL)).toMatchObject({ kind: 'rotate' })
    // Inside the layer, off its corners and edges, a press moves it.
    expect(zoneAt(BOX, { x: 190, y: 150 }, ALL)).toBeNull()
    // Without turning, nothing past the corner.
    expect(zoneAt(BOX, { x: 210, y: 170 }, { handles: HANDLES, rotate: false })).toBeNull()
  })

  it('answers every point round a corner within ROTATE_REACH outside the layer: a resize or a turn', () => {
    for (let a = 0; a < 360; a += 5)
      for (let r = 1; r < ROTATE_REACH; r += 0.5) {
        const p = { x: 100 + r * Math.cos((a * Math.PI) / 180), y: 100 + r * Math.sin((a * Math.PI) / 180) }
        const outside = p.x < 100 || p.y < 100
        if (outside) expect(zoneAt(BOX, p, ALL), `${a}° ${r}`).not.toBeNull()
      }
  })

  it('reaches into a small layer no further than a quarter of its shorter side', () => {
    const small = quad(100, 100, 24, 24)
    // A quarter of 24 is 6: a press 7 in from the corner moves the layer.
    expect(zoneAt(small, { x: 107, y: 107 }, ALL)).toBeNull()
    expect(zoneAt(small, { x: 104, y: 104 }, ALL)).toMatchObject({ kind: 'resize', handle: 'nw' })
    // Outside, the corner reaches as far as ever.
    expect(zoneAt(small, { x: 100 - CORNER_REACH, y: 100 }, ALL)).toMatchObject({ kind: 'resize', handle: 'nw' })
  })

  it('moves a layer under SMALL_BOX across from a press on it, and resizes it from just outside', () => {
    const tiny = quad(100, 100, 6, 6)
    expect(zoneAt(tiny, { x: 103, y: 103 }, ALL)).toBeNull()
    expect(zoneAt(tiny, { x: 98, y: 98 }, ALL)).toMatchObject({ kind: 'resize', handle: 'nw' })
    expect(zoneAt(tiny, { x: 109, y: 109 }, ALL)).toMatchObject({ kind: 'resize', handle: 'se' })
    const thin = quad(100, 100, 80, 4)
    expect(zoneAt(thin, { x: 140, y: 108 }, ALL)).toMatchObject({ kind: 'resize', handle: 's' })
    expect(zoneAt(thin, { x: 140, y: 102 }, ALL)).toBeNull()
  })

  it('moves a 1px rule from a press on it or within a screen pixel of it, and resizes it from past that', () => {
    const rule = quad(100, 500, 300, 1)
    for (const y of [499, 500, 500.5, 501, 502]) expect(zoneAt(rule, { x: 250, y }, ALL), `${y}`).toBeNull()
    expect(zoneAt(rule, { x: 250, y: 498.5 }, ALL)).toMatchObject({ kind: 'resize', handle: 'n' })
    expect(zoneAt(rule, { x: 250, y: 502.5 }, ALL)).toMatchObject({ kind: 'resize', handle: 's' })
    expect(zoneAt(rule, { x: 250, y: 500 - EDGE_REACH }, ALL)).toMatchObject({ kind: 'resize', handle: 'n' })
  })

  it('moves a 12px line of text from a press on it, and resizes it across from just outside and along from its ends', () => {
    const text = quad(100, 100, 300, 12)
    for (const y of [100, 103, 106, 109, 112]) expect(zoneAt(text, { x: 250, y }, ALL), `${y}`).toBeNull()
    expect(zoneAt(text, { x: 250, y: 98 }, ALL)).toMatchObject({ kind: 'resize', handle: 'n' })
    expect(zoneAt(text, { x: 250, y: 114 }, ALL)).toMatchObject({ kind: 'resize', handle: 's' })
    // Its width is far over SMALL_BOX: its sides reach in EDGE_REACH.
    expect(zoneAt(text, { x: 397, y: 106 }, ALL)).toMatchObject({ kind: 'resize', handle: 'e' })
    expect(zoneAt(text, { x: 103, y: 106 }, ALL)).toMatchObject({ kind: 'resize', handle: 'w' })
  })

  it('moves a flat selection from a press on it and resizes it along its length from its two ends', () => {
    // Lines in a row, a line with its linked copy, a path with no height: a box with no height.
    const flat = quad(100, 300, 200, 0)
    for (const x of [110, 150, 200, 290]) {
      expect(zoneAt(flat, { x, y: 300 }, ALL), `${x}`).toBeNull()
      expect(zoneAt(flat, { x, y: 302 }, ALL), `${x}`).toBeNull()
      expect(zoneAt(flat, { x, y: 298 }, ALL), `${x}`).toBeNull()
    }
    expect(zoneAt(flat, { x: 100, y: 300 }, ALL)).toMatchObject({ kind: 'resize', handle: 'w' })
    expect(zoneAt(flat, { x: 97, y: 301 }, ALL)).toMatchObject({ kind: 'resize', handle: 'w' })
    expect(zoneAt(flat, { x: 303, y: 300 }, ALL)).toMatchObject({ kind: 'resize', handle: 'e' })
    // Past its ends it turns, and beside an end, out of the reach of a press on it.
    expect(zoneAt(flat, { x: 312, y: 300 }, ALL)).toMatchObject({ kind: 'rotate' })
    expect(zoneAt(flat, { x: 295, y: 312 }, ALL)).toMatchObject({ kind: 'rotate' })
    expect(zoneAt(flat, { x: 105, y: 288 }, ALL)).toMatchObject({ kind: 'rotate' })
    // A box flat but for the error a turn leaves in its corners is flat.
    const halfTurned = quad(0, 0, 200, 0, 180)
    expect(zoneAt(halfTurned, { x: 100, y: 0.000001 }, ALL)).toBeNull()
    // With no width, it is resized from its top and bottom ends.
    const upright = quad(100, 100, 0, 200, 0)
    expect(zoneAt(upright, { x: 100, y: 200 }, ALL)).toBeNull()
    expect(zoneAt(upright, { x: 100, y: 100 }, ALL)).toMatchObject({ kind: 'resize', handle: 'n' })
    expect(zoneAt(upright, { x: 101, y: 302 }, ALL)).toMatchObject({ kind: 'resize', handle: 's' })
    // Turned, the same.
    const turned = quad(100, 300, 200, 0, 30)
    const [a, b] = lineEnds(turned)
    expect(zoneAt(turned, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, ALL)).toBeNull()
    expect(zoneAt(turned, b, ALL)).toMatchObject({ kind: 'resize', handle: 'e' })
  })

  it('finds a line by its two ends, which move it, and turns it past them', () => {
    const line = quad(100, 100, 100, 0)
    const ends = { handles: HANDLES, rotate: true, line: true }
    expect(zoneAt(line, { x: 102, y: 101 }, ends)).toMatchObject({ kind: 'end', end: 'w' })
    expect(zoneAt(line, { x: 198, y: 99 }, ends)).toMatchObject({ kind: 'end', end: 'e' })
    // Along the line, between its ends, a press moves it.
    expect(zoneAt(line, { x: 150, y: 102 }, ends)).toBeNull()
    expect(zoneAt(line, { x: 214, y: 100 }, ends)?.kind).toBe('rotate')
    expect(zoneAt(line, { x: 195, y: 112 }, ends)?.kind).toBe('rotate')
  })

  it('finds the same handles on a layer turned by 30° and by a half turn', () => {
    for (const rotation of [30, 180]) {
      const turned = quad(100, 100, 100, 60, rotation)
      const [nw, ne, se] = turned as [(typeof turned)[0], (typeof turned)[0], (typeof turned)[0]]
      expect(zoneAt(turned, nw, ALL), `${rotation}°`).toMatchObject({ kind: 'resize', handle: 'nw' })
      expect(zoneAt(turned, se, ALL), `${rotation}°`).toMatchObject({ kind: 'resize', handle: 'se' })
      const mid = { x: (ne.x + se.x) / 2, y: (ne.y + se.y) / 2 }
      expect(zoneAt(turned, mid, ALL), `${rotation}°`).toMatchObject({ kind: 'resize', handle: 'e' })
      // Past the north east corner, away from the centre.
      const c = { x: 150, y: 130 }
      const out = { x: ne.x + (ne.x - c.x) * 0.2, y: ne.y + (ne.y - c.y) * 0.2 }
      expect(zoneAt(turned, out, ALL)?.kind, `${rotation}°`).toBe('rotate')
    }
  })

  it('resizes a 60 × 40 layer zoomed out to 6 × 4 and 12 × 8 from just outside a corner and an edge, turns it past a corner and moves it from its centre, upright and turned', () => {
    /** `p` moved `by` screen pixels away from `from`. */
    const away = (p: Point, from: Point, by: number) => {
      const length = Math.hypot(p.x - from.x, p.y - from.y)
      return { x: p.x + ((p.x - from.x) / length) * by, y: p.y + ((p.y - from.y) / length) * by }
    }
    const misses: string[] = []
    for (const zoom of [0.1, 0.2])
      for (const rotation of [0, 30, 180]) {
        const corners = quad(100, 100, 60 * zoom, 40 * zoom, rotation)
        const [nw, ne, se] = corners as [Point, Point, Point]
        const centre = { x: (nw.x + se.x) / 2, y: (nw.y + se.y) / 2 }
        const east = { x: (ne.x + se.x) / 2, y: (ne.y + se.y) / 2 }
        const samples: [string, Point, string][] = [
          ['corner', away(nw, centre, 3), 'resize'],
          ['edge', away(east, centre, 3), 'resize'],
          ['turn', away(se, centre, 12), 'rotate'],
          ['centre', centre, 'move'],
        ]
        for (const [name, p, want] of samples) {
          const got = zoneAt(corners, p, { ...ALL, zoom })?.kind ?? 'move'
          if (got !== want) misses.push(`${zoom * 100}% ${rotation}° ${name}: ${got}`)
        }
      }
    expect(misses).toEqual([])
  })

  it('reaches TOUCH_REACH from a corner for a finger', () => {
    expect(zoneAt(BOX, { x: 200 + TOUCH_REACH, y: 100 }, { ...ALL, touch: true })).toMatchObject({
      kind: 'resize',
      handle: 'ne',
    })
    const touch = { ...ALL, touch: true }
    expect(zoneAt(BOX, { x: 200 + 15, y: 100 }, touch)).toMatchObject({ kind: 'resize', handle: 'ne' })
    expect(zoneAt(BOX, { x: 200 + 15, y: 100 }, ALL)?.kind).toBe('rotate')
  })

  it("turns by touch in a band as wide as a mouse's, from where the corner's touch reach ends", () => {
    const touch = { ...ALL, touch: true }
    const band = ROTATE_REACH - CORNER_REACH
    expect(zoneAt(BOX, { x: 200 + TOUCH_REACH + 1, y: 100 - 1 }, touch)).toMatchObject({ kind: 'rotate' })
    expect(zoneAt(BOX, { x: 200 + TOUCH_REACH + band, y: 100 }, touch)).toMatchObject({ kind: 'rotate' })
    expect(zoneAt(BOX, { x: 200 + TOUCH_REACH + band + 1, y: 100 }, touch)).toBeNull()
  })

  it('grabs a drawn corner handle at every point of it, on a 300 × 12 box, a 1px rule and a text with no top or bottom handle', () => {
    const noTop = HANDLES.filter((h) => h !== 'n' && h !== 's')
    const boxes = [
      ['300 × 12', quad(100, 100, 300, 12), HANDLES],
      ['rule', quad(100, 100, 300, 1), HANDLES],
      ['text', quad(100, 100, 300, 12), noTop],
      ['turned', quad(100, 100, 300, 12, 30), HANDLES],
    ] as const
    const half = HANDLE_SIZE / 2
    for (const [name, corners, handles] of boxes) {
      const drawn = drawnHandles(corners, handles)
      expect(drawn, name).toEqual(['nw', 'ne', 'se', 'sw'])
      /** Whether the drawn square of a corner holds a point: unturned, as the overlay draws it, about the corner. */
      const onSquare = (handle: string, p: Point) => {
        const c = corners[CORNERS.indexOf(handle as Handle)] as Point
        return Math.abs(p.x - c.x) <= half && Math.abs(p.y - c.y) <= half
      }
      for (const handle of drawn)
        for (let dx = -half; dx <= half; dx += 2)
          for (let dy = -half; dy <= half; dy += 2) {
            const c = corners[CORNERS.indexOf(handle)] as Point
            const p = { x: c.x + dx, y: c.y + dy }
            const grab = zoneAt(corners, p, { handles, rotate: true })
            // Where two drawn handles overlap, as at a rule's ends, either one.
            const corner = grab?.kind === 'resize' && isCorner(grab.handle) ? grab.handle : null
            expect(corner && onSquare(corner, p), `${name} ${handle} ${dx}, ${dy}: ${JSON.stringify(grab)}`).toBe(true)
          }
    }
    expect(zoneAt(quad(100, 100, 300, 12), { x: 100, y: 100 }, ALL)).toMatchObject({ kind: 'resize', handle: 'nw' })
    expect(zoneAt(quad(100, 100, 300, 12), { x: 400, y: 112 }, ALL)).toMatchObject({ kind: 'resize', handle: 'se' })
  })

  // A sweep of 22,500 presses, each picked and grabbed: 0.7 s on a PC, 2.5 to 5.5 s on CI's shared runners.
  it('moves a thin rule, text or ellipse from a press on it or as near as the pick reaches, and resizes it from past that, at any zoom and turn', () => {
    const misses: string[] = []
    const kinds = {
      rule: (box: Box) => rect('thin', box.x, box.y, box.width, box.height, box.rotation),
      text: (box: Box) => text('thin', 'A caption', { ...box }),
      ellipse: (box: Box) => shape('thin', { kind: 'ellipse' }, { ...box }),
    }
    for (const [kind, made] of Object.entries(kinds))
      for (const zoom of [0.1, 0.2, 0.5, 1, 8])
        for (const rotation of [0, 30, 90])
          for (const touch of [false, true]) {
            const box = { x: 0, y: 0, width: 1000, height: 1, rotation }
            const rule = made(box)
            const corners = cornersOf(box).map((p) => ({ x: p.x * zoom, y: p.y * zoom }))
            const a = (rotation * Math.PI) / 180
            const across = { x: -Math.sin(a), y: Math.cos(a) }
            const edgeReach = (EDGE_REACH * (touch ? TOUCH_REACH : CORNER_REACH)) / CORNER_REACH
            for (let s = -12.97; s <= 12; s += 0.1) {
              const p = { x: 500 * zoom + across.x * s, y: 0.5 * zoom + across.y * s }
              const picked = hitTest([rule], { x: p.x / zoom, y: p.y / zoom }, looks, { zoom })?.id === 'thin'
              const grab = zoneAt(corners, p, { ...ALL, touch, zoom })
              const offEdge = Math.abs(s) - 0.5 * zoom
              const on = picked || offEdge <= screenReach(NEAR_REACH, zoom)
              expect(onSelection(corners, p, zoom), `${kind} ${zoom} ${rotation} ${s}`).toBe(
                offEdge <= screenReach(NEAR_REACH, zoom),
              )
              const want = on ? 'move' : offEdge <= edgeReach ? (s < 0 ? 'n' : 's') : 'any'
              const got = grab === null ? 'move' : grab.kind === 'resize' ? grab.handle : grab.kind
              if (want !== 'any' && want !== got)
                misses.push(`${kind} ${zoom * 100}% ${rotation}° ${touch ? 'touch' : 'mouse'} ${s.toFixed(2)}: ${got}`)
            }
          }
    expect(misses).toEqual([])
  }, 20_000)

  it('leaves no point round the end of a line, within the turning ring, that neither picks the line nor grabs it', () => {
    const misses: string[] = []
    for (const zoom of [0.1, 0.5, 1, 8])
      for (const touch of [false, true]) {
        const line = layer('line', 'graphic', {
          x: 0,
          y: 0,
          width: 1000,
          height: 0,
          shape: { kind: 'line' },
          strokes: [{ paint: RED, width: 2 }],
        })
        const corners = quad(0, 0, 1000 * zoom, 0)
        const reach = touch ? TOUCH_REACH : CORNER_REACH
        const ring = reach + ROTATE_REACH - CORNER_REACH
        for (const end of lineEnds(corners))
          for (let angle = 0; angle < 360; angle += 7)
            for (let r = reach + 0.5; r < ring; r += 1) {
              const p = { x: end.x + r * Math.cos((angle * Math.PI) / 180), y: r * Math.sin((angle * Math.PI) / 180) }
              const picked = hitTest([line], { x: p.x / zoom, y: p.y / zoom }, looks, { zoom })?.id === 'line'
              const grab = zoneAt(corners, p, { ...ALL, line: true, touch, zoom })
              if (!picked && grab === null) misses.push(`${zoom * 100}% ${touch ? 'touch' : 'mouse'} ${angle}° ${r}`)
            }
      }
    expect(misses).toEqual([])
  })

  it("reaches a flat selection's two ends as far as a line's", () => {
    const flat = quad(100, 300, 200, 0)
    expect(zoneAt(flat, { x: 300 + CORNER_REACH, y: 300 }, ALL)).toMatchObject({ kind: 'resize', handle: 'e' })
    expect(zoneAt(flat, { x: 100 - 6, y: 300 - 4 }, ALL)).toMatchObject({ kind: 'resize', handle: 'w' })
    expect(zoneAt(flat, { x: 300 + 20, y: 300 }, { ...ALL, touch: true })).toMatchObject({
      kind: 'resize',
      handle: 'e',
    })
    expect(zoneAt(flat, { x: 300 + CORNER_REACH + 1, y: 300 }, ALL)).toMatchObject({ kind: 'rotate' })
  })

  it('says whether the handle grabbed is drawn: a corner, or the end of a flat selection or a line; never an edge', () => {
    expect(zoneAt(BOX, { x: 100, y: 100 }, ALL)).toEqual({ kind: 'resize', handle: 'nw', drawn: true })
    expect(zoneAt(BOX, { x: 150, y: 100 }, ALL)).toEqual({ kind: 'resize', handle: 'n', drawn: false })
    expect(zoneAt(quad(100, 100, 6, 6), { x: 98, y: 98 }, ALL)).toEqual({ kind: 'resize', handle: 'nw', drawn: false })
    expect(zoneAt(quad(100, 300, 200, 0), { x: 100, y: 300 }, ALL)).toEqual({
      kind: 'resize',
      handle: 'w',
      drawn: true,
    })
    const ends = { ...ALL, line: true }
    expect(zoneAt(quad(100, 100, 100, 0), { x: 100, y: 100 }, ends)).toEqual({ kind: 'end', end: 'w', drawn: true })
    expect(zoneAt(quad(100, 100, 10, 0), { x: 98, y: 100 }, ends)).toEqual({ kind: 'end', end: 'w', drawn: false })
  })

  it('grabs a radius dot within DOT_REACH of its centre, over the layer, its corner from the top left clockwise', () => {
    const box = quad(100, 100, 200, 120)
    const dots = [
      { x: 112, y: 112 },
      { x: 288, y: 112 },
      { x: 288, y: 208 },
      { x: 112, y: 208 },
    ]
    const options = { ...ALL, dots }
    dots.forEach((dot, corner) => {
      expect(zoneAt(box, dot, options)).toEqual({ kind: 'radius', corner, drawn: true })
      expect(zoneAt(box, { x: dot.x, y: dot.y + DOT_REACH }, options)).toEqual({ kind: 'radius', corner, drawn: true })
      const inward = dot.x < 200 ? 1 : -1
      expect(zoneAt(box, { x: dot.x + inward * (DOT_REACH + 1), y: dot.y }, options)).toBeNull()
      expect(zoneAt(box, dot, ALL)).toBeNull()
    })
  })

  it('asks a dot after the corners and edges: a press in reach of both grabs the corner or the edge', () => {
    // Dots nearer the sides than DOT_INSET, as none is drawn: one in a corner's reach, one in an edge's.
    const box = quad(100, 100, 48, 48)
    const options = {
      ...ALL,
      dots: [
        { x: 103, y: 103 },
        { x: 124, y: 102 },
      ],
    }
    expect(zoneAt(box, { x: 103, y: 103 }, options)).toEqual({ kind: 'resize', handle: 'nw', drawn: true })
    expect(zoneAt(box, { x: 124, y: 102 }, options)).toEqual({ kind: 'resize', handle: 'n', drawn: false })
    expect(zoneAt(box, { x: 124, y: 106 }, options)).toEqual({ kind: 'radius', corner: 1, drawn: true })
  })

  it('grabs a dot on a selection with no handles, as one locked in place', () => {
    const dots = [{ x: 112, y: 112 }]
    expect(zoneAt(quad(100, 100, 200, 120), { x: 113, y: 113 }, { handles: [], rotate: false, dots })).toEqual({
      kind: 'radius',
      corner: 0,
      drawn: true,
    })
  })

  it('takes, of dots that meet, the one whose corner is nearest the press', () => {
    const box = quad(100, 100, 120, 120)
    const middle = { x: 160, y: 160 }
    const options = { ...ALL, dots: [middle, middle, middle, middle] }
    const corner = (dx: number, dy: number) => zoneAt(box, { x: 160 + dx, y: 160 + dy }, options)
    expect([corner(-2, -2), corner(2, -2), corner(2, 2), corner(-2, 2)]).toEqual(
      [0, 1, 2, 3].map((c) => ({ kind: 'radius', corner: c, drawn: true })),
    )
  })

  it('leaves no point within DOT_REACH of a dot DOT_INSET in from the sides to a resize zone, on a 1px grid', () => {
    expect(DOT_INSET - DOT_REACH).toBeGreaterThan(EDGE_REACH)
    expect(DOT_INSET * Math.SQRT2 - DOT_REACH).toBeGreaterThan(CORNER_REACH)
    for (const [width, height, rotation] of [
      [200, 120, 0],
      [48, 48, 0],
      [200, 120, 30],
    ] as const) {
      const box = { x: 100, y: 100, width, height, rotation }
      const corners = cornersOf(box)
      const centre = { x: 100 + width / 2, y: 100 + height / 2 }
      const a = (rotation * Math.PI) / 180
      const turned = (x: number, y: number) => ({
        x: centre.x + (x - centre.x) * Math.cos(a) - (y - centre.y) * Math.sin(a),
        y: centre.y + (x - centre.x) * Math.sin(a) + (y - centre.y) * Math.cos(a),
      })
      const dots = [
        turned(100 + DOT_INSET, 100 + DOT_INSET),
        turned(100 + width - DOT_INSET, 100 + DOT_INSET),
        turned(100 + width - DOT_INSET, 100 + height - DOT_INSET),
        turned(100 + DOT_INSET, 100 + height - DOT_INSET),
      ]
      let reached = 0
      for (let x = 60; x <= 140 + width; x++)
        for (let y = 60; y <= 140 + height; y++) {
          const p = { x, y }
          if (!dots.some((dot) => Math.hypot(dot.x - x, dot.y - y) <= DOT_REACH)) continue
          reached++
          expect(zoneAt(corners, p, ALL)?.kind).not.toBe('resize')
          expect(zoneAt(corners, p, { ...ALL, dots })?.kind).toBe('radius')
        }
      expect(reached).toBeGreaterThan(4 * 100)
    }
  })
})

describe('onSelection', () => {
  it('is inside the box, or as near it as the pick reaches across a side under SMALL_BOX', () => {
    const thin = quad(100, 100, 300, 12)
    expect(onSelection(thin, { x: 250, y: 106 })).toBe(true)
    expect(onSelection(thin, { x: 250, y: 99 })).toBe(true)
    expect(onSelection(thin, { x: 250, y: 99.5 })).toBe(true)
    expect(onSelection(thin, { x: 250, y: 98.5 })).toBe(false)
    expect(onSelection(thin, { x: 250, y: 99.5 }, 0.1)).toBe(true)
    expect(onSelection(thin, { x: 250, y: 99.1 }, 0.1)).toBe(false)
    // Across a side SMALL_BOX or more, only inside the box.
    expect(onSelection(BOX, { x: 150, y: 100 })).toBe(true)
    expect(onSelection(BOX, { x: 150, y: 99.5 })).toBe(false)
  })
})

describe('grabbedHandles', () => {
  it('lists the handles a press grabs: those the selection has along the sides the box has', () => {
    expect(grabbedHandles(BOX, HANDLES)).toEqual(HANDLES)
    expect(grabbedHandles(BOX, [])).toEqual([])
    expect(grabbedHandles(quad(0, 0, 200, 0), HANDLES)).toEqual(['e', 'w'])
    expect(grabbedHandles(quad(0, 0, 0, 200), HANDLES)).toEqual(['n', 's'])
    expect(grabbedHandles(quad(0, 0, 0, 0), HANDLES)).toEqual([])
  })

  it("lists one line's two ends", () => {
    expect(grabbedHandles(quad(0, 0, 200, 0), HANDLES, true)).toEqual(['w', 'e'])
    expect(grabbedHandles(quad(0, 0, 200, 0), [], true)).toEqual([])
  })
})

describe('drawnHandles', () => {
  it('draws the corners unless both sides are under SMALL_BOX on screen', () => {
    expect(drawnHandles(BOX, HANDLES)).toEqual(['nw', 'ne', 'se', 'sw'])
    expect(drawnHandles(quad(0, 0, 300, 12), HANDLES)).toEqual(['nw', 'ne', 'se', 'sw'])
    expect(drawnHandles(quad(0, 0, SMALL_BOX, 1), HANDLES)).toEqual(['nw', 'ne', 'se', 'sw'])
    expect(drawnHandles(quad(0, 0, SMALL_BOX - 1, SMALL_BOX - 1), HANDLES)).toEqual([])
    expect(drawnHandles(quad(0, 0, SMALL_BOX - 1, SMALL_BOX - 1, 30), HANDLES)).toEqual([])
  })

  it("draws a flat selection's two ends, and one line's", () => {
    expect(drawnHandles(quad(0, 0, 200, 0), HANDLES)).toEqual(['e', 'w'])
    expect(drawnHandles(quad(0, 0, 200, 0), HANDLES, true)).toEqual(['w', 'e'])
    expect(drawnHandles(quad(0, 0, SMALL_BOX - 1, 0), HANDLES, true)).toEqual([])
    expect(drawnHandles(quad(0, 0, 200, 0), [], true)).toEqual([])
  })
})

describe('lineEnds', () => {
  it('gives the middles of the west and east sides, where a line starts and ends', () => {
    expect(lineEnds(quad(100, 100, 100, 0))).toEqual([
      { x: 100, y: 100 },
      { x: 200, y: 100 },
    ])
  })
})
