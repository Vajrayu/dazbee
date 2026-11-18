import { describe, expect, it } from 'vitest'

import type { Design } from '@dazbee/schema'

import { childrenOfSelected, pairsIn, parentsOfSelected, selectInto, siblingOfSelected } from './selection.ts'
import { graphic, harness } from './test-selection.ts'

/** A layer of the tree below, in order among its siblings by `index`. */
const at = (parentId: string, index: string, type = 'graphic') => ({
  ...(type === 'graphic' ? graphic('rect', parentId) : { type, parentId, props: {} }),
  index,
})
/**
 * Two linked frames of one page. The first holds, back to front, `a`, `b` and the group `g`, which
 * holds `c`, `d` and the group `h` holding `e`; the second holds the group `g2`, holding `c2` and `d2`.
 */
const TREE = {
  pages: { p1: { name: 'One' } },
  frames: { 'p1-f1': { pageId: 'p1' }, 'p1-f2': { pageId: 'p1' } },
  nodes: {
    a: at('p1-f1', 'a0'),
    b: at('p1-f1', 'a1'),
    g: at('p1-f1', 'a2', 'group'),
    c: at('g', 'a0'),
    d: at('g', 'a1'),
    h: at('g', 'a2', 'group'),
    e: at('h', 'a0'),
    g2: at('p1-f2', 'a0', 'group'),
    c2: at('g2', 'a0'),
    d2: at('g2', 'a1'),
  },
} as unknown as Design

const one = (...ids: string[]) => pairsIn('p1-f1', ids)
const two = (...ids: string[]) => pairsIn('p1-f2', ids)

describe('childrenOfSelected', () => {
  it('lists what is directly in each selected layer, back to front, in its frame', () => {
    expect(childrenOfSelected(one('g'), TREE)).toEqual(one('c', 'd', 'h'))
    expect(childrenOfSelected(one('h'), TREE)).toEqual(one('e'))
    expect(childrenOfSelected([...one('g'), ...two('g2')], TREE)).toEqual([...one('c', 'd', 'h'), ...two('c2', 'd2')])
  })

  it('lists none for a layer that holds nothing, at the top level or inside a group', () => {
    expect(childrenOfSelected(one('a'), TREE)).toEqual([])
    expect(childrenOfSelected(one('c', 'e'), TREE)).toEqual([])
  })
})

describe('parentsOfSelected', () => {
  it('lists the group each selected layer is directly in, once each, in its frame', () => {
    expect(parentsOfSelected(one('c'), TREE)).toEqual(one('g'))
    expect(parentsOfSelected(one('c', 'd', 'e'), TREE)).toEqual(one('g', 'h'))
    expect(parentsOfSelected([...one('c'), ...two('c2')], TREE)).toEqual([...one('g'), ...two('g2')])
  })

  it('lists none for a layer at the top level, whose parent is its frame', () => {
    expect(parentsOfSelected(one('a', 'g'), TREE)).toEqual([])
    expect(parentsOfSelected(one('a', 'c'), TREE)).toEqual(one('g'))
  })
})

describe('siblingOfSelected', () => {
  it("steps from the last selected layer along the layers panel's order, topmost first, wrapping round", () => {
    // The panel lists the frame's layers g, b, a.
    expect(siblingOfSelected(one('b'), TREE, 1)).toEqual(one('a')[0])
    expect(siblingOfSelected(one('b'), TREE, -1)).toEqual(one('g')[0])
    expect(siblingOfSelected(one('a'), TREE, 1)).toEqual(one('g')[0])
    expect(siblingOfSelected(one('g'), TREE, -1)).toEqual(one('a')[0])
  })

  it('steps among the layers of the group the layer is in', () => {
    // The panel lists g's layers h, d, c.
    expect(siblingOfSelected(one('d'), TREE, 1)).toEqual(one('c')[0])
    expect(siblingOfSelected(one('c'), TREE, 1)).toEqual(one('h')[0])
    expect(siblingOfSelected(one('e'), TREE, 1)).toEqual(one('e')[0])
  })

  it('steps from the layer picked last when several are selected across frames', () => {
    expect(siblingOfSelected([...one('c'), ...two('c2')], TREE, 1)).toEqual(two('d2')[0])
    expect(siblingOfSelected([...two('d2'), ...one('c')], TREE, -1)).toEqual(one('d')[0])
  })

  it('finds none with nothing selected', () => {
    expect(siblingOfSelected(null, TREE, 1)).toBeNull()
  })
})

describe('selectInto', () => {
  it('selects layers and goes into the group the first is in, or out of every one at the top level', () => {
    const { selection, world } = harness()
    world.design = TREE
    selectInto(selection, TREE, one('e'))
    expect(selection.current()).toEqual(one('e'))
    expect(selection.entered()).toBe('h')
    selectInto(selection, TREE, one('c', 'd'))
    expect(selection.entered()).toBe('g')
    selectInto(selection, TREE, one('b'))
    expect(selection.current()).toEqual(one('b'))
    expect(selection.entered()).toBeNull()
  })

  it('selects layers in two frames of one page, going into the first one’s group', () => {
    const { selection, world } = harness()
    world.design = TREE
    selectInto(selection, TREE, [...two('c2'), ...one('c')])
    expect(selection.current()).toEqual([...two('c2'), ...one('c')])
    expect(selection.entered()).toBe('g2')
  })
})
