import { describe, expect, it } from 'vitest'

import { Design, type Layer } from '@dazbee/schema'

import { pairsIn } from '../selection.ts'
import { matchable, sameAs, sameByOf, selectedSame } from './select-same.ts'

const red = [{ type: 'solid', color: '#ff0000ff' }]
const blue = [{ type: 'solid', color: '#0000ffff' }]
const rect = (parentId: string, index: string, fills: unknown[], extra: Record<string, unknown> = {}) => ({
  type: 'graphic',
  parentId,
  link: `${parentId}-${index}`,
  index,
  name: 'Rect',
  ...extra,
  props: { x: 0, y: 0, width: 10, height: 10, shape: { kind: 'rect' }, fills, ...(extra.props as object) },
})
const text = (parentId: string, index: string, style: Record<string, unknown>) => ({
  type: 'text',
  parentId,
  link: `${parentId}-${index}`,
  index,
  name: 'Text',
  props: { x: 0, y: 0, width: 10, height: 10, text: 'Hi', style: { fontSize: 20, color: '#000000ff', ...style } },
})
/**
 * Two pages. The first page's first frame holds a red rect, a blue one, a group holding a red rect
 * and an Inter text; its second a hidden red box, a red rect locked in place, an empty rect, an Inter
 * text, a bold Inter text, a Lora one, a red mask and a blue boolean of a red rect. The second page
 * holds a red rect and an Inter text.
 */
const design: Design = Design.parse({
  meta: { designId: 'd', name: 'D' },
  pages: { p1: { name: 'One', order: 'a0' }, p2: { name: 'Two', order: 'a1' } },
  frames: {
    f1: { pageId: 'p1', name: 'F1', width: 100, height: 100, x: 0, y: 0, order: 'a0' },
    f2: { pageId: 'p1', name: 'F2', width: 100, height: 100, x: 200, y: 0, order: 'a1' },
    g1: { pageId: 'p2', name: 'G1', width: 100, height: 100, x: 0, y: 0, order: 'a0' },
  },
  nodes: {
    red: rect('f1', 'a0', red),
    blue: rect('f1', 'a1', blue),
    group: {
      type: 'group',
      parentId: 'f1',
      link: 'group',
      index: 'a2',
      name: 'G',
      props: { x: 0, y: 0, width: 10, height: 10 },
    },
    inner: rect('group', 'a0', red),
    inter: text('f1', 'a3', { fontFamily: 'Inter' }),
    hidden: {
      type: 'box',
      parentId: 'f2',
      link: 'hidden',
      index: 'a0',
      name: 'Box',
      props: { x: 0, y: 0, width: 10, height: 10, fills: red, visible: false },
    },
    pinned: rect('f2', 'a1', red, { lock: { move: true } }),
    empty: rect('f2', 'a2', []),
    inter2: text('f2', 'a3', { fontFamily: 'Inter' }),
    bold: text('f2', 'a4', { fontFamily: 'Inter', fontWeight: 700 }),
    lora: text('f2', 'a5', { fontFamily: 'Lora' }),
    mask: rect('f2', 'a6', red, { props: { mask: 'alpha' } }),
    shape: {
      type: 'boolean',
      parentId: 'f2',
      link: 'shape',
      index: 'a7',
      name: 'Shape',
      props: { x: 0, y: 0, width: 10, height: 10, fills: blue },
    },
    operand: rect('shape', 'a0', red),
    other: rect('g1', 'a0', red),
    otherText: text('g1', 'a1', { fontFamily: 'Inter' }),
  },
})

