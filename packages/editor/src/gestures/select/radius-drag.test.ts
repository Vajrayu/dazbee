import { describe, expect, it } from 'vitest'

import { copyIn } from '../../test-matrix/index.ts'
import { DOT_REACH } from '../hit-zones.ts'
import { dotOf, dots, dragDot, grabAt, open, props, r2, send, shapeOf, shown, tap, unseen } from './test-radius-drag.ts'

describe('which layer has radius dots', () => {
  it('shows them on one box or rectangle, polygon or star, turned, in a group, in a flow, stroked, with a photo or clipping', async () => {
    const editor = await open()
    const count = (id: string) => dots(editor, id).length
    const ids = ['plain', 'over', 'four', 'turned', 'inGroup', 'inFlow', 'tri', 'star', 'square', 'holder', 'stroked']
    expect(ids.map(count)).toEqual([4, 4, 4, 4, 4, 4, 1, 1, 4, 4, 4])
    expect(count('photo')).toBe(4)
    editor.end()
  })

  it('shows none on an ellipse, a text, a group, a layer under 48px on screen, one style locked or hidden', async () => {
    const editor = await open()
    const count = (id: string) => dots(editor, id).length
    expect(['oval', 'words', 'group', 'small', 'styled', 'inHidden'].map(count)).toEqual([0, 0, 0, 0, 0, 0])
    expect(count('plain')).toBe(4)
    editor.core.setHidden(['plain'], true)
    expect(count('plain')).toBe(0)
    editor.end()
  })

  it('keeps them on a layer locked in place, which they round where it is', async () => {
    const editor = await open()
    const dot = dotOf(editor, 'pinned')
    expect([editor.modules.boxes.handlesFor(), grabAt(editor, dot.at)]).toEqual([
      [],
      { kind: 'radius', corner: 0, drawn: true },
    ])
    dragDot(editor, dot.at, { x: dot.at.x + 20, y: dot.at.y + 20 })
    expect([shapeOf(editor, 'pinned'), editor.core.boxOf('pinned')]).toEqual([
      { kind: 'rect', cornerRadius: 20 },
      { x: 800, y: 800, width: 120, height: 120 },
    ])
    editor.end()
  })

  it('shows none with several selected, a layer selected in two frames, a frame picked or another tool', async () => {
    const { core, modules, end, ...editor } = await open()
    const opened = { core, modules, end, ...editor }
    core.select(['plain', 'four'])
    expect(shown(opened)).toEqual([])
    modules.selection.selectAcross([
      { id: 'plain', frameId: 'sq' },
      { id: copyIn('wide', 'plain'), frameId: 'wide' },
    ])
    expect(shown(opened)).toEqual([])
    core.select([])
    core.pickFrame('sq')
    expect(shown(opened)).toEqual([])
    core.select(['plain'])
    core.setTool('rect')
    expect(shown(opened)).toEqual([])
    core.setTool('select')
    expect(shown(opened)).toHaveLength(4)
    end()
  })

  it('shows them at 10% and 800% only while both sides are 48px on screen', async () => {
    const editor = await open(0.1)
    expect(dots(editor, 'plain')).toEqual([])
    editor.core.zoomTo(0.39)
    expect(dots(editor, 'plain')).toEqual([])
    editor.core.zoomTo(0.4)
    expect(dots(editor, 'plain')).toHaveLength(4)
    editor.core.zoomTo(8)
    expect(dots(editor, 'plain').map((d) => [r2(d.x), r2(d.y)])).toEqual([
      [12, 12],
      [1588, 12],
      [1588, 948],
      [12, 948],
    ])
    editor.end()
  })
})

