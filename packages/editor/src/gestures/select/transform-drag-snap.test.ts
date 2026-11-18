// Snapping in the space a drag's layers are kept in, through the editor's core in Node: inside a
// turned group or box a move or a resize snaps to the parent and the layers beside them in its
// space, a group's own sides counting without the layers dragged, and what it shows names the
// containers that turn it.
import { describe, expect, it } from 'vitest'

import { type DesignStore, openSession } from '@dazbee/doc'
import { anotherTab } from '@dazbee/doc/test-store'
import type { DesignInput } from '@dazbee/schema'

import { type Box, pageFrom } from '../../layers/transform.ts'
import type { TestEditor } from '../../test-editor.ts'
import {
  boxOf,
  expectOnSnapLines,
  hold,
  holdSelection,
  layer,
  type NodeInput,
  open,
  pull,
  shape,
  snapLineAt,
  stageOf,
} from './test-snap-drag.ts'

const G = { x: 300, y: 300, width: 400, height: 300 }
const INNER = { x: 420, y: 320, width: 200, height: 150 }
/**
 * A square frame holding a tag, and a group turned by `turn` holding two squares at its corners,
 * `s1` and `s2`, a small one `m` between them, and an inner group turned by `inner` holding two
 * more, `i1` and `i2`. `parent` makes the outer one a Free box of the same size instead.
 */
const design = (turn: number, inner = 0, extra: DesignInput['nodes'] = {}, parent: 'group' | 'box' = 'group') => ({
  meta: { designId: 'd', name: 'D' },
  pages: { p1: { name: 'One', order: 'a0' } },
  frames: { sq: { pageId: 'p1', name: 'Square', width: 1080, height: 1080, x: 0, y: 0, order: 'a0' } },
  nodes: {
    tag: layer('graphic', 'sq', 'a0', shape(60, 60, 160, 80)),
    g: layer(parent, 'sq', 'a1', { ...G, rotation: turn }),
    s1: layer('graphic', 'g', 'a0', shape(300, 300, 100, 100)),
    s2: layer('graphic', 'g', 'a1', shape(600, 500, 100, 100)),
    m: layer('graphic', 'g', 'a2', shape(450, 520, 60, 60)),
    in: layer('group', 'g', 'a3', { ...INNER, rotation: inner }),
    i1: layer('graphic', 'in', 'a0', shape(420, 320, 50, 50)),
    i2: layer('graphic', 'in', 'a1', shape(570, 420, 50, 50)),
    ...extra,
  },
})
/** A frame holding one group turned by `turn`, with the layers given in it. */
const groupOf = (turn: number, box: Omit<Box, 'rotation'>, nodes: DesignInput['nodes']): DesignInput => ({
  ...design(0),
  nodes: { g: layer('group', 'sq', 'a1', { ...box, rotation: turn }), ...nodes },
})
/** A group holding `a` at its top left and `b`, which sets its right and bottom sides. */
const pair = (turn: number) =>
  groupOf(
    turn,
    { x: 300, y: 300, width: 400, height: 200 },
    {
      a: layer('graphic', 'g', 'a0', shape(300, 300, 100, 100)),
      b: layer('graphic', 'g', 'a1', shape(600, 400, 100, 100)),
    },
  )

/**
 * Makes a change to the design in another tab and brings it into the editor's store, as the sync
 * server does: never through the editor's session. Then redraws.
 */
function fromAnotherTab(editor: TestEditor, change: (store: DesignStore) => void) {
  const other = anotherTab(editor.core.store)
  change(other.store)
  other.deliver()
  editor.core.redraw()
}

