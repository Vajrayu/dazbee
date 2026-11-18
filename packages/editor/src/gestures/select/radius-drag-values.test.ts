import { describe, expect, it } from 'vitest'

import { radiusCorners } from '../../layers/radius.ts'
import { copyIn } from '../../test-matrix/index.ts'
import { CORNER_REACH, DOT_REACH, screenCorners } from '../hit-zones.ts'
import {
  DESIGN,
  dotOf,
  dots,
  dragDot,
  dragThrough,
  grabAt,
  open,
  pill,
  props,
  r2,
  shapeOf,
  shown,
} from './test-radius-drag.ts'

describe('the drag of a radius dot', () => {
  it('rounds every corner by the pointer’s travel along the bisector from the slop, one undo step named edit', async () => {
    const editor = await open()
    const { core } = editor
    const dot = dotOf(editor, 'plain')
    const steps = Array.from({ length: 10 }, (_, i) => ({ x: i + 1, y: i + 1 }))
    const seen = dragThrough(editor, dot.at, steps, () => shapeOf(editor, 'plain').cornerRadius)
    expect(seen).toEqual([0, 0, 3, 4, 5, 6, 7, 8, 9, 10])
    expect([core.selection(), core.undoName(), core.boxOf('plain')]).toEqual([
      ['plain'],
      'edit',
      { x: 100, y: 100, width: 200, height: 120 },
    ])
    expect(shapeOf(editor, copyIn('wide', 'plain'))).toEqual({ kind: 'rect', cornerRadius: 0 })
    core.perform('undo')
    expect([shapeOf(editor, 'plain'), core.canUndo()]).toEqual([{ kind: 'rect', cornerRadius: 0 }, false])
    core.perform('redo')
    expect(shapeOf(editor, 'plain')).toEqual({ kind: 'rect', cornerRadius: 10 })
    editor.end()
  })

  it('at 40% writes 8 first, past the slop', async () => {
    const editor = await open(0.4)
    const dot = dotOf(editor, 'plain')
    const steps = Array.from({ length: 5 }, (_, i) => ({ x: i + 1, y: i + 1 }))
    expect(dragThrough(editor, dot.at, steps, () => shapeOf(editor, 'plain').cornerRadius)).toEqual([0, 0, 8, 10, 13])
    editor.end()
  })

  it('puts all back on Escape, with no step left', async () => {
    const editor = await open()
    const { core, mouse, keys } = editor
    const dot = dotOf(editor, 'four')
    mouse.move(dot.at.x, dot.at.y)
    mouse.down()
    mouse.move(dot.at.x + 20, dot.at.y + 20)
    expect(shapeOf(editor, 'four')).toEqual({ kind: 'rect', cornerRadius: 30 })
    keys.down('Escape')
    expect([shapeOf(editor, 'four').corners, core.canUndo(), shown(editor).length]).toEqual([[10, 40, 0, 20], false, 4])
    keys.up('Escape')
    mouse.up()
    editor.end()
  })

  it('starts from the radius drawn, comes down from a stored one above it, and out and back puts the stored one back', async () => {
    const editor = await open()
    const { core } = editor
    const dot = dotOf(editor, 'over')
    const path = [2, 4, 6, 8, 10, 8, 6, 4, 2, 0].map((i) => ({ x: -i, y: -i }))
    expect(dragThrough(editor, dot.at, path, () => props(editor, 'over').cornerRadius)).toEqual([
      300, 56, 54, 52, 50, 52, 54, 56, 58, 300,
    ])
    dragDot(editor, dot.at, { x: dot.at.x + 40, y: dot.at.y + 40 })
    expect(props(editor, 'over').cornerRadius).toBe(300)
    dragDot(editor, dot.at, { x: dot.at.x - 10, y: dot.at.y - 10 })
    expect(props(editor, 'over').cornerRadius).toBe(50)
    const again = dotOf(editor, 'over')
    dragDot(editor, again.at, { x: again.at.x + 400, y: again.at.y + 400 })
    expect(props(editor, 'over').cornerRadius).toBe(60)
    expect(core.boxOf('over')).toEqual({ x: 400, y: 100, width: 200, height: 120 })
    editor.end()
  })

  it('changes nothing on a wobble across the bisector of mixed corners', async () => {
    const editor = await open()
    const dot = dotOf(editor, 'four')
    dragDot(editor, dot.at, { x: dot.at.x + 4, y: dot.at.y - 4 })
    expect([shapeOf(editor, 'four').corners, editor.core.canUndo()]).toEqual([[10, 40, 0, 20], false])
    editor.end()
  })

  it('without Alt gives corners that differ the value; with Alt rounds its own corner up to its lone top', async () => {
    const editor = await open()
    const { core } = editor
    const dot = dotOf(editor, 'four')
    dragDot(editor, dot.at, { x: dot.at.x + 10, y: dot.at.y + 10 })
    expect(shapeOf(editor, 'four')).toEqual({ kind: 'rect', cornerRadius: 20 })
    core.perform('undo')
    dragDot(editor, dot.at, { x: dot.at.x + 400, y: dot.at.y + 400 }, { alt: true })
    expect(shapeOf(editor, 'four').corners).toEqual([100, 40, 0, 20])
    expect(core.selection()).toEqual(['four'])
    expect(Object.keys(core.design().nodes)).toHaveLength(Object.keys(DESIGN.nodes).length)
    const tr = dotOf(editor, 'plain', 1)
    dragDot(editor, tr.at, { x: tr.at.x - 400, y: tr.at.y + 400 }, { alt: true })
    expect(shapeOf(editor, 'plain').corners).toEqual([0, 120, 0, 0])
    editor.end()
  })

  it('on a flipped layer, puts each dot at its corner as drawn, and with Alt rounds the corner drawn under it', async () => {
    const editor = await open()
    const { core } = editor
    core.session.run('node.update', { ids: ['four'], patch: { flipX: true } })
    const [tr, tl] = dots(editor, 'four')
    if (!tr || !tl) throw new Error('no dots')
    // The corner stored at the top left is drawn at the top right, and the top right's at the top left.
    expect(tr.at.x).toBeGreaterThan(tl.at.x)
    dragDot(editor, tl.at, { x: tl.at.x + 10, y: tl.at.y + 10 }, { alt: true })
    expect(shapeOf(editor, 'four').corners).toEqual([10, 50, 0, 20])
    editor.end()
  })

  it('follows Alt pressed and let go mid-drag, read on each move', async () => {
    const editor = await open()
    const { mouse, keys } = editor
    const dot = dotOf(editor, 'four')
    const radii = () => {
      const shape = shapeOf(editor, 'four')
      return shape.corners ?? shape.cornerRadius
    }
    mouse.move(dot.at.x, dot.at.y)
    mouse.down()
    const seen = [10, 11, 12, 13].map((i) => {
      if (i === 11 || i === 13) keys.down('Alt')
      else keys.up('Alt')
      mouse.move(dot.at.x + i, dot.at.y + i)
      return radii()
    })
    keys.up('Alt')
    mouse.up()
    expect(seen).toEqual([20, [21, 40, 0, 20], 22, [23, 40, 0, 20]])
    editor.end()
  })

  it('stops a polygon and a star at the top point’s limit, Alt or not, and brings a star stored above it back out and back', async () => {
    const editor = await open()
    const top = dotOf(editor, 'tri')
    dragDot(editor, top.at, { x: top.at.x, y: top.at.y + 20 })
    expect(shapeOf(editor, 'tri').cornerRadius).toBe(14)
    const again = dotOf(editor, 'tri')
    dragDot(editor, again.at, { x: again.at.x, y: again.at.y + 400 }, { alt: true })
    expect(shapeOf(editor, 'tri').cornerRadius).toBe(70.71)
    const tip = dotOf(editor, 'star')
    const path = [5, 10, 15, 10, 5, 0].map((i) => ({ x: 0, y: -i }))
    expect(dragThrough(editor, tip.at, path, () => shapeOf(editor, 'star').cornerRadius)).toEqual([11, 9, 8, 9, 11, 40])
    editor.end()
  })

  it('stops at the hundredth under a top that is not one, the radius stored there the radius drawn', async () => {
    const editor = await open()
    const box = dotOf(editor, 'odd')
    dragDot(editor, box.at, { x: box.at.x + 400, y: box.at.y + 400 })
    const tip = dotOf(editor, 'narrow')
    dragDot(editor, tip.at, { x: tip.at.x, y: tip.at.y + 400 })
    expect([shapeOf(editor, 'odd').cornerRadius, shapeOf(editor, 'narrow').cornerRadius]).toEqual([45.37, 25.76])
    editor.end()
  })

  it('rounds a turned layer, one in a turned group, one a flow sizes and a clipping box; linked copies keep theirs', async () => {
    const editor = await open()
    for (const [id, was] of [
      ['turned', 20],
      ['inGroup', 20],
      ['inFlow', 10],
      ['kept', 10],
      ['mask', 10],
      ['masked', 10],
      ['holder', 0],
      ['stroked', 0],
    ] as const) {
      const [tl] = dots(editor, id)
      const outer = editor.modules.boxes.selectionBox()
      const [corner] = outer ? screenCorners(outer.drawn, outer.frame, editor.core.camera()) : []
      if (!tl || !corner) throw new Error(`no dots on ${id}`)
      // Along the corner's bisector on screen: from the corner through its dot.
      const d = Math.hypot(tl.at.x - corner.x, tl.at.y - corner.y)
      const along = (n: number) => ({
        x: tl.at.x + ((tl.at.x - corner.x) / d) * n,
        y: tl.at.y + ((tl.at.y - corner.y) / d) * n,
      })
      expect(grabAt(editor, tl.at)).toEqual({ kind: 'radius', corner: 0, drawn: true })
      const box = editor.core.boxOf(id)
      // A travel of 10√2 along a right angle's bisector rounds 10 more.
      dragDot(editor, tl.at, along(10 * Math.SQRT2))
      const now = props(editor, id)
      const radius = id === 'holder' ? now.cornerRadius : (now.shape as Record<string, unknown>).cornerRadius
      expect([radius, editor.core.boxOf(id), editor.core.selection()]).toEqual([was + 10, box, [id]])
      const copy = props(editor, copyIn('wide', id))
      expect(id === 'holder' ? copy.cornerRadius : (copy.shape as Record<string, unknown>).cornerRadius).toBe(was)
    }
    editor.end()
  })

  it('rounds the same with Shift held, and at 800% by the travel in design pixels', async () => {
    const editor = await open()
    const dot = dotOf(editor, 'plain')
    dragDot(editor, dot.at, { x: dot.at.x + 10, y: dot.at.y + 10 }, { shift: true })
    expect(shapeOf(editor, 'plain').cornerRadius).toBe(10)
    editor.core.perform('undo')
    editor.core.zoomTo(8)
    const near = dotOf(editor, 'plain')
    dragDot(editor, near.at, { x: near.at.x + 80, y: near.at.y + 80 })
    expect(shapeOf(editor, 'plain').cornerRadius).toBe(10)
    editor.end()
  })

  it('rounds a dot a press finds anywhere in its reach, and none past it, at the corner nearest', async () => {
    const editor = await open()
    const dot = dotOf(editor, 'plain', 3)
    expect(grabAt(editor, { x: dot.at.x + DOT_REACH, y: dot.at.y })).toEqual({ kind: 'radius', corner: 3, drawn: true })
    expect(grabAt(editor, { x: dot.at.x, y: dot.at.y - DOT_REACH - 1 })).toBeNull()
    const corner = editor.core.stagePoint(100, 220, 'sq')
    expect(grabAt(editor, { x: corner.x + CORNER_REACH / 2, y: corner.y - CORNER_REACH / 2 })?.kind).toBe('resize')
    editor.end()
  })
})

