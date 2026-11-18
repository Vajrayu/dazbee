// A drag along a flow moving its layers to their new place as the pointer finds it, the other
// layers laid out around them: the design during the drag, its undo step, Alt's copies, and
// taking it all back.
import { describe, expect, it } from 'vitest'

import { openSession } from '@dazbee/doc'
import { anotherTab } from '@dazbee/doc/test-store'

import { idsOf } from '../../selection.ts'
import { designStore, harness } from './test-auto-layout-drag.ts'

/** The row's squares are 50 wide with no gap: One 100 to 150, Two 150 to 200, Three 200 to 250. */
function pressOne(store = designStore(), ids = ['one']) {
  const h = harness(store)
  h.selection.select(ids, 'sq')
  const drag = h.reorder.press(h.frame, [], { x: 125, y: 125 }, ids)
  if (!drag) throw new Error('no drag')
  const layers = () => Object.keys(h.session.design().nodes).length
  const snapshot = () => JSON.stringify(h.session.design())
  return { ...h, drag, layers, snapshot, before: snapshot() }
}

describe('editorAutoLayoutDrag: live reflow', () => {
  it('moves the dragged layers to the place found while the pointer is down, the others laid out around them', () => {
    const { reorder, session, drag, order, boxes } = pressOne()
    reorder.drag(drag, { x: 240, y: 125 }, false)
    expect(order()).toEqual(['two', 'three', 'one'])
    expect(boxes.boxIn('two')).toMatchObject({ x: 100 })
    expect(boxes.boxIn('one')).toMatchObject({ x: 200 })
    expect(session.inGesture()).toBe(true)
  })

  it('writes nothing while the place stays the same', () => {
    const { reorder, session, drag } = pressOne()
    reorder.drag(drag, { x: 240, y: 125 }, false)
    const changes = session.changes()
    reorder.drag(drag, { x: 245, y: 130 }, false)
    reorder.drag(drag, { x: 238, y: 120 }, false)
    expect(session.changes()).toBe(changes)
  })

  it('finds the place from the rooms as the press found them, so a pointer held near a boundary keeps it', () => {
    const { reorder, session, drag, order } = pressOne()
    // Past Two's middle as the press found it: One goes after Two, and now takes 150 to 200 itself.
    reorder.drag(drag, { x: 176, y: 125 }, false)
    expect(order()).toEqual(['two', 'one', 'three'])
    const changes = session.changes()
    reorder.drag(drag, { x: 176, y: 125 }, false)
    expect(drag.slot).toBe(1)
    expect(session.changes()).toBe(changes)
    // At 160, Two as laid out now (100 to 150) would put One after it; as the press found it, before it.
    reorder.drag(drag, { x: 160, y: 125 }, false)
    expect(drag.slot).toBe(0)
    expect(order()).toEqual(['one', 'two', 'three'])
  })

  it('shows the ghost following the pointer and the line before the layers where they are now', () => {
    const { reorder, drag, frame } = pressOne()
    reorder.drag(drag, { x: 240, y: 135 }, false)
    expect(reorder.shown(drag)).toEqual([
      { kind: 'ghost', frame, box: { x: 215, y: 110, width: 50, height: 50, rotation: 0 } },
      // One now takes 200 to 250: the line is 3 before it, the least gap it keeps, as tall as One.
      { kind: 'line', frame, box: { x: 196, y: 100, width: 2, height: 50, rotation: 0 } },
    ])
  })

  it('puts the line half the box’s gap before the layers, 24 at most, first in the flow too', () => {
    const { reorder, session, drag, frame } = pressOne()
    session.run('node.update', { ids: ['row'], patch: { layout: { direction: 'row', gap: 20 } } })
    reorder.drag(drag, { x: 110, y: 125 }, false)
    expect(reorder.shown(drag).at(-1)).toEqual({
      kind: 'line',
      frame,
      box: { x: 89, y: 100, width: 2, height: 50, rotation: 0 },
    })
    session.run('node.update', { ids: ['row'], patch: { layout: { direction: 'row', gap: 80 } } })
    expect(reorder.shown(drag).at(-1)?.box).toMatchObject({ x: 75 })
  })

  it('leaves no undo step for a drag past a layer and back to where the press found it', () => {
    const { reorder, session, drag, order, snapshot, before } = pressOne()
    reorder.drag(drag, { x: 240, y: 125 }, false)
    reorder.drag(drag, { x: 125, y: 125 }, false)
    expect(order()).toEqual(['one', 'two', 'three'])
    reorder.release(drag)
    expect(session.canUndo()).toBe(false)
    expect(snapshot()).toBe(before)
  })

  it('drops where the layers are, one undo step called move that puts the flow back exactly', () => {
    const { reorder, session, drag, order, snapshot, before } = pressOne()
    reorder.drag(drag, { x: 176, y: 125 }, false)
    reorder.drag(drag, { x: 240, y: 125 }, false)
    reorder.release(drag)
    expect(order()).toEqual(['two', 'three', 'one'])
    expect(session.undoName()).toBe('move')
    session.undo()
    expect(snapshot()).toBe(before)
  })

  it('puts the flow back as the press found it outside the box, with the ghost and the leave outline, and moves the layers again back inside', () => {
    const { reorder, drag, order, snapshot, before } = pressOne()
    reorder.drag(drag, { x: 240, y: 125 }, false)
    reorder.drag(drag, { x: 125, y: 700 }, false)
    expect(snapshot()).toBe(before)
    expect(reorder.shown(drag).map((part) => part.kind)).toEqual(['ghost', 'leave'])
    reorder.drag(drag, { x: 240, y: 125 }, false)
    expect(order()).toEqual(['two', 'three', 'one'])
  })

  it('drops outside the box as before, and with Alt makes no copy until that drop', () => {
    const { reorder, session, drag, order, layers } = pressOne()
    const count = layers()
    reorder.drag(drag, { x: 240, y: 125 }, true)
    reorder.drag(drag, { x: 525, y: 325 }, true)
    expect(layers()).toBe(count)
    reorder.release(drag)
    expect(layers()).toBe(count + 1)
    expect(order()).toEqual(['one', 'two', 'three'])
    expect(session.undoName()).toBe('duplicate')
  })

  it('with Alt moves copies to the place, the originals staying, and letting go of Alt moves the originals, selecting them again', () => {
    const { reorder, session, selection, drag, order, layers } = pressOne()
    const count = layers()
    reorder.drag(drag, { x: 240, y: 125 }, true)
    expect(layers()).toBe(count + 1)
    const [copy] = idsOf(selection.current())
    expect(copy).not.toBe('one')
    expect(order()).toEqual(['one', 'two', 'three', copy])

    reorder.setAlt(drag, false)
    expect(layers()).toBe(count)
    expect(order()).toEqual(['two', 'three', 'one'])
    expect(idsOf(selection.current())).toEqual(['one'])

    reorder.setAlt(drag, true)
    reorder.release(drag)
    const [dropped] = idsOf(selection.current())
    expect(order()).toEqual(['one', 'two', 'three', dropped])
    expect(session.undoName()).toBe('duplicate')
  })

  it('with Alt pressed before the drag, opens the gap for the copy; leaving the box puts it away and selects the originals', () => {
    const { reorder, selection, drag, order, layers, snapshot, before } = pressOne()
    reorder.setAlt(drag, true)
    reorder.drag(drag, { x: 176, y: 125 }, true)
    const [copy] = idsOf(selection.current())
    expect(order()).toEqual(['one', 'two', copy, 'three'])
    reorder.drag(drag, { x: 176, y: 700 }, true)
    expect(snapshot()).toBe(before)
    expect(layers()).toBe(5 * 2)
    expect(idsOf(selection.current())).toEqual(['one'])
  })

  it('takes back all the drag wrote, copies included, when cancelled, the release then dropping nothing', () => {
    for (const alt of [false, true]) {
      const { reorder, session, selection, drag, snapshot, before } = pressOne()
      reorder.drag(drag, { x: 240, y: 125 }, alt)
      reorder.cancel(drag)
      reorder.release(drag)
      expect(snapshot(), `alt ${alt}`).toBe(before)
      expect(session.canUndo()).toBe(false)
      expect(idsOf(selection.current())).toEqual(['one'])
    }
  })

  it('with Alt moves the copies of layers side by side to the place as one block, there and back alike', () => {
    for (const path of [
      [
        { x: 240, y: 125 },
        { x: 160, y: 125 },
      ],
      [{ x: 160, y: 125 }],
    ]) {
      const { reorder, selection, drag, order } = pressOne(designStore(), ['one', 'two'])
      for (const at of path) reorder.drag(drag, at, true)
      const copies = idsOf(selection.current())
      expect(order()).toEqual(['one', 'two', ...copies, 'three'])
    }
  })

  it('puts the flow back as the press found it when another tab took away the layer the place is before', () => {
    const store = designStore()
    const { reorder, session, drag, order } = pressOne(store)
    reorder.drag(drag, { x: 240, y: 125 }, false)
    expect(order()).toEqual(['two', 'three', 'one'])
    const other = anotherTab(store)
    openSession(other.store).run('node.delete', { ids: ['three'] })
    other.deliver()
    // Before Three as the press found it: Three is gone, so One can't go there.
    reorder.drag(drag, { x: 190, y: 125 }, false)
    expect(order()).toEqual(['one', 'two'])
    reorder.release(drag)
    expect(session.canUndo()).toBe(false)
  })

  it('takes back all the drag wrote when its undo step is cancelled, as Escape does', () => {
    const { reorder, session, drag, snapshot, before } = pressOne()
    reorder.drag(drag, { x: 240, y: 125 }, true)
    drag.step.cancel()
    expect(snapshot()).toBe(before)
    expect(session.canUndo()).toBe(false)
  })
})
