import { describe, expect, it } from 'vitest'

import type { DesignInput } from '@dazbee/schema'

import { readDesign } from '../index.ts'
import { openTestSession } from '../test-design.ts'
import { openTestStore } from '../test-store.ts'

type NodeInput = DesignInput['nodes'][string]

const rect = { kind: 'rect' } as const
const LOCKED_IN_PLACE = { move: true, resize: false, content: false, style: false, delete: false }

let order = 0
/** A rectangle under `parentId` at x, y, width and height, with more props and fields. */
const shape = (
  parentId: string,
  [x, y, width, height]: [number, number, number, number],
  props: Record<string, unknown> = {},
  more: Record<string, unknown> = {},
): NodeInput => {
  order += 1
  return {
    type: 'graphic',
    parentId,
    link: `l${order}`,
    index: `a${order}`,
    name: 'Shape',
    props: { x, y, width, height, shape: rect, ...props },
    ...more,
  } as NodeInput
}

/**
 * Frame F, 100 × 100 at 500, 200 on its page, with a guide across at x 30 and one down at y 40,
 * holding: `corner`, set to right and bottom; `plain`, set to nothing (left and top); `pinned`, set
 * to right and bottom but locked in place; `line`, a path set to scale both ways, with no box it was
 * drawn in; and `card`, a box set to nothing, holding `dot`.
 */
const design = (): DesignInput => ({
  meta: { designId: 'd1', name: 'Resize' },
  pages: { p1: { name: 'Page 1', order: 'a0' } },
  frames: {
    F: {
      pageId: 'p1',
      name: 'F',
      width: 100,
      height: 100,
      x: 500,
      y: 200,
      order: 'a0',
      guides: [
        { axis: 'x', at: 30 },
        { axis: 'y', at: 40 },
      ],
    },
  },
  nodes: {
    corner: shape('F', [20, 20, 30, 30], { constraints: { horizontal: 'right', vertical: 'bottom' } }),
    plain: shape('F', [10, 10, 10, 10]),
    pinned: shape(
      'F',
      [70, 70, 10, 10],
      { constraints: { horizontal: 'right', vertical: 'bottom' } },
      { lock: LOCKED_IN_PLACE },
    ),
    line: {
      ...shape('F', [60, 10, 20, 10], { constraints: { horizontal: 'scale', vertical: 'scale' } }),
      props: {
        x: 60,
        y: 10,
        width: 20,
        height: 10,
        shape: { kind: 'path', d: 'M0 0 L20 10' },
        constraints: { horizontal: 'scale', vertical: 'scale' },
      },
    } as NodeInput,
    card: { ...shape('F', [40, 50, 40, 40]), type: 'box', props: { x: 40, y: 50, width: 40, height: 40 } } as NodeInput,
    dot: shape('card', [45, 55, 5, 5]),
  },
})

/** A session on the frame of `design`, and what reads its design back. */
function open() {
  const store = openTestStore(design())
  const tab = openTestSession(store)
  return { store, tab, read: () => readDesign(store) }
}

const boxOf = (props: { x: number; y: number; width: number; height: number } | undefined) =>
  props && { x: props.x, y: props.y, width: props.width, height: props.height }