describe('a move inside a turned group', () => {
  for (const turn of [30, 90, 180, -45]) {
    it(`in a group turned ${turn}°, snaps to the layers beside and to the group in the group's space, gathering once`, async () => {
      const editor = await open(design(turn))
      const before = editor.core.snapWork()
      // m's left side comes 3 from s1's right side at x = 400, its top 2 from the group's middle at y = 450.
      const around = hold(editor, 'm', { x: 480, y: 550 }, { x: -47, y: -68 })
      const shown = editor.modules.transformDrag.shown()
      expect(boxOf(editor, 'm')).toMatchObject({ x: 400, y: 450 })
      expect(around).toEqual([{ ...G, rotation: turn }])
      expect(shown?.around).toEqual(around)
      // Each snap line in the group's space, through the points that lined up.
      expect(snapLineAt(shown?.snapLines, 'x')).toEqual({
        axis: 'x',
        at: 400,
        from: 300,
        to: 510,
        points: [300, 400, 450, 510],
      })
      expect(snapLineAt(shown?.snapLines, 'y')).toMatchObject({ at: 450, from: 300, to: 700 })
      expectOnSnapLines(editor, 'm')
      // The two squares, the inner group, and the group as it fits them.
      expect(editor.core.snapWork()).toEqual({ gathered: before.gathered + 1, moves: before.moves + 4, targets: 4 })
      editor.mouse.up()
      expect(editor.modules.transformDrag.shown()).toBeNull()
      editor.end()
    })
  }

  it('lands on whole pixels of the group, and with nothing in reach shows no snap line', async () => {
    const editor = await open(design(30))
    // The nearest line to any side or middle of m is 8 away.
    hold(editor, 'm', { x: 480, y: 550 }, { x: -19.6, y: -38.3 })
    expect(boxOf(editor, 'm')).toMatchObject({ x: 430, y: 482 })
    expect(editor.modules.transformDrag.shown()).toMatchObject({ snapLines: [], gaps: [] })
    editor.end()
  })

  it('reaches 6 screen pixels at any zoom: 3 design pixels at 200%, 60 at 10%', async () => {
    for (const [off, lands] of [
      [2.6, 400],
      [3.6, 404],
    ] as const) {
      const editor = await open(design(30), 2)
      hold(editor, 'm', { x: 480, y: 550 }, { x: -50 + off, y: 20 })
      expect(boxOf(editor, 'm').x).toBe(lands)
      editor.end()
    }
    // a's right side is taken to 50 and to 70 from b's left side, the nearest line.
    for (const [by, lands] of [
      [150, 500],
      [130, 430],
    ] as const) {
      const editor = await open(pair(30), 0.1)
      hold(editor, 'a', { x: 350, y: 350 }, { x: by, y: 0 })
      expect(boxOf(editor, 'a').x).toBe(lands)
      editor.end()
    }
  })

  it('snaps to equal gaps between the layers beside it, in the group’s space', async () => {
    // Two squares in a row 40 apart, and a third dragged to 40 past the second, alone at that height.
    const editor = await open(
      groupOf(30, G, {
        s1: layer('graphic', 'g', 'a0', shape(300, 300, 100, 100)),
        s2: layer('graphic', 'g', 'a1', shape(600, 500, 100, 100)),
        r1: layer('graphic', 'g', 'b0', shape(300, 420, 40, 40)),
        r2: layer('graphic', 'g', 'b1', shape(380, 420, 40, 40)),
        r3: layer('graphic', 'g', 'b2', shape(520, 425, 30, 30)),
      }),
    )
    hold(editor, 'r3', { x: 535, y: 440 }, { x: -57, y: 0 })
    expect(boxOf(editor, 'r3')).toMatchObject({ x: 460, y: 425 })
    expect(editor.modules.transformDrag.shown()?.gaps).toEqual([
      { axis: 'x', from: 340, to: 380, at: 440 },
      { axis: 'x', from: 420, to: 460, at: 440 },
    ])
    editor.end()
  })

  it('in nested turned groups, snaps in the inner one’s space only, and what it shows names both', async () => {
    const editor = await open(design(30, 20))
    // i2's left side comes 2 from i1's right side at x = 470.
    const around = hold(editor, 'i2', { x: 595, y: 445 }, { x: -98, y: -10 })
    const shown = editor.modules.transformDrag.shown()
    expect(around).toEqual([
      { ...G, rotation: 30 },
      { ...INNER, rotation: 20 },
    ])
    expect(shown?.around).toEqual(around)
    expect(boxOf(editor, 'i2')).toMatchObject({ x: 470, y: 410 })
    expect(snapLineAt(shown?.snapLines, 'x')).toMatchObject({ at: 470 })
    expectOnSnapLines(editor, 'i2')
    // i1, and the inner group as it fits i1 alone: nothing of the outer group or the frame.
    expect(editor.core.snapWork().targets).toBe(2)
    editor.end()
  })

  it('in an upright group inside a turned one, snaps in that group’s space, which the turned one turns', async () => {
    const editor = await open(design(30, 0))
    hold(editor, 'i2', { x: 595, y: 445 }, { x: -98, y: -10 })
    expect(boxOf(editor, 'i2')).toMatchObject({ x: 470, y: 410 })
    expect(editor.modules.transformDrag.shown()?.around).toEqual([
      { ...G, rotation: 30 },
      { ...INNER, rotation: 0 },
    ])
    expect(editor.core.snapWork().targets).toBe(2)
    editor.end()
  })

  it('snaps a turned layer by the box around it in the group', async () => {
    const editor = await open(
      design(30, 0, { m: layer('graphic', 'g', 'a2', shape(450, 520, 60, 60, { rotation: 45 })) }),
    )
    // Turned 45°, m's box in the group is 84.85 wide about its middle: its left side is at 437.57.
    hold(editor, 'm', { x: 480, y: 550 }, { x: -35, y: 0 })
    expect(boxOf(editor, 'm').x).toBeCloseTo(412.43, 2)
    expect(snapLineAt(editor.modules.transformDrag.shown()?.snapLines, 'x')).toMatchObject({ at: 400 })
    expectOnSnapLines(editor, 'm')
    editor.end()
  })

  it('in a Free box turned 30°, snaps to the box’s own sides, which its layers do not set', async () => {
    const only = { a: layer('graphic', 'g', 'a0', shape(300, 300, 100, 100)) }
    const editor = await open({ ...design(0), nodes: { g: layer('box', 'sq', 'a1', { ...G, rotation: 30 }), ...only } })
    hold(editor, 'a', { x: 350, y: 350 }, { x: 4, y: 5.4 })
    expect(boxOf(editor, 'a')).toMatchObject({ x: 300, y: 300 })
    expect(snapLineAt(editor.modules.transformDrag.shown()?.snapLines, 'x')).toMatchObject({ at: 300 })
    expectOnSnapLines(editor, 'a')
    editor.end()
  })

  it('snaps to a locked layer beside it, and to nothing of a hidden one', async () => {
    for (const [extra, x] of [
      [{ lock: { move: true } }, 400],
      [{ visible: false }, 403],
    ] as const) {
      const s1 = { ...layer('graphic', 'g', 'a0', shape(300, 300, 100, 100)), ...('lock' in extra ? extra : {}) }
      const props = 'visible' in extra ? { ...s1.props, visible: false } : s1.props
      const editor = await open(design(30, 0, { s1: { ...s1, props } as NodeInput }))
      hold(editor, 'm', { x: 480, y: 550 }, { x: -47, y: -68 })
      expect(boxOf(editor, 'm')).toMatchObject({ x, y: 450 })
      editor.end()
    }
  })

  it('snaps nothing with the deep key held or snapping off, landing on whole pixels of the group', async () => {
    for (const off of ['key', 'setting'] as const) {
      const editor = await open(design(30))
      if (off === 'setting') editor.core.setSnapping(false)
      else editor.keys.down('Control')
      hold(editor, 'm', { x: 480, y: 550 }, { x: -47, y: -68 })
      expect(boxOf(editor, 'm')).toMatchObject({ x: 403, y: 452 })
      expect(editor.modules.transformDrag.shown()).toBeNull()
      editor.end()
    }
  })

  it('undoes and redoes a snapped move as one step', async () => {
    const editor = await open(design(30))
    hold(editor, 'm', { x: 480, y: 550 }, { x: -47, y: -68 })
    editor.mouse.up()
    expect(boxOf(editor, 'm')).toMatchObject({ x: 400, y: 450 })
    editor.press('undo')
    expect(boxOf(editor, 'm')).toMatchObject({ x: 450, y: 520 })
    editor.press('redo')
    expect(boxOf(editor, 'm')).toMatchObject({ x: 400, y: 450 })
    editor.end()
  })

  it('moves a linked copy in another frame by the snapped step', async () => {
    const one = design(30)
    const copies = Object.fromEntries(
      Object.entries(one.nodes).map(([id, node]) => [
        `w-${id}`,
        { ...node, parentId: node.parentId === 'sq' ? 'wide' : `w-${node.parentId}` },
      ]),
    )
    const wide = { pageId: 'p1', name: 'Wide', width: 1200, height: 1080, x: 1200, y: 0, order: 'a1' }
    const editor = await open({ ...one, frames: { ...one.frames, wide }, nodes: { ...one.nodes, ...copies } })
    // With its copy selected too, m is dragged by the same step in the group's space as above.
    const around = [{ ...G, rotation: 30 }]
    const [from, to] = [stageOf(editor, { x: 480, y: 550 }, around), stageOf(editor, { x: 433, y: 482 }, around)]
    holdSelection(editor, ['m', 'w-m'], { x: 480, y: 550 }, around, { x: to.x - from.x, y: to.y - from.y })
    expectOnSnapLines(editor, 'm')
    editor.mouse.up()
    expect(boxOf(editor, 'm')).toMatchObject({ x: 400, y: 450 })
    expect(boxOf(editor, 'w-m')).toMatchObject({ x: 400, y: 450 })
    editor.end()
  })

  it('upright in an upright group, snaps to the frame and its layers too', async () => {
    const editor = await open(design(0))
    hold(editor, 'm', { x: 480, y: 550 }, { x: -47, y: -68 })
    expect(boxOf(editor, 'm')).toMatchObject({ x: 400, y: 450 })
    expect(editor.modules.transformDrag.shown()?.around).toEqual([{ ...G, rotation: 0 }])
    // The tag, the two squares, the inner group, the group as it fits them, and the frame.
    expect(editor.core.snapWork().targets).toBe(6)
    editor.end()
  })
})

