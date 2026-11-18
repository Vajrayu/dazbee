import { describe, expect, it } from 'vitest'

import { childrenOf, descendants, readDesign } from '../index.ts'
import { openShapes } from '../test-store.ts'

describe('node.boolean', () => {
  it('combines shapes where the top one was, painted like the bottom one, hugging them', () => {
    const { store, tab } = openShapes()
    const wide = descendants(readDesign(store), 'wide').map((id) => readDesign(store).nodes[id])
    const id = tab.run('node.boolean', { ids: ['b', 'a'], op: 'subtract' })
    const d = readDesign(store)
    expect(d.nodes[id]).toMatchObject({ type: 'boolean', name: 'Subtract', parentId: 'sq', index: 'a1' })
    expect(d.nodes[id]?.props).toMatchObject({
      op: 'subtract',
      x: 100,
      y: 100,
      width: 150,
      height: 100,
      fills: [{ type: 'solid', color: '#FF0000FF' }],
    })
    expect(childrenOf(d, id).map(([child]) => child)).toEqual(['a', 'b'])
    expect(descendants(d, 'wide').map((child) => d.nodes[child])).toEqual(wide)
    // One undo step takes it all back.
    tab.undo()
    expect(readDesign(store).nodes[id]).toBeUndefined()
    expect(readDesign(store).nodes.a?.parentId).toBe('sq')
  })

  it('combines only two or more shapes or booleans that share a parent', () => {
    const { tab } = openShapes()
    expect(() => tab.run('node.boolean', { ids: ['a'], op: 'union' })).toThrow(/ids/)
    expect(() => tab.run('node.boolean', { ids: ['a', 't'], op: 'union' })).toThrow(
      /"t" is a text; only shapes and booleans combine/,
    )
    const group = tab.run('node.group', { ids: ['c'] })
    expect(() => tab.run('node.boolean', { ids: ['a', group], op: 'union' })).toThrow(
      /is a group; only shapes and booleans combine/,
    )
    expect(() => tab.run('node.boolean', { ids: ['a', 'c'], op: 'union' })).toThrow(/must share a parent/)
    expect(() => tab.run('node.boolean', { ids: ['a', 'wide-b'], op: 'union' })).toThrow(/must share a parent/)
    // A boolean of booleans nests.
    const inner = tab.run('node.boolean', { ids: ['a', 'b'], op: 'union' })
    tab.run('node.move', { id: 'c', parentId: 'sq' })
    const outer = tab.run('node.boolean', { ids: [inner, 'c'], op: 'exclude' })
    expect(tab.design().nodes[inner]?.parentId).toBe(outer)
  })

  it('holds only shapes and booleans, however a layer gets there', () => {
    const { store, tab } = openShapes()
    const id = tab.run('node.boolean', { ids: ['a', 'b'], op: 'intersect' })
    expect(() => tab.run('node.move', { id: 't', parentId: id })).toThrow(
      /parent "\S+" is a boolean, which holds only shapes and booleans/,
    )
    expect(() =>
      tab.run('node.create', {
        parentId: id,
        layer: { type: 'group', name: 'G', props: { x: 0, y: 0, width: 1, height: 1 } },
      }),
    ).toThrow(/holds only shapes/)
    const drawnCut = tab.run('node.create', {
      parentId: id,
      layer: {
        type: 'graphic',
        name: 'Cut',
        props: { x: 120, y: 120, width: 20, height: 20, shape: { kind: 'ellipse' } },
      },
    })
    expect(readDesign(store).nodes[drawnCut]?.parentId).toBe(id)
    expect(() => tab.run('node.group', { ids: ['a', 'b'] })).toThrow(/is a boolean, which can't hold a group/)
    expect(() => tab.run('node.box', { ids: ['a', 'b'] })).toThrow(/is a boolean, which can't hold a box/)
  })

  it('stays live: an edited shape changes it, hug refits it, and ungroup lets the shapes go', () => {
    const { store, tab } = openShapes()
    const id = tab.run('node.boolean', { ids: ['a', 'b'], op: 'union' })
    tab.run('node.update', {
      ids: ['b'],
      patch: { x: 300, shape: { kind: 'star', points: 8, innerRadius: 0.6, cornerRadius: 4 } },
    })
    tab.run('node.hug', { ids: ['b'] })
    expect(readDesign(store).nodes[id]?.props).toMatchObject({ x: 100, width: 300 })
    expect(readDesign(store).nodes.b?.props).toHaveProperty('shape', {
      kind: 'star',
      points: 8,
      innerRadius: 0.6,
      cornerRadius: 4,
    })
    tab.run('node.update', { ids: [id], patch: { op: 'exclude' } })
    expect(readDesign(store).nodes[id]?.props).toMatchObject({ op: 'exclude' })
    const freed = tab.run('node.ungroup', { ids: [id] })
    expect(freed).toEqual(['a', 'b'])
    expect(readDesign(store).nodes[id]).toBeUndefined()
    expect(readDesign(store).nodes.a?.parentId).toBe('sq')
  })
})
