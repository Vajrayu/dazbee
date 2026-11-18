import { describe, expect, it } from 'vitest'

import { type Constraints, type Design, type DesignInput, type Layer, parseDesign, type Rect } from '@dazbee/schema'

import { constraintsApply, constraintsOf, followingBoxes, stayedBoxes, stayedGuides } from './constraints.ts'
import { boundsOf, centreOf, round, scaleWithin } from './geometry.ts'

type H = Constraints['horizontal']
type V = Constraints['vertical']
type NodeInput = DesignInput['nodes'][string]

const PADDING = { top: 0, right: 0, bottom: 0, left: 0 }
const ROW = { layout: { direction: 'row', gap: 0, padding: PADDING } }
const FRAME: Rect = { x: 0, y: 0, width: 100, height: 100 }

let order = 0
/** A layer of `type` under `parentId` at `box` (or x, y, width and height), with more props and fields. */
const layer = (
  parentId: string,
  type: 'graphic' | 'box' | 'group' | 'boolean' | 'text',
  at: Rect | [number, number, number, number],
  props: Record<string, unknown> = {},
  more: Record<string, unknown> = {},
): NodeInput => {
  order += 1
  const box = Array.isArray(at) ? { x: at[0], y: at[1], width: at[2], height: at[3] } : at
  const own =
    type === 'graphic'
      ? { shape: { kind: 'rect' } }
      : type === 'text'
        ? { text: 'Hi', style: { fontFamily: 'Noto Sans', fontSize: 12, color: '#000000FF' } }
        : {}
  return {
    type,
    parentId,
    link: `l${order}`,
    index: `a${order}`,
    name: type,
    props: { ...box, ...own, ...props },
    ...more,
  } as NodeInput
}
const set = (horizontal: H, vertical: V) => ({ constraints: { horizontal, vertical } })

/** A design with one 100 × 100 frame, `sq`, holding `nodes`. */
const design = (nodes: Record<string, NodeInput>): Design => {
  const result = parseDesign({
    meta: { designId: 'd1', name: 'Constraints' },
    pages: { p1: { name: 'Page 1', order: 'a0' } },
    frames: { sq: { pageId: 'p1', name: 'Square', width: 100, height: 100, x: 0, y: 0, order: 'a0' } },
    nodes,
  })
  if (!result.success) throw new Error(result.errors.join('\n'))
  return result.design
}
const frameTo = (width: number, height: number): Rect => ({ x: 0, y: 0, width, height })