describe('when radius dots show', () => {
  it('shows none before the first pointer, after a finger’s press, a tap included, and again after a mouse or a pen', async () => {
    const editor = await unseen()
    editor.core.select(['plain'])
    const at = editor.core.stagePoint(112, 112, 'sq')
    expect([shown(editor), grabAt(editor, at)]).toEqual([[], null])
    editor.mouse.move(2, 2)
    expect(shown(editor)).toHaveLength(4)
    const dot = dotOf(editor, 'plain')
    // A finger's reach takes the corner: its tap there starts a resize, and leaves no dots.
    expect(tap(editor, 'touch', dot.at)).toBe('resize')
    expect([shown(editor), grabAt(editor, dot.at)]).toEqual([[], null])
    expect(shapeOf(editor, 'plain')).toEqual({ kind: 'rect', cornerRadius: 0 })
    // A pen that cannot hover: its first press finds no dot, and the dots show once it has been seen.
    expect(tap(editor, 'pen', dot.at)).toBe('move')
    expect(shown(editor)).toHaveLength(4)
    expect(tap(editor, 'pen', dot.at)).toBe('radius')
    editor.end()
  })

  it('shows none during any other drag, while cropping or after Escape leaves the crop; they stay while Alt measures', async () => {
    const editor = await open()
    const { core, mouse, keys, modules } = editor
    expect(dots(editor, 'plain')).toHaveLength(4)
    mouse.move(200, 600)
    keys.down('Alt')
    expect(modules.pointer.measured()).not.toBeNull()
    expect(shown(editor)).toHaveLength(4)
    keys.up('Alt')
    const at = core.stagePoint(200, 160, 'sq')
    mouse.move(at.x, at.y)
    mouse.down()
    mouse.move(at.x + 20, at.y + 20)
    expect(modules.pointer.gesture()?.kind).toBe('move')
    expect(shown(editor)).toEqual([])
    mouse.up()
    expect(shown(editor)).toHaveLength(4)
    // The photo's left half is opaque, where a double click goes into cropping it.
    const photo = core.stagePoint(740, 1000, 'sq')
    expect(dots(editor, 'photo')).toHaveLength(4)
    mouse.dblclick(photo.x, photo.y)
    expect(modules.selection.cropping()).not.toBeNull()
    expect(shown(editor)).toEqual([])
    editor.end()
  })

  it('draws the dot under the pointer big, none big with the deep key held or once the pointer leaves', async () => {
    const editor = await open()
    const { mouse, keys } = editor
    const dot = dotOf(editor, 'plain', 2)
    const big = () => shown(editor).flatMap((d) => (d.big ? [d.corner] : []))
    mouse.move(dot.at.x + 3, dot.at.y)
    expect(big()).toEqual([2])
    mouse.move(dot.at.x + DOT_REACH + 1, dot.at.y)
    expect(big()).toEqual([])
    mouse.move(dot.at.x, dot.at.y)
    keys.down('Control')
    mouse.move(dot.at.x, dot.at.y + 1)
    expect([shown(editor).length, big()]).toEqual([4, []])
    keys.up('Control')
    mouse.move(dot.at.x, dot.at.y)
    expect(big()).toEqual([2])
    send(editor, 'pointerleave', 'mouse', dot.at)
    expect([shown(editor).length, big()]).toEqual([4, []])
    editor.end()
  })

  it('draws no dot big once the pointer leaves the stage, before any redraw', async () => {
    const editor = await open()
    const { core, mouse } = editor
    const dot = dotOf(editor, 'plain', 2)
    const big = () => shown(editor).flatMap((d) => (d.big ? [d.corner] : []))
    mouse.move(dot.at.x, dot.at.y)
    expect(big()).toEqual([2])
    const keys = { shiftKey: false, altKey: false, ctrlKey: false, metaKey: false }
    core.input.pointer({ type: 'pointerleave', at: dot.at, button: 0, detail: 0, ...keys, pointerType: 'mouse' })
    expect([shown(editor).length, big()]).toEqual([4, []])
    editor.end()
  })

  it('draws the dot under the pointer big as its drag is released, before any redraw', async () => {
    const editor = await open()
    const { core, mouse } = editor
    core.setRadius(['plain'], () => 30)
    const dot = dotOf(editor, 'plain')
    const big = () => shown(editor).flatMap((d) => (d.big ? [d.corner] : []))
    const end = { x: dot.at.x + 10, y: dot.at.y + 10 }
    mouse.move(dot.at.x, dot.at.y)
    mouse.down()
    mouse.move(dot.at.x + 5, dot.at.y + 5)
    mouse.move(end.x, end.y)
    expect(big()).toEqual([0])
    // The release alone, with no redraw after it.
    const keys = { shiftKey: false, altKey: false, ctrlKey: false, metaKey: false }
    core.input.pointer({ type: 'pointerup', at: end, button: 0, detail: 0, ...keys, pointerType: 'mouse' })
    expect([shapeOf(editor, 'plain').cornerRadius, grabAt(editor, end)?.kind, big()]).toEqual([40, 'radius', [0]])
    editor.end()
  })
})

