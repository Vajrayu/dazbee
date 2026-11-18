// A drag in a wrapping flow: the place a dragged layer takes is found in the line under the pointer,
// or the nearest line, then before the first layer whose middle is past it, and the line drawn
// where layers would go spans that line.
import { describe, expect, it } from 'vitest'

import { harness } from './test-auto-layout-drag.ts'

/**
 * The harness with the square frame's row 120 wide and wrapping, its squares 50 wide: One (100 to
 * 150) and Two (150 to 200) on its first line, y 100 to 150, and Three (100 to 150) on its second,
 * y 150 to 200, or 20 lower with `lineGap` 20; with `tall`, a square 80 tall, Four, after Three on the
 * second line.
 */
function wrapHarness(tall = false, lineGap = 0) {
  const h = harness()
  h.session.run('node.update', {
    ids: ['row'],
    patch: { width: 120, sizing: { width: 'fixed', height: 'hug' }, layout: { direction: 'row', wrap: true, lineGap } },
  })
  if (tall)
    h.session.run('node.create', {
      id: 'four',
      parentId: 'row',
      layer: { type: 'graphic', name: 'Four', props: { x: 0, y: 0, width: 50, height: 80, shape: { kind: 'rect' } } },
    })
  return h
}

describe('editorAutoLayoutDrag: a wrapping flow', () => {
  it('takes the line under the pointer, after its last layer, though a layer of another line is nearer', () => {
    const h = wrapHarness()
    h.selection.select(['one'], 'sq')
    const drag = h.reorder.press(h.frame, [], { x: 125, y: 125 }, ['one'])
    if (!drag) throw new Error('no drag')
    // Right of Three on the second line: Two, above, is nearer, but the second line is under the pointer.
    h.reorder.drag(drag, { x: 205, y: 160 }, false)
    expect(drag.slot).toBe(2)
    expect(drag.near).toEqual({ id: 'three', after: true })
    h.reorder.release(drag)
    expect(h.order()).toEqual(['two', 'three', 'one'])
  })

  it('takes the nearest line where none is under the pointer, then the place in it', () => {
    const h = wrapHarness(false, 20)
    h.selection.select(['one'], 'sq')
    const drag = h.reorder.press(h.frame, [], { x: 125, y: 125 }, ['one'])
    if (!drag) throw new Error('no drag')
    // Between the lines, nearer the first, past Two's middle: after Two.
    h.reorder.drag(drag, { x: 190, y: 158 }, false)
    expect(drag.near).toEqual({ id: 'two', after: true })
    h.reorder.release(drag)
    expect(h.order()).toEqual(['two', 'one', 'three'])
  })

  it('reads the lines with the dragged layers in them, so a line a dragged layer starts stays its own', () => {
    const h = wrapHarness()
    // One 30 wide on the first line; Two 100 wide and Three 20 wide on the second, Three past One's end.
    h.session.run('node.update', { ids: ['one'], patch: { width: 30 } })
    h.session.run('node.update', { ids: ['two'], patch: { width: 100 } })
    h.session.run('node.update', { ids: ['three'], patch: { width: 20 } })
    h.selection.select(['two'], 'sq')
    const drag = h.reorder.press(h.frame, [], { x: 150, y: 175 }, ['two'])
    if (!drag) throw new Error('no drag')
    h.reorder.drag(drag, { x: 110, y: 170 }, false)
    expect(drag.near).toEqual({ id: 'three', after: false })
    expect(drag.slot).toBe(1)
  })

  it('draws the line marking the gap in its flow as tall as the line the dragged layer is on', () => {
    const h = wrapHarness(true)
    h.selection.select(['three'], 'sq')
    const drag = h.reorder.press(h.frame, [], { x: 125, y: 175 }, ['three'])
    if (!drag) throw new Error('no drag')
    // Past Four's middle: Three goes after Four, on the line from 150 to 230.
    h.reorder.drag(drag, { x: 190, y: 170 }, false)
    expect(h.order()).toEqual(['one', 'two', 'four', 'three'])
    expect(h.reorder.shown(drag).find((part) => part.kind === 'line')?.box).toMatchObject({ y: 150, height: 80 })
  })

  it('drops a layer from outside into the line under the pointer, the line drawn as tall as that line', () => {
    const h = wrapHarness(true)
    const drop = h.reorder.dropAt(h.frame, { x: 110, y: 170 }, ['free'])
    expect(drop).toMatchObject({ boxId: 'row', slot: 2, near: { id: 'three', after: false } })
    // Three is 50 tall, but its line, with Four, runs from 150 to 230.
    expect(h.reorder.shownDrop(h.frame, drop)).toEqual([
      { kind: 'line', frame: h.frame, box: { x: 99, y: 150, width: 2, height: 80, rotation: 0 } },
    ])
  })
})