describe('followingBoxes', () => {
  describe('each constraint on each axis, grown and shrunk (FigCraft’s arithmetic)', () => {
    // A 30 × 30 layer at 20, 20 in the 100 × 100 frame; grown to 200, shrunk to 80.
    const across: [H, Partial<Rect> | undefined, Partial<Rect> | undefined][] = [
      ['left', undefined, undefined],
      ['right', { x: 120 }, { x: 0 }],
      ['leftRight', { width: 130 }, { width: 10 }],
      ['center', { x: 70 }, { x: 10 }],
      ['scale', { x: 40, width: 60 }, { x: 16, width: 24 }],
    ]
    const down: [V, Partial<Rect> | undefined, Partial<Rect> | undefined][] = [
      ['top', undefined, undefined],
      ['bottom', { y: 120 }, { y: 0 }],
      ['topBottom', { height: 130 }, { height: 10 }],
      ['center', { y: 70 }, { y: 10 }],
      ['scale', { y: 40, height: 60 }, { y: 16, height: 24 }],
    ]
    const start = { x: 20, y: 20, width: 30, height: 30 }

    it.each(across)('across %s', (horizontal, grown, shrunk) => {
      const d = design({ a: layer('sq', 'graphic', start, set(horizontal, 'top')) })
      expect(followingBoxes(d, 'sq', FRAME, frameTo(200, 100)).get('a')).toEqual(grown && { ...start, ...grown })
      expect(followingBoxes(d, 'sq', FRAME, frameTo(80, 100)).get('a')).toEqual(shrunk && { ...start, ...shrunk })
    })

    it.each(down)('down %s', (vertical, grown, shrunk) => {
      const d = design({ a: layer('sq', 'graphic', start, set('left', vertical)) })
      expect(followingBoxes(d, 'sq', FRAME, frameTo(100, 200)).get('a')).toEqual(grown && { ...start, ...grown })
      expect(followingBoxes(d, 'sq', FRAME, frameTo(100, 80)).get('a')).toEqual(shrunk && { ...start, ...shrunk })
    })
  })

  it('gives FigCraft’s constraints_on_resize numbers', () => {
    const d = design({
      r: layer('sq', 'graphic', [80, 10, 10, 10], set('right', 'topBottom')),
      c: layer('sq', 'graphic', [45, 45, 10, 10], set('center', 'scale')),
    })
    const boxes = followingBoxes(d, 'sq', FRAME, frameTo(200, 200))
    expect(boxes.get('r')).toEqual({ x: 180, y: 10, width: 10, height: 110 })
    expect(boxes.get('c')).toEqual({ x: 95, y: 90, width: 10, height: 20 })
  })

  it('keeps a layer left and right at no width when its parent shrinks past it, at its start', () => {
    const d = design({ a: layer('sq', 'graphic', [20, 0, 30, 10], set('leftRight', 'top')) })
    expect(followingBoxes(d, 'sq', FRAME, frameTo(40, 100)).get('a')).toEqual({ x: 20, y: 0, width: 0, height: 10 })
  })

  it('moves a layer left and top with its parent’s start, which a resize from the left or top moves', () => {
    const d = design({
      box: layer('sq', 'box', [0, 0, 100, 100]),
      a: layer('box', 'graphic', [10, 10, 10, 10]),
    })
    const boxes = followingBoxes(d, 'box', FRAME, { x: -50, y: -20, width: 150, height: 120 })
    expect(boxes.get('a')).toEqual({ x: -40, y: -10, width: 10, height: 10 })
  })

  describe('a Free box', () => {
    it('applies the rule to what it holds, from its old box to its new one, all the way down', () => {
      const d = design({
        box: layer('sq', 'box', [10, 10, 80, 80], set('leftRight', 'top')),
        inner: layer('box', 'box', [20, 20, 60, 20], set('leftRight', 'top')),
        badge: layer('inner', 'graphic', [70, 25, 5, 5], set('right', 'top')),
        logo: layer('box', 'graphic', [15, 50, 10, 10]),
      })
      const boxes = followingBoxes(d, 'sq', FRAME, frameTo(200, 100))
      expect(boxes.get('box')).toEqual({ x: 10, y: 10, width: 180, height: 80 })
      expect(boxes.get('inner')).toEqual({ x: 20, y: 20, width: 160, height: 20 })
      expect(boxes.get('badge')).toEqual({ x: 170, y: 25, width: 5, height: 5 })
      expect(boxes.has('logo')).toBe(false)
    })

    it('carries everything inside it by as much when it only moves', () => {
      const d = design({
        box: layer('sq', 'box', [10, 10, 40, 40], set('right', 'bottom')),
        a: layer('box', 'graphic', [20, 20, 10, 10], set('scale', 'center')),
        g: layer('box', 'group', [30, 30, 10, 10]),
        b: layer('g', 'graphic', [30, 30, 10, 10]),
      })
      const boxes = followingBoxes(d, 'sq', FRAME, frameTo(150, 120))
      expect(boxes.get('box')).toEqual({ x: 60, y: 30, width: 40, height: 40 })
      expect(boxes.get('a')).toEqual({ x: 70, y: 40, width: 10, height: 10 })
      expect(boxes.get('g')).toEqual({ x: 80, y: 50, width: 10, height: 10 })
      expect(boxes.get('b')).toEqual({ x: 80, y: 50, width: 10, height: 10 })
    })

    it('inside a Column, gives what it holds stored boxes that draw where they belong under the column’s shift', () => {
      // The column draws the box at 10, 10, and what it holds moved by as far as it moved the box.
      const d = design({
        column: layer('sq', 'box', [0, 0, 100, 100], {
          layout: { direction: 'column', gap: 0, padding: { ...PADDING, top: 10, left: 10 } },
        }),
        free: layer('column', 'box', [40, 50, 40, 30]),
        badge: layer('free', 'graphic', [70, 55, 5, 5], set('right', 'bottom')),
      })
      const drawnAt = { x: 10, y: 10 }
      const from = { x: 40, y: 50, width: 40, height: 30 }
      const to = { x: 40, y: 50, width: 60, height: 40 }
      const badge = followingBoxes(d, 'free', from, to).get('badge')
      expect(badge).toEqual({ x: 90, y: 65, width: 5, height: 5 })
      const drawn = { x: (badge?.x ?? 0) + drawnAt.x - to.x, y: (badge?.y ?? 0) + drawnAt.y - to.y }
      // Drawn as far in from the drawn box's right and bottom edges as it was stored from the box's.
      expect(drawn).toEqual({ x: drawnAt.x + to.width - 10, y: drawnAt.y + to.height - 25 })
    })
  })

  describe('a group or a boolean', () => {
    it.each(['group', 'boolean'] as const)('scales what a %s holds with it, whatever their own constraints', (type) => {
      const d = design({
        g: layer('sq', type, [20, 20, 40, 20], set('scale', 'top')),
        a: layer('g', 'graphic', [20, 20, 20, 20], set('right', 'bottom')),
        b: layer('g', 'graphic', [40, 30, 20, 10], set('left', 'top')),
      })
      const boxes = followingBoxes(d, 'sq', FRAME, frameTo(200, 150))
      expect(boxes.get('g')).toEqual({ x: 40, y: 20, width: 80, height: 20 })
      expect(boxes.get('a')).toEqual({ x: 40, y: 20, width: 40, height: 20 })
      expect(boxes.get('b')).toEqual({ x: 80, y: 30, width: 40, height: 10 })
    })

    it('keeps what a locked layer inside a group holds with the box the lock leaves it', () => {
      const d = design({
        g: layer('sq', 'group', [0, 0, 100, 50], set('scale', 'top')),
        fixed: layer('g', 'box', [20, 0, 20, 20], {}, { lock: { move: true, resize: true } }),
        inFixed: layer('fixed', 'graphic', [25, 5, 5, 5]),
        sized: layer('g', 'box', [60, 0, 20, 20], {}, { lock: { resize: true } }),
        inSized: layer('sized', 'graphic', [65, 5, 5, 5]),
      })
      const boxes = followingBoxes(d, 'sq', FRAME, frameTo(200, 100))
      expect(boxes.has('fixed')).toBe(false)
      expect(boxes.has('inFixed')).toBe(false)
      expect(boxes.get('sized')).toEqual({ x: 120, y: 0, width: 20, height: 20 })
      expect(boxes.get('inSized')).toEqual({ x: 125, y: 5, width: 5, height: 5 })
    })
  })

  describe('a laid-out box', () => {
    const row = () =>
      design({
        row: layer('sq', 'box', [0, 0, 100, 100], ROW),
        first: layer('row', 'box', [0, 0, 30, 30], set('right', 'bottom')),
        inFirst: layer('first', 'graphic', [5, 5, 10, 10], set('right', 'bottom')),
        badge: layer('row', 'graphic', [80, 4, 10, 10], { absolute: true, ...set('right', 'top') }),
      })

    it('moves a layer kept where it is put by its constraints (FigCraft’s absolute_children_follow_constraints)', () => {
      const boxes = followingBoxes(row(), 'row', FRAME, { x: 0, y: 0, width: 150, height: 100 })
      expect(boxes.get('badge')?.x).toBe(130)
      expect([...boxes.keys()]).toEqual(['badge'])
    })

    it('moves a layer its flow places, and what it holds, with the box’s start, keeping its size', () => {
      const boxes = followingBoxes(row(), 'row', FRAME, { x: -50, y: -10, width: 150, height: 110 })
      expect(boxes.get('first')).toEqual({ x: -50, y: -10, width: 30, height: 30 })
      expect(boxes.get('inFirst')).toEqual({ x: -45, y: -5, width: 10, height: 10 })
      expect(boxes.get('badge')).toEqual({ x: 80, y: -6, width: 10, height: 10 })
    })
  })

  describe('a turned layer', () => {
    it('turned 90°, follows by its drawn bounds and keeps its turn, its own sides swapped in the scale', () => {
      // 20 wide and 10 tall, turned: drawn 10 wide and 20 tall, from 45 to 55 across.
      const d = design({
        a: layer('sq', 'graphic', [40, 45, 20, 10], { rotation: 90, flipX: true, ...set('leftRight', 'top') }),
      })
      const box = followingBoxes(d, 'sq', FRAME, frameTo(200, 100)).get('a')
      expect(box).toEqual({ x: 90, y: -5, width: 20, height: 110 })
    })

    it('turned 30°, keeps its turn and its middle goes to the middle of its new bounds, as scaleWithin gives', () => {
      const start = { x: 30, y: 40, width: 40, height: 20, rotation: 30 }
      const d = design({ a: layer('sq', 'graphic', start, set('scale', 'center')) })
      const bounds = boundsOf([start])
      const newBounds = { ...bounds, x: bounds.x * 2, y: bounds.y + 25, width: bounds.width * 2 }
      const want = scaleWithin(start, bounds, newBounds)
      const box = followingBoxes(d, 'sq', FRAME, frameTo(200, 150)).get('a')
      expect(box).toEqual({ x: round(want.x), y: round(want.y), width: round(want.width), height: round(want.height) })
      const middle = centreOf({ ...(box as Rect), rotation: 30 })
      expect(middle.x).toBeCloseTo(centreOf(newBounds).x, 1)
      expect(middle.y).toBeCloseTo(centreOf(newBounds).y, 1)
    })

    it('applies the rule inside a turned box in the box’s own unturned space', () => {
      const d = design({
        box: layer('sq', 'box', [20, 20, 40, 40], { rotation: 30 }),
        a: layer('box', 'graphic', [50, 30, 5, 5], set('right', 'top')),
      })
      const from = { x: 20, y: 20, width: 40, height: 40 }
      const boxes = followingBoxes(d, 'box', from, { ...from, width: 60 })
      expect(boxes.get('a')).toEqual({ x: 70, y: 30, width: 5, height: 5 })
    })
  })

  describe('a side that fits its content', () => {
    it('keeps the width of a text that grows across with its words, under left and right and under scale', () => {
      const d = design({
        a: layer('sq', 'text', [20, 20, 30, 10], { boxMode: 'autoWidth', ...set('leftRight', 'top') }),
        b: layer('sq', 'text', [20, 40, 30, 10], { boxMode: 'autoWidth', ...set('scale', 'top') }),
      })
      const boxes = followingBoxes(d, 'sq', FRAME, frameTo(200, 100))
      expect(boxes.has('a')).toBe(false)
      expect(boxes.get('b')).toEqual({ x: 40, y: 40, width: 30, height: 10 })
    })

    it('keeps the height of a laid-out box that fits its content down, under top and bottom', () => {
      const d = design({
        a: layer('sq', 'box', [20, 20, 30, 30], {
          layout: { direction: 'column', gap: 0, padding: PADDING },
          sizing: { width: 'fixed', height: 'hug' },
          ...set('leftRight', 'topBottom'),
        }),
      })
      const box = followingBoxes(d, 'sq', FRAME, frameTo(200, 200)).get('a')
      expect(box).toEqual({ x: 20, y: 20, width: 130, height: 30 })
    })
  })

  describe('locks', () => {
    const locked = () =>
      design({
        placed: layer('sq', 'graphic', [20, 20, 10, 10], set('right', 'bottom'), {
          lock: { move: true },
        }),
        sized: layer('sq', 'graphic', [20, 40, 10, 10], set('leftRight', 'center'), {
          lock: { resize: true },
        }),
        box: layer('sq', 'box', [10, 60, 40, 20], set('leftRight', 'bottom'), {
          lock: { move: true },
        }),
        inBox: layer('box', 'graphic', [40, 60, 10, 10], set('right', 'top')),
        turned: layer(
          'sq',
          'graphic',
          [40, 45, 20, 10],
          { rotation: 90, ...set('leftRight', 'top') },
          {
            lock: { resize: true },
          },
        ),
      })

    it('keeps a locked layer’s place or size, and what a locked box holds still follows from the box it has', () => {
      const boxes = followingBoxes(locked(), 'sq', FRAME, frameTo(200, 200))
      expect(boxes.has('placed')).toBe(false)
      expect(boxes.get('sized')).toEqual({ x: 20, y: 90, width: 10, height: 10 })
      expect(boxes.get('box')).toEqual({ x: 10, y: 60, width: 140, height: 20 })
      expect(boxes.get('inBox')).toEqual({ x: 140, y: 60, width: 10, height: 10 })
      // Its drawn bounds stretch from 45 to 155 across: it keeps its size about their middle.
      expect(boxes.get('turned')).toEqual({ x: 90, y: 45, width: 20, height: 10 })
    })

    it('moves and resizes locked layers alike under ignore', () => {
      const boxes = followingBoxes(locked(), 'sq', FRAME, frameTo(200, 200), { locks: 'ignore' })
      expect(boxes.get('placed')).toEqual({ x: 120, y: 120, width: 10, height: 10 })
      expect(boxes.get('sized')).toEqual({ x: 20, y: 90, width: 110, height: 10 })
      expect(boxes.get('box')).toEqual({ x: 10, y: 160, width: 140, height: 20 })
      expect(boxes.get('inBox')).toEqual({ x: 140, y: 160, width: 10, height: 10 })
    })
  })

  describe('what it gives', () => {
    it('rounds every box to hundredths', () => {
      const d = design({ a: layer('sq', 'graphic', [10, 10, 10, 10], set('scale', 'center')) })
      const shrunk = followingBoxes(d, 'sq', FRAME, frameTo(30, 101)).get('a')
      expect(shrunk).toEqual({ x: 3, y: 10.5, width: 3, height: 10 })
      const grown = followingBoxes(d, 'sq', frameTo(30, 100), FRAME).get('a')
      expect(grown).toEqual({ x: 33.33, y: 10, width: 33.33, height: 10 })
    })

    it('leaves out every layer whose box doesn’t change', () => {
      const d = design({
        a: layer('sq', 'graphic', [10, 10, 10, 10]),
        g: layer('sq', 'group', [40, 40, 10, 10], set('left', 'scale')),
        b: layer('g', 'graphic', [40, 40, 10, 10]),
        c: layer('sq', 'graphic', [10, 10, 10, 10], set('scale', 'top')),
        fine: layer('sq', 'graphic', [10.125, 10.125, 10.125, 10], set('left', 'center')),
      })
      expect([...followingBoxes(d, 'sq', FRAME, frameTo(300, 100)).keys()]).toEqual(['c'])
      // A value that changes is rounded; one stored finer than hundredths that doesn't is left as it is.
      expect(followingBoxes(d, 'sq', FRAME, frameTo(300, 101)).get('fine')).toEqual({
        x: 10.125,
        y: 10.63,
        width: 10.125,
        height: 10,
      })
      expect(followingBoxes(d, 'sq', FRAME, frameTo(100.001, 100)).size).toBe(0)
    })
  })
})

