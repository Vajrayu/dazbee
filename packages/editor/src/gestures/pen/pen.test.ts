import { describe, expect, it } from 'vitest'

import { openSession } from '@dazbee/doc'
import { openTestStore } from '@dazbee/doc/test-store'
import { type DesignInput, parseDesign } from '@dazbee/schema'

import type { Frame } from '../../canvas/frames.ts'
import { watchFaults } from '../../faults.ts'
import { groupMovedByRow, testBoxes } from '../../layers/test-boxes.ts'
import { editorSelection, pairsIn } from '../../selection.ts'
import { faultOn, registerFaultyCommand } from '../../test-faults.ts'
import { editorDragStart } from '../drag-start.ts'
import { pointerInput } from '../test-inputs.ts'
import { editorPen, type PenDeps } from './pen.ts'

const ZIG = { x: 100, y: 100, width: 100, height: 100, shape: { kind: 'path' as const, d: 'M0 0 L100 0 L100 100' } }
/** One page with a square and a wide frame, beside each other, each with its copy of a path of three anchors. */
const DESIGN: DesignInput = {
  meta: { designId: 'd', name: 'D' },
  pages: { p1: { name: 'One', order: 'a0' } },
  frames: {
    sq: { pageId: 'p1', name: 'Square', width: 1080, height: 1080, x: 0, y: 0, order: 'a0' },
    wide: { pageId: 'p1', name: 'Wide', width: 1200, height: 628, x: 1280, y: 0, order: 'a1' },
  },
  nodes: {
    zig: { type: 'graphic', parentId: 'sq', link: 'zig', index: 'a0', name: 'Zig', props: ZIG },
    'wide-zig': { type: 'graphic', parentId: 'wide', link: 'zig', index: 'a0', name: 'Zig', props: ZIG },
  },
}
/** The design with a triangle drawn in 200 × 160 whose box was scaled to 400 × 320: its points are drawn at twice their size. */
const SCALED: DesignInput = {
  ...DESIGN,
  nodes: {
    ...DESIGN.nodes,
    tri: {
      type: 'graphic',
      parentId: 'sq',
      link: 'tri',
      index: 'a1',
      name: 'Triangle',
      props: {
        x: 100,
        y: 100,
        width: 400,
        height: 320,
        shape: { kind: 'path', d: 'M0 0 L200 0 L100 160 Z', drawnIn: { width: 200, height: 160 } },
      },
    },
  },
}
const SQUARE: Frame = { id: 'sq', pageId: 'p1', name: 'Square', x: 0, y: 0, width: 1080, height: 1080 }
const WIDE: Frame = { id: 'wide', pageId: 'p1', name: 'Wide', x: 1280, y: 0, width: 1200, height: 628 }
const FRAMES = [SQUARE, WIDE]

/** A press or move of the pointer, Shift held or not. */
const pointer = (shift = false) => pointerInput({ shiftKey: shift })

/** The pen over a design on a real session and selection, at zoom 1 with no containers, logging what it asks for. */
function harness(design = DESIGN) {
  /** How many times the pointer was held. */
  let holds = 0
  const parsed = parseDesign(design)
  if (!parsed.success) throw new Error(parsed.errors.join('\n'))
  const session = openSession(openTestStore(parsed.design))
  const log: string[] = []
  const frameOf = (id: string | undefined) => FRAMES.find((f) => f.id === id)
  const selection = editorSelection({ drawn: () => session.design(), frames: () => FRAMES, changed: () => {} })
  const boxes = testBoxes(session, selection, FRAMES)
  const dragStart = editorDragStart()
  const deps: PenDeps = {
    hold: () => (holds += 1),
    dragStart,
    session,
    selection,
    tools: { setTool: (tool) => log.push(`tool ${tool}`) },
    typing: { stop: () => log.push('stop typing') },
    camera: () => ({ x: 0, y: 0, zoom: 1 }),
    drawn: () => session.design(),
    frameOf,
    boxes,
    hug: (ids) => log.push(`hug ${ids.join(',')}`),
    shownChanged: () => log.push('draw'),
  }
  const pen = editorPen(deps)
  /** Presses the pen at a point of the square, by a pointer of a type, telling the press to the drag start as the pointer does. */
  const press = (x: number, y: number, pointerType = 'mouse') => {
    dragStart.press({ x, y }, pointerType)
    pen.down(pointerInput({ pointerType }), { frame: SQUARE, p: { x, y } })
  }
  /** Presses the pen at a point in a frame, and lets go. */
  const click = (x: number, y: number, frame = SQUARE) => {
    pen.down(pointer(), { frame, p: { x, y } })
    pen.up()
  }
  const made = () => Object.keys(session.design().nodes).filter((id) => id !== 'zig' && id !== 'wide-zig')
  /** A layer's anchors in the square frame. */
  const anchors = (id: string) => boxes.pathIn(SQUARE, id)?.path[0]?.anchors
  /** Edits the zig's points, none selected. */
  const editZig = () => {
    selection.select(['zig'], 'sq')
    selection.editPath({ id: 'zig', frameId: 'sq' })
  }
  return { pen, session, selection, boxes, log, click, press, made, anchors, editZig, holds: () => holds }
}

