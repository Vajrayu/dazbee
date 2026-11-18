import { describe, expect, it } from 'vitest'

import { laidOutBox, placedByFlow } from '@dazbee/doc'
import { type Design, parseDesign } from '@dazbee/schema'

import { flowSiblings, laidOut, placedInside, propIn, rowIn } from './auto-layout.ts'

const box = { x: 0, y: 0, width: 100, height: 100 }
const rect = (parentId: string, index: string, link: string, extra: Record<string, unknown> = {}) => ({
  type: 'graphic',
  parentId,
  link,
  index,
  name: 'Rect',
  props: { ...box, shape: { kind: 'rect' }, ...extra },
})

/**
 * One page with a square frame and a banner. In each, `row` lays out `a`, `b` (absolute) and the
 * group `g` in a row, and `free` sits beside it; `col` holds `c`, laid out in a column only in the
 * banner. The banner's layers are the square's linked copies, `banner-<id>`.
 */
const design: Design = (() => {
  const parsed = parseDesign({
    meta: { designId: 'd', name: 'D' },
    pages: { p1: { name: 'Page 1', order: 'a0' } },
    frames: {
      sq: { pageId: 'p1', name: 'Square', width: 1080, height: 1080, x: 0, y: 0, order: 'a0' },
      banner: { pageId: 'p1', name: 'Banner', width: 320, height: 50, x: 1280, y: 0, order: 'a1' },
    },
    nodes: {
      row: {
        type: 'box',
        parentId: 'sq',
        link: 'row',
        index: 'a0',
        name: 'Row',
        props: { ...box, layout: { direction: 'row', gap: 8 } },
      },
      a: rect('row', 'a0', 'a'),
      b: rect('row', 'a1', 'b', { absolute: true }),
      g: { type: 'group', parentId: 'row', link: 'g', index: 'a2', name: 'Group', props: box },
      inner: rect('g', 'a0', 'inner'),
      col: { type: 'box', parentId: 'sq', link: 'col', index: 'a1', name: 'Column', props: box },
      c: rect('col', 'a0', 'c'),
      free: rect('sq', 'a2', 'free'),
      'banner-row': {
        type: 'box',
        parentId: 'banner',
        link: 'row',
        index: 'a0',
        name: 'Row',
        props: { ...box, layout: { direction: 'row', gap: 8 } },
      },
      'banner-a': rect('banner-row', 'a0', 'a'),
      'banner-b': rect('banner-row', 'a1', 'b', { absolute: true }),
      'banner-g': { type: 'group', parentId: 'banner-row', link: 'g', index: 'a2', name: 'Group', props: box },
      'banner-inner': rect('banner-g', 'a0', 'inner'),
      'banner-col': {
        type: 'box',
        parentId: 'banner',
        link: 'col',
        index: 'a1',
        name: 'Column',
        props: { ...box, layout: { direction: 'column' } },
      },
      'banner-c': rect('banner-col', 'a0', 'c'),
      'banner-free': rect('banner', 'a2', 'free'),
    },
  })
  if (!parsed.success) throw new Error(parsed.errors.join('\n'))
  return parsed.design
})()

describe('propIn', () => {
  it("reads a layer's own property, which its copy in another frame may not share", () => {
    expect(propIn('col', 'layout', design)).toBeUndefined()
    expect(propIn('banner-col', 'layout', design)).toMatchObject({ direction: 'column' })
    expect(propIn('row', 'layout', design)).toMatchObject({ direction: 'row', gap: 8 })
    expect(propIn('missing', 'layout', design)).toBeUndefined()
  })
})

describe('rowIn', () => {
  it('is a row unless the layout runs in a column', () => {
    expect(rowIn('row', design)).toBe(true)
    expect(rowIn('banner-col', design)).toBe(false)
    expect(rowIn('col', design)).toBe(true)
  })
})

describe('laidOutBox', () => {
  it('holds for a box with auto layout', () => {
    expect(laidOutBox(design, 'row')).toBe(true)
    expect(laidOutBox(design, 'col')).toBe(false)
    expect(laidOutBox(design, 'banner-col')).toBe(true)
    expect(laidOutBox(design, 'a')).toBe(false)
    expect(laidOutBox(design, 'missing')).toBe(false)
  })
})

describe('placedByFlow', () => {
  it('holds for a layer its parent places, not an absolute one', () => {
    expect(placedByFlow(design, 'a')).toBe(true)
    expect(placedByFlow(design, 'g')).toBe(true)
    expect(placedByFlow(design, 'b')).toBe(false)
    expect(placedByFlow(design, 'inner')).toBe(false)
    expect(placedByFlow(design, 'free')).toBe(false)
  })

  it('follows its own parent: the copy in a column only the banner lays out', () => {
    expect(placedByFlow(design, 'c')).toBe(false)
    expect(placedByFlow(design, 'banner-c')).toBe(true)
  })
})

describe('laidOut', () => {
  it('holds for an auto layout box and anything inside one', () => {
    for (const id of ['row', 'a', 'b', 'g', 'inner', 'banner-col', 'banner-c'])
      expect(laidOut(id, design), id).toBe(true)
    for (const id of ['free', 'col', 'c']) expect(laidOut(id, design), id).toBe(false)
  })
})

describe('placedInside', () => {
  it('holds when the layer, or what holds it below the root, is in a flow', () => {
    expect(placedInside('inner', 'row', design)).toBe(true)
    expect(placedInside('a', 'row', design)).toBe(true)
    expect(placedInside('inner', 'g', design)).toBe(false)
    expect(placedInside('c', 'col', design)).toBe(false)
    expect(placedInside('banner-c', 'banner-col', design)).toBe(true)
  })
})

describe('flowSiblings', () => {
  it('lists the layers in the flow, in order, without the ones moving', () => {
    expect(flowSiblings('row', [], design)).toEqual(['a', 'g'])
    expect(flowSiblings('row', ['a'], design)).toEqual(['g'])
    expect(flowSiblings('col', [], design)).toEqual([])
    expect(flowSiblings('banner-col', [], design)).toEqual(['banner-c'])
  })
})