describe('where radius dots sit', () => {
  it('sits 12px in at radius 0, at the centre of the arc past it, at the limit and a lone corner’s top', async () => {
    const editor = await open()
    const place = (id: string) => dots(editor, id).map((d) => [r2(d.x), r2(d.y)])
    expect(place('plain')).toEqual([
      [12, 12],
      [188, 12],
      [188, 108],
      [12, 108],
    ])
    expect(place('four')).toEqual([
      [12, 12],
      [160, 40],
      [188, 108],
      [20, 100],
    ])
    expect(place('over')).toEqual([
      [60, 60],
      [140, 60],
      [140, 60],
      [60, 60],
    ])
    const corner = dotOf(editor, 'plain', 1)
    dragDot(editor, corner.at, { x: corner.at.x - 400, y: corner.at.y + 400 }, { alt: true })
    expect(place('plain')).toEqual([
      [12, 12],
      [92, 108],
      [188, 108],
      [12, 108],
    ])
    editor.end()
  })

  it('puts a polygon’s and a star’s one dot at its top point, 12px down', async () => {
    const editor = await open()
    expect(dots(editor, 'tri').map((d) => [r2(d.x), r2(d.y), d.corner])).toEqual([[100, 12, 0]])
    const [tip] = dots(editor, 'star')
    expect(tip && [r2(tip.x), tip.y > 12]).toEqual([100, true])
    editor.end()
  })

  it('meets in pairs on a fully rounded box and all four on a square, each press taking the nearest corner’s', async () => {
    const editor = await open()
    const square = dots(editor, 'square')
    expect(new Set(square.map((d) => `${r2(d.at.x)},${r2(d.at.y)}`)).size).toBe(1)
    const c = square[0]?.at ?? { x: 0, y: 0 }
    const grabs = [
      [-2, -2],
      [2, -2],
      [2, 2],
      [-2, 2],
    ].map(([dx = 0, dy = 0]) => grabAt(editor, { x: c.x + dx, y: c.y + dy }))
    expect(grabs.map((g) => (g?.kind === 'radius' ? g.corner : g))).toEqual([0, 1, 2, 3])
    expect(grabAt(editor, { x: c.x + DOT_REACH + 1, y: c.y })).toBeNull()
    // A press just past the dots moves the layer.
    editor.mouse.drag({ x: c.x + DOT_REACH + 1, y: c.y }, { x: c.x + 47, y: c.y })
    expect(editor.core.boxOf('square')).toEqual({ x: 140, y: 800, width: 120, height: 120 })
    const pairs = dots(editor, 'over').map((d) => `${r2(d.at.x)},${r2(d.at.y)}`)
    expect([pairs[0] === pairs[3], pairs[1] === pairs[2], pairs[0] === pairs[1]]).toEqual([true, true, false])
    editor.end()
  })

  it('leaves no point within DOT_REACH of a dot to a resize zone, on a 1px grid round a layer 200 × 120 rounded 20', async () => {
    const editor = await open()
    editor.core.select(['turned'])
    const outer = editor.modules.boxes.selectionBox()
    const on = dots(editor, 'turned')
    const centre = editor.core.stagePoint(200, 360, 'sq')
    let reached = 0
    for (let x = -130; x <= 130; x++)
      for (let y = -130; y <= 130; y++) {
        const p = { x: centre.x + x, y: centre.y + y }
        if (!on.some((d) => Math.hypot(d.at.x - p.x, d.at.y - p.y) <= DOT_REACH)) continue
        reached++
        expect(editor.modules.transformDrag.handleUnder(p)?.kind).not.toBe('resize')
        expect(grabAt(editor, p)?.kind).toBe('radius')
      }
    expect(outer?.drawn.rotation).toBe(30)
    expect(reached).toBeGreaterThan(4 * 100)
    editor.end()
  })
})

