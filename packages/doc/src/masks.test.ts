import { describe, expect, it } from 'vitest'

import { type DesignInput, parseDesign } from '@dazbee/schema'

import { isMask, isMaskGroup, maskOf, maskSpans, shownAbove } from './masks.ts'

const layer = (parentId: string, index: string, extra: Record<string, unknown> = {}, type = 'graphic') => ({
  type,
  parentId,
  index,
  name: index,
  link: `${parentId}-${index}`,
  props: { x: 0, y: 0, width: 10, height: 10, ...(type === 'graphic' ? { shape: { kind: 'rect' } } : {}), ...extra },
})
const mask = { mask: 'alpha' }
const hidden = { visible: false }

/**
 * One frame holding, bottom to top: a layer under every mask, a mask, a layer, a hidden layer, a
 * layer, a hidden mask, a layer, a second mask and a layer; then a Mask group with a Mask group
 * inside it, a group with two masks, a group with a hidden mask, and a box with a mask.
 */
const DESIGN = {
  meta: { designId: 'd', name: 'D' },
  pages: { p: { name: 'P', order: 'a0' } },
  frames: { f: { pageId: 'p', name: 'F', width: 100, height: 100, x: 0, y: 0, order: 'a0' } },
  nodes: {
    under: layer('f', 'a0'),
    m1: layer('f', 'a1', mask),
    one: layer('f', 'a2'),
    gone: layer('f', 'a3', hidden),
    two: layer('f', 'a4'),
    m2: layer('f', 'a5', { ...mask, ...hidden }),
    three: layer('f', 'a6'),
    m3: layer('f', 'a7', mask),
    four: layer('f', 'a8'),
    g: layer('f', 'a9', {}, 'group'),
    gm: layer('g', 'a0', mask),
    gp: layer('g', 'a1'),
    inner: layer('g', 'a2', {}, 'group'),
    im: layer('inner', 'a0', mask),
    ip: layer('inner', 'a1'),
    twice: layer('f', 'b0', {}, 'group'),
    tm1: layer('twice', 'a0', mask),
    tm2: layer('twice', 'a1', mask),
    veiled: layer('f', 'b1', {}, 'group'),
    vm: layer('veiled', 'a0', { ...mask, ...hidden }),
    vp: layer('veiled', 'a1'),
    boxed: layer('f', 'b2', {}, 'box'),
    bm: layer('boxed', 'a0', mask),
    bp: layer('boxed', 'a1'),
  },
} as unknown as DesignInput

const design = () => {
  const result = parseDesign(DESIGN)
  if (!result.success) throw new Error(result.errors.join('\n'))
  return result.design
}

describe('isMask', () => {
  it('is a layer used as a mask, shown or hidden, and no other layer', () => {
    const { nodes } = design()
    expect(['m1', 'm2', 'gm', 'bm', 'under', 'g', 'boxed'].map((id) => nodes[id] && isMask(nodes[id]))).toEqual([
      true,
      true,
      true,
      true,
      false,
      false,
      false,
    ])
  })
})

describe('isMaskGroup', () => {
  it('is a group whose own layers include exactly one mask, shown or hidden, at any depth', () => {
    const d = design()
    expect(isMaskGroup(d, 'g')).toBe(true)
    expect(isMaskGroup(d, 'inner')).toBe(true)
    expect(isMaskGroup(d, 'veiled')).toBe(true)
  })

  it('is no group with two masks, a box with a mask, a layer, or a missing id', () => {
    const d = design()
    expect(isMaskGroup(d, 'twice')).toBe(false)
    expect(isMaskGroup(d, 'boxed')).toBe(false)
    expect(isMaskGroup(d, 'm1')).toBe(false)
    expect(isMaskGroup(d, 'nope')).toBe(false)
  })
})

describe('maskOf', () => {
  it('finds the nearest shown mask below a shown layer in its parent, past a hidden mask', () => {
    const d = design()
    expect(maskOf(d, 'one')).toBe('m1')
    expect(maskOf(d, 'two')).toBe('m1')
    expect(maskOf(d, 'three')).toBe('m1')
    expect(maskOf(d, 'four')).toBe('m3')
    expect(maskOf(d, 'g')).toBe('m3')
    expect(maskOf(d, 'gp')).toBe('gm')
    expect(maskOf(d, 'inner')).toBe('gm')
    expect(maskOf(d, 'ip')).toBe('im')
  })

  it('finds none for a hidden layer, a mask, a layer with no shown mask below, or one over a hidden mask alone', () => {
    const d = design()
    expect(maskOf(d, 'gone')).toBeNull()
    expect(maskOf(d, 'm3')).toBeNull()
    expect(maskOf(d, 'under')).toBeNull()
    expect(maskOf(d, 'vp')).toBeNull()
    expect(maskOf(d, 'nope')).toBeNull()
  })
})

describe('shownAbove', () => {
  it('finds the nearest shown layer above, skipping hidden ones, a mask counting as one', () => {
    const d = design()
    expect(shownAbove(d, 'under')).toBe('m1')
    expect(shownAbove(d, 'one')).toBe('two')
    expect(shownAbove(d, 'two')).toBe('three')
    expect(shownAbove(d, 'gm')).toBe('gp')
  })

  it('finds none at the top of a parent', () => {
    const d = design()
    expect(shownAbove(d, 'ip')).toBeNull()
    expect(shownAbove(d, 'boxed')).toBeNull()
  })
})

describe('maskSpans', () => {
  it('lists each shown mask with the shown layers it masks, a hidden mask masking nothing', () => {
    const d = design()
    expect(maskSpans(d, 'f')).toEqual([
      { mask: 'm1', masked: ['one', 'two', 'three'] },
      { mask: 'm3', masked: ['four', 'g', 'twice', 'veiled', 'boxed'] },
    ])
    expect(maskSpans(d, 'g')).toEqual([{ mask: 'gm', masked: ['gp', 'inner'] }])
    expect(maskSpans(d, 'twice')).toEqual([
      { mask: 'tm1', masked: [] },
      { mask: 'tm2', masked: [] },
    ])
    expect(maskSpans(d, 'veiled')).toEqual([])
  })
})
