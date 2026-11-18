import { describe, expect, it } from 'vitest'

import { type Frame, pageFrames } from '../../canvas/frames.ts'
import { pairsIn } from '../../selection.ts'
import { harness, lineProps } from './test-transform-drag.ts'
import { carried, type TransformDrag } from './transform-drag.ts'

describe('editorTransformDrag', () => {
  describe('snapWork', () => {
    it('starts at nothing', () => {
      const { drag } = harness()
      expect(drag.snapWork()).toEqual({ gathered: 0, moves: 0, targets: 0 })
    })
  })

  describe('shown', () => {
    it('shows nothing until a drag snaps', () => {
      const { drag, frame } = harness()
      expect(drag.shown()).toBeNull()
      const move = drag.pressMove(frame, [], { x: 150, y: 150 }, ['a'])
      drag.drag(move, { x: 200, y: 150 }, false, false, false)
      expect(drag.shown()).toBeNull()
    })

    it('shows the snap lines a move snapped to, in its frame, until the snap lines are let go', () => {
      const { drag, frame } = harness()
      const move = drag.pressMove(frame, [], { x: 150, y: 150 }, ['a'])
      // The right edge lands on b's left edge, 3 pixels away.
      drag.drag(move, { x: 347, y: 150 }, false, false, true)
      const shown = drag.shown()
      expect(shown?.frame).toBe(frame)
      expect(shown?.snapLines.map((line) => [line.axis, line.at])).toContainEqual(['x', 400])
      drag.clearSnapLines()
      expect(drag.shown()).toBeNull()
    })
  })

  describe('handleUnder', () => {
    it('finds the handle under a point, the zone outside a corner that turns, or nothing', () => {
      const { drag, selection, frame } = harness()
      expect(drag.handleUnder({ x: 200, y: 200 })).toBeNull()
      selection.select(['a'], frame.id)
      expect(drag.handleUnder({ x: 202, y: 198 })).toMatchObject({ kind: 'resize', handle: 'se' })
      expect(drag.handleUnder({ x: 150, y: 100 })).toMatchObject({ kind: 'resize', handle: 'n' })
      expect(drag.handleUnder({ x: 120, y: 103 })).toMatchObject({ kind: 'resize', handle: 'n' })
      expect(drag.handleUnder({ x: 210, y: 210 })).toEqual({ kind: 'rotate', angle: 45 })
      expect(drag.handleUnder({ x: 215, y: 215 })).toBeNull()
      expect(drag.handleUnder({ x: 150, y: 150 })).toBeNull()
      expect(drag.handleUnder({ x: 300, y: 300 })).toBeNull()
    })

    it('reaches TOUCH_REACH from a corner for a finger', () => {
      const { drag, selection, frame } = harness()
      selection.select(['a'], frame.id)
      expect(drag.handleUnder({ x: 215, y: 200 }, true)).toMatchObject({ kind: 'resize', handle: 'se' })
      expect(drag.handleUnder({ x: 215, y: 200 })?.kind).toBe('rotate')
    })

    it("finds one line's two ends", () => {
      const { drag, selection, frame } = harness()
      selection.select(['line'], frame.id)
      expect(drag.handleUnder({ x: 101, y: 900 })).toMatchObject({ kind: 'end', end: 'w' })
      expect(drag.handleUnder({ x: 300, y: 902 })).toMatchObject({ kind: 'end', end: 'e' })
      expect(drag.handleUnder({ x: 200, y: 900 })).toBeNull()
    })

    it("leaves a press on a thick line's paint near its end to the line, and turns it past the pick's reach", () => {
      const { drag, selection, frame, session } = harness()
      const paint = { type: 'solid' as const, color: '#000000FF' }
      session.run('node.update', { ids: ['line'], patch: { strokes: [{ paint, width: 12 }] } })
      selection.select(['line'], frame.id)
      // 12 px in from its start at (100, 900): half its stroke and LINE_REACH more is 10 px.
      for (const off of [3, 5, 6, 9]) expect(drag.handleUnder({ x: 112, y: 900 + off }), `${off}`).toBeNull()
      expect(drag.handleUnder({ x: 112, y: 900 + 11 })?.kind).toBe('rotate')
    })

    it('finds a flat selection resized from its two ends and nothing along it: a line with its copy, lines in a row, a flat path', () => {
      const { drag, session, selection, frame } = harness()
      const wide = pageFrames(session.design(), 'p1').frames[1] as Frame
      const add = (id: string, props: Record<string, unknown>) =>
        session.run('node.create', { id, parentId: frame.id, layer: { type: 'graphic', name: id, props } })
      add('next', lineProps(350, 900, 100))
      add('flat', { x: 550, y: 1000, width: 200, height: 0, shape: { kind: 'path', d: 'M0 0L200 0' } })
      const selections = [
        { picks: [...pairsIn(frame.id, ['line']), ...pairsIn(wide.id, ['wide-line'])], from: 100, to: 300, y: 900 },
        { picks: pairsIn(frame.id, ['line', 'next']), from: 100, to: 450, y: 900 },
        { picks: pairsIn(frame.id, ['flat']), from: 550, to: 750, y: 1000 },
      ]
      for (const { picks, from, to, y } of selections) {
        selection.selectAcross(picks)
        const name = picks.map((p) => p.id).join(' ')
        for (const x of [from + 10, (from + to) / 2, to - 10])
          for (const dy of [-2, 0, 2]) expect(drag.handleUnder({ x, y: y + dy }), `${name} at ${x}`).toBeNull()
        expect(drag.handleUnder({ x: from - 2, y }), name).toMatchObject({ kind: 'resize', handle: 'w' })
        expect(drag.handleUnder({ x: to + 2, y: y + 1 }), name).toMatchObject({ kind: 'resize', handle: 'e' })
      }
    })

    it('finds the resize handles across frames, but no zone that turns, as a turn would leave the other copies', () => {
      const { drag, session, selection, frame } = harness()
      const wide = pageFrames(session.design(), 'p1').frames[1] as Frame
      selection.selectAcross([
        { id: 'a', frameId: frame.id },
        { id: 'wide-a', frameId: wide.id },
      ])
      expect(drag.handleUnder({ x: 202, y: 198 })).toMatchObject({ kind: 'resize', handle: 'se' })
      expect(drag.handleUnder({ x: 215, y: 215 })).toBeNull()
    })

    it('finds none on a selection locked in place', () => {
      const { drag, selection, frame } = harness()
      selection.select(['pin'], frame.id)
      expect(drag.handleUnder({ x: 750, y: 750 })).toBeNull()
    })
  })

  describe('pressHandle and rotate', () => {
    it('turns the layer about its centre from outside a corner, in 15° steps with Shift, as one undo step', () => {
      const { drag, session, selection, frame, boxOf, pressSelection } = harness()
      selection.select(['a'], frame.id)
      const rotate = pressSelection({ x: 210, y: 210 })
      expect(rotate).toMatchObject({ kind: 'rotate', roots: ['a'] })
      // From the bottom right corner to straight below the centre: an eighth of a turn.
      drag.drag(rotate, { x: 150, y: 220 }, false, false, false)
      expect(boxOf('a').rotation).toBe(45)
      drag.drag(rotate, { x: 160, y: 220 }, true, false, false)
      expect(boxOf('a').rotation % 15).toBe(0)
      drag.release(rotate)
      expect(session.undoName()).toBe('rotate')
    })
  })

  describe('pressHandle and resize on a turned layer', () => {
    it('sizes a layer turned 30° along its own side from its east handle, its west middle, turn and height kept, and a move keeps the turn', () => {
      const { drag, session, selection, frame, boxOf, pressSelection } = harness()
      session.run('node.update', { ids: ['a'], patch: { rotation: 30 } })
      selection.select(['a'], frame.id)
      const [cos, sin] = [Math.cos(Math.PI / 6), Math.sin(Math.PI / 6)]
      // The middles of its west and east sides, turned about its centre (150, 150).
      const west = (b: { x: number; y: number; width: number; height: number }) => ({
        x: b.x + b.width / 2 - (b.width / 2) * cos,
        y: b.y + b.height / 2 - (b.width / 2) * sin,
      })
      const was = west(boxOf('a'))
      const east = { x: 150 + 50 * cos, y: 150 + 50 * sin }
      const resize = pressSelection(east)
      expect(resize).toMatchObject({ kind: 'resize', handle: 'e' })
      drag.drag(resize, { x: east.x + 100 * cos, y: east.y + 100 * sin }, false, false, false)
      drag.release(resize)
      expect(boxOf('a')).toMatchObject({ rotation: 30, height: 100 })
      expect(boxOf('a').width).toBeCloseTo(200, 1)
      expect(west(boxOf('a')).x).toBeCloseTo(was.x, 1)
      expect(west(boxOf('a')).y).toBeCloseTo(was.y, 1)
      const move = drag.pressMove(frame, [], { x: 200, y: 180 }, ['a'])
      drag.drag(move, { x: 180, y: 160 }, false, false, false)
      expect(boxOf('a').rotation).toBe(30)
    })
  })

  describe('release', () => {
    it('leaves nothing to undo after a press that never dragged: a move, a resize, a turn and a line end', () => {
      const { drag, session, selection, frame, boxOf, pressSelection } = harness()
      drag.release(drag.pressMove(frame, [], { x: 150, y: 150 }, ['a']))
      selection.select(['a'], frame.id)
      for (const at of [
        { x: 200, y: 150 },
        { x: 210, y: 210 },
      ])
        drag.release(pressSelection(at))
      selection.select(['line'], frame.id)
      drag.release(pressSelection({ x: 300, y: 900 }))
      expect([boxOf('a'), boxOf('line')]).toMatchObject([
        { x: 100, y: 100, width: 100, height: 100, rotation: 0 },
        { x: 100, y: 900, width: 200, rotation: 0 },
      ])
      expect([session.inGesture(), session.canUndo()]).toEqual([false, false])
    })
  })

  describe('writeBoxes', () => {
    it('writes only what changed from the start, and a change put back', () => {
      const { drag, session, frame, boxes } = harness()
      const start = boxes.startBoxes(frame, ['a'])
      const was = start.get('a')
      if (!was) throw new Error('no box')
      drag.writeBoxes(frame, start, new Map([['a', { ...was, x: 120 }]]))
      expect(session.design().nodes.a?.props).toMatchObject({ x: 120, y: 100 })
      drag.writeBoxes(frame, start, new Map([['a', { ...was, y: 130 }]]))
      expect(session.design().nodes.a?.props).toMatchObject({ x: 100, y: 130 })
    })
  })

  describe('marquee', () => {
    it('selects the layers it touches that can be picked, with those selected before', () => {
      const { drag, selection, frame } = harness()
      drag.marquee({ kind: 'marquee', from: { x: 50, y: 50 }, to: { x: 450, y: 150 }, base: [] })
      expect(selection.current()).toEqual(pairsIn(frame.id, ['a', 'b']))
      drag.marquee({
        kind: 'marquee',
        from: { x: 650, y: 650 },
        to: { x: 800, y: 800 },
        base: pairsIn(frame.id, ['b']),
      })
      expect(selection.current()).toEqual(pairsIn(frame.id, ['b']))
      drag.marquee({ kind: 'marquee', from: { x: 650, y: 650 }, to: { x: 800, y: 800 }, base: [] })
      expect(selection.current()).toBeNull()
    })

    it('takes out the layers selected before that it touches, and adds the ones that were not', () => {
      const { drag, selection, frame } = harness()
      const around = (base: string[], from: { x: number; y: number }, to: { x: number; y: number }) => {
        drag.marquee({ kind: 'marquee', from, to, base: pairsIn(frame.id, base) })
        return selection.current()
      }
      // Over selected layers only: each comes out, and none left selects nothing.
      expect(around(['a', 'b'], { x: 50, y: 50 }, { x: 250, y: 150 })).toEqual(pairsIn(frame.id, ['b']))
      expect(around(['a', 'b'], { x: 50, y: 50 }, { x: 450, y: 150 })).toBeNull()
      // Over unselected layers only: each goes in.
      expect(around(['a'], { x: 350, y: 50 }, { x: 450, y: 150 })).toEqual(pairsIn(frame.id, ['a', 'b']))
      // Over both: the selected one comes out and the other goes in.
      expect(around(['a'], { x: 50, y: 50 }, { x: 450, y: 150 })).toEqual(pairsIn(frame.id, ['b']))
    })

    it('selects a group whole when it touches one of its layers, and a move of the group carries its layers', () => {
      const { drag, session, selection, frame, boxOf } = harness()
      for (const [id, x] of [
        ['left', 800],
        ['right', 910],
      ] as const)
        session.run('node.create', {
          id,
          parentId: frame.id,
          layer: { type: 'graphic', name: id, props: { x, y: 300, width: 90, height: 100, shape: { kind: 'rect' } } },
        })
      session.run('node.group', { ids: ['left', 'right'], id: 'pair', name: 'Pair' })
      drag.marquee({ kind: 'marquee', from: { x: 780, y: 280 }, to: { x: 820, y: 320 }, base: [] })
      expect(selection.current()).toEqual(pairsIn(frame.id, ['pair']))
      const move = drag.pressMove(frame, [], { x: 850, y: 350 }, ['pair'])
      drag.drag(move, { x: 890, y: 310 }, false, false, false)
      expect([boxOf('pair'), boxOf('left'), boxOf('right')]).toMatchObject([
        { x: 840, y: 260, width: 200 },
        { x: 840, y: 260 },
        { x: 950, y: 260 },
      ])
    })

    it('drops the selection when it is in another frame than the one the marquee covers', () => {
      const { drag, selection, frame } = harness()
      drag.marquee({
        kind: 'marquee',
        from: { x: 50, y: 50 },
        to: { x: 250, y: 150 },
        base: pairsIn('wide', ['wide-a']),
      })
      expect(selection.current()).toEqual(pairsIn(frame.id, ['a']))
    })
  })
})

describe('carried', () => {
  it('is the frame and the layers a move, resize or turn carries, and nothing for any other gesture', () => {
    const frame = { id: 'sq' } as Frame
    for (const kind of ['move', 'resize', 'rotate'])
      expect(carried({ kind, frame, roots: ['a', 'b'] } as unknown as TransformDrag)).toEqual({
        frame,
        roots: ['a', 'b'],
      })
    expect(carried({ kind: 'marquee' })).toBeNull()
    expect(carried(null)).toBeNull()
  })
})