describe('a resize inside a turned group', () => {
  it('snaps the side dragged to a line of the group’s space, and out of reach keeps it unrounded', async () => {
    const editor = await open(design(30))
    // m's right side, at 510, is dragged to 2.5 from the inner group's right side at 620, then to 591.37.
    const [near, free] = pull(editor, 'm', 'e', 30, [
      { x: 107.5, y: 0 },
      { x: 81.37, y: 0 },
    ])
    expect(near).toMatchObject({ x: 450, width: 170 })
    expect(free?.width).toBeCloseTo(141.37, 2)
    expect(editor.modules.transformDrag.shown()).toMatchObject({ snapLines: [] })
    editor.end()
  })

  it('shows the snap line of the side it snapped, in the group’s space', async () => {
    const editor = await open(design(30))
    pull(editor, 'm', 'e', 30, [{ x: 107.5, y: 0 }])
    const shown = editor.modules.transformDrag.shown()
    expect(shown?.around).toEqual([{ ...G, rotation: 30 }])
    expect(snapLineAt(shown?.snapLines, 'x')).toMatchObject({ at: 620 })
    expectOnSnapLines(editor, 'm')
    editor.end()
  })

  it('with Alt, snaps the side dragged and mirrors it about the middle', async () => {
    const editor = await open(design(30))
    const [box] = pull(editor, 'm', 'e', 30, [{ x: 107.5, y: 0 }], { Alt: true })
    expect(box).toMatchObject({ x: 340, width: 280 })
    expectOnSnapLines(editor, 'm')
    editor.end()
  })

  it('with Shift from a corner, snaps the nearer side and the other follows the shape', async () => {
    const editor = await open(design(30))
    const [box] = pull(editor, 'm', 'se', 30, [{ x: 107.5, y: 107.5 }], { Shift: true })
    expect(box).toMatchObject({ x: 450, y: 520, width: 170, height: 170 })
    expectOnSnapLines(editor, 'm')
    editor.end()
  })

  it('snaps nothing as a turned layer in the group is resized', async () => {
    const editor = await open(
      design(30, 0, { m: layer('graphic', 'g', 'a2', shape(450, 520, 60, 60, { rotation: 45 })) }),
    )
    pull(editor, 'm', 'e', 30, [{ x: 30, y: 30 }])
    expect(editor.modules.transformDrag.shown()).toBeNull()
    editor.end()
  })
})

