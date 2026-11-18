import { describe, expect, it } from 'vitest'

import { childrenOf } from '@dazbee/doc'

import { type Box, drawnFrom, localTo } from '../../layers/transform.ts'
import type { ReorderDrag } from './auto-layout-drag.ts'
import { addBox, dropHarness, FREE, gridHarness, harness } from './test-auto-layout-drag.ts'

describe('editorAutoLayoutDrag', () => {
  describe('press', () => {
    it('starts a drag of layers all in one flow, as one undo step', () => {
      const { reorder, session, frame } = harness()
      const drag = reorder.press(frame, [], { x: 125, y: 125 }, ['one'])
      expect(drag).toMatchObject({ kind: 'reorder', parentId: 'row', roots: ['one'], moved: false, outside: false })
      expect(drag?.boxes.get('one')).toMatchObject({ x: 100, y: 100 })
      expect(session.inGesture()).toBe(true)
    })

    it('starts none for layers in no flow, or not all in it', () => {
      const { reorder, session, frame } = harness()
      expect(reorder.press(frame, [], { x: 625, y: 625 }, ['free'])).toBeNull()
      expect(reorder.press(frame, [], { x: 125, y: 125 }, ['one', 'free'])).toBeNull()
      expect(session.inGesture()).toBe(false)
    })
  })

  describe('reorders', () => {
    it('answers whether a press on layers drags them along a flow, as press decides, starting no drag', () => {
      const { reorder, session } = harness()
      expect(reorder.reorders(['one'])).toBe(true)
      expect(reorder.reorders(['one', 'two'])).toBe(true)
      expect(reorder.reorders(['free'])).toBe(false)
      expect(reorder.reorders(['one', 'free'])).toBe(false)
      expect(reorder.reorders(['one', 'wide-one'])).toBe(false)
      expect(session.inGesture()).toBe(false)
    })
  })

  describe('drag', () => {
    it('follows the point to its place in the flow, or out of it', () => {
      const { reorder, frame } = harness()
      const drag = reorder.press(frame, [], { x: 125, y: 125 }, ['one'])
      if (!drag) throw new Error('no drag')
      reorder.drag(drag, { x: 240, y: 125 }, false)
      expect(drag).toMatchObject({ moved: true, slot: 2, near: { id: 'three', after: true }, outside: false })
      reorder.drag(drag, { x: 160, y: 125 }, false)
      expect(drag).toMatchObject({ slot: 0, near: { id: 'two', after: false } })
      reorder.drag(drag, { x: 500, y: 125 }, false)
      expect(drag.outside).toBe(true)
    })

    it('finds the place beside a turned layer by the room its turned bounds take in the flow', () => {
      const { reorder, session, frame } = harness()
      // Turned a quarter, Two takes 20 across, 150 to 170, though its own box reaches from 80 to 240.
      session.run('node.update', { ids: ['two'], patch: { width: 160, height: 20, rotation: 90 } })
      const drag = reorder.press(frame, [], { x: 125, y: 125 }, ['one'])
      if (!drag) throw new Error('no drag')
      // Inside Two's own box, but nearer Three's room than Two's.
      reorder.drag(drag, { x: 210, y: 180 }, false)
      expect(drag).toMatchObject({ slot: 2, near: { id: 'three', after: true } })
      // Past Two's middle, in its room: One goes after Two, whose room is laid out first now, 100 to
      // 120, not its own box; the line is 3 before One, which starts at the room's end.
      reorder.drag(drag, { x: 165, y: 125 }, false)
      const line = reorder.shown(drag).find((part) => part.kind === 'line')
      expect(drag.near).toEqual({ id: 'two', after: true })
      expect(line?.box).toMatchObject({ x: 116, width: 2 })
    })
  })

  describe('drag onto another frame', () => {
    it('finds the other frame under the pointer outside the box, shows no leave outline there, and lands the layer on its top', () => {
      const { reorder, session, frame } = harness()
      const drag = reorder.press(frame, [], { x: 125, y: 125 }, ['one'])
      if (!drag) throw new Error('no drag')
      // 1400 across the square is over the wide frame, which starts 1280 across the page; 300 down is below its row.
      reorder.drag(drag, { x: 1400, y: 300 }, false)
      expect(drag).toMatchObject({ outside: true, target: { id: 'wide' }, drop: null })
      expect(reorder.shown(drag).map((part) => part.kind)).toEqual(['ghost'])
      reorder.release(drag)
      expect(session.design().nodes.one).toMatchObject({ parentId: 'wide', props: { x: 1375 - 1280, y: 275 } })
    })

    it('lands several layers on the frame’s top in the order they are drawn, the group around the box they leave fitting it again', () => {
      const { reorder, session, frame, log } = harness()
      session.run('node.group', { ids: ['row'], id: 'around', name: 'Around' })
      const drag = reorder.press(frame, [], { x: 225, y: 125 }, ['three', 'two'])
      if (!drag) throw new Error('no drag')
      reorder.drag(drag, { x: 1400, y: 300 }, false)
      reorder.release(drag)
      const onWide = childrenOf(session.design(), 'wide').map(([id]) => id)
      expect(onWide.slice(-2)).toEqual(['two', 'three'])
      // The box they left is fitted around, as the groups holding it are.
      expect(log).toContain('hug row')
    })

    it('keeps a mask in its flow in its frame', () => {
      const { reorder, session, frame } = harness()
      session.run('node.mask', { ids: ['one'], mask: 'alpha' })
      const drag = reorder.press(frame, [], { x: 125, y: 125 }, ['one'])
      if (!drag) throw new Error('no drag')
      reorder.drag(drag, { x: 1400, y: 125 }, false)
      expect(drag.target).toBeNull()
      reorder.release(drag)
      expect(session.design().nodes.one?.parentId).not.toBe('wide')
    })
  })

  describe('shown', () => {
    it('shows nothing with no drag, or before the drag has moved', () => {
      const { reorder, frame } = harness()
      const drag = reorder.press(frame, [], { x: 125, y: 125 }, ['one'])
      if (!drag) throw new Error('no drag')
      expect(reorder.shown(null)).toEqual([])
      expect(reorder.shown(drag)).toEqual([])
    })

    it('shows each dragged layer following the pointer, then the line where they would go', () => {
      const { reorder, frame } = harness()
      const drag = reorder.press(frame, [], { x: 125, y: 125 }, ['one'])
      if (!drag) throw new Error('no drag')
      reorder.drag(drag, { x: 145, y: 135 }, false)
      const one = drag.boxes.get('one')
      expect(reorder.shown(drag)).toEqual([
        { kind: 'ghost', frame, box: { ...one, x: (one?.x ?? 0) + 20, y: (one?.y ?? 0) + 10 } },
        { kind: 'line', frame, box: expect.objectContaining({ width: 2 }) as Box },
      ])
    })

    it('shows the box the layers would leave, in place of a line, once they are outside it over no other flow', () => {
      const { reorder, frame, boxes } = harness()
      const drag = reorder.press(frame, [], { x: 125, y: 125 }, ['one'])
      if (!drag) throw new Error('no drag')
      reorder.drag(drag, { x: 125, y: 700 }, false)
      expect(reorder.shown(drag).map((part) => part.kind)).toEqual(['ghost', 'leave'])
      expect(reorder.shown(drag).at(-1)).toEqual({ kind: 'leave', frame, box: boxes.boxIn('row') })
    })
  })

  describe('drag in a grid', () => {
    // The grid's cells are 150 wide, 50 tall: One and Two on the first row, Three under One, and an empty cell after it.
    const lineOf = (reorder: ReturnType<typeof harness>['reorder'], drag: ReorderDrag) =>
      reorder.shown(drag).find((part) => part.kind === 'line')?.box

    it('finds the place in the cell under the pointer, before or past its middle, the line at the start of the cell the layer now takes', () => {
      const { reorder, frame, order } = gridHarness()
      const drag = reorder.press(frame, [], { x: 125, y: 125 }, ['one'])
      if (!drag) throw new Error('no drag')
      // In Three's cell, past where Three ends but before the cell's middle: before Three.
      // Before Three, One takes the second cell, Two the first.
      reorder.drag(drag, { x: 160, y: 175 }, false)
      expect(drag).toMatchObject({ slot: 1, near: { id: 'three', after: false } })
      expect(lineOf(reorder, drag)).toMatchObject({ x: 249, y: 100, width: 2, height: 50 })
      // After Three, One takes the third cell, under Two.
      reorder.drag(drag, { x: 200, y: 175 }, false)
      expect(drag).toMatchObject({ slot: 2, near: { id: 'three', after: true } })
      expect(lineOf(reorder, drag)).toMatchObject({ x: 99, y: 150, width: 2, height: 50 })
      reorder.release(drag)
      expect(order()).toEqual(['two', 'three', 'one'])
    })

    it('puts layers dropped on the empty cell after the last layer at the end, the line at the cell they now take', () => {
      const { reorder, frame, order } = gridHarness()
      const drag = reorder.press(frame, [], { x: 125, y: 125 }, ['one'])
      if (!drag) throw new Error('no drag')
      reorder.drag(drag, { x: 380, y: 190 }, false)
      expect(drag).toMatchObject({ slot: 2, near: { id: 'three', after: true } })
      expect(lineOf(reorder, drag)).toMatchObject({ x: 99, y: 150, width: 2, height: 50 })
      reorder.release(drag)
      expect(order()).toEqual(['two', 'three', 'one'])
    })

    it('drops a layer from outside the grid on the empty cell after the last layer at the end, in that cell', () => {
      const { reorder, session, frame, boxes, order } = gridHarness()
      const drop = reorder.dropAt(frame, { x: 325, y: 175 }, ['free'])
      expect(drop).toMatchObject({ boxId: 'row', slot: 3, near: { id: 'three', after: true } })
      if (!drop) throw new Error('no drop')
      session.gesture(() => reorder.dropInto(drop, ['free']))
      expect(order()).toEqual(['one', 'two', 'three', 'free'])
      expect(boxes.boxIn('free')).toMatchObject({ x: 250, y: 150, width: 50, height: 50 })
    })
  })

  describe('dropAt', () => {
    it('finds the laid-out box under a point that the layers are not in, and their place in its flow', () => {
      const { reorder, frame } = dropHarness()
      expect(reorder.dropAt(frame, { x: 625, y: 160 }, ['free'])).toMatchObject({
        boxId: 'col',
        slot: 1,
        near: { id: 'x2', after: false },
      })
      expect(reorder.dropAt(frame, { x: 625, y: 390 }, ['free'])).toMatchObject({
        slot: 2,
        near: { id: 'x2', after: true },
      })
    })

    it('finds none over a Free box, the canvas, or the box the layers are in', () => {
      const { reorder, frame } = dropHarness()
      expect(reorder.dropAt(frame, { x: 150, y: 450 }, ['free'])).toBeNull()
      expect(reorder.dropAt(frame, { x: 1000, y: 1000 }, ['free'])).toBeNull()
      expect(reorder.dropAt(frame, { x: 350, y: 125 }, ['one'])).toBeNull()
    })

    it('never takes a box locked in place, a hidden one, or one the layers are or hold', () => {
      const h = dropHarness()
      const at = { x: 625, y: 160 }
      expect(h.reorder.dropAt(h.frame, at, ['col'])).toBeNull()
      h.session.run('node.group', { ids: ['col'], id: 'holder', name: 'Holder' })
      expect(h.reorder.dropAt(h.frame, at, ['holder'])).toBeNull()
      h.session.run('node.lock', { ids: ['col'], lock: { move: true } })
      expect(h.reorder.dropAt(h.frame, at, ['free'])).toBeNull()
      h.session.run('node.lock', { ids: ['col'], lock: { move: false } })
      h.session.run('node.update', { ids: ['col'], patch: { visible: false } })
      expect(h.reorder.dropAt(h.frame, at, ['free'])).toBeNull()
    })

    it('never takes a box the dragged layers are copies of, nor one inside it', () => {
      const h = dropHarness()
      const at = { x: 625, y: 160 }
      expect(h.reorder.dropAt(h.frame, at, ['free'], ['col'])).toBeNull()
      h.session.run('node.group', { ids: ['col'], id: 'holder', name: 'Holder' })
      expect(h.reorder.dropAt(h.frame, at, ['free'], ['holder'])).toBeNull()
      expect(h.reorder.dropAt(h.frame, at, ['free'], ['one'])).toMatchObject({ boxId: 'col' })
    })

    it('finds none for a mask, which no flow may hold', () => {
      const { reorder, session, frame } = dropHarness()
      session.run('node.mask', { ids: ['free'], mask: 'alpha' })
      expect(reorder.dropAt(frame, { x: 625, y: 160 }, ['free'])).toBeNull()
    })

    it('never takes a Mask group, nor a laid-out box that is its mask, nor a box inside that mask', () => {
      const h = dropHarness()
      addBox(h, 'inner', 'col', { width: 150, height: 60, layout: { direction: 'row' } }, ['y1'])
      h.session.run('node.group', { ids: ['col'], id: 'masked', name: 'Masked' })
      h.session.run('node.mask', { ids: ['col'], mask: 'alpha' })
      h.session.run('node.create', {
        id: 'pic',
        parentId: 'masked',
        layer: {
          type: 'graphic',
          name: 'Picture',
          props: { x: 600, y: 100, width: 200, height: 300, shape: { kind: 'rect' } },
        },
      })
      // The column at 600,100 is the Mask group's mask; it places the inner row under x2, at 600,200.
      expect(h.reorder.dropAt(h.frame, { x: 625, y: 160 }, ['free'])).toBeNull()
      expect(h.reorder.dropAt(h.frame, { x: 640, y: 220 }, ['free'])).toBeNull()
    })

    it('takes the innermost laid-out box under the point', () => {
      const h = dropHarness()
      addBox(h, 'inner', 'col', { width: 150, height: 60, layout: { direction: 'row' } }, ['y1'])
      // The column places the inner row under x2, at 600,200.
      expect(h.reorder.dropAt(h.frame, { x: 640, y: 220 }, ['free'])).toMatchObject({
        boxId: 'inner',
        slot: 1,
        near: { id: 'y1', after: true },
      })
    })

    it('finds none over a Free box inside a laid-out box, which takes no drop', () => {
      const h = dropHarness()
      addBox(h, 'loose', 'col', { width: 150, height: 60 })
      // The column places the Free box under x2, at 600,200.
      expect(h.reorder.dropAt(h.frame, { x: 640, y: 220 }, ['free'])).toBeNull()
    })

    it('finds the place in a turned box along its own flow, and draws the line turned with it', () => {
      const { reorder, frame } = dropHarness()
      // Turned a quarter round 500,425, the row runs down the frame from 475,325.
      expect(reorder.dropAt(frame, { x: 420, y: 425 }, ['free'])).toBeNull()
      const drop = reorder.dropAt(frame, { x: 500, y: 340 }, ['free'])
      expect(drop).toMatchObject({ boxId: 'turned', slot: 0, near: { id: 't1', after: false } })
      const [line] = reorder.shownDrop(frame, drop)
      expect(line).toMatchObject({ kind: 'line', frame, box: { rotation: 90 } })
      expect(reorder.shownDrop(frame, null)).toEqual([])
    })
  })

  describe('dropInto', () => {
    it('moves the layers into the box at the place found, the groups they leave fitting what they hold', () => {
      const h = dropHarness()
      h.session.run('node.group', { ids: ['free'], id: 'pair', name: 'Pair' })
      const drop = h.reorder.dropAt(h.frame, { x: 625, y: 160 }, ['free'])
      if (!drop) throw new Error('no drop')
      h.session.gesture(() => h.reorder.dropInto(drop, ['free']))
      expect(childrenOf(h.session.design(), 'col').map(([id]) => id)).toEqual(['x1', 'free', 'x2'])
      expect(h.boxes.boxIn('free')).toMatchObject({ x: 600, y: 150 })
      expect(h.log).toContain('hug pair')
      h.session.undo()
      expect(h.session.design().nodes.free?.parentId).toBe('pair')
    })
  })

  describe('release', () => {
    it('drops the layers into their new place in the flow, one undo step called move, leaving the copies in the other frame be', () => {
      const { reorder, session, log, frame, order, wideCopies } = harness()
      const copies = wideCopies()
      const drag = reorder.press(frame, [], { x: 125, y: 125 }, ['one'])
      if (!drag) throw new Error('no drag')
      reorder.drag(drag, { x: 240, y: 125 }, false)
      reorder.release(drag)
      expect(order()).toEqual(['two', 'three', 'one'])
      expect(wideCopies()).toEqual(copies)
      expect(log).toEqual(['hug one'])
      expect(session.inGesture()).toBe(false)
      expect(session.undoName()).toBe('move')
      session.undo()
      expect(order()).toEqual(['one', 'two', 'three'])
    })

    it("takes the layers out of the box to the frame's top level, where they were dropped; the copies in the other frame stay", () => {
      const { reorder, session, frame, order, wideCopies } = harness()
      const copies = wideCopies()
      const drag = reorder.press(frame, [], { x: 125, y: 125 }, ['one'])
      if (!drag) throw new Error('no drag')
      reorder.drag(drag, { x: 525, y: 325 }, false)
      reorder.release(drag)
      expect(order()).toEqual(['two', 'three'])
      expect(session.design().nodes.one?.parentId).toBe('sq')
      expect(session.design().nodes.one?.props).toMatchObject({ x: 500, y: 300 })
      expect(wideCopies()).toEqual(copies)
    })

    it('takes a group out of the box with what it holds, where it was dropped', () => {
      const { reorder, session, frame, boxes } = harness()
      session.run('node.group', { ids: ['free'], id: 'pair', name: 'Pair' })
      session.run('node.move', { id: 'pair', parentId: 'row' })
      const was = boxes.drawnRect(frame, 'free')
      if (!was) throw new Error('no layer')
      const at = { x: was.x + 25, y: was.y + 25 }
      const drag = reorder.press(frame, [], at, ['pair'])
      if (!drag) throw new Error('no drag')
      reorder.drag(drag, { x: at.x + 300, y: at.y + 300 }, false)
      reorder.release(drag)
      expect(session.design().nodes.pair?.parentId).toBe('sq')
      const dropped = { ...was, x: was.x + 300, y: was.y + 300 }
      expect(boxes.drawnRect(frame, 'pair')).toEqual(dropped)
      expect(boxes.drawnRect(frame, 'free')).toEqual(dropped)
      session.undo()
      expect(boxes.drawnRect(frame, 'free')).toEqual(was)
    })

    it("drops layers dragged out of their flow into another laid-out box's flow, the box they left keeping its drawn size", () => {
      const h = dropHarness()
      h.session.run('node.update', { ids: ['row'], patch: { sizing: { width: 'hug', height: 'hug' } } })
      const was = h.boxes.boxIn('row')
      const drag = h.reorder.press(h.frame, [], { x: 125, y: 125 }, ['one', 'two', 'three'])
      if (!drag) throw new Error('no drag')
      h.reorder.drag(drag, { x: 625, y: 160 }, false)
      expect(drag).toMatchObject({ outside: true, drop: { boxId: 'col', slot: 1 } })
      expect(h.reorder.shown(drag).map((part) => part.kind)).toEqual(['ghost', 'ghost', 'ghost', 'line'])
      h.reorder.release(drag)
      expect(childrenOf(h.session.design(), 'col').map(([id]) => id)).toEqual(['x1', 'one', 'two', 'three', 'x2'])
      expect(h.boxes.boxIn('row')).toEqual(was)
      h.session.undo()
      expect(h.order()).toEqual(['one', 'two', 'three'])
    })

    it('keeps a box that fits its content at its drawn size when every layer of its flow is dragged out onto the frame', () => {
      const h = harness()
      h.session.run('node.update', { ids: ['row'], patch: { sizing: { width: 'hug', height: 'hug' } } })
      const was = h.boxes.boxIn('row')
      expect(was).toMatchObject({ width: 150, height: 50 })
      const drag = h.reorder.press(h.frame, [], { x: 125, y: 125 }, ['one', 'two', 'three'])
      if (!drag) throw new Error('no drag')
      h.reorder.drag(drag, { x: 525, y: 525 }, false)
      expect(drag).toMatchObject({ outside: true, drop: null })
      h.reorder.release(drag)
      expect(h.order()).toEqual([])
      expect(h.boxes.boxIn('row')).toEqual(was)
    })

    it('takes a first layer into a box its flow left empty, at its start, the box fitting that layer again', () => {
      const h = harness()
      h.session.run('node.update', { ids: ['row'], patch: { sizing: { width: 'hug', height: 'hug' } } })
      const drag = h.reorder.press(h.frame, [], { x: 125, y: 125 }, ['one', 'two', 'three'])
      if (!drag) throw new Error('no drag')
      h.reorder.drag(drag, { x: 525, y: 525 }, false)
      h.reorder.release(drag)
      const drop = h.reorder.dropAt(h.frame, { x: 200, y: 125 }, ['free'])
      expect(drop).toMatchObject({ boxId: 'row', slot: 0, near: null })
      expect(h.reorder.shownDrop(h.frame, drop)).toEqual([
        { kind: 'line', frame: h.frame, box: expect.objectContaining({ x: 99, y: 100, width: 2 }) as Box },
      ])
      if (!drop) throw new Error('no drop')
      h.session.gesture(() => h.reorder.dropInto(drop, ['free']))
      expect(h.order()).toEqual(['free'])
      expect(h.boxes.boxIn('row')).toMatchObject({ x: 100, y: 100, width: 50, height: 50 })
    })

    it('keeps two layers dragged out of a turned box that fits its content where they were dropped, the box at its drawn size', () => {
      const h = dropHarness()
      h.session.run('node.update', { ids: ['turned'], patch: { sizing: { width: 'hug', height: 'hug' } } })
      const around = h.boxes.containersOf(h.frame, 'turned')
      const drawnBox = (id: string) => {
        const box = h.boxes.boxIn(id)
        if (!box) throw new Error(`no ${id}`)
        return drawnFrom(box, h.boxes.containersOf(h.frame, h.session.design().nodes[id]?.parentId))
      }
      const row = h.boxes.boxIn('turned')
      const was = { t1: drawnBox('t1'), t2: drawnBox('t2') }
      const at = { x: was.t1.x + 25, y: was.t1.y + 25 }
      const step = { x: 400, y: 450 }
      const drag = h.reorder.press(h.frame, around, at, ['t1', 't2'])
      if (!drag) throw new Error('no drag')
      h.reorder.drag(drag, localTo({ x: at.x + step.x, y: at.y + step.y }, around), false)
      expect(drag).toMatchObject({ outside: true, drop: null })
      h.reorder.release(drag)
      for (const id of ['t1', 't2'] as const) {
        expect(h.session.design().nodes[id]?.parentId).toBe('sq')
        const now = drawnBox(id)
        expect(now.x).toBeCloseTo(was[id].x + step.x)
        expect(now.y).toBeCloseTo(was[id].y + step.y)
        expect(now.rotation).toBe(was[id].rotation)
      }
      expect(h.boxes.boxIn('turned')).toEqual(row)
    })

    it('writes nothing for a drag that stayed a click, or a drop where they were', () => {
      const { reorder, session, frame } = harness()
      const click = reorder.press(frame, [], { x: 125, y: 125 }, ['one'])
      if (!click) throw new Error('no drag')
      reorder.release(click)
      const back = reorder.press(frame, [], { x: 125, y: 125 }, ['one'])
      if (!back) throw new Error('no drag')
      reorder.drag(back, { x: 110, y: 125 }, false)
      reorder.release(back)
      expect(session.canUndo()).toBe(false)
    })
  })

  describe('nudge', () => {
    it('moves layers one place along the flow, as one undo step', () => {
      const { reorder, session, order } = harness()
      reorder.nudge(['one'], 1, 0, session.design())
      expect(order()).toEqual(['two', 'one', 'three'])
      reorder.nudge(['one'], -1, 0, session.design())
      expect(order()).toEqual(['one', 'two', 'three'])
    })

    it('says why it does nothing: across the flow auto layout decides, and past its end there is no place', () => {
      const { reorder, session, log, order } = harness()
      reorder.nudge(['one'], 0, 1, session.design())
      reorder.nudge(['one'], -1, 0, session.design())
      reorder.nudge(['three'], 1, 0, session.design())
      expect(log).toEqual(['placedByLayout', 'flowEnd', 'flowEnd'])
      expect(order()).toEqual(['one', 'two', 'three'])
    })

    it('moves nothing while a selected layer is locked in place, and says why', () => {
      const { reorder, session, log, order } = harness()
      session.run('node.lock', { ids: ['two'], lock: { move: true } })
      session.run('node.update', { ids: ['free'], patch: { visible: false } })
      const undoable = session.canUndo()
      for (const ids of [['two'], ['two', 'three'], ['one', 'two'], ['one', 'two', 'free']])
        expect(reorder.nudge(ids, -1, 0, session.design()), ids.join()).toBe(true)
      expect(order()).toEqual(['one', 'two', 'three'])
      expect(session.canUndo()).toBe(undoable)
      expect(log).toEqual(Array(4).fill('refused locked'))
    })

    it('leaves hidden layers out, which hold no place in the flow, and moves the others along it', () => {
      const { reorder, session, log, order } = harness()
      session.run('node.update', { ids: ['two', 'free'], patch: { visible: false } })
      reorder.nudge(['one', 'two'], 1, 0, session.design())
      expect(order()).toEqual(['two', 'three', 'one'])
      reorder.nudge(['one', 'free'], -1, 0, session.design())
      expect(order()).toEqual(['two', 'one', 'three'])
      expect(session.design().nodes.two?.props).toMatchObject({ x: 0, y: 0 })
      expect(session.design().nodes.free?.props).toMatchObject(FREE)
      expect(log).toEqual([])
    })

    it('leaves out a hidden layer locked in place too, which holds no place in the flow, and moves the others', () => {
      const { reorder, session, log, order } = harness()
      session.run('node.update', { ids: ['two'], patch: { visible: false } })
      session.run('node.lock', { ids: ['two'], lock: { move: true } })
      reorder.nudge(['one', 'two'], 1, 0, session.design())
      expect(order()).toEqual(['two', 'three', 'one'])
      expect(log).toEqual([])
    })

    it('in a grid, moves a layer one place with Left and Right, and a row of places with Up and Down', () => {
      const { reorder, session, log, order } = gridHarness()
      reorder.nudge(['one'], 0, 1, session.design())
      expect(order()).toEqual(['two', 'three', 'one'])
      reorder.nudge(['one'], 0, -10, session.design())
      expect(order()).toEqual(['one', 'two', 'three'])
      reorder.nudge(['one'], 1, 0, session.design())
      expect(order()).toEqual(['two', 'one', 'three'])
      reorder.nudge(['one'], 0, 1, session.design())
      reorder.nudge(['two'], 0, -1, session.design())
      expect(log).toEqual(['flowEnd', 'flowEnd'])
      expect(order()).toEqual(['two', 'one', 'three'])
    })

    it('steps over hidden layers, which no flow places', () => {
      const { reorder, session, log, order } = harness()
      session.run('node.update', { ids: ['row'], patch: { layout: { direction: 'grid', columns: 1 } } })
      session.run('node.update', { ids: ['two'], patch: { visible: false } })
      reorder.nudge(['three'], 0, -1, session.design())
      expect(order()).toEqual(['three', 'one', 'two'])
      reorder.nudge(['three'], 0, -1, session.design())
      expect(log).toEqual(['flowEnd'])
    })

    it('names the layout of the flow that places the layers, a loose layer or a locked one elsewhere selected too', () => {
      const h = harness()
      addBox(h, 'grid', 'sq', { x: 600, y: 100, layout: { direction: 'grid', columns: 2 } }, ['g1', 'g2', 'g3'])
      addBox(h, 'col', 'sq', { x: 100, y: 400, layout: { direction: 'column' } }, ['c1', 'c2'])
      const nudge = (ids: string[], dx: number, dy: number) => h.reorder.nudge(ids, dx, dy, h.session.design())
      nudge(['g3'], 1, 0)
      nudge(['free', 'one'], 1, 0)
      h.session.run('node.lock', { ids: ['one'], lock: { move: true } })
      nudge(['g3'], 1, 0)
      nudge(['free', 'one'], 1, 0)
      nudge(['c1'], 0, -1)
      expect(h.told).toEqual([
        ['flowEnd', { layout: 'grid' }],
        ['placedByLayout', { layout: 'row' }],
        ['flowEnd', { layout: 'grid' }],
        ['refused', { why: 'locked' }],
        ['flowEnd', { layout: 'column' }],
      ])
    })
  })
})