describe('the radius pill', () => {
  it('reads the radius in the app’s words from the press, the value asked on each move, and none after the release', async () => {
    const editor = await open()
    const { mouse } = editor
    const dot = dotOf(editor, 'plain')
    mouse.move(dot.at.x, dot.at.y)
    expect(pill(editor)).toBeNull()
    mouse.down()
    const seen = [pill(editor)]
    for (let i = 1; i <= 10; i++) {
      mouse.move(dot.at.x + i, dot.at.y + i)
      seen.push(pill(editor))
    }
    expect(seen).toEqual(['Radius 0', ...[0, 0, 3, 4, 5, 6, 7, 8, 9, 10].map((r) => `Radius ${r}`)])
    mouse.up()
    expect([pill(editor), shown(editor).length]).toEqual([null, 4])
    editor.end()
  })

  it('reads the top to two decimals at the drag’s top, and the own corner’s value with Alt', async () => {
    const editor = await open()
    const { mouse } = editor
    const odd = dotOf(editor, 'odd')
    mouse.move(odd.at.x, odd.at.y)
    mouse.down()
    mouse.move(odd.at.x + 400, odd.at.y + 400)
    expect(pill(editor)).toBe('Radius 45.37')
    mouse.up()
    const four = dotOf(editor, 'four')
    mouse.move(four.at.x, four.at.y)
    mouse.down()
    editor.keys.down('Alt')
    mouse.move(four.at.x + 400, four.at.y + 400)
    expect([pill(editor), shapeOf(editor, 'four').corners]).toEqual(['Radius 100', [100, 40, 0, 20]])
    editor.keys.up('Alt')
    mouse.up()
    editor.end()
  })

  it('reads, with Alt held from the press, the own corner’s radius at the press as on each move after it', async () => {
    const editor = await open()
    const { mouse } = editor
    // Corner 0 of 200 × 120 stored at 100, past the 60 every corner together stops at.
    editor.core.setRadius(['four'], () => 100, 0)
    const four = dotOf(editor, 'four')
    mouse.move(four.at.x, four.at.y)
    editor.keys.down('Alt')
    mouse.down()
    const seen = [pill(editor)]
    mouse.move(four.at.x + 1, four.at.y + 1)
    seen.push(pill(editor))
    mouse.move(four.at.x + 6, four.at.y + 6)
    seen.push(pill(editor))
    expect(seen).toEqual(['Radius 100', 'Radius 100', 'Radius 100'])
    expect(shapeOf(editor, 'four').corners).toEqual([100, 40, 0, 20])
    mouse.up()
    editor.keys.up('Alt')
    editor.end()
  })

  it('reads a corner drawn smaller than it is stored to two decimals', async () => {
    const editor = await open()
    const { mouse } = editor
    // Corner 1 at 190 on a side 120 tall scales every corner by 120 / 190: corner 0's 10 draws at 6.3157…
    editor.core.setRadius(['four'], () => 190, 1)
    const four = dotOf(editor, 'four')
    mouse.move(four.at.x, four.at.y)
    editor.keys.down('Alt')
    mouse.down()
    expect(pill(editor)).toBe('Radius 6.32')
    mouse.up()
    editor.keys.up('Alt')
    editor.end()
  })

  it('reads the radius drawn at the press where the one stored is above it, out and back', async () => {
    const editor = await open()
    const over = dotOf(editor, 'over')
    const path = [2, 4, 0].map((i) => ({ x: -i, y: -i }))
    expect(dragThrough(editor, over.at, [{ x: 0, y: 0 }, ...path], () => pill(editor))).toEqual([
      'Radius 60',
      'Radius 60',
      'Radius 56',
      'Radius 60',
    ])
    editor.end()
  })

  it('reads the top, the hundredth under it, from the press on a corner drawn there, as on a move that writes nothing', async () => {
    const editor = await open()
    const tip = dotOf(editor, 'star')
    const node = editor.core.design().nodes.star
    const box = editor.core.boxOf('star')
    if (!node || !box) throw new Error('no star')
    // The star stores 40 and is drawn at its top point's limit, which is not a hundredth.
    const drawn = radiusCorners(node.type, node.props, box.width, box.height)[0]?.drawn ?? Number.NaN
    expect(r2(drawn)).not.toBe(Math.floor(drawn * 100) / 100)
    const top = `Radius ${Math.floor(drawn * 100) / 100}`
    expect(
      dragThrough(
        editor,
        tip.at,
        [
          { x: 0, y: 0 },
          { x: 0, y: 6 },
        ],
        () => pill(editor),
      ),
    ).toEqual([top, top])
    editor.end()
  })

  it('is gone after Escape', async () => {
    const editor = await open()
    const { mouse, keys } = editor
    const dot = dotOf(editor, 'plain')
    mouse.move(dot.at.x, dot.at.y)
    mouse.down()
    mouse.move(dot.at.x + 20, dot.at.y + 20)
    expect(pill(editor)).toBe('Radius 20')
    keys.down('Escape')
    expect(pill(editor)).toBeNull()
    keys.up('Escape')
    mouse.up()
    editor.end()
  })

  it('tells what is shown changed on each move of the drag, the value changed or not', async () => {
    const editor = await open()
    const { core, mouse } = editor
    const dot = dotOf(editor, 'plain')
    mouse.move(dot.at.x, dot.at.y)
    mouse.down()
    mouse.move(dot.at.x + 400, dot.at.y + 400)
    expect(shapeOf(editor, 'plain').cornerRadius).toBe(60)
    let told = 0
    const stop = core.onShown(() => (told += 1))
    // Each move alone, with no redraw pass after it.
    const keys = { shiftKey: false, altKey: false, ctrlKey: false, metaKey: false }
    for (let i = 1; i <= 5; i++) {
      const at = { x: dot.at.x + 400 + i, y: dot.at.y + 400 }
      core.input.pointer({ type: 'pointermove', at, button: 0, detail: 0, ...keys, pointerType: 'mouse' })
    }
    stop()
    expect([told, shapeOf(editor, 'plain').cornerRadius, pill(editor)]).toEqual([5, 60, 'Radius 60'])
    mouse.up()
    editor.end()
  })
})
