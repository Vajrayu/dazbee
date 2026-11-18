import { describe, expect, it } from 'vitest'

import { type Session, sizingOf } from '@dazbee/doc'
import type { Point } from '@dazbee/schema'

import { editorLayerEdits } from '../../layer-edits.ts'
import { localTo, pageFrom } from '../../layers/transform.ts'
import { harness, lineProps, resizeFrom } from './test-transform-drag.ts'

/** Adds a laid-out box in `direction` at (550, 250), 400 × 150, holding the line `rule`, 200 long, with a `width` sizing. */
function flowLine(session: Session, frameId: string, direction: 'row' | 'column', width: 'fixed' | 'fill') {
  session.run('node.create', {
    id: 'flow',
    parentId: frameId,
    layer: { type: 'box', name: 'Flow', props: { x: 550, y: 250, width: 400, height: 150, layout: { direction } } },
  })
  session.run('node.create', {
    id: 'rule',
    parentId: 'flow',
    layer: { type: 'graphic', name: 'Rule', props: { ...lineProps(0, 0, 200), sizing: { width, height: 'fixed' } } },
  })
}

/** The harness with its row at a place, the square in it sized `width` × `height` and selected. */
function rowAt(at: Point, width: number, height: number) {
  const h = harness()
  h.session.run('node.update', { ids: ['row'], patch: at })
  h.session.run('node.update', { ids: ['c'], patch: { width, height } })
  h.selection.select(['c'], h.frame.id)
  return h
}

