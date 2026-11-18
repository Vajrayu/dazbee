import { describe, expect, it } from 'vitest'

import type { Design, NonEmpty } from '@dazbee/schema'

import { idsOf, pairsIn } from '../selection.ts'
import { FLOW, harness } from '../test-actions.ts'
import { layOutWayOf } from './box-layout.ts'

const copy = (design: Design) => JSON.parse(JSON.stringify(design)) as Design
const layoutOf = (design: Design, id: string) => {
  const node = design.nodes[id]
  return node?.type === 'box' ? node.props.layout : undefined
}

describe('editorBoxLayout', () => {
  describe('setLayout', () => {
    it('keeps every drawn box, its own included, as a Fit box that grew since it was made goes Free', () => {
      const { session, selection, boxes, frame, boxLayout } = harness(false, FLOW)
      // The hugging row, laid out in the flow, grows round a bigger square, far past its stored 10 × 10.
      session.run('node.update', { ids: ['inHug'], patch: { width: 200, height: 100 } })
      for (const id of ['hugging', 'flow']) {
        const before = copy(session.design())
        selection.select([id], frame.id)
        expect(boxLayout.setLayout('free')).toBe('set')
        const after = session.design()
        expect(layoutOf(after, id)).toBeUndefined()
        expect(boxes.drawnAlike(frame.id, before, after)).toBe(true)
        expect(after.nodes[id]?.props.sizing).toEqual({ width: 'fixed', height: 'fixed' })
        session.undo()
        expect(layoutOf(session.design(), id)).toBeDefined()
        session.redo()
        expect(boxes.drawnAlike(frame.id, before, session.design())).toBe(true)
        session.undo()
      }
      expect(boxes.drawnBoxOf(frame, 'hugging')).toMatchObject({ width: 260, height: 160 })
    })

    it('lays out the selected boxes in every frame as one undo step, leaving other layers alone', () => {
      const { session, selection, frame, wide, boxLayout } = harness()
      session.run('node.box', { ids: ['a'], id: 'square-box' })
      session.run('node.box', { ids: ['wide-a'], id: 'wide-box' })
      selection.selectAcross([...pairsIn(frame.id, ['square-box', 'b']), ...pairsIn(wide.id, ['wide-box'])])
      const before = session.design()
      expect(boxLayout.setLayout('grid')).toBe('set')
      for (const id of ['square-box', 'wide-box']) expect(layoutOf(session.design(), id)?.direction).toBe('grid')
      expect(session.design().nodes.b).toBe(before.nodes.b)
      session.undo()
      expect(session.design()).toEqual(before)
    })

    it('does nothing without a box to change: none selected, or each has that layout already', () => {
      const { session, selection, frame, boxLayout } = harness()
      session.run('node.box', { ids: ['a'], id: 'free' })
      const undoable = session.canUndo()
      for (const [ids, layout] of [
        [['b'], 'row'],
        [['free'], 'free'],
        [['row'], 'row'],
        [['row'], 'auto'],
      ] as const) {
        selection.select([...ids], frame.id)
        expect(boxLayout.setLayout(layout), `${ids.join()} to ${layout}`).toBe('none')
      }
      expect(session.canUndo()).toBe(undoable)
    })

    it('leaves a locked box as it is, saying so when every box it would change is locked', () => {
      const { session, selection, frame, boxLayout } = harness()
      session.run('node.box', { ids: ['a'], id: 'free' })
      session.run('node.lock', { ids: ['row'], lock: { style: true } })
      selection.select(['row', 'free'], frame.id)
      const before = session.design()
      const undoable = session.canUndo()
      // The Free box has no layout to take off, so only the locked one would change.
      expect(boxLayout.setLayout('free')).toBe('locked')
      expect(session.design()).toEqual(before)
      expect(session.canUndo()).toBe(undoable)
      // Laid out as a column, the Free box changes and the locked row stays a row.
      expect(boxLayout.setLayout('column')).toBe('set')
      expect(layoutOf(session.design(), 'free')?.direction).toBe('column')
      expect(layoutOf(session.design(), 'row')?.direction).toBe('row')
    })
  })
  describe('layOutInPlace and wrapInLayout', () => {
    const text = {
      text: 'Hello',
      boxMode: 'fixed',
      style: { fontFamily: 'Noto Sans', fontSize: 20, color: '#000000FF' },
    }
    const sizingOf = (design: Design, id: string) => design.nodes[id]?.props.sizing

    it('lays one Free box out itself, no box made and the box kept where it starts, its row read off its layers, at Fit both ways', () => {
      const { session, boxLayout } = harness()
      session.run('node.box', { ids: ['a', 'c'], id: 'free' })
      const before = Object.keys(session.design().nodes).length
      boxLayout.layOutInPlace('free')
      const after = session.design()
      expect(layoutOf(after, 'free')?.direction).toBe('row')
      expect(sizingOf(after, 'free')).toEqual({ width: 'hug', height: 'hug' })
      expect(Object.keys(after.nodes)).toHaveLength(before)
      expect(after.nodes.a?.parentId).toBe('free')
      expect(after.nodes.free?.props).toMatchObject({ x: 100, y: 100 })
    })

    it('wraps two Free boxes together in one new box laid out round them, the boxes left Free', () => {
      const { session, boxLayout } = harness()
      session.run('node.box', { ids: ['a'], id: 'left' })
      session.run('node.box', { ids: ['c'], id: 'right' })
      const made = boxLayout.wrapInLayout(['left', 'right'])
      const after = session.design()
      expect(after.nodes[made]?.name).toBe('Boîte')
      expect(layoutOf(after, made)?.direction).toBe('row')
      expect(sizingOf(after, made)).toEqual({ width: 'hug', height: 'hug' })
      for (const id of ['left', 'right']) {
        expect(after.nodes[id]?.parentId).toBe(made)
        expect(layoutOf(after, id)).toBeUndefined()
      }
    })

    it('wraps two laid-out boxes together, each keeping its layout', () => {
      const { session, boxLayout } = harness(false, FLOW)
      const made = boxLayout.wrapInLayout(['row', 'flow'])
      const after = session.design()
      expect(layoutOf(after, made)?.direction).toBe('column')
      for (const id of ['row', 'flow']) {
        expect(after.nodes[id]?.parentId).toBe(made)
        expect(layoutOf(after, id)?.direction).toBe('row')
      }
    })

    it('wraps a box and a text together', () => {
      const { session, boxLayout } = harness()
      session.run('node.box', { ids: ['a'], id: 'free' })
      session.run('node.create', {
        id: 'words',
        parentId: 'sq',
        layer: { type: 'text', name: 'Words', props: { x: 300, y: 100, width: 200, height: 40, ...text } },
      })
      const made = boxLayout.wrapInLayout(['free', 'words'])
      const after = session.design()
      expect(layoutOf(after, made)?.direction).toBe('row')
      expect(after.nodes.free?.parentId).toBe(made)
      expect(after.nodes.words?.parentId).toBe(made)
      expect(layoutOf(after, 'free')).toBeUndefined()
    })
  })
  describe('layOutWayOf', () => {
    it('lays one Free box alone out in place, and wraps anything else', () => {
      const { session } = harness()
      session.run('node.box', { ids: ['a'], id: 'free' })
      const now = session.design()
      const cases: [NonEmpty<string>, string][] = [
        [['free'], 'inPlace'],
        [['free', 'c'], 'wrap'],
        [['row'], 'wrap'],
        [['c'], 'wrap'],
      ]
      for (const [ids, way] of cases) expect(layOutWayOf(now, ids), ids.join()).toBe(way)
    })

    it('says a Free box alone locked against style changes is locked; a lock against moving alone keeps it in place', () => {
      const { session } = harness()
      session.run('node.box', { ids: ['a'], id: 'free' })
      session.run('node.lock', { ids: ['free'], lock: { move: true } })
      expect(layOutWayOf(session.design(), ['free'])).toBe('inPlace')
      session.run('node.lock', { ids: ['free'], lock: { style: true } })
      expect(layOutWayOf(session.design(), ['free'])).toBe('locked')
      expect(layOutWayOf(session.design(), ['free', 'c'])).toBe('wrap')
    })
  })
  describe('the layout keys', () => {
    it('goes back to Free with Alt+Shift+A, every layer, and the box, kept where and as big as they are drawn', () => {
      const { actions, session, selection, boxes, frame } = harness(false, FLOW)
      // A group the flow places away from where it is stored, and the box in the flow fitting its square.
      session.run('node.group', { ids: ['a', 'b'], id: 'pair', name: 'Pair' })
      session.run('node.move', { id: 'pair', parentId: 'flow' })
      for (const id of ['hugging', 'flow']) {
        const before = JSON.parse(JSON.stringify(session.design())) as Design
        selection.select([id], frame.id)
        expect(actions.perform('layoutFree')).toBe(true)
        expect(session.design().nodes[id]?.props).not.toHaveProperty('layout')
        expect(boxes.drawnAlike(frame.id, before, session.design())).toBe(true)
        session.undo()
        expect(session.design().nodes[id]?.props).toHaveProperty('layout')
        session.redo()
        expect(boxes.drawnAlike(frame.id, before, session.design())).toBe(true)
        session.undo()
      }
    })

    it('takes only the selected box back to Free with Alt+Shift+A, a laid-out box inside it keeping its own layout and its fit', () => {
      const { actions, session, selection, frame } = harness(false, FLOW)
      const layout = layoutOf(session.design(), 'hugging')
      expect(layout).toMatchObject({ direction: 'row', padding: { top: 30, right: 30, bottom: 30, left: 30 } })
      selection.select(['flow'], frame.id)
      expect(actions.perform('layoutFree')).toBe(true)
      const after = session.design()
      expect(layoutOf(after, 'flow')).toBeUndefined()
      expect(layoutOf(after, 'hugging')).toEqual(layout)
      expect(after.nodes.hugging?.props.sizing).toEqual({ width: 'hug', height: 'hug' })
    })

    it('leaves Alt+Shift+A to the page on a group or a Free box, which have no layout to take off', () => {
      const { actions, session, selection, frame, log } = harness()
      session.run('node.group', { ids: ['a', 'b'], id: 'pair' })
      session.run('node.box', { ids: ['c'], id: 'free' })
      for (const id of ['pair', 'free']) {
        selection.select([id], frame.id)
        const before = session.design()
        const undoable = session.canUndo()
        expect(actions.perform('layoutFree')).toBe(false)
        expect(session.design()).toEqual(before)
        expect(session.canUndo()).toBe(undoable)
      }
      expect(log.filter((line) => line.startsWith('refused'))).toEqual([])
    })

    it('says why Alt+Shift+A leaves a laid-out box whose style is locked as it is', () => {
      const { actions, session, selection, frame, log } = harness()
      session.run('node.lock', { ids: ['row'], lock: { style: true } })
      selection.select(['row'], frame.id)
      const before = session.design()
      expect(actions.perform('layoutFree')).toBe(true)
      expect(session.design()).toEqual(before)
      expect(log).toContain('refused locked')
    })

    it('lays nothing out with Shift+A for a box the app locked, alone or beside another layer, and says why', () => {
      const { actions, session, selection, frame, log } = harness()
      session.run('node.box', { ids: ['a'], id: 'free' })
      selection.select(['free'], frame.id)
      actions.perform('lock')
      for (const ids of [['free'], ['free', 'c']]) {
        selection.select(ids, frame.id)
        const before = session.design()
        const undoable = session.canUndo()
        actions.perform('autoLayout')
        expect(session.design()).toEqual(before)
        expect(session.canUndo()).toBe(undoable)
        expect(idsOf(selection.current())).toEqual(ids)
        expect(log.splice(0).filter((line) => line.startsWith('refused'))).toEqual(['refused locked'])
      }
    })

    it('decides Shift+A in each frame as it would there alone: a Free box alone laid out in place, two layers wrapped', () => {
      const { actions, session, selection, frame, wide } = harness()
      session.run('node.box', { ids: ['wide-a'], id: 'wide-free' })
      selection.selectAcross([...pairsIn(frame.id, ['a', 'c']), ...pairsIn(wide.id, ['wide-free'])])
      const before = session.design()
      expect(actions.perform('autoLayout')).toBe(true)
      const after = session.design()
      const [made = '', laidOut] = idsOf(selection.current())
      expect(after.nodes.a?.parentId).toBe(made)
      expect(layoutOf(after, made)?.direction).toBe('row')
      expect(laidOut).toBe('wide-free')
      expect(after.nodes['wide-free']?.parentId).toBe(wide.id)
      expect(layoutOf(after, 'wide-free')?.direction).toBeDefined()
      session.undo()
      expect(session.design()).toEqual(before)
    })

    it('lays a Free box locked only against moving out in place with Shift+A', () => {
      const { actions, session, selection, frame } = harness()
      session.run('node.box', { ids: ['a', 'c'], id: 'free' })
      session.run('node.lock', { ids: ['free'], lock: { move: true } })
      selection.select(['free'], frame.id)
      expect(actions.perform('autoLayout')).toBe(true)
      expect(layoutOf(session.design(), 'free')?.direction).toBe('row')
      expect(session.design().nodes.free?.parentId).toBe('sq')
      expect(idsOf(selection.current())).toEqual(['free'])
    })

    it('wraps two shapes side by side in a new row with Shift+A, its gap and alignment read off them and nothing moved', () => {
      const { actions, session, selection, boxes, frame } = harness()
      const shape = (id: string, x: number, width: number, height: number) =>
        session.run('node.create', {
          id,
          parentId: 'sq',
          layer: { type: 'graphic', name: id, props: { x, y: 600, width, height, shape: { kind: 'rect' } } },
        })
      // Tops lined up, 40 apart.
      shape('e', 120, 200, 160)
      shape('f', 360, 120, 100)
      selection.select(['e', 'f'], frame.id)
      const before = copy(session.design())
      expect(actions.perform('autoLayout')).toBe(true)
      const after = session.design()
      const [made = ''] = idsOf(selection.current())
      expect([after.nodes.e?.parentId, after.nodes.f?.parentId]).toEqual([made, made])
      expect(after.nodes[made]?.props).toMatchObject({
        layout: { direction: 'row', gap: 40, align: 'start' },
        sizing: { width: 'hug', height: 'hug' },
      })
      expect(boxes.drawnAlike(frame.id, before, after)).toBe(true)
      expect(boxes.drawnBoxOf(frame, made)).toEqual({ x: 120, y: 600, width: 360, height: 160, rotation: 0 })
    })

    it('wraps a laid-out box in a new box laid out round it with Shift+A, selecting the new box', () => {
      const { actions, session, selection, frame } = harness()
      selection.select(['row'], frame.id)
      expect(actions.perform('autoLayout')).toBe(true)
      const [made = ''] = idsOf(selection.current())
      expect(made).not.toBe('row')
      expect(session.design().nodes.row?.parentId).toBe(made)
      expect(session.design().nodes.row?.props).toHaveProperty('layout')
    })

    it('wraps two Free boxes together in each frame with Shift+A, as one undo step, selecting every new box', () => {
      const { actions, session, selection, frame, wide } = harness()
      session.run('node.box', { ids: ['a'], id: 'left' })
      session.run('node.box', { ids: ['c'], id: 'right' })
      session.run('node.create', {
        id: 'wide-c',
        parentId: wide.id,
        layer: {
          type: 'graphic',
          name: 'Rect',
          props: { x: 400, y: 100, width: 100, height: 100, shape: { kind: 'rect' } },
        },
      })
      session.run('node.box', { ids: ['wide-a'], id: 'wide-left' })
      session.run('node.box', { ids: ['wide-c'], id: 'wide-right' })
      selection.selectAcross([
        ...pairsIn(frame.id, ['left', 'right']),
        ...pairsIn(wide.id, ['wide-left', 'wide-right']),
      ])
      const before = session.design()
      expect(actions.perform('autoLayout')).toBe(true)
      const made = idsOf(selection.current())
      expect(made).toHaveLength(2)
      const after = session.design()
      for (const [i, pair] of [
        ['left', 'right'],
        ['wide-left', 'wide-right'],
      ].entries())
        for (const id of pair) {
          expect(after.nodes[id]?.parentId).toBe(made[i])
          expect(after.nodes[id]?.props).not.toHaveProperty('layout')
        }
      for (const id of made) expect(after.nodes[id]?.props).toHaveProperty('layout')
      session.undo()
      expect(session.design()).toEqual(before)
    })
  })
})