describe('constraintsOf', () => {
  it('gives a layer’s own constraints, or left and top', () => {
    const d = design({
      a: layer('sq', 'graphic', FRAME, set('right', 'center')),
      b: layer('sq', 'graphic', FRAME),
    })
    expect(constraintsOf(d.nodes.a as Layer)).toEqual({ horizontal: 'right', vertical: 'center' })
    expect(constraintsOf(d.nodes.b as Layer)).toEqual({ horizontal: 'left', vertical: 'top' })
  })
})

describe('constraintsApply', () => {
  it('holds for a layer in a frame or a Free box, and one a laid-out box’s flow doesn’t place', () => {
    const d = design({
      inFrame: layer('sq', 'box', FRAME),
      inBox: layer('inFrame', 'graphic', FRAME),
      g: layer('sq', 'group', FRAME),
      inGroup: layer('g', 'graphic', FRAME),
      bool: layer('sq', 'boolean', FRAME),
      inBoolean: layer('bool', 'graphic', FRAME),
      row: layer('sq', 'box', FRAME, ROW),
      placed: layer('row', 'graphic', FRAME),
      absolute: layer('row', 'graphic', FRAME, { absolute: true }),
      hidden: layer('row', 'graphic', FRAME, { visible: false }),
    })
    const holds = Object.keys(d.nodes).filter((id) => constraintsApply(d, id))
    expect(holds.sort()).toEqual(['absolute', 'bool', 'g', 'hidden', 'inBox', 'inFrame', 'row'])
    expect(constraintsApply(d, 'gone')).toBe(false)
  })
})