describe('a layer that sets a side of its group', () => {
  for (const turn of [0, 30]) {
    it(`as the group's only layer, moves free of the group's box, at ${turn}°`, async () => {
      const only = { o: layer('graphic', 'g', 'a0', shape(300, 300, 100, 100)) }
      const editor = await open(groupOf(turn, { x: 300, y: 300, width: 100, height: 100 }, only))
      hold(editor, 'o', { x: 350, y: 350 }, { x: 4, y: 5.4 })
      expect(boxOf(editor, 'o')).toMatchObject({ x: 304, y: 305 })
      expect(editor.modules.transformDrag.shown()).toMatchObject({ snapLines: [], gaps: [] })
      // Upright the frame is left to snap to; turned, nothing.
      expect(editor.core.snapWork().targets).toBe(turn === 0 ? 1 : 0)
      editor.end()
    })

    it(`moved 5 and 30, does not snap back to the side it sets, at ${turn}°`, async () => {
      const editor = await open(pair(turn))
      hold(editor, 'b', { x: 650, y: 450 }, { x: 5, y: 30 })
      expect(boxOf(editor, 'b')).toMatchObject({ x: 605, y: 430 })
      expect(editor.modules.transformDrag.shown()).toMatchObject({ snapLines: [] })
      editor.end()
    })

    it(`resized by 4 and by -5 from that side, takes the size dragged, at ${turn}°`, async () => {
      const editor = await open(pair(turn))
      const [grown, shrunk] = pull(editor, 'b', 'e', turn, [
        { x: 4, y: 0 },
        { x: -5, y: 0 },
      ])
      expect(grown?.width).toBeCloseTo(104, 1)
      expect(shrunk?.width).toBeCloseTo(95, 1)
      expect(editor.modules.transformDrag.shown()).toMatchObject({ snapLines: [] })
      editor.end()
    })

    it(`leaves the layer beside it snapping to that side, at ${turn}°`, async () => {
      const editor = await open(pair(turn))
      // a's right side comes 3 from b's left side at 600.
      hold(editor, 'a', { x: 350, y: 350 }, { x: 197, y: 0 })
      expect(boxOf(editor, 'a')).toMatchObject({ x: 500 })
      expect(snapLineAt(editor.modules.transformDrag.shown()?.snapLines, 'x')).toMatchObject({ at: 600 })
      expectOnSnapLines(editor, 'a')
      editor.end()
    })
  }
})