describe('frame.resize', () => {
  it('resizes a frame from its top left, its layers following their constraints, as one undo step called resize', () => {
    const { tab, read } = open()
    const before = read()

    tab.run('frame.resize', { frameId: 'F', width: 200, height: 150 })

    const after = read()
    expect(after.frames.F).toMatchObject({ x: 500, y: 200, width: 200, height: 150 })
    expect(boxOf(after.nodes.corner?.props)).toEqual({ x: 120, y: 70, width: 30, height: 30 })
    expect(boxOf(after.nodes.line?.props)).toEqual({ x: 120, y: 15, width: 40, height: 15 })
    // A layer set to left and top, and a box that doesn't move with what it holds, are not written.
    for (const id of ['plain', 'card', 'dot']) expect(after.nodes[id]).toEqual(before.nodes[id])
    // Guides keep their place from the frame's top left.
    expect(after.frames.F?.guides).toEqual(before.frames.F?.guides)
    expect(tab.undoName()).toBe('resize')

    tab.undo()
    expect(JSON.stringify(read())).toBe(JSON.stringify(before))
    tab.redo()
    expect(JSON.stringify(read())).toBe(JSON.stringify(after))
  })

  it('moves the frame to the place given, its layers following its size, kept in it from its top left', () => {
    const { tab, read } = open()
    // A drag of the left and top edges: the frame's right and bottom stay at 600 and 300.
    tab.run('frame.resize', { frameId: 'F', x: 450, y: 180, width: 150, height: 120 })
    const after = read()
    expect(after.frames.F).toMatchObject({ x: 450, y: 180, width: 150, height: 120 })
    expect(boxOf(after.nodes.corner?.props)).toEqual({ x: 70, y: 40, width: 30, height: 30 })
    expect(boxOf(after.nodes.plain?.props)).toEqual({ x: 10, y: 10, width: 10, height: 10 })
    expect(after.frames.F?.guides).toEqual([
      { axis: 'x', at: 30 },
      { axis: 'y', at: 40 },
    ])
  })

  it('leaves a layer locked in place where its lock keeps it, and is not refused for it', () => {
    const { tab, read } = open()
    tab.run('frame.resize', { frameId: 'F', width: 200, height: 150 })
    expect(boxOf(read().nodes.pinned?.props)).toEqual({ x: 70, y: 70, width: 10, height: 10 })
    tab.run('frame.resize', { frameId: 'F', x: 450, y: 180, width: 150, height: 120, layers: 'stay' })
    expect(boxOf(read().nodes.pinned?.props)).toEqual({ x: 70, y: 70, width: 10, height: 10 })
  })

  it('gives a path whose box changes its old box as the box it was drawn in, so its drawing scales with it', () => {
    const { tab, read } = open()
    tab.run('frame.resize', { frameId: 'F', width: 200, height: 150 })
    expect(read().nodes.line?.props).toMatchObject({
      shape: { kind: 'path', d: 'M0 0 L20 10', drawnIn: { width: 20, height: 10 } },
    })
    // One that has a box it was drawn in keeps it.
    tab.run('frame.resize', { frameId: 'F', width: 100, height: 100 })
    expect(read().nodes.line?.props).toMatchObject({
      width: 20,
      height: 10,
      shape: { drawnIn: { width: 20, height: 10 } },
    })
  })

  it('with layers staying, leaves every layer where it is on the page, its size kept, and shifts the guides with them', () => {
    const { tab, read } = open()
    const before = read()
    const onPage = (d: typeof before, id: string) => {
      const props = d.nodes[id]?.props
      const frame = d.frames.F
      return props && frame && { x: frame.x + props.x, y: frame.y + props.y, width: props.width, height: props.height }
    }

    tab.run('frame.resize', { frameId: 'F', x: 450, y: 180, width: 150, height: 120, layers: 'stay' })

    const after = read()
    expect(after.frames.F).toMatchObject({ x: 450, y: 180, width: 150, height: 120 })
    for (const id of ['corner', 'plain', 'line', 'card', 'dot']) expect(onPage(after, id)).toEqual(onPage(before, id))
    expect(boxOf(after.nodes.dot?.props)).toEqual({ x: 95, y: 75, width: 5, height: 5 })
    // Nothing changed size, so the path keeps no box it was drawn in.
    expect(after.nodes.line?.props).toMatchObject({ shape: { kind: 'path', d: 'M0 0 L20 10' } })
    expect(after.nodes.line?.props).not.toHaveProperty('shape.drawnIn')
    expect(after.frames.F?.guides).toEqual([
      { axis: 'x', at: 80 },
      { axis: 'y', at: 60 },
    ])
    tab.undo()
    expect(JSON.stringify(read())).toBe(JSON.stringify(before))
  })

  it('with layers staying, shifts the guides by whole pixels when the frame moves by a part of one', () => {
    const { tab, read } = open()
    tab.run('frame.resize', { frameId: 'F', x: 449.6, y: 200.4, width: 150, height: 100, layers: 'stay' })
    const after = read()
    expect(boxOf(after.nodes.plain?.props)).toEqual({ x: 60.4, y: 9.6, width: 10, height: 10 })
    expect(after.frames.F?.guides).toEqual([
      { axis: 'x', at: 80 },
      { axis: 'y', at: 40 },
    ])
  })

  it('with layers staying, keeps the guides with the layers when the frame moves by half a pixel and back', () => {
    const { tab, read } = open()
    const before = read()
    tab.run('frame.resize', { frameId: 'F', x: 499.5, y: 200.5, width: 100, height: 100, layers: 'stay' })
    tab.run('frame.resize', { frameId: 'F', x: 500, y: 200, width: 100, height: 100, layers: 'stay' })
    expect(read().frames.F?.guides).toEqual(before.frames.F?.guides)
    expect(boxOf(read().nodes.plain?.props)).toEqual(boxOf(before.nodes.plain?.props))
  })

  it('with layers staying and the frame resized from its top left, writes no layer and no guide', () => {
    const { tab, read } = open()
    const before = read()
    tab.run('frame.resize', { frameId: 'F', width: 300, height: 60, layers: 'stay' })
    const after = read()
    expect(after.nodes).toEqual(before.nodes)
    expect(after.frames.F).toEqual({ ...before.frames.F, width: 300, height: 60 })
  })

  it('writes nothing and makes no undo step for a resize to the size and place it has', () => {
    const { tab, read } = open()
    const before = read()
    tab.run('frame.resize', { frameId: 'F', width: 100, height: 100, x: 500, y: 200 })
    expect(read()).toEqual(before)
    expect(tab.canUndo()).toBe(false)
  })

  it('refuses a missing frame and a size the editor does not take, writing nothing', () => {
    const { tab, read } = open()
    const before = read()
    expect(() => tab.run('frame.resize', { frameId: 'nope', width: 200, height: 200 })).toThrow(/no frame "nope"/)
    expect(() => tab.run('frame.resize', { frameId: 'corner', width: 200, height: 200 })).toThrow(/no frame "corner"/)
    expect(() => tab.run('frame.resize', { frameId: 'F', width: 49, height: 200 })).toThrow(/at least 50 px/)
    expect(() => tab.run('frame.resize', { frameId: 'F', width: 8001, height: 1000 })).toThrow(/at most 8000 px/)
    expect(() => tab.run('frame.resize', { frameId: 'F', width: 1300, height: 100 })).toThrow(/at most 12 times/)
    expect(() => tab.run('frame.resize', { frameId: 'F', width: 200.5, height: 200 })).toThrow(/width/)
    expect(() => tab.run('frame.resize', { frameId: 'F', width: 200, height: 200, layers: 'pin' as never })).toThrow(
      /layers/,
    )
    expect(read()).toEqual(before)
    expect(tab.canUndo()).toBe(false)
  })

  it('refuses a resize that would move a layer or a guide past where one can be, writing nothing', () => {
    const far = design()
    far.nodes.line = { ...far.nodes.line, props: { ...far.nodes.line?.props, x: 1e308 } } as NodeInput
    const store = openTestStore(far)
    const tab = openTestSession(store)
    const before = readDesign(store)
    expect(() => tab.run('frame.resize', { frameId: 'F', width: 200, height: 100 })).toThrow(
      /"line" would be moved past where a layer can be/,
    )
    expect(readDesign(store)).toEqual(before)
    expect(tab.canUndo()).toBe(false)

    const plain = open()
    expect(() =>
      plain.tab.run('frame.resize', { frameId: 'F', x: -Number.MAX_VALUE, width: 100, height: 100, layers: 'stay' }),
    ).toThrow(/the guides of frame "F" would be moved past where a guide can be/)
    expect(plain.tab.canUndo()).toBe(false)
  })

  it('runs in a batch, with what else the batch changes, as one undo step', () => {
    const { tab, read } = open()
    const before = read()
    tab.batch(() => {
      tab.run('frame.resize', { frameId: 'F', width: 200, height: 150 })
      tab.run('frame.update', { frameId: 'F', name: 'Wide' })
    })
    expect(read().frames.F).toMatchObject({ name: 'Wide', width: 200, height: 150 })
    expect(boxOf(read().nodes.corner?.props)).toEqual({ x: 120, y: 70, width: 30, height: 30 })
    tab.undo()
    expect(read()).toEqual(before)
  })

  it('in a batch after a change of the frame’s size, still sets the size it is given', () => {
    const { tab, read } = open()
    tab.batch(() => {
      tab.run('frame.update', { frameId: 'F', width: 300 })
      tab.run('frame.resize', { frameId: 'F', width: 100, height: 100, x: 500, y: 200 })
    })
    expect(read().frames.F).toMatchObject({ x: 500, y: 200, width: 100, height: 100 })
  })
})