describe('editorResizeDrag', () => {
  describe('pressHandle and a line in a flow', () => {
    for (const direction of ['column', 'row'] as const)
      for (const width of ['fixed', 'fill'] as const)
        it(`resizes a line in a ${direction} with a ${width} width from its ends, as a resize there, the flow placing it`, () => {
          const { drag, session, selection, frame, boxes, boxOf, pressSelection } = harness()
          flowLine(session, frame.id, direction, width)
          selection.select(['rule'], frame.id)
          const was = boxes.drawnRect(frame, 'rule')
          const stored = boxOf('rule')
          if (!was) throw new Error('no rule')
          expect(drag.handleUnder({ x: was.x, y: was.y })).toMatchObject({ kind: 'resize', handle: 'w' })
          const east = { x: was.x + was.width, y: was.y }
          const end = pressSelection(east)
          expect(end).toMatchObject({ kind: 'resize', handle: 'e' })
          drag.drag(end, { x: east.x - 50, y: east.y + 30 }, false, false, false)
          drag.release(end)
          const node = session.design().nodes.rule
          if (!node) throw new Error('no rule')
          // The side dragged becomes Fixed; the flow keeps its place and turn.
          expect(sizingOf(node).width).toBe('fixed')
          expect(boxOf('rule')).toMatchObject({ x: stored.x, y: stored.y, height: 0, rotation: 0 })
          expect(boxes.drawnRect(frame, 'rule')).toEqual({ ...was, width: was.width - 50 })
          expect(boxOf('rule').width).toBe(was.width - 50)
        })
  })

  describe('pressHandle and resize', () => {
    it('grows a group moved into a flow from the layers panel by the drag only, what it holds scaled with it', () => {
      const { drag, session, selection, frame, boxes, pressSelection } = harness()
      session.run('node.group', { ids: ['a', 'b'], id: 'pair', name: 'Pair' })
      const edits = editorLayerEdits({
        session,
        selection,
        boxes,
        resources: { loadFamilies: () => [] },
        typing: { fitText: () => {}, selectedText: () => null, styleRange: () => {} },
        signal: new AbortController().signal,
      })
      edits.moveLayer('pair', 'row')
      selection.select(['pair'], frame.id)
      const was = boxes.drawnRect(frame, 'pair')
      if (!was) throw new Error('no group')
      const corner = { x: was.x + was.width, y: was.y + was.height }
      const resize = pressSelection(corner)
      for (let step = 1; step <= 4; step++)
        drag.drag(resize, { x: corner.x + 10 * step, y: corner.y + 5 * step }, false, false, false)
      drag.release(resize)
      expect(boxes.drawnRect(frame, 'pair')).toEqual({ ...was, width: was.width + 40, height: was.height + 20 })
      const scale = (was.width + 40) / was.width
      expect(boxes.drawnRect(frame, 'a')).toMatchObject({ x: was.x, y: was.y })
      expect(boxes.drawnRect(frame, 'a')?.width).toBeCloseTo(100 * scale)
      expect(boxes.drawnRect(frame, 'b')?.x).toBeCloseTo(was.x + 300 * scale)
    })

    it('grows a group the flow moved after it went in by the drag only', () => {
      const { drag, session, selection, frame, boxes, pressSelection } = harness()
      session.run('node.group', { ids: ['a', 'b'], id: 'pair', name: 'Pair' })
      const edits = editorLayerEdits({
        session,
        selection,
        boxes,
        resources: { loadFamilies: () => [] },
        typing: { fitText: () => {}, selectedText: () => null, styleRange: () => {} },
        signal: new AbortController().signal,
      })
      edits.moveLayer('pair', 'row')
      // The row moves the group 100 right.
      session.run('node.update', { ids: ['c'], patch: { width: 150 } })
      selection.select(['pair'], frame.id)
      const was = boxes.drawnRect(frame, 'pair')
      if (!was) throw new Error('no group')
      const corner = { x: was.x + was.width, y: was.y + was.height }
      const resize = pressSelection(corner)
      for (let step = 1; step <= 4; step++)
        drag.drag(resize, { x: corner.x + 10 * step, y: corner.y + 5 * step }, false, false, false)
      drag.release(resize)
      expect(boxes.drawnRect(frame, 'pair')).toEqual({ ...was, width: was.width + 40, height: was.height + 20 })
    })
  })

  describe('a resize on whole design pixels', () => {
    it('lands the size dragged of a layer a flow places on whole pixels, the flow putting it on a fraction, and with Shift the leading side’s', () => {
      const h = rowAt({ x: 100.3, y: 500 }, 50, 40)
      resizeFrom(h, { x: 150.3, y: 520 }, { x: 20.4, y: 0 })
      expect(h.boxes.drawnRect(h.frame, 'c')?.x).toBeCloseTo(100.3)
      expect(h.boxes.drawnRect(h.frame, 'c')).toMatchObject({ width: 70, height: 40 })
      const shift = rowAt({ x: 100.3, y: 500 }, 50, 40)
      resizeFrom(shift, { x: 150.3, y: 540 }, { x: 20.4, y: 5.2 }, { shift: true })
      expect(shift.boxes.drawnRect(shift.frame, 'c')).toMatchObject({ width: 70, height: 56 })
    })

    it('rounds the size dragged as the pointer gives it, a whole size about the centre with Alt', () => {
      for (const [held, by, width] of [
        [{}, 90.6, 141],
        [{ shift: true }, 90.6, 141],
        [{ alt: true }, 58.77, 168],
      ] as const) {
        // Drawn at 60.7, its east side at 110.7.
        const h = rowAt({ x: 60.7, y: 500 }, 50, 40)
        resizeFrom(h, { x: 110.7, y: 520 }, { x: by, y: 0 }, held)
        expect.soft(h.boxes.drawnRect(h.frame, 'c')?.width, JSON.stringify(held)).toBe(width)
      }
    })

    it('lands the leading side’s size on whole pixels from a corner where the height leads', () => {
      const h = rowAt({ x: 100.3, y: 500.6 }, 50, 40)
      resizeFrom(h, { x: 150.3, y: 540.6 }, { x: 5.2, y: 20.4 }, { shift: true })
      expect(h.boxes.drawnRect(h.frame, 'c')).toMatchObject({ width: 75, height: 60 })
    })

    it('keeps a side that snaps on the line its snap line shows: free, and with Shift where the height or the width leads', () => {
      // Square a's east side is a line at x 200.
      for (const [at, by, shift] of [
        [{ x: 190.3, y: 515 }, { x: 9.1, y: 0 }, false],
        [{ x: 190.3, y: 530 }, { x: 9.1, y: 3.5 }, true],
        [{ x: 190.3, y: 530 }, { x: 9.1, y: 1 }, true],
      ] as const) {
        const h = rowAt({ x: 100.3, y: 500 }, 90, 30)
        resizeFrom(h, at, by, { shift, snap: true })
        const drawn = h.boxes.drawnRect(h.frame, 'c')
        expect(h.drag.shown()?.snapLines).toContainEqual(expect.objectContaining({ axis: 'x', at: 200 }))
        expect.soft((drawn?.x ?? 0) + (drawn?.width ?? 0), JSON.stringify(by)).toBeCloseTo(200, 2)
      }
    })

    it('rounds nothing for a layer in a row turned 30°', () => {
      const h = rowAt({ x: 100.3, y: 500 }, 50, 40)
      h.session.run('node.update', { ids: ['row'], patch: { rotation: 30 } })
      const outer = h.boxes.selectionBox()
      if (!outer) throw new Error('nothing selected')
      // The east handle, turned with the row about its centre.
      const at = pageFrom({ x: 150.3, y: 520 }, outer.around)
      resizeFrom(h, at, { x: 20.4, y: 0 }, {}, (p) => localTo(p, outer.around))
      // Along the row's own sides the pointer went 20.4 × cos 30°.
      expect(h.boxes.drawnRect(h.frame, 'c')?.width).toBe(67.67)
    })

    it('rounds the sizes of two layers a flow places by the selection’s box on the page, each scaled within it', () => {
      const h = rowAt({ x: 100.3, y: 500 }, 50, 40)
      h.session.run('node.create', {
        id: 'c2',
        parentId: 'row',
        layer: { type: 'graphic', name: 'C2', props: { x: 0, y: 0, width: 50, height: 40, shape: { kind: 'rect' } } },
      })
      h.selection.select(['c', 'c2'], h.frame.id)
      // The selection runs from 100.3 to 200.3: its east side lands on 221, so it is 120.7 wide.
      resizeFrom(h, { x: 200.3, y: 520 }, { x: 20.4, y: 0 })
      expect(h.boxOf('c').width).toBe(60.35)
      expect(h.boxOf('c2').width).toBe(60.35)
    })
  })
})