describe('what a drag shows, turned by its containers as they are', () => {
  it('in a row turned 30° that hugs, a resize’s snap line is on the side as drawn while the row grows', async () => {
    const row = { x: 300, y: 300, width: 340, height: 80 }
    const editor = await open({
      ...design(0),
      nodes: {
        row: layer('box', 'sq', 'a1', {
          ...row,
          rotation: 30,
          layout: { direction: 'row', gap: 20 },
          sizing: { width: 'hug', height: 'hug' },
        }),
        c1: layer('graphic', 'row', 'a0', shape(0, 0, 100, 80)),
        c2: layer('graphic', 'row', 'a1', shape(0, 0, 100, 80)),
        c3: layer('graphic', 'row', 'a2', shape(0, 0, 100, 80)),
      },
    })
    const { boxes, transformDrag } = editor.modules
    const [frame] = editor.core.frames()
    if (!frame) throw new Error('no frame')
    const pressed = boxes.containersOf(frame, 'row')
    // c1's right side comes 2.5 from where c2's left side was, 20 on.
    pull(editor, 'c1', 'e', 30, [{ x: 17.5, y: 0 }])
    const shown = transformDrag.shown()
    const snapped = snapLineAt(shown?.snapLines, 'x')
    const c1 = boxes.boxIn('c1')
    if (!shown || !snapped || !c1) throw new Error('nothing shown')
    expect(c1.width).toBe(120)
    expect(boxes.boxIn('row')?.width).toBe(360)
    expect(shown.around).toEqual(boxes.containersOf(frame, 'row'))
    expect(shown.around).not.toEqual(pressed)
    // The middle of c1's right side and of the snap line, both as drawn in the frame.
    const side = pageFrom({ x: c1.x + c1.width, y: c1.y + c1.height / 2 }, shown.around)
    const line = (around: Box[]) => pageFrom({ x: snapped.at, y: c1.y + c1.height / 2 }, around)
    const off = (around: Box[]) => Math.hypot(line(around).x - side.x, line(around).y - side.y)
    expect(off(shown.around)).toBeLessThan(0.01)
    expectOnSnapLines(editor, 'c1')
    // Turned by the row as it was at the press, it would be drawn 5.18 off the side.
    expect(off(pressed)).toBeCloseTo(5.18, 2)
    editor.end()
  })

  for (const [what, props, around] of [
    ['turns', { rotation: 50 }, { ...G, rotation: 50 }],
    ['moves', { x: 350, y: 280 }, { ...G, x: 350, y: 280, rotation: 30 }],
  ] as const) {
    it(`follows the group as another tab ${what} it mid-drag`, async () => {
      const editor = await open(design(30))
      hold(editor, 'm', { x: 480, y: 550 }, { x: -47, y: -68 })
      expect(editor.modules.transformDrag.shown()?.around).toEqual([{ ...G, rotation: 30 }])
      fromAnotherTab(editor, (store) =>
        store.transact(() => {
          for (const [key, value] of Object.entries(props)) store.setProp('g', key, value)
        }),
      )
      const shown = editor.modules.transformDrag.shown()
      expect(shown?.around).toEqual([around])
      expect(snapLineAt(shown?.snapLines, 'x')).toMatchObject({ at: 400 })
      expectOnSnapLines(editor, 'm')
      editor.end()
    })
  }

  for (const [what, command, ids] of [
    ['ungroups the group', 'node.ungroup', ['g']],
    ['deletes the group', 'node.delete', ['g']],
    ['deletes the layer dragged', 'node.delete', ['m']],
  ] as const) {
    it(`shows nothing once another tab ${what} mid-drag, through the drag's end`, async () => {
      const editor = await open(design(30))
      hold(editor, 'm', { x: 480, y: 550 }, { x: -47, y: -68 })
      expect(editor.modules.transformDrag.shown()?.snapLines).toHaveLength(2)
      fromAnotherTab(editor, (store) => openSession(store).run(command, { ids: [...ids] }))
      expect(editor.modules.transformDrag.shown()).toBeNull()
      // A move after it still snaps to what the press gathered in the group.
      const at = stageOf(editor, { x: 434, y: 482 }, [{ ...G, rotation: 30 }])
      editor.mouse.move(at.x, at.y, { steps: 2 })
      expect(editor.modules.transformDrag.shown()).toBeNull()
      editor.mouse.up()
      expect(editor.modules.transformDrag.shown()).toBeNull()
      editor.end()
    })
  }
})