describe('a press on a radius dot', () => {
  it('as a click changes nothing and keeps the selection; the cursor stays the arrow, Alt held too', async () => {
    const editor = await open()
    const { core, mouse, keys } = editor
    const dot = dotOf(editor, 'holder')
    mouse.click(dot.at.x, dot.at.y)
    expect([core.canUndo(), core.selection()]).toEqual([false, ['holder']])
    mouse.move(dot.at.x, dot.at.y)
    expect(editor.modules.pointer.cursor()).toBe('')
    keys.down('Alt')
    expect(editor.modules.pointer.cursor()).toBe('')
    // With the deep key too, the press passes over the dot and moves a copy: the cursor says so.
    keys.down('Control')
    mouse.move(dot.at.x, dot.at.y + 1)
    expect(editor.modules.pointer.cursor()).toBe('copy')
    keys.up('Control')
    keys.up('Alt')
    editor.end()
  })

  it('with Alt held, then the deep key, the pointer still: the cursor, the big dot and the press all pass over the dot', async () => {
    const editor = await open()
    const { mouse, keys, modules } = editor
    const dot = dotOf(editor, 'holder')
    const big = () => shown(editor).flatMap((d) => (d.big ? [d.corner] : []))
    mouse.move(dot.at.x, dot.at.y)
    keys.down('Alt')
    expect([modules.pointer.cursor(), big()]).toEqual(['', [0]])
    keys.down('Control')
    expect([modules.pointer.cursor(), big()]).toEqual(['copy', []])
    mouse.down()
    const g = modules.pointer.gesture()
    expect([g?.kind, g?.kind === 'move' && modules.transformDrag.carries(g)]).toEqual(['move', true])
    mouse.up()
    keys.up('Control')
    keys.up('Alt')
    editor.end()
  })

  it('with the deep key, then Alt, then the deep key let go, the pointer still: the cursor, the big dot and the press all take the dot', async () => {
    const editor = await open()
    const { mouse, keys, modules } = editor
    const dot = dotOf(editor, 'holder')
    const big = () => shown(editor).flatMap((d) => (d.big ? [d.corner] : []))
    mouse.move(dot.at.x, dot.at.y)
    keys.down('Control')
    keys.down('Alt')
    expect([modules.pointer.cursor(), big()]).toEqual(['copy', []])
    keys.up('Control')
    expect([modules.pointer.cursor(), big()]).toEqual(['', [0]])
    mouse.down()
    expect(modules.pointer.gesture()?.kind).toBe('radius')
    mouse.up()
    keys.up('Alt')
    editor.end()
  })

  it('with the deep key grabs no dot: it selects the layer the deep hover outlines, and the dots stay drawn', async () => {
    const editor = await open()
    const { core, mouse, keys, modules } = editor
    const dot = dotOf(editor, 'holder')
    keys.down('Control')
    mouse.move(dot.at.x, dot.at.y)
    expect([shown(editor).length, modules.selection.hovered()?.id]).toEqual([4, 'inner'])
    mouse.down()
    expect(modules.pointer.gesture()?.kind).toBe('move')
    mouse.move(dot.at.x + 21, dot.at.y + 20)
    mouse.up()
    keys.up('Control')
    expect([core.selection(), props(editor, 'holder').cornerRadius, core.boxOf('inner')?.x]).toEqual([
      ['inner'],
      0,
      121,
    ])
    const again = dotOf(editor, 'holder')
    mouse.move(again.at.x, again.at.y)
    mouse.down()
    expect(modules.pointer.gesture()?.kind).toBe('radius')
    mouse.up()
    editor.end()
  })

  it('under a frame’s label goes to the label', async () => {
    const editor = await open()
    const { core, mouse } = editor
    core.select(['plain'])
    const dot = dotOf(editor, 'plain')
    const label = editor.modules.view.frames().find((f) => f.id === 'sq')
    expect(label).toBeDefined()
    // The label takes a press under it before a dot, as it does before a layer.
    core.input.pointer({
      type: 'pointerdown',
      at: dot.at,
      button: 0,
      detail: 0,
      shiftKey: false,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      pointerType: 'mouse',
      label: 'sq',
    })
    expect(editor.modules.pointer.gesture()?.kind).toBe('frameMove')
    mouse.up()
    editor.end()
  })
})