describe('stayedBoxes', () => {
  const d = () =>
    design({
      a: layer('sq', 'graphic', [10, 10, 10, 10], set('right', 'bottom')),
      box: layer('sq', 'box', [30, 30, 40, 40]),
      inBox: layer('box', 'graphic', [35, 35, 10, 10]),
      locked: layer('sq', 'box', [50, 50, 20, 20], {}, { lock: { move: true } }),
      inLocked: layer('locked', 'graphic', [55, 55, 10, 10]),
    })

  it('moves every layer in the frame’s space by the frame’s old place less its new, but one locked in place and what it holds', () => {
    const boxes = stayedBoxes(d(), 'sq', { x: 100, y: 200 }, { x: 50, y: 180 })
    expect(Object.fromEntries(boxes)).toEqual({
      a: { x: 60, y: 30, width: 10, height: 10 },
      box: { x: 80, y: 50, width: 40, height: 40 },
      inBox: { x: 85, y: 55, width: 10, height: 10 },
    })
  })

  it('gives nothing when the frame keeps its place', () => {
    expect(stayedBoxes(d(), 'sq', { x: 100, y: 200 }, { x: 100, y: 200 }).size).toBe(0)
  })
})

describe('stayedGuides', () => {
  const guides = [
    { axis: 'x' as const, at: 100 },
    { axis: 'y' as const, at: 40 },
  ]

  it('shifts each guide by the frame’s whole-pixel place, old less new, so it stays where it is on the page', () => {
    expect(stayedGuides(guides, { x: 10.5, y: 0 }, { x: 50.5, y: -20 })).toEqual([
      { axis: 'x', at: 60 },
      { axis: 'y', at: 60 },
    ])
    // Rounded places: 10.5 rounds to 11, 12.4 to 12.
    expect(stayedGuides(guides, { x: 10.5, y: 0 }, { x: 12.4, y: 0 })).toEqual([
      { axis: 'x', at: 99 },
      { axis: 'y', at: 40 },
    ])
  })

  it('gives the guides as they are when the frame’s whole-pixel place stays, and none for a frame with none', () => {
    expect(stayedGuides(guides, { x: 10, y: 0 }, { x: 10.2, y: 0.3 })).toBe(guides)
    expect(stayedGuides(undefined, { x: 10, y: 0 }, { x: 50, y: 0 })).toBeUndefined()
  })
})