describe('layers not all kept in the space the drag reads', () => {
  it('across parents, snap nothing when a container around one is turned, whichever is picked first', async () => {
    for (const order of [
      ['m', 'tag'],
      ['tag', 'm'],
    ]) {
      const editor = await open(design(30))
      const before = editor.core.snapWork()
      holdSelection(editor, order, { x: 140, y: 100 }, [], { x: 100, y: 0 })
      expect(editor.modules.pointer.gesture()?.kind).toBe('move')
      expect(editor.modules.transformDrag.shown()).toBeNull()
      expect(editor.core.snapWork()).toEqual(before)
      editor.end()
    }
  })

  it('across two turned groups of the same box and turn, snap nothing, whichever is picked first', async () => {
    const two = groupOf(30, G, {
      a1: layer('graphic', 'g', 'a0', shape(300, 300, 100, 100)),
      a2: layer('graphic', 'g', 'a1', shape(600, 500, 100, 100)),
      h: layer('group', 'sq', 'a2', { ...G, rotation: 30 }),
      b1: layer('graphic', 'h', 'a0', shape(300, 500, 100, 100)),
      b2: layer('graphic', 'h', 'a1', shape(600, 300, 100, 100)),
      b3: layer('graphic', 'h', 'a2', shape(450, 420, 40, 40)),
    })
    const around = [{ ...G, rotation: 30 }]
    for (const order of [
      ['a1', 'b3'],
      ['b3', 'a1'],
    ]) {
      const editor = await open(two)
      const before = editor.core.snapWork()
      // Moved by a step of the two groups' space.
      const [from, to] = [stageOf(editor, { x: 350, y: 350 }, around), stageOf(editor, { x: 407, y: 353 }, around)]
      holdSelection(editor, order, { x: 350, y: 350 }, around, { x: to.x - from.x, y: to.y - from.y })
      expect(editor.modules.pointer.gesture()?.kind).toBe('move')
      expect(editor.modules.transformDrag.shown()).toBeNull()
      expect(editor.core.snapWork()).toEqual(before)
      editor.end()
    }
  })

  it('across parents with nothing around them turned, snap as they did', async () => {
    const editor = await open(design(0))
    // The tag's top comes 3 from the frame's top.
    holdSelection(editor, ['tag', 'm'], { x: 140, y: 100 }, [], { x: 20, y: -57 })
    expect(boxOf(editor, 'tag')).toMatchObject({ x: 80, y: 0 })
    expect(snapLineAt(editor.modules.transformDrag.shown()?.snapLines, 'y')).toMatchObject({ at: 0 })
    editor.end()
  })

  it('a flow-placed layer picked first with a layer of a turned group snaps nothing', async () => {
    const editor = await open(
      design(30, 0, {
        row: layer('box', 'sq', 'a4', { x: 60, y: 900, width: 340, height: 80, layout: { direction: 'row', gap: 20 } }),
        c1: layer('graphic', 'row', 'a0', shape(0, 0, 100, 80)),
        c2: layer('graphic', 'row', 'a1', shape(0, 0, 100, 80)),
      }),
    )
    const before = editor.core.snapWork()
    // The step is read in the row's space and given to m in the group's, where it lands 3 and 2 from lines.
    holdSelection(editor, ['c1', 'm'], { x: 480, y: 550 }, [{ ...G, rotation: 30 }], { x: -47, y: -68 })
    expect(boxOf(editor, 'm')).toMatchObject({ x: 403, y: 452 })
    expect(editor.modules.transformDrag.shown()).toBeNull()
    expect(editor.core.snapWork()).toEqual(before)
    editor.end()
  })

  it('a layer and the group around it, both selected inside a turned group, snap nothing', async () => {
    const editor = await open(design(30))
    const before = editor.core.snapWork()
    holdSelection(editor, ['i1', 'in'], { x: 595, y: 445 }, [{ ...G, rotation: 30 }], { x: -18, y: 20 })
    expect(editor.modules.boxes.roots()).toEqual(['in'])
    expect(editor.modules.pointer.gesture()?.kind).toBe('move')
    expect(editor.modules.transformDrag.shown()).toBeNull()
    expect(editor.core.snapWork()).toEqual(before)
    editor.end()
  })
})
