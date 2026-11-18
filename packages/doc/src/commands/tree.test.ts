import { describe, expect, it } from 'vitest'

import { childrenOf } from '../index.ts'
import { badge, openTestSession } from '../test-design.ts'
import { openTestStore } from '../test-store.ts'
import { orderIndexes, type Slot } from './tree.ts'

/** The slots' ids in the order their indexes give after `changes`, ties by id. */
const sorted = (slots: Slot[], changes: Map<string, string>) =>
  slots
    .map(([id, index]) => [id, changes.get(id) ?? index] as const)
    .sort(([a, x], [b, y]) => (x === y ? (a < b ? -1 : 1) : (x as string) < (y as string) ? -1 : 1))
    .map(([id]) => id)

describe('orderIndexes', () => {
  it('changes nothing for siblings whose indexes already hold their order', () => {
    expect(
      orderIndexes([
        ['a', 'a0'],
        ['b', 'a1'],
        ['c', 'a2'],
      ]),
    ).toEqual(new Map())
  })

  it('gives a sibling that came an index between its neighbours, and one at an end an index past it', () => {
    const between = orderIndexes(
      [
        ['a', 'a0'],
        ['x', null],
        ['b', 'a1'],
      ],
      new Set(['x']),
    )
    expect([...between.keys()]).toEqual(['x'])
    expect((between.get('x') as string) > 'a0' && (between.get('x') as string) < 'a1').toBe(true)
    const ends: Slot[] = [
      ['x', null],
      ['a', 'a0'],
      ['y', null],
    ]
    expect(orderIndexes(ends, new Set(['x', 'y']))).toEqual(
      new Map([
        ['x', 'Zz'],
        ['y', 'a1'],
      ]),
    )
  })

  it('re-keys a run of siblings with one index when one comes between them, the first keeping its index', () => {
    const slots: Slot[] = [
      ['a', 'a0'],
      ['b', 'a1'],
      ['x', null],
      ['c', 'a1'],
      ['d', 'a1'],
      ['e', 'a2'],
    ]
    const changes = orderIndexes(slots, new Set(['x']))
    expect([...changes.keys()]).toEqual(['x', 'c', 'd'])
    expect(sorted(slots, changes)).toEqual(['a', 'b', 'x', 'c', 'd', 'e'])
    expect(new Set(slots.map(([id, index]) => changes.get(id) ?? index)).size).toBe(6)
  })

  it('re-keys siblings that tie wherever they are, so every index under the parent is its own', () => {
    const slots: Slot[] = [
      ['b', 'a1'],
      ['c', 'a1'],
      ['x', null],
    ]
    const changes = orderIndexes(slots, new Set(['x']))
    expect([...changes.keys()]).toEqual(['c', 'x'])
    expect(sorted(slots, changes)).toEqual(['b', 'c', 'x'])
  })

  it('leaves siblings that move where their indexes already put them, and re-keys only the ones out of order', () => {
    const inPlace: Slot[] = [
      ['a', 'a0'],
      ['b', 'a1'],
      ['c', 'a2'],
    ]
    expect(orderIndexes(inPlace, new Set(['b', 'c']))).toEqual(new Map())
    const toBack: Slot[] = [
      ['c', 'a2'],
      ['a', 'a0'],
      ['b', 'a1'],
    ]
    const changes = orderIndexes(toBack, new Set(['c']))
    expect([...changes.keys()]).toEqual(['c'])
    expect(sorted(toBack, changes)).toEqual(['c', 'a', 'b'])
  })

  it('re-spaces every sibling when an index would be longer than 48 characters', () => {
    const deep = `a0${'0'.repeat(46)}1`
    const slots: Slot[] = [
      ['a', 'a0'],
      ['x', null],
      ['b', deep],
    ]
    expect(orderIndexes(slots, new Set(['x']))).toEqual(
      new Map([
        ['x', 'a1'],
        ['b', 'a2'],
      ]),
    )
  })

  it('re-spaces every sibling when a neighbour has an index no index can be made beside', () => {
    const slots: Slot[] = [
      ['a', 'a000'],
      ['x', null],
      ['b', 'a001'],
    ]
    expect(orderIndexes(slots, new Set(['x']))).toEqual(
      new Map([
        ['a', 'a0'],
        ['x', 'a1'],
        ['b', 'a2'],
      ]),
    )
  })
})

describe('commands that insert or move, among layers two tabs gave one index', () => {
  /** The test design with `tie-a` and `tie-b` on top of the square, both at one index, as two tabs inserting at once leave them. */
  const tied = () => {
    const store = openTestStore()
    const tab = openTestSession(store)
    for (const id of ['tie-a', 'tie-b']) tab.run('node.create', { id, parentId: 'sq', layer: badge })
    store.transact(() => store.set('layer', 'tie-b', 'index', tab.design().nodes['tie-a']?.index))
    const order = () => childrenOf(tab.design(), 'sq').map(([id]) => id)
    expect(order()).toEqual(['box', 'headline', 'tie-a', 'tie-b'])
    return { store, tab, order }
  }
  const indexes = (tab: ReturnType<typeof tied>['tab'], parentId: string) =>
    childrenOf(tab.design(), parentId).map(([, layer]) => layer.index)

  it('node.move puts a layer between the two, in drawn order', () => {
    const { tab, order } = tied()
    tab.run('node.move', { id: 'box', parentId: 'sq', before: 'tie-b' })
    expect(order()).toEqual(['headline', 'tie-a', 'box', 'tie-b'])
    expect(new Set(indexes(tab, 'sq')).size).toBe(4)
  })

  it('node.create on top gives the two their own indexes, in the order they were drawn', () => {
    const { tab, order } = tied()
    tab.run('node.create', { id: 'top', parentId: 'sq', layer: badge })
    expect(order()).toEqual(['box', 'headline', 'tie-a', 'tie-b', 'top'])
    expect(new Set(indexes(tab, 'sq')).size).toBe(5)
  })

  it('frame.duplicate copies the two in the order they are drawn, each copy with its own index', () => {
    const { store, tab } = tied()
    // The copies' ids are random: only their indexes can hold the originals' order.
    for (let round = 0; round < 8; round++) {
      const copy = tab.run('frame.duplicate', { frameId: 'sq' })
      const copies = childrenOf(tab.design(), copy)
      expect(copies.map(([, layer]) => layer.link)).toEqual(
        childrenOf(tab.design(), 'sq').map(([, layer]) => layer.link),
      )
      expect(new Set(copies.map(([, layer]) => layer.index)).size).toBe(4)
    }
    expect((store.layer('tie-b') as { index: string }).index).toBe(tab.design().nodes['tie-a']?.index)
  })
})
