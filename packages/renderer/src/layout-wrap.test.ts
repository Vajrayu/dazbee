// Wrapping rows and columns, and the room between a grid's rows, through scene building, with the
// stand-in measure of test-layout.ts.
import { describe, expect, it } from 'vitest'

import { box, boxLayer, layout, type Node, PAD, rect, scene } from './test-layout.ts'

/** A row 300 wide with 10 around and between, that wraps and fits its height, holding `children` by id. */
function wrapping(props: Record<string, unknown>, children: Record<string, Node>) {
  return scene({
    w: boxLayer('sq', 'a0', {
      ...box(0, 0, 300, 100),
      sizing: { width: 'fixed', height: 'hug' },
      ...props,
      layout: layout({ wrap: true, gap: 10, padding: PAD(10), ...(props.layout as object) }),
    }),
    ...children,
  })
}
const tile = (index: string, width: number, height: number, props: Record<string, unknown> = {}) =>
  rect('w', index, { ...box(0, 0, width, height), ...props })

describe('wrap', () => {
  it('runs a row onto a new line where the next layer would pass its length, the lines lineGap apart, and fits their height', () => {
    const get = wrapping(
      { layout: { lineGap: 20 } },
      { a: tile('a0', 100, 40), b: tile('a1', 100, 40), c: tile('a2', 100, 40) },
    )
    // 280 inside: a and b take 210, and c would take 320.
    expect([get('a'), get('b'), get('c')]).toEqual([box(10, 10, 100, 40), box(120, 10, 100, 40), box(10, 70, 100, 40)])
    expect(get('w')).toEqual(box(0, 0, 300, 120))
  })

  it('puts lines gap apart while the box sets no line gap', () => {
    const get = wrapping({}, { a: tile('a0', 200, 40), b: tile('a1', 200, 40) })
    expect(get('b')).toEqual(box(10, 60, 200, 40))
  })

  it('gives a layer longer than the line a line of its own, and none empty before it', () => {
    const get = wrapping({}, { a: tile('a0', 400, 40), b: tile('a1', 50, 40) })
    expect(get('a')).toEqual(box(10, 10, 400, 40))
    expect(get('b')).toEqual(box(10, 60, 50, 40))
  })

  it('lines up each line along the flow on its own', () => {
    const get = wrapping(
      { layout: { justify: 'center' } },
      { a: tile('a0', 100, 40), b: tile('a1', 100, 40), c: tile('a2', 100, 40) },
    )
    expect([get('a'), get('b'), get('c')]).toEqual([box(45, 10, 100, 40), box(155, 10, 100, 40), box(100, 60, 100, 40)])
  })

  it('makes each line as tall as its tallest layer, lining layers up across it, and packs the lines where align puts them', () => {
    const get = wrapping(
      { sizing: { width: 'fixed', height: 'fixed' }, height: 200, layout: { align: 'center', lineGap: 20 } },
      { a: tile('a0', 100, 40), b: tile('a1', 100, 20), c: tile('a2', 100, 30) },
    )
    // Lines of 40 and 30, 20 apart, leave 90 of the 180 inside: they start 45 down.
    expect([get('a'), get('b'), get('c')]).toEqual([box(10, 55, 100, 40), box(120, 65, 100, 20), box(10, 115, 100, 30)])
  })

  it('spreads the lines with the room left between them', () => {
    const get = wrapping(
      {
        sizing: { width: 'fixed', height: 'fixed' },
        height: 200,
        layout: { alignLines: 'space-between', lineGap: 20 },
      },
      { a: tile('a0', 200, 40), b: tile('a1', 200, 30) },
    )
    expect(get('b')).toEqual(box(10, 160, 200, 30))
  })

  it('counts a layer that fills along the flow as its least width when breaking, then shares its line’s room with it', () => {
    const fill = { sizing: { width: 'fill', height: 'fixed' } }
    const loose = wrapping({}, { a: tile('a0', 100, 40), f: tile('a1', 10, 40, fill), b: tile('a2', 200, 40) })
    expect([loose('a'), loose('f'), loose('b')]).toEqual([
      box(10, 10, 100, 40),
      box(120, 10, 170, 40),
      box(10, 60, 200, 40),
    ])
    const least = wrapping(
      {},
      { a: tile('a0', 100, 40), f: tile('a1', 10, 40, { ...fill, minWidth: 200 }), b: tile('a2', 200, 40) },
    )
    expect([least('a'), least('f'), least('b')]).toEqual([
      box(10, 10, 100, 40),
      box(10, 60, 280, 40),
      box(10, 110, 200, 40),
    ])
  })

  it('stretches a layer that fills across the flow to its line’s height', () => {
    const fill = { sizing: { width: 'fixed', height: 'fill' } }
    const get = wrapping(
      {},
      { a: tile('a0', 100, 40), f: tile('a1', 100, 10, fill), c: tile('a2', 200, 30), g: tile('a3', 50, 10, fill) },
    )
    expect(get('f')).toEqual(box(120, 10, 100, 40))
    expect(get('g')).toEqual(box(220, 60, 50, 30))
  })

  it('shares the room left among the lines when every layer fills across the flow', () => {
    const fill = { sizing: { width: 'fixed', height: 'fill' } }
    const get = wrapping(
      { sizing: { width: 'fixed', height: 'fixed' }, height: 200 },
      { a: tile('a0', 200, 40, fill), b: tile('a1', 200, 30, fill) },
    )
    // 180 inside less 40, 30 and 10 between leaves 100, 50 more for each line.
    expect(get('a')).toEqual(box(10, 10, 200, 90))
    expect(get('b')).toEqual(box(10, 110, 200, 80))
  })

  it('lays a box that fits its length along the flow out in one line', () => {
    const get = wrapping(
      { sizing: { width: 'hug', height: 'hug' } },
      { a: tile('a0', 200, 40), b: tile('a1', 200, 40) },
    )
    expect(get('b')).toEqual(box(220, 10, 200, 40))
    expect(get('w')).toEqual(box(0, 0, 430, 60))
  })

  it('wraps a column onto lines across, fitting its width to them', () => {
    const get = scene({
      w: boxLayer('sq', 'a0', {
        ...box(0, 0, 10, 100),
        sizing: { width: 'hug', height: 'fixed' },
        layout: layout({ direction: 'column', wrap: true, gap: 10 }),
      }),
      a: tile('a0', 40, 40),
      b: tile('a1', 40, 40),
      c: tile('a2', 40, 40),
    })
    expect([get('a'), get('b'), get('c')]).toEqual([box(0, 0, 40, 40), box(0, 50, 40, 40), box(50, 0, 40, 40)])
    expect(get('w')).toEqual(box(0, 0, 90, 100))
  })

  it('leaves a grid as it lays it out, though set to wrap', () => {
    const grid = (props: Record<string, unknown>) =>
      scene({
        w: boxLayer('sq', 'a0', {
          ...box(0, 0, 210, 10),
          sizing: { width: 'fixed', height: 'hug' },
          layout: layout({ direction: 'grid', columns: 2, gap: 10, ...props }),
        }),
        a: tile('a0', 300, 40),
        b: tile('a1', 50, 40),
        c: tile('a2', 50, 40),
      })
    expect(grid({ wrap: true })('c')).toEqual(grid({})('c'))
  })
})

describe('the room between a grid’s rows', () => {
  it('puts its rows lineGap apart, and gap apart while it sets none', () => {
    const grid = (props: Record<string, unknown>) =>
      scene({
        w: boxLayer('sq', 'a0', {
          ...box(0, 0, 210, 10),
          sizing: { width: 'fixed', height: 'hug' },
          layout: layout({ direction: 'grid', columns: 2, gap: 10, ...props }),
        }),
        a: tile('a0', 50, 40),
        b: tile('a1', 50, 40),
        c: tile('a2', 50, 40),
      })
    const spaced = grid({ lineGap: 30 })
    expect(spaced('c')).toEqual(box(0, 70, 50, 40))
    expect(spaced('w')).toEqual(box(0, 0, 210, 110))
    expect(grid({})('c')).toEqual(box(0, 50, 50, 40))
  })
})