describe('sameAs', () => {
  it("finds every layer of the page with the layer's fill, at any depth, hidden ones too, the layer first", () => {
    expect(sameAs(design, { id: 'inner', frameId: 'f1' }, 'fill')).toEqual([
      ...pairsIn('f1', ['inner', 'red']),
      ...pairsIn('f2', ['hidden']),
    ])
    expect(sameAs(design, { id: 'blue', frameId: 'f1' }, 'fill')).toEqual([
      ...pairsIn('f1', ['blue']),
      ...pairsIn('f2', ['shape']),
    ])
  })

  it('leaves out layers locked in place, masks and the shapes inside a boolean, whose fills are not drawn', () => {
    const found = sameAs(design, { id: 'red', frameId: 'f1' }, 'fill').map(({ id }) => id)
    expect(found).not.toContain('pinned')
    expect(found).not.toContain('mask')
    expect(found).not.toContain('operand')
    // A layer locked in place that is selected is still matched from.
    expect(sameAs(design, { id: 'pinned', frameId: 'f2' }, 'fill')[0]).toEqual({ id: 'pinned', frameId: 'f2' })
  })

  it("finds every text of the page in the text's family, weight and style", () => {
    expect(sameAs(design, { id: 'inter2', frameId: 'f2' }, 'font')).toEqual([
      ...pairsIn('f2', ['inter2']),
      ...pairsIn('f1', ['inter']),
    ])
    expect(sameAs(design, { id: 'bold', frameId: 'f2' }, 'font')).toEqual(pairsIn('f2', ['bold']))
  })

  it('finds nothing for a layer with no fill, a fill for a text, a font for a shape, or a layer gone', () => {
    expect(sameAs(design, { id: 'empty', frameId: 'f2' }, 'fill')).toEqual([])
    expect(sameAs(design, { id: 'group', frameId: 'f1' }, 'fill')).toEqual([])
    expect(sameAs(design, { id: 'inter', frameId: 'f1' }, 'fill')).toEqual([])
    expect(sameAs(design, { id: 'red', frameId: 'f1' }, 'font')).toEqual([])
    expect(sameAs(design, { id: 'gone', frameId: 'f1' }, 'fill')).toEqual([])
  })
})

describe('sameByOf', () => {
  it('says what each Select all with same action matches by, and null for any other action', () => {
    expect(sameByOf('selectSameFill')).toBe('fill')
    expect(sameByOf('selectSameFont')).toBe('font')
    expect(sameByOf('selectAll')).toBeNull()
  })
})

describe('selectedSame', () => {
  it('selects the matches of the first selected layer, and nothing when that changes nothing', () => {
    const matches = [...pairsIn('f1', ['red', 'inner']), ...pairsIn('f2', ['hidden'])]
    expect(selectedSame(design, pairsIn('f1', ['red', 'blue']), 'fill')).toEqual(matches)
    expect(selectedSame(design, matches, 'fill')).toBeNull()
    // Picked in another order, the matches are what is selected already.
    expect(
      selectedSame(
        design,
        [...pairsIn('f1', ['red']), ...pairsIn('f2', ['hidden']), ...pairsIn('f1', ['inner'])],
        'fill',
      ),
    ).toBeNull()
    expect(selectedSame(design, pairsIn('f2', ['lora']), 'font')).toBeNull()
    expect(selectedSame(design, pairsIn('f1', ['blue', 'red']), 'fill')).toEqual([
      ...pairsIn('f1', ['blue']),
      ...pairsIn('f2', ['shape']),
    ])
    expect(selectedSame(design, pairsIn('f2', ['empty']), 'fill')).toBeNull()
    expect(selectedSame(design, [], 'font')).toBeNull()
  })
})

describe('matchable', () => {
  it('says whether a layer has a fill or a font to match others by', () => {
    const node = (id: string) => design.nodes[id] as Layer
    expect(matchable(node('red'), 'fill')).toBe(true)
    expect(matchable(node('empty'), 'fill')).toBe(false)
    expect(matchable(node('inter'), 'fill')).toBe(false)
    expect(matchable(node('inter'), 'font')).toBe(true)
    expect(matchable(node('group'), 'font')).toBe(false)
    expect(matchable(undefined, 'fill')).toBe(false)
  })
})