describe('editorPen', () => {
  describe('holding the pointer', () => {
    it("holds it from each press of the pen, the path's first and the ones after", () => {
      const { pen, holds } = harness()
      pen.down(pointer(), { frame: SQUARE, p: { x: 100, y: 300 } })
      expect(holds()).toBe(1)
      pen.up()
      pen.down(pointer(), { frame: SQUARE, p: { x: 200, y: 300 } })
      expect(holds()).toBe(2)
    })

    it('holds it from a press on a point of the path edited, and not from one off the path, which leaves it', () => {
      const { pen, editZig, holds } = harness()
      editZig()
      expect(pen.pressPoints(pointer(), { frame: SQUARE, p: { x: 200, y: 100 } })).not.toBeNull()
      expect(holds()).toBe(1)
      expect(pen.pressPoints(pointer(), { frame: SQUARE, p: { x: 900, y: 900 } })).toBeNull()
      expect(holds()).toBe(1)
    })
  })

  describe('shown', () => {
    it('shows nothing while no path is drawn or edited', () => {
      const { pen } = harness()
      expect(pen.shown()).toBeNull()
    })

    it("shows the path the pen is drawing with its last anchor's handles, and the next segment to the pointer", () => {
      const { pen, click } = harness()
      click(100, 300)
      click(200, 300)
      pen.move(pointer(), { x: 260, y: 340 })
      expect(pen.shown()).toEqual({
        frame: SQUARE,
        around: [],
        path: [
          {
            anchors: [
              { x: 100, y: 300 },
              { x: 200, y: 300 },
            ],
            closed: false,
          },
        ],
        handles: [{ contour: 0, index: 1 }],
        picked: false,
        preview: [
          { x: 200, y: 300 },
          { x: 260, y: 340 },
        ],
        closing: false,
      })
    })

    it('marks the first anchor as closing while the pointer is on it, and shows no next segment during a press', () => {
      const { pen, click } = harness()
      click(100, 300)
      click(200, 300)
      pen.move(pointer(), { x: 103, y: 302 })
      expect(pen.shown()).toMatchObject({ closing: true })
      pen.down(pointer(), { frame: SQUARE, p: { x: 300, y: 400 } })
      expect(pen.shown()).toMatchObject({ handles: [{ contour: 0, index: 2 }], preview: null })
    })

    it('gives a path and a next segment that stay as they were once the pen places the next anchor', () => {
      const { pen, click } = harness()
      click(100, 300)
      click(200, 300)
      pen.move(pointer(), { x: 260, y: 340 })
      const kept = pen.shown()
      const before = structuredClone(kept)
      click(300, 400)
      expect(kept).toEqual(before)
    })

    it('gives anchors that stay as they were once a drag pulls handles out of one', () => {
      const { pen, click, press } = harness()
      click(100, 300)
      press(200, 300)
      const kept = pen.shown()
      const before = structuredClone(kept)
      pen.move(pointer(), { x: 240, y: 340 })
      expect(pen.shown()?.path[0]?.anchors[1]).toMatchObject({ out: { x: 240, y: 340 } })
      expect(kept).toEqual(before)
    })

    it('shows the path whose points are edited as drawn, with the selected anchors marked', () => {
      const { pen, selection, boxes, editZig } = harness()
      editZig()
      selection.pickAnchors([{ contour: 0, index: 1 }])
      const found = boxes.pathIn(SQUARE, 'zig')
      expect(pen.shown()).toEqual({
        frame: SQUARE,
        around: found?.around,
        path: found?.path,
        handles: [{ contour: 0, index: 1 }],
        picked: true,
        preview: null,
        closing: false,
      })
    })
  })

  describe('drawing a path', () => {
    it('stops typing and lets the selection go, then makes the layer at the second anchor', () => {
      const { pen, session, selection, log, click, made, anchors } = harness()
      selection.select(['zig'], 'sq')
      click(100, 300)
      expect(pen.drawing()).toBe(true)
      expect(log[0]).toBe('stop typing')
      expect(selection.current()).toBeNull()
      expect(made()).toEqual([])
      click(200, 350)
      const [id = ''] = made()
      expect(anchors(id)).toEqual([
        { x: 100, y: 300 },
        { x: 200, y: 350 },
      ])
      expect(session.design().nodes[id]?.props).toMatchObject({ x: 100, y: 300, width: 100, height: 50 })
    })

    it('finishes as one undo step: the new layer selected, its groups fitted, the select tool back', () => {
      const { pen, session, selection, log, click, made } = harness()
      click(100, 300)
      click(200, 350)
      pen.finish()
      const [id] = made()
      expect(pen.drawing()).toBe(false)
      expect(selection.current()).toEqual(pairsIn('sq', [id ?? '']))
      expect(log).toContain(`hug ${id}`)
      expect(log.at(-2)).toBe('tool select')
      session.undo()
      expect(made()).toEqual([])
      expect(session.canUndo()).toBe(false)
    })

    it('makes nothing when finished with one anchor, and still brings the select tool back', () => {
      const { pen, session, log, click, made } = harness()
      click(100, 300)
      pen.finish()
      expect(made()).toEqual([])
      expect(log).toContain('tool select')
      expect(session.canUndo()).toBe(false)
      // Finishing again does nothing.
      const told = log.length
      pen.finish()
      expect(log).toHaveLength(told)
    })

    it('closes the path with a press on its first anchor, finishing it as the press ends', () => {
      const { pen, session, click, made } = harness()
      click(100, 300)
      click(200, 300)
      click(200, 400)
      pen.down(pointer(), { frame: SQUARE, p: { x: 101, y: 301 } })
      expect(pen.drawing()).toBe(true)
      pen.up()
      expect(pen.drawing()).toBe(false)
      const [id] = made()
      const node = session.design().nodes[id ?? '']
      expect(node?.type === 'graphic' && node.props.shape.kind === 'path' && node.props.shape.d).toMatch(/Z$/)
    })

    it('pulls smooth handles out of the anchor a press placed once the press is past the slop', () => {
      const { pen, click, press, made, anchors } = harness()
      click(100, 300)
      press(200, 300)
      pen.move(pointer(), { x: 202, y: 300 })
      pen.up()
      expect(anchors(made()[0] ?? '')?.[1]).toEqual({ x: 200, y: 300 })
      press(300, 300)
      pen.move(pointer(), { x: 300, y: 304 })
      pen.move(pointer(), { x: 300, y: 340 })
      pen.up()
      click(400, 300)
      expect(anchors(made()[0] ?? '')?.[2]).toEqual({ x: 300, y: 300, in: { x: 300, y: 260 }, out: { x: 300, y: 340 } })
    })

    it('keeps the anchor a finger placed a corner while it wanders 7 pixels, and pulls handles at 9', () => {
      const { pen, click, press, made, anchors } = harness()
      click(100, 300)
      press(200, 300, 'touch')
      pen.move(pointer(), { x: 207, y: 300 })
      pen.up()
      expect(anchors(made()[0] ?? '')?.[1]).toEqual({ x: 200, y: 300 })
      press(300, 300, 'touch')
      pen.move(pointer(), { x: 309, y: 300 })
      pen.up()
      click(400, 300)
      expect(anchors(made()[0] ?? '')?.[2]).toEqual({ x: 300, y: 300, in: { x: 291, y: 300 }, out: { x: 309, y: 300 } })
    })

    it('turns the new segment to 45° with Shift', () => {
      const { pen, click, made, anchors } = harness()
      click(100, 300)
      pen.down(pointer(true), { frame: SQUARE, p: { x: 200, y: 310 } })
      pen.up()
      expect(anchors(made()[0] ?? '')?.[1]?.y).toBe(300)
    })

    it('finishes the path when a press lands in another frame, and starts a new one there', () => {
      const { pen, session, log, click, made } = harness()
      click(100, 300)
      click(200, 300)
      const [first] = made()
      click(1300, 100, WIDE)
      expect(log).toContain(`hug ${first}`)
      expect(log).toContain('tool select')
      expect(pen.drawing()).toBe(true)
      expect(made()).toEqual([first])
      expect(session.canUndo()).toBe(true)
    })
  })

  describe('in a group a row moved', () => {
    it('draws the path where its anchors were placed, through undo and redo', () => {
      const { pen, session, selection, boxes, click, made } = harness()
      selection.enter(groupMovedByRow(session, 'zig', 'sq'))
      click(620, 630)
      click(700, 650)
      pen.finish()
      const [id = ''] = made().filter((layer) => !['row', 'moved'].includes(layer))
      const want = { x: 620, y: 630, width: 80, height: 20 }
      expect(boxes.drawnBoxOf(SQUARE, id)).toMatchObject(want)
      session.undo()
      session.redo()
      expect(boxes.drawnBoxOf(SQUARE, id)).toMatchObject(want)
    })
  })

  describe("editing a path's points", () => {
    it('selects the anchor pressed and drags the selected anchors, as one undo step', () => {
      const { pen, session, selection, log, editZig, anchors } = harness()
      const copy = session.design().nodes['wide-zig']
      editZig()
      const drag = pen.pressPoints(pointer(), { frame: SQUARE, p: { x: 200, y: 100 } })
      expect(drag?.kind).toBe('path')
      expect(selection.pathEditing()?.selected).toEqual([{ contour: 0, index: 1 }])
      if (!drag) return
      pen.dragPoints(drag, { x: 230, y: 110 }, false, false)
      expect(anchors('zig')?.[1]).toEqual({ x: 230, y: 110 })
      // The copy in the wide frame stays as it was.
      expect(session.design().nodes['wide-zig']).toEqual(copy)
      pen.releasePoints(drag)
      expect(log).toContain('hug zig')
      session.undo()
      expect(anchors('zig')?.[1]).toEqual({ x: 200, y: 100 })
      expect(session.canUndo()).toBe(false)
    })

    it("shows a scaled path's points where they are drawn, and drags one alone, the others staying where they are drawn", () => {
      const { pen, session, selection, anchors } = harness(SCALED)
      selection.select(['tri'], 'sq')
      selection.editPath({ id: 'tri', frameId: 'sq' })
      const at = (points: { x: number; y: number }[] | undefined) => points?.map(({ x, y }) => ({ x, y }))
      const drawn = [
        { x: 100, y: 100 },
        { x: 500, y: 100 },
        { x: 300, y: 420 },
      ]
      expect(at(pen.shown()?.path[0]?.anchors)).toEqual(drawn)
      const drag = pen.pressPoints(pointer(), { frame: SQUARE, p: { x: 500, y: 100 } })
      if (!drag) throw new Error('no drag')
      expect(selection.pathEditing()?.selected).toEqual([{ contour: 0, index: 1 }])
      pen.dragPoints(drag, { x: 540, y: 100 }, false, false)
      pen.releasePoints(drag)
      expect(at(anchors('tri'))).toEqual([drawn[0], { x: 540, y: 100 }, drawn[2]])
      // Its points are stored in its box as it is drawn now.
      const props = session.design().nodes.tri?.props as { width: number; height: number; shape: { drawnIn: unknown } }
      expect(props.shape.drawnIn).toEqual({ width: props.width, height: props.height })
    })

    it("shows a flipped path's points mirrored, where they are drawn, and drags one there, the others staying where they are drawn", () => {
      const { pen, session, editZig, anchors } = harness()
      session.run('node.update', { ids: ['zig'], patch: { flipX: true, flipY: true } })
      editZig()
      const at = (points: { x: number; y: number }[] | undefined) => points?.map(({ x, y }) => ({ x, y }))
      const drawn = [
        { x: 200, y: 200 },
        { x: 100, y: 200 },
        { x: 100, y: 100 },
      ]
      expect(at(pen.shown()?.path[0]?.anchors)).toEqual(drawn)
      const drag = pen.pressPoints(pointer(), { frame: SQUARE, p: drawn[1] as { x: number; y: number } })
      if (!drag) throw new Error('no drag')
      pen.dragPoints(drag, { x: 60, y: 240 }, false, false)
      pen.releasePoints(drag)
      expect(at(anchors('zig'))).toEqual([drawn[0], { x: 60, y: 240 }, drawn[2]])
    })

    it('keeps an anchor drag to one axis with Shift', () => {
      const { pen, editZig, anchors } = harness()
      editZig()
      const drag = pen.pressPoints(pointer(), { frame: SQUARE, p: { x: 200, y: 100 } })
      if (drag) pen.dragPoints(drag, { x: 230, y: 110 }, true, false)
      expect(anchors('zig')?.[1]).toEqual({ x: 230, y: 100 })
    })

    it('adds an anchor to the selection with Shift, or takes it away', () => {
      const { pen, selection, editZig } = harness()
      editZig()
      pen.pressPoints(pointer(), { frame: SQUARE, p: { x: 200, y: 100 } })
      pen.pressPoints(pointer(true), { frame: SQUARE, p: { x: 100, y: 100 } })
      expect(selection.pathEditing()?.selected).toEqual([
        { contour: 0, index: 1 },
        { contour: 0, index: 0 },
      ])
      pen.pressPoints(pointer(true), { frame: SQUARE, p: { x: 200, y: 100 } })
      expect(selection.pathEditing()?.selected).toEqual([{ contour: 0, index: 0 }])
    })

    it('adds an anchor where a press lands on a segment, selected', () => {
      const { pen, selection, editZig, anchors } = harness()
      editZig()
      pen.pressPoints(pointer(), { frame: SQUARE, p: { x: 150, y: 100 } })
      expect(anchors('zig')).toHaveLength(4)
      expect(anchors('zig')?.[1]).toMatchObject({ x: 150, y: 100 })
      expect(selection.pathEditing()?.selected).toEqual([{ contour: 0, index: 1 }])
    })

    it('leaves the points with a press off the path, which then does what it would have, and draws', () => {
      const { pen, selection, log, editZig } = harness()
      editZig()
      expect(pen.pressPoints(pointer(), { frame: SQUARE, p: { x: 600, y: 600 } })).toBeNull()
      expect(selection.pathEditing()).toBeNull()
      expect(selection.current()).toEqual(pairsIn('sq', ['zig']))
      expect(log).toEqual(['draw'])
      expect(pen.pressPoints(pointer(), null)).toBeNull()
    })

    it('deletes the selected anchors as one undo step, and the layer once none would be left', () => {
      const { pen, session, selection, editZig, anchors } = harness()
      editZig()
      expect(pen.deletePoints()).toBe(false)
      selection.pickAnchors([{ contour: 0, index: 2 }])
      expect(pen.deletePoints()).toBe(true)
      expect(anchors('zig')).toHaveLength(2)
      expect(selection.pathEditing()?.selected).toEqual([])
      session.undo()
      expect(anchors('zig')).toHaveLength(3)
      selection.pickAnchors([0, 1, 2].map((index) => ({ contour: 0, index })))
      pen.deletePoints()
      expect(session.design().nodes.zig).toBeUndefined()
    })

    it('keeps a box that fits its content at the size it is drawn when deleting the last path of its flow', () => {
      const { pen, session, selection, boxes, editZig } = harness()
      session.run('node.create', {
        id: 'row',
        parentId: 'sq',
        layer: {
          type: 'box',
          name: 'Row',
          props: {
            x: 100,
            y: 100,
            width: 10,
            height: 10,
            sizing: { width: 'hug', height: 'hug' },
            layout: { direction: 'row', padding: { top: 10, right: 10, bottom: 10, left: 10 } },
          },
        },
      })
      session.run('node.move', { id: 'zig', parentId: 'row' })
      const was = boxes.drawnRect(SQUARE, 'row')
      expect(was).toMatchObject({ width: 120, height: 120 })
      editZig()
      selection.pickAnchors([0, 1, 2].map((index) => ({ contour: 0, index })))
      pen.deletePoints()
      expect(boxes.drawnRect(SQUARE, 'row')).toEqual(was)
    })
  })

  describe('a fault in the middle of a path', () => {
    registerFaultyCommand()

    it('leaves no path being drawn and no gesture open, the editor finishing the path, and the next press starts a path of its own', () => {
      const { pen, session, selection, click, made } = harness()
      // The editor ends the pen's path when a fault is told.
      watchFaults({ session, endOpen: () => pen.finish(), notify: () => {} })
      click(100, 300)
      click(200, 300)
      expect(made()).toHaveLength(1)
      faultOn(session, ['zig'])
      // The fault put back all the path's step wrote, the layer with it.
      expect([made(), session.inGesture(), session.canUndo()]).toEqual([[], false, false])
      expect(pen.drawing()).toBe(false)
      expect(selection.current()).toBeNull()
      click(400, 400)
      click(500, 400)
      expect([pen.drawing(), session.inGesture()]).toEqual([true, true])
      pen.finish()
      expect(made()).toHaveLength(1)
      session.undo()
      expect([made(), session.canUndo()]).toEqual([[], false])
    })
  })
})
