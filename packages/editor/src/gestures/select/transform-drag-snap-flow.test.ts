// Snapping inside an auto layout box, through the editor's core in Node: along an axis the box fits
// its layers on, a layer its flow places sets the box's sides and middle there, so a resize of it
// does not snap to them; across that axis, in a box of a fixed size, and for a layer kept in place
// inside it, they stay lines to snap to.
import { describe, expect, it } from 'vitest'

import type { DesignInput } from '@dazbee/schema'

import { boxOf, expectOnSnapLines, hold, layer, open, pull, shape, snapLineAt } from './test-snap-drag.ts'

/** Both sides fit what the box holds, or only its width does. */
const HUGS = { width: 'hug', height: 'hug' } as const
const HUGS_WIDTH = { width: 'hug', height: 'fixed' } as const

/**
 * A square frame holding a box at (300, 300) turned by `turn`, laid out `direction` with layers 20
 * apart, sized by `sizing` (Fixed when none, at 400 × 200), holding `c1` 120 × 80, `c2` 60 × 40 and
 * `c3` 100 × 60, and any more layers given. Fitting both sides, a row is 320 × 80 and a column
 * 120 × 220.
 */
function flowBox(
  turn: number,
  sizing?: typeof HUGS | typeof HUGS_WIDTH,
  {
    direction = 'row',
    align = 'start',
    extra = {},
  }: { direction?: string; align?: string; extra?: DesignInput['nodes'] } = {},
): DesignInput {
  return {
    meta: { designId: 'd', name: 'D' },
    pages: { p1: { name: 'One', order: 'a0' } },
    frames: { sq: { pageId: 'p1', name: 'Square', width: 1080, height: 1080, x: 0, y: 0, order: 'a0' } },
    nodes: {
      row: layer('box', 'sq', 'a1', {
        x: 300,
        y: 300,
        width: 400,
        height: 200,
        rotation: turn,
        layout: { direction, gap: 20, align },
        ...(sizing ? { sizing } : {}),
      }),
      c1: layer('graphic', 'row', 'a0', shape(0, 0, 120, 80)),
      c2: layer('graphic', 'row', 'a1', shape(0, 0, 60, 40)),
      c3: layer('graphic', 'row', 'a2', shape(0, 0, 100, 60)),
      ...extra,
    },
  }
}

describe('a resize of a layer an auto layout box places', () => {
  for (const turn of [0, 30]) {
    it(`in a row that fits its layers, turned ${turn}°, takes the size dragged from the side it sets`, async () => {
      const editor = await open(flowBox(turn, HUGS))
      // c3's right side is the row's, at 620: dragged 4 past it, 5 short and 9 past.
      const widths = pull(editor, 'c3', 'e', turn, [
        { x: 4, y: 0 },
        { x: -5, y: 0 },
        { x: 9, y: 0 },
      ]).map((box) => box.width)
      expect(widths[0]).toBeCloseTo(104, 1)
      expect(widths[1]).toBeCloseTo(95, 1)
      expect(widths[2]).toBeCloseTo(109, 1)
      expect(editor.modules.transformDrag.shown()).toMatchObject({ snapLines: [] })
      editor.end()
    })

    it(`in a row that fits its layers, turned ${turn}°, a layer still snaps to the layers beside it`, async () => {
      const editor = await open(flowBox(turn, HUGS))
      // c1's right side comes 2.5 from c2's left side at 440.
      const [box] = pull(editor, 'c1', 'e', turn, [{ x: 17.5, y: 0 }])
      expect(box?.width).toBe(140)
      expect(snapLineAt(editor.modules.transformDrag.shown()?.snapLines, 'x')).toMatchObject({ at: 440 })
      expectOnSnapLines(editor, 'c1')
      editor.end()
    })

    it(`in a row that fits its width only, turned ${turn}°, snaps to the row's top, middle and bottom, not its sides`, async () => {
      const editor = await open(flowBox(turn, HUGS_WIDTH))
      // The row is 200 tall: c3's bottom, at 360, comes 3 from the row's middle at 400 and from its bottom at 500.
      const [middle, bottom] = pull(editor, 'c3', 's', turn, [
        { x: 0, y: 37 },
        { x: 0, y: 137 },
      ])
      expect(middle?.height).toBe(100)
      expect(bottom?.height).toBe(200)
      expect(snapLineAt(editor.modules.transformDrag.shown()?.snapLines, 'y')).toMatchObject({ at: 500 })
      expectOnSnapLines(editor, 'c3')
      editor.end()
      const wide = await open(flowBox(turn, HUGS_WIDTH))
      expect(pull(wide, 'c3', 'e', turn, [{ x: 4, y: 0 }])[0]?.width).toBeCloseTo(104, 1)
      wide.end()
      // Lined up at the end, c3's top, at 440, comes 3 from the row's top.
      const top = await open(flowBox(turn, HUGS_WIDTH, { align: 'end' }))
      expect(pull(top, 'c3', 'n', turn, [{ x: 0, y: -137 }])[0]?.height).toBe(200)
      expect(snapLineAt(top.modules.transformDrag.shown()?.snapLines, 'y')).toMatchObject({ at: 300 })
      top.end()
    })
  }

  it('in a column that fits its layers, takes the size dragged from the side its last layer sets', async () => {
    const editor = await open(flowBox(0, HUGS, { direction: 'column' }))
    // c3's bottom is the column's, at 520.
    const heights = pull(editor, 'c3', 's', 0, [
      { x: 0, y: 4 },
      { x: 0, y: -5 },
      { x: 0, y: 9 },
    ]).map((box) => box.height)
    expect(heights[0]).toBeCloseTo(64, 1)
    expect(heights[1]).toBeCloseTo(55, 1)
    expect(heights[2]).toBeCloseTo(69, 1)
    editor.end()
  })

  it('in a row of a fixed size, snaps to its sides and nothing more', async () => {
    const editor = await open(flowBox(0))
    // c3's right side, at 620, dragged 4 on, then to 3 short of the row's right side at 700.
    const [free, near] = pull(editor, 'c3', 'e', 0, [
      { x: 4, y: 0 },
      { x: 77, y: 0 },
    ])
    expect(free?.width).toBe(104)
    expect(near?.width).toBe(180)
    expect(snapLineAt(editor.modules.transformDrag.shown()?.snapLines, 'x')).toMatchObject({ at: 700 })
    editor.end()
  })
})

describe('a move of a layer kept in place in an auto layout box', () => {
  it('snaps to the middle of a row that fits its layers, which it does not set', async () => {
    const kept = layer('graphic', 'row', 'a3', shape(500, 420, 30, 30, { absolute: true }))
    const editor = await open(flowBox(0, HUGS, { extra: { k: kept } }))
    // k's middle, at 515, comes 2 from the row's middle at 460.
    hold(editor, 'k', { x: 515, y: 435 }, { x: -53, y: 0 })
    expect(boxOf(editor, 'k')).toMatchObject({ x: 445, y: 420 })
    expect(snapLineAt(editor.modules.transformDrag.shown()?.snapLines, 'x')).toMatchObject({ at: 460 })
    expectOnSnapLines(editor, 'k')
    editor.end()
  })
})
