import { describe, expect, it } from 'vitest'

import { type Frame, pageFrames } from '../../canvas/frames.ts'
import { idsOf, pairsIn } from '../../selection.ts'
import { harness } from './test-transform-drag.ts'

describe('editorMoveDrag', () => {
  describe('pressMove and move', () => {
    it('moves the layers by whole pixels as one undo step called move, gathering what they snap to once', () => {
      const { drag, session, log, frame, boxOf } = harness()
      const move = drag.pressMove(frame, [], { x: 150, y: 150 }, ['a'])
      expect(session.inGesture()).toBe(true)
      expect(drag.snapWork()).toMatchObject({ gathered: 1, moves: 0 })
      drag.drag(move, { x: 160.4, y: 170.6 }, false, false, false)
      expect(boxOf('a')).toMatchObject({ x: 110, y: 121 })
      expect(drag.snapWork().moves).toBe(0)
      drag.drag(move, { x: 170, y: 190 }, false, false, false)
      drag.release(move)
      expect(log).toEqual(['hug a'])
      expect(session.inGesture()).toBe(false)
      expect(session.undoName()).toBe('move')
      session.undo()
      expect(boxOf('a')).toMatchObject({ x: 100, y: 100 })
    })

    it('drops the layers into the flow of a laid-out box under the pointer where the line shows, as one undo step', () => {
      const { drag, session, frame, log } = harness()
      const move = drag.pressMove(frame, [], { x: 150, y: 150 }, ['a'])
      drag.drag(move, { x: 300, y: 300 }, false, false, false)
      expect(move.drop).toBeNull()
      drag.drag(move, { x: 300, y: 550 }, false, false, false)
      expect(move.drop).toMatchObject({ boxId: 'row', slot: 1, near: { id: 'c', after: true } })
      drag.release(move)
      expect(session.design().nodes.a?.parentId).toBe('row')
      expect(log).toEqual(['hug a'])
      session.undo()
      expect(session.design().nodes.a).toMatchObject({ parentId: 'sq', props: { x: 100, y: 100 } })
    })

    it('moves the layer in its frame, leaving its copy in the other frame be', () => {
      const { drag, frame, boxOf, copies } = harness()
      const before = copies()
      const move = drag.pressMove(frame, [], { x: 150, y: 150 }, ['a'])
      drag.drag(move, { x: 160, y: 150 }, false, false, false)
      expect(boxOf('a')).toMatchObject({ x: 110, y: 100 })
      expect(copies()).toEqual(before)
    })

    it('moves a layer released with the pointer over the other frame into it, kept where it is drawn on the page, as one undo step called move', () => {
      const { drag, session, frame, copies } = harness()
      const was = JSON.stringify(session.design())
      const before = copies()
      const move = drag.pressMove(frame, [], { x: 150, y: 150 }, ['a'])
      // 1400 across the square is over the wide frame, which starts 1280 across the page.
      drag.drag(move, { x: 1400, y: 150 }, false, false, false)
      expect(move.target?.id).toBe('wide')
      expect(move.drop).toBeNull()
      drag.release(move)
      const a = session.design().nodes.a
      expect(a?.parentId).toBe('wide')
      expect(a?.props).toMatchObject({ x: 1350 - 1280, y: 100 })
      // The wide frame holds a copy of it already: it takes a new link id there.
      expect(a?.link).not.toBe('a')
      expect(copies()).toEqual(before)
      expect(session.undoName()).toBe('move')
      session.undo()
      expect(JSON.stringify(session.design())).toBe(was)
    })

    it('keeps a layer released with the pointer over no frame in its own, drawn past its edge', () => {
      const { drag, session, frame } = harness()
      const move = drag.pressMove(frame, [], { x: 150, y: 150 }, ['a'])
      // 1180 across is between the square, which ends at 1080, and the wide frame.
      drag.drag(move, { x: 1180, y: 150 }, false, false, false)
      expect(move.target).toBeNull()
      drag.release(move)
      expect(session.design().nodes.a).toMatchObject({ parentId: 'sq', props: { x: 1130, y: 100 } })
    })

    it('keeps layers that can’t leave their frame in it: one locked in place, a selection across frames, or a mix', () => {
      const cases = [
        { ids: ['pin'], others: false },
        { ids: ['a'], others: true },
        { ids: ['a', 'pin'], others: false },
      ]
      for (const { ids, others } of cases) {
        const { drag, session, frame } = harness()
        const wide = pageFrames(session.design(), 'p1').frames[1] as Frame
        const across = others ? [{ frame: wide, around: [], ids: ['wide-a'] }] : []
        const move = drag.pressMove(frame, [], { x: 150, y: 150 }, ids, across)
        drag.drag(move, { x: 1400, y: 150 }, false, false, false)
        expect(move.target, ids.join()).toBeNull()
        drag.release(move)
        for (const id of ids) expect(session.design().nodes[id]?.parentId, id).toBe('sq')
      }
    })

    it('carries and judges only the layers no flow places: a free one leaves with a flow’s layer selected too, which stays', () => {
      const { drag, session, frame } = harness()
      const move = drag.pressMove(frame, [], { x: 150, y: 150 }, ['a', 'c'])
      drag.drag(move, { x: 1400, y: 150 }, false, false, false)
      expect(move.target?.id).toBe('wide')
      drag.release(move)
      expect(session.design().nodes.a?.parentId).toBe('wide')
      expect(session.design().nodes.c?.parentId).toBe('row')
    })

    it('moves the selected copies of other frames by the same amount, in the same undo step', () => {
      const { drag, session, log, frame, boxOf } = harness()
      const wide = pageFrames(session.design(), 'p1').frames[1] as Frame
      const move = drag.pressMove(frame, [], { x: 150, y: 150 }, ['a'], [{ frame: wide, around: [], ids: ['wide-a'] }])
      drag.drag(move, { x: 160.4, y: 170.6 }, false, false, false)
      expect(boxOf('wide-a')).toMatchObject({ x: 110, y: 121 })
      drag.drag(move, { x: 130, y: 190 }, true, false, false)
      expect(boxOf('a')).toMatchObject({ x: 100, y: 140 })
      expect(boxOf('wide-a')).toMatchObject({ x: 100, y: 140 })
      drag.release(move)
      expect(log).toEqual(['hug a,wide-a'])
      session.undo()
      expect([boxOf('a'), boxOf('wide-a')]).toMatchObject([
        { x: 100, y: 100 },
        { x: 100, y: 100 },
      ])
    })

    it('moves a copy inside a turned container across its frame as the dragged layer goes across its own', () => {
      const { drag, session, frame, boxOf } = harness()
      const wide = pageFrames(session.design(), 'p1').frames[1] as Frame
      const turned = { x: 0, y: 0, width: 400, height: 400, rotation: 90 }
      const move = drag.pressMove(
        frame,
        [],
        { x: 150, y: 150 },
        ['a'],
        [{ frame: wide, around: [turned], ids: ['wide-a'] }],
      )
      drag.drag(move, { x: 160, y: 150 }, false, false, false)
      // Ten pixels right across the frame is ten up inside a container turned a quarter clockwise.
      expect(boxOf('wide-a')).toMatchObject({ x: 100, y: 90 })
    })

    it('keeps a move to one axis with Shift', () => {
      const { drag, frame, boxOf } = harness()
      const move = drag.pressMove(frame, [], { x: 150, y: 150 }, ['a'])
      drag.drag(move, { x: 180, y: 160 }, true, false, false)
      expect(boxOf('a')).toMatchObject({ x: 130, y: 100 })
    })

    it('snaps to the layers beside it, counting each move that snaps', () => {
      const { drag, frame, boxOf } = harness()
      const move = drag.pressMove(frame, [], { x: 150, y: 150 }, ['a'])
      const { targets } = drag.snapWork()
      // The frame's other top-level layers (b, pin, row, words, line) and the frame itself.
      expect(targets).toBe(6)
      drag.drag(move, { x: 347, y: 150 }, false, false, true)
      // The right edge lands on b's left edge, 3 pixels away.
      expect(boxOf('a')).toMatchObject({ x: 300 })
      drag.drag(move, { x: 348, y: 150 }, false, false, true)
      expect(drag.snapWork()).toEqual({ gathered: 1, moves: 2, targets })
    })

    it('snaps nothing while the layers would drop into a flow, which places them, so no snap line covers its line', () => {
      const { drag, frame, boxOf } = harness()
      const move = drag.pressMove(frame, [], { x: 150, y: 150 }, ['a'])
      // 3 pixels below the row's top edge, which a move off the row would snap to.
      drag.drag(move, { x: 303, y: 553 }, false, false, true)
      expect(move.drop).toMatchObject({ boxId: 'row' })
      expect(boxOf('a')).toMatchObject({ x: 253, y: 503 })
      expect(drag.snapWork().moves).toBe(0)
      drag.drag(move, { x: 303, y: 453 }, false, false, true)
      expect(move.drop).toBeNull()
      expect(drag.snapWork().moves).toBe(1)
    })

    it('puts the layers back and drops nothing when its step is cancelled, as Escape cancels it, over a flow they would drop into', () => {
      const { drag, session, frame, boxOf } = harness()
      // An edit before the press, the undo step the cancel must leave on top.
      session.run('node.update', { ids: ['b'], patch: { x: 420 } })
      const before = JSON.stringify(session.design())
      const undoable = session.canUndo()
      const move = drag.pressMove(frame, [], { x: 150, y: 150 }, ['a'])
      drag.drag(move, { x: 300, y: 550 }, false, false, false)
      expect(move.drop).toMatchObject({ boxId: 'row' })
      expect(boxOf('a')).toMatchObject({ x: 250, y: 500 })
      move.step.cancel()
      expect(JSON.stringify(session.design())).toBe(before)
      expect(session.design().nodes.a?.parentId).toBe('sq')
      expect(session.inGesture()).toBe(false)
      expect(session.canUndo()).toBe(undoable)
      expect(session.undoName()).toBe('edit')
    })

    it('leaves layers in a flow among others where they are, and says auto layout places them', () => {
      const { drag, log, frame } = harness()
      const move = drag.pressMove(frame, [], { x: 150, y: 150 }, ['a', 'c'])
      expect(move.roots).toEqual(['a'])
      expect(log).toEqual(['placedByLayout'])
    })
  })

  describe('Alt: copies', () => {
    /** The harness with `a` selected and pressed on, a deep copy of the design then, and the layers made since. */
    function pressed(ids = ['a']) {
      const h = harness()
      h.selection.select(ids, h.frame.id)
      const before = JSON.parse(JSON.stringify(h.session.design())) as object
      const made = () =>
        Object.keys(h.session.design().nodes).filter((id) => !(id in (before as { nodes: object }).nodes))
      const move = h.drag.pressMove(h.frame, [], { x: 150, y: 150 }, ids)
      return { ...h, before, made, move }
    }

    it('with Alt, leaves the layers where they were and moves copies of them, selected, as one undo step called duplicate', () => {
      const { drag, session, selection, boxOf, before, made, move } = pressed()
      drag.drag(move, { x: 450, y: 450 }, false, true, false)
      const [copy = ''] = made()
      expect(made()).toHaveLength(1)
      expect(boxOf('a')).toMatchObject({ x: 100, y: 100 })
      expect(boxOf(copy)).toMatchObject({ x: 400, y: 400 })
      expect(idsOf(selection.current())).toEqual([copy])
      drag.release(move)
      expect(session.undoName()).toBe('duplicate')
      session.undo()
      expect(session.design()).toEqual(before)
    })

    it('Alt let go turns it back into a move of the layers, with no copy left, the layers selected again', () => {
      const { drag, session, selection, boxOf, made, move } = pressed()
      drag.drag(move, { x: 300, y: 150 }, false, true, false)
      drag.drag(move, { x: 330, y: 150 }, false, false, false)
      expect(made()).toEqual([])
      expect(boxOf('a')).toMatchObject({ x: 280, y: 100 })
      expect(idsOf(selection.current())).toEqual(['a'])
      drag.release(move)
      expect(session.undoName()).toBe('move')
    })

    it('setAlt runs the last move again with copies or without, and does nothing before the first move', () => {
      const { drag, session, selection, boxOf, before, made, move } = pressed()
      drag.setAlt(move, true)
      expect(made()).toEqual([])
      expect(session.design()).toEqual(before)
      drag.drag(move, { x: 300, y: 150 }, false, false, false)
      drag.setAlt(move, true)
      const [copy = ''] = made()
      expect([boxOf('a'), boxOf(copy)]).toMatchObject([
        { x: 100, y: 100 },
        { x: 250, y: 100 },
      ])
      expect(idsOf(selection.current())).toEqual([copy])
      drag.setAlt(move, false)
      expect(made()).toEqual([])
      expect(boxOf('a')).toMatchObject({ x: 250, y: 100 })
      expect(idsOf(selection.current())).toEqual(['a'])
      drag.setAlt(move, true)
      drag.release(move)
      expect(made()).toHaveLength(1)
      expect(session.undoName()).toBe('duplicate')
      session.undo()
      expect(session.design()).toEqual(before)
      expect(session.canUndo()).toBe(false)
    })

    it('setAlt runs the last of the moves before it again, not the first', () => {
      const { drag, boxOf, made, move } = pressed()
      drag.drag(move, { x: 300, y: 150 }, false, false, false)
      drag.drag(move, { x: 350, y: 200 }, false, false, false)
      drag.setAlt(move, true)
      expect([boxOf('a'), boxOf(made()[0] ?? '')]).toMatchObject([
        { x: 100, y: 100 },
        { x: 300, y: 150 },
      ])
    })

    it('keeps Shift’s axis and the snap of the last move when Alt changes with the pointer still', () => {
      const { drag, boxOf, made, move } = pressed()
      // 103 right and 10 down, kept to the one axis: the right edge, 3 past the line's end, snaps onto it.
      drag.drag(move, { x: 253, y: 160 }, true, false, true)
      expect(boxOf('a')).toMatchObject({ x: 200, y: 100 })
      drag.setAlt(move, true)
      expect(boxOf('a')).toMatchObject({ x: 100, y: 100 })
      expect(boxOf(made()[0] ?? '')).toMatchObject({ x: 200, y: 100 })
    })

    it('snaps the copies to their originals', () => {
      const { drag, boxOf, made, move } = pressed()
      drag.drag(move, { x: 253, y: 153 }, false, true, true)
      expect(boxOf(made()[0] ?? '')).toMatchObject({ x: 200, y: 100 })
    })

    it('copies the selected layers of other frames in their own frames, moved alike, selecting every copy', () => {
      const { drag, session, selection, frame, boxOf, before, made } = pressed()
      const wide = pageFrames(session.design(), 'p1').frames[1] as Frame
      selection.selectAcross([...pairsIn(frame.id, ['a']), ...pairsIn(wide.id, ['wide-a'])])
      const move = drag.pressMove(frame, [], { x: 150, y: 150 }, ['a'], [{ frame: wide, around: [], ids: ['wide-a'] }])
      drag.drag(move, { x: 160, y: 170 }, false, true, false)
      const copies = made()
      expect(copies.map((id) => session.design().nodes[id]?.parentId).sort()).toEqual(['sq', 'wide'])
      expect(copies.map(boxOf)).toMatchObject([
        { x: 110, y: 120 },
        { x: 110, y: 120 },
      ])
      expect([boxOf('a'), boxOf('wide-a')]).toMatchObject([
        { x: 100, y: 100 },
        { x: 100, y: 100 },
      ])
      expect(selection.current()?.map((layer) => layer.frameId)).toEqual(['sq', 'wide'])
      drag.release(move)
      session.undo()
      expect(session.design()).toEqual(before)
    })

    it('copiesUnmoved: null while the copy of another frame is off its original, the pressed frame’s on its own', () => {
      const { drag, session, selection, frame, boxOf, made } = pressed()
      const wide = pageFrames(session.design(), 'p1').frames[1] as Frame
      selection.selectAcross([...pairsIn(frame.id, ['a']), ...pairsIn(wide.id, ['wide-a'])])
      const turned = { x: 0, y: 0, width: 400, height: 400, rotation: 45 }
      const move = drag.pressMove(
        frame,
        [],
        { x: 150, y: 150 },
        ['a'],
        [{ frame: wide, around: [turned], ids: ['wide-a'] }],
      )
      // Four tenths of a pixel right and down: the square's copy rounds back onto its original, and
      // the other's, inside a container turned 45°, goes over half a pixel along one of its axes.
      drag.drag(move, { x: 150.4, y: 150.4 }, false, true, false)
      const [copy = '', wideCopy = ''] = made()
      expect(session.design().nodes[wideCopy]?.parentId).toBe('wide')
      expect(boxOf(copy)).toMatchObject({ x: 100, y: 100 })
      expect(boxOf(wideCopy)).not.toMatchObject({ x: 100, y: 100 })
      expect(drag.copiesUnmoved(move)).toBeNull()
    })

    it('makes no copy for a move that carries no layer, and leaves the selection be', () => {
      const { drag, selection, made, move } = pressed(['c'])
      expect(move.roots).toEqual([])
      expect(drag.carries(move)).toBe(false)
      drag.drag(move, { x: 300, y: 300 }, false, true, false)
      expect(made()).toEqual([])
      expect(move.sources).toBeNull()
      expect(idsOf(selection.current())).toEqual(['c'])
    })

    it('copiesUnmoved: with the copies each where its original is, dropping into no flow, the selection when they were made; else null', () => {
      const { drag, selection, made, move } = pressed()
      const picked = selection.held()
      drag.drag(move, { x: 155, y: 150 }, false, true, true)
      expect(made()).toHaveLength(1)
      expect(drag.copiesUnmoved(move)).toEqual(picked)
      drag.drag(move, { x: 151, y: 150 }, false, true, false)
      expect(drag.copiesUnmoved(move)).toBeNull()
      drag.drag(move, { x: 150, y: 150 }, false, true, false)
      expect(drag.copiesUnmoved(move)).toEqual(picked)
      drag.drag(move, { x: 300, y: 550 }, false, true, false)
      expect(move.drop).not.toBeNull()
      expect(drag.copiesUnmoved(move)).toBeNull()
      drag.drag(move, { x: 150, y: 150 }, false, false, false)
      expect(drag.copiesUnmoved(move)).toBeNull()
    })
  })
})
