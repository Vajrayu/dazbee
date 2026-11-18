// Grid auto layout, through scene building, with the stand-in measure of test-layout.ts.
import { describe, expect, it } from 'vitest'

import { gridCells } from './layout.ts'
import type { SceneLayer } from './scene.ts'
import { box, boxLayer, laidOut, layout, nestedIn, PAD, rect, scene, text } from './test-layout.ts'

describe('grid', () => {
  const grid = (props: Record<string, unknown>) => layout({ direction: 'grid', ...props })
  const tile = (index: string, width: number, height: number, props: Record<string, unknown> = {}) =>
    rect('g', index, { ...box(0, 0, width, height), ...props })

  it('splits a fixed width into equal columns, row after row, each row as tall as its tallest layer', () => {
    const get = scene({
      g: boxLayer('sq', 'a0', {
        ...box(100, 100, 330, 10),
        sizing: { width: 'fixed', height: 'hug' },
        layout: grid({ columns: 3, gap: 10, padding: PAD(5) }),
      }),
      a: tile('a0', 60, 20),
      b: tile('a1', 80, 40),
      c: tile('a2', 50, 30),
      d: tile('a3', 60, 20),
      e: tile('a4', 60, 20),
      f: tile('a5', 60, 50),
    })
    expect([get('a'), get('b'), get('c')]).toEqual([
      box(105, 105, 60, 20),
      box(215, 105, 80, 40),
      box(325, 105, 50, 30),
    ])
    expect([get('d'), get('e'), get('f')]).toEqual([
      box(105, 155, 60, 20),
      box(215, 155, 60, 20),
      box(325, 155, 60, 50),
    ])
    expect(get('g')).toEqual(box(100, 100, 330, 110))
  })

  it('fits its width to every column, as wide as its widest layer, though fewer layers than columns', () => {
    const get = scene({
      g: boxLayer('sq', 'a0', {
        ...box(0, 0, 10, 10),
        sizing: { width: 'hug', height: 'hug' },
        layout: grid({ columns: 3, gap: 10, padding: PAD(4) }),
      }),
      a: tile('a0', 60, 20),
      b: tile('a1', 80, 30),
    })
    expect(get('a')).toEqual(box(4, 4, 60, 20))
    expect(get('b')).toEqual(box(94, 4, 80, 30))
    expect(get('g')).toEqual(box(0, 0, 268, 38))
  })

  it("fills a cell's width and its row's height", () => {
    const get = scene({
      g: boxLayer('sq', 'a0', { ...box(0, 0, 320, 300), layout: grid({ columns: 3, gap: 10 }) }),
      wide: tile('a0', 20, 20, { sizing: { width: 'fill', height: 'fixed' } }),
      tall: tile('a1', 20, 20, { sizing: { width: 'fixed', height: 'fill' } }),
      sets: tile('a2', 20, 60),
    })
    expect(get('wide')).toEqual(box(0, 0, 100, 20))
    expect(get('tall')).toEqual(box(110, 0, 20, 60))
  })

  it('takes the widest layer that does not fill as its columns when it fits its width, and keeps own sizes where all fill', () => {
    const fit = { ...box(0, 0, 10, 10), sizing: { width: 'hug', height: 'hug' }, layout: grid({ columns: 2 }) }
    const some = scene({
      g: boxLayer('sq', 'a0', fit),
      wide: tile('a0', 500, 20, { sizing: { width: 'fill', height: 'fixed' } }),
      set: tile('a1', 70, 20),
    })
    expect(some('wide')).toEqual(box(0, 0, 70, 20))
    expect(some('g')).toEqual(box(0, 0, 140, 20))
    const all = scene({
      g: boxLayer('sq', 'a0', fit),
      a: tile('a0', 50, 20, { sizing: { width: 'fill', height: 'fill' } }),
      b: tile('a1', 90, 30, { sizing: { width: 'fill', height: 'fill' } }),
    })
    expect(all('a')).toEqual(box(0, 0, 50, 20))
    expect(all('b')).toEqual(box(90, 0, 90, 30))
    expect(all('g')).toEqual(box(0, 0, 180, 30))
  })

  it('keeps own sizes where all fill in a grid that fits its width nested one and two levels deep, as at the top', () => {
    const fills = { sizing: { width: 'fill', height: 'fill' } }
    const nodes = {
      g: boxLayer('sq', 'a0', {
        ...box(0, 0, 10, 10),
        sizing: { width: 'hug', height: 'hug' },
        layout: grid({ columns: 2 }),
      }),
      a: tile('a0', 50, 20, fills),
      b: tile('a1', 90, 30, fills),
    }
    for (const depth of [1, 2]) {
      const get = scene(nestedIn(depth, 'g', nodes))
      expect([get('a'), get('b'), get('g')]).toEqual([box(0, 0, 50, 20), box(90, 0, 90, 30), box(0, 0, 180, 30)])
    }
  })

  it("lines a layer up across its cell's width and down its row's height, and spreads nothing out", () => {
    const at = (justify: string, align: string) =>
      scene({
        g: boxLayer('sq', 'a0', { ...box(0, 0, 210, 300), layout: grid({ columns: 2, gap: 10, justify, align }) }),
        a: tile('a0', 40, 20),
        b: tile('a1', 40, 60),
      })('a')
    expect(at('center', 'center')).toEqual(box(30, 20, 40, 20))
    expect(at('end', 'end')).toEqual(box(60, 40, 40, 20))
    expect(at('space-between', 'start')).toEqual(box(0, 0, 40, 20))
  })

  it('measures text that fits its height at the width of the cell it fills', () => {
    const get = scene({
      g: boxLayer('sq', 'a0', {
        ...box(0, 0, 210, 10),
        sizing: { width: 'fixed', height: 'hug' },
        layout: grid({ columns: 2, gap: 10 }),
      }),
      words: text('g', 'a0', 'aaaa bbbb cccc', { boxMode: 'autoHeight', sizing: { width: 'fill', height: 'hug' } }),
    })
    expect(get('words')).toEqual(box(0, 0, 100, 40))
    expect(get('g')).toEqual(box(0, 0, 210, 40))
  })

  it('lets a layer wider than its cell run past it, and leaves an absolute layer where it is put', () => {
    const get = scene({
      g: boxLayer('sq', 'a0', { ...box(0, 0, 210, 100), layout: grid({ columns: 2, gap: 10 }) }),
      wide: tile('a0', 150, 20),
      next: tile('a1', 20, 20),
      badge: tile('a2', 30, 30, { ...box(400, 400, 30, 30), absolute: true }),
    })
    expect(get('wide')).toEqual(box(0, 0, 150, 20))
    expect(get('next')).toEqual(box(110, 0, 20, 20))
    expect(get('badge')).toEqual(box(400, 400, 30, 30))
  })

  it('gives its cells, row after row, on to the end of its last row, each a cell wide and its row tall', () => {
    const all = laidOut({
      g: boxLayer('sq', 'a0', {
        ...box(100, 100, 330, 10),
        sizing: { width: 'fixed', height: 'hug' },
        layout: grid({ columns: 3, gap: 10, padding: PAD(5) }),
      }),
      a: tile('a0', 60, 20),
      b: tile('a1', 80, 40),
      c: tile('a2', 50, 30),
      d: tile('a3', 60, 20),
      e: tile('a4', 60, 20),
      row: boxLayer('sq', 'a1', { layout: layout({}) }),
      inRow: rect('row', 'a0', {}),
      empty: boxLayer('sq', 'a2', { layout: grid({}) }),
    })
    const cells = (id: string) => gridCells(all.get(id) as SceneLayer)
    expect(cells('g')).toEqual([
      box(105, 105, 100, 40),
      box(215, 105, 100, 40),
      box(325, 105, 100, 40),
      box(105, 155, 100, 20),
      box(215, 155, 100, 20),
      box(325, 155, 100, 20),
    ])
    expect(cells('row')).toEqual([])
    expect(cells('empty')).toEqual([])
  })

  it('lays out a grid that a row places, its cells moved with it', () => {
    const nodes = {
      row: boxLayer('sq', 'a0', { ...box(100, 100, 600, 200), layout: layout({ gap: 20 }) }),
      first: rect('row', 'a0', box(0, 0, 50, 50)),
      g: boxLayer('row', 'a1', {
        ...box(900, 900, 10, 10),
        sizing: { width: 'hug', height: 'hug' },
        layout: grid({ columns: 2, gap: 5 }),
      }),
      a: tile('a0', 30, 30),
      b: tile('a1', 30, 30),
      c: tile('a2', 30, 30),
    }
    const get = scene(nodes)
    expect(get('g')).toEqual(box(170, 100, 65, 65))
    const cell = (x: number, y: number) => box(x, y, 30, 30)
    const cells = gridCells(laidOut(nodes).get('g') as SceneLayer)
    expect(cells).toEqual([cell(170, 100), cell(205, 100), cell(170, 135), cell(205, 135)])
    expect([get('a'), get('b'), get('c')]).toEqual([
      box(170, 100, 30, 30),
      box(205, 100, 30, 30),
      box(170, 135, 30, 30),
    ])
  })
})
