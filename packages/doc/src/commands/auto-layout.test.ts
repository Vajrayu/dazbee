import { describe, expect, it } from 'vitest'

import { type DesignInput, gridColumns, parseDesign } from '@dazbee/schema'

import { changesLayout, childrenOf, readDesign } from '../index.ts'
import { openTestSession } from '../test-design.ts'
import { openTestStore } from '../test-store.ts'

const tile = (x: number) => ({ x, y: 20, width: 100, height: 60, shape: { kind: 'rect' as const } })

/** A box in a square frame holding three tiles in an even row, out of order, and its linked copy in a banner frame. */
const design = (): DesignInput => ({
  meta: { designId: 'd1', name: 'Rows' },
  pages: { p1: { name: 'Page 1', order: 'a0' } },
  frames: {
    sq: { pageId: 'p1', name: 'Square', width: 1080, height: 1080, x: 0, y: 0, order: 'a0' },
    banner: { pageId: 'p1', name: 'Banner', width: 960, height: 320, x: 1280, y: 0, order: 'a1' },
  },
  nodes: {
    row: {
      type: 'box',
      parentId: 'sq',
      link: 'row',
      index: 'a0',
      name: 'Row',
      props: { x: 0, y: 0, width: 400, height: 100 },
    },
    t1: { type: 'graphic', parentId: 'row', link: 't1', index: 'a0', name: 'T1', props: tile(260) },
    t2: { type: 'graphic', parentId: 'row', link: 't2', index: 'a1', name: 'T2', props: tile(20) },
    t3: { type: 'graphic', parentId: 'row', link: 't3', index: 'a2', name: 'T3', props: tile(140) },
    'banner-row': {
      type: 'box',
      parentId: 'banner',
      link: 'row',
      index: 'a0',
      name: 'Row',
      props: { x: 0, y: 0, width: 400, height: 100 },
    },
    'banner-t1': { type: 'graphic', parentId: 'banner-row', link: 't1', index: 'a0', name: 'T1', props: tile(260) },
  },
})

const open = () => {
  const result = parseDesign(design())
  if (!result.success) throw new Error(result.errors.join('\n'))
  const store = openTestStore(result.design)
  return { store, tab: openTestSession(store) }
}

describe('node.autoLayout', () => {
  it('reads a row off where the children are and orders them as the flow takes them; the linked copy stays', () => {
    const { store, tab } = open()
    const copy = [readDesign(store).nodes['banner-row'], readDesign(store).nodes['banner-t1']]

    tab.run('node.autoLayout', { id: 'row', layout: 'auto' })

    const d = readDesign(store)
    expect(d.nodes.row?.props).toMatchObject({
      layout: {
        direction: 'row',
        gap: 20,
        padding: { top: 20, right: 40, bottom: 20, left: 20 },
        align: 'start',
      },
    })
    expect(childrenOf(d, 'row').map(([id]) => id)).toEqual(['t2', 't3', 't1'])
    expect([d.nodes['banner-row'], d.nodes['banner-t1']]).toEqual(copy)
  })

  it('reads a gap and paddings of 0 or more off layers that overlap and reach past the box', () => {
    const { store, tab } = open()
    const at = (x: number, y: number, size: number) => ({ x, y, width: size, height: size })
    tab.run('node.update', { ids: ['row'], patch: { height: 300 } })
    tab.run('node.update', { ids: ['t1'], patch: { ...at(20, 20, 200) } })
    tab.run('node.update', { ids: ['t2'], patch: { ...at(150, 180, 100) } })
    tab.run('node.update', { ids: ['t3'], patch: { ...at(40, 240, 80) } })

    tab.run('node.autoLayout', { id: 'row', layout: 'auto' })

    const row = readDesign(store).nodes.row
    const layout = row?.type === 'box' ? row.props.layout : undefined
    expect(layout).toBeDefined()
    expect(layout?.gap).toBeGreaterThanOrEqual(0)
    for (const side of Object.values(layout?.padding ?? {})) expect(side).toBeGreaterThanOrEqual(0)
  })

  it('reads turned layers by the room their turned bounds take, as the flow places them', () => {
    const { store, tab } = open()
    // Turned a quarter, each 100 × 40 takes 40 × 100, the three 10 apart from 10 in.
    for (const [id, x] of [
      ['t1', -20],
      ['t2', 30],
      ['t3', 80],
    ] as const)
      tab.run('node.update', { ids: [id], patch: { x, y: 30, width: 100, height: 40, rotation: 90 } })

    tab.run('node.autoLayout', { id: 'row', layout: 'auto' })

    const row = readDesign(store).nodes.row
    expect(row?.type === 'box' && row.props.layout).toMatchObject({
      direction: 'row',
      gap: 10,
      padding: { top: 0, right: 250, bottom: 0, left: 10 },
    })
  })

  it('takes the layout off again, each switch one undo step', () => {
    const { store, tab } = open()
    tab.run('node.autoLayout', { id: 'row', layout: 'auto' })
    tab.run('node.autoLayout', { id: 'row', layout: 'free', drawn: {} })
    expect(readDesign(store).nodes.row?.props).not.toHaveProperty('layout')
    tab.undo()
    expect(readDesign(store).nodes.row?.props).toHaveProperty('layout')
    tab.undo()
    expect(childrenOf(readDesign(store), 'row').map(([id]) => id)).toEqual(['t1', 't2', 't3'])
  })

  it('goes Free with the box and every layer stored where it is drawn, what a layer holds moved with it, the box fixed', () => {
    const { store, tab } = open()
    tab.run('node.group', { ids: ['t3'], id: 'g', name: 'G' })
    tab.run('node.autoLayout', { id: 'row', layout: 'auto' })
    // Where the flow draws them, listed inner first: each is stored there, the group's tile moved with it.
    const drawn = {
      t3: { x: 140, y: 20, width: 100, height: 60 },
      g: { x: 140, y: 20, width: 100, height: 60 },
      row: { x: 0, y: 0, width: 400, height: 100 },
      t2: { x: 20, y: 20, width: 100, height: 60 },
      t1: { x: 260, y: 20, width: 120, height: 60 },
    }
    tab.run('node.update', { ids: ['g'], patch: { x: 500, y: 500 } })
    tab.run('node.update', { ids: ['t3'], patch: { x: 510, y: 510 } })
    tab.run('node.autoLayout', { id: 'row', layout: 'free', drawn })
    const { nodes } = readDesign(store)
    expect(nodes.row?.props).not.toHaveProperty('layout')
    expect(nodes.row?.props.sizing).toEqual({ width: 'fixed', height: 'fixed' })
    for (const [id, box] of Object.entries(drawn)) expect(nodes[id]?.props).toMatchObject(box)
    tab.undo()
    expect(readDesign(store).nodes.g?.props).toMatchObject({ x: 500, y: 500 })
  })

  it('keeps the size a box that fits its layers is drawn at, grown past its stored one', () => {
    const { store, tab } = open()
    tab.run('node.autoLayout', { id: 'row', layout: 'auto' })
    tab.run('node.update', { ids: ['row'], patch: { sizing: { width: 'hug', height: 'hug' } } })
    tab.run('node.autoLayout', { id: 'row', layout: 'free', drawn: { row: { x: 0, y: 0, width: 520, height: 140 } } })
    expect(readDesign(store).nodes.row?.props).toMatchObject({ x: 0, y: 0, width: 520, height: 140 })
  })

  it('switches only boxes, and not a locked one', () => {
    const { tab } = open()
    expect(() => tab.run('node.autoLayout', { id: 't1', layout: 'auto' })).toThrow(/only boxes have auto layout/)
    tab.run('node.lock', { ids: ['row'], lock: { style: true } })
    expect(() => tab.run('node.autoLayout', { id: 'row', layout: 'auto' })).toThrow(/"row" is locked \(style\)/)
    tab.run('node.autoLayout', { id: 'banner-row', layout: 'auto' })
  })

  it('fits a box it lays out both ways, one with no layer in its flow keeping its stored size to fit from', () => {
    const { store, tab } = open()
    tab.run('node.autoLayout', { id: 'row', layout: 'auto' })
    expect(readDesign(store).nodes.row?.props.sizing).toEqual({ width: 'hug', height: 'hug' })
    tab.run('node.update', { ids: ['banner-t1'], patch: { absolute: true } })
    tab.run('node.autoLayout', { id: 'banner-row', layout: 'column' })
    expect(readDesign(store).nodes['banner-row']?.props).toMatchObject({
      width: 400,
      height: 100,
      sizing: { width: 'hug', height: 'hug' },
      layout: { direction: 'column' },
    })
  })

  it('fits a Free box whose layers are all hidden both ways, its stored size kept, as no flow places a hidden layer', () => {
    const { store, tab } = open()
    tab.run('node.update', { ids: ['t1', 't2', 't3'], patch: { visible: false } })
    tab.run('node.autoLayout', { id: 'row', layout: 'row' })
    expect(readDesign(store).nodes.row?.props).toMatchObject({
      width: 400,
      height: 100,
      sizing: { width: 'hug', height: 'hug' },
      layout: { direction: 'row' },
    })
  })

  it('reads a row off the shown layers only, a hidden one keeping its place in the layer order', () => {
    const { store, tab } = open()
    tab.run('node.update', { ids: ['t1'], patch: { visible: false } })
    tab.run('node.autoLayout', { id: 'row', layout: 'auto' })
    const d = readDesign(store)
    expect(d.nodes.row?.props).toMatchObject({
      layout: { direction: 'row', gap: 20, padding: { top: 20, right: 160, bottom: 20, left: 20 } },
    })
    expect(childrenOf(d, 'row').map(([id]) => id)).toEqual(['t1', 't2', 't3'])
  })

  it('lays layers out in a row when told, though they read as a column', () => {
    const { store, tab } = open()
    for (const [id, y] of [
      ['t1', 0],
      ['t2', 80],
      ['t3', 160],
    ] as const)
      tab.run('node.update', { ids: [id], patch: { x: 20, y } })
    tab.run('node.autoLayout', { id: 'row', layout: 'row' })
    const d = readDesign(store)
    expect(d.nodes.row?.type === 'box' && d.nodes.row.props.layout?.direction).toBe('row')
    expect(childrenOf(d, 'row').map(([id]) => id)).toEqual(['t1', 't2', 't3'])
  })

  it('starts a Free box as a grid of the default columns, nothing between or around, its layers in layer order', () => {
    const { store, tab } = open()
    tab.run('node.autoLayout', { id: 'row', layout: 'grid' })
    const d = readDesign(store)
    const layout = d.nodes.row?.type === 'box' ? d.nodes.row.props.layout : undefined
    expect(layout && gridColumns(layout)).toBe(2)
    expect(layout).toEqual({
      direction: 'grid',
      gap: 0,
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      justify: 'start',
      align: 'start',
    })
    expect(childrenOf(d, 'row').map(([id]) => id)).toEqual(['t1', 't2', 't3'])
  })

  it('keeps Between, Around, Line up and sizing from one layout to another, a spread-out row starting at the start in a grid', () => {
    const { store, tab } = open()
    tab.run('node.autoLayout', { id: 'row', layout: 'auto' })
    const row = readDesign(store).nodes.row
    const was = row?.type === 'box' ? row.props.layout : undefined
    tab.run('node.update', {
      ids: ['row'],
      patch: { layout: { ...was, justify: 'space-between', align: 'end' }, sizing: { width: 'fixed', height: 'hug' } },
    })
    tab.run('node.autoLayout', { id: 'row', layout: 'grid' })
    const grid = readDesign(store).nodes.row
    expect(grid?.type === 'box' && grid.props.layout).toEqual({
      ...was,
      direction: 'grid',
      justify: 'start',
      align: 'end',
    })
    // The box keeps how it sizes: only a box leaving Free starts at Fit.
    expect(grid?.props.sizing).toEqual({ width: 'fixed', height: 'hug' })
    tab.run('node.autoLayout', { id: 'row', layout: 'column' })
    const column = readDesign(store).nodes.row
    expect(column?.type === 'box' && column.props.layout).toMatchObject({
      direction: 'column',
      gap: was?.gap,
      align: 'end',
    })
  })

  it('keeps no columns once a grid becomes a row or a column', () => {
    const { store, tab } = open()
    tab.run('node.autoLayout', { id: 'row', layout: 'grid' })
    const grid = readDesign(store).nodes.row
    const was = grid?.type === 'box' ? grid.props.layout : undefined
    tab.run('node.update', { ids: ['row'], patch: { layout: { ...was, columns: 3 } } })
    for (const to of ['row', 'column'] as const) {
      tab.run('node.autoLayout', { id: 'row', layout: to })
      const now = readDesign(store).nodes.row
      const layout = now?.type === 'box' ? now.props.layout : undefined
      expect(layout).toMatchObject({ direction: to })
      expect(layout).not.toHaveProperty('columns')
      tab.undo()
    }
  })

  it('changes nothing for the layout a box has, or for auto on a laid-out box', () => {
    const { store, tab } = open()
    tab.run('node.autoLayout', { id: 'row', layout: 'grid' })
    const grid = readDesign(store)
    tab.run('node.autoLayout', { id: 'row', layout: 'grid' })
    tab.run('node.autoLayout', { id: 'row', layout: 'auto' })
    expect(readDesign(store)).toEqual(grid)
    tab.undo()
    expect(readDesign(store).nodes.row?.props).not.toHaveProperty('layout')
    tab.run('node.autoLayout', { id: 'row', layout: 'free' })
    expect(readDesign(store).nodes.row?.props).not.toHaveProperty('layout')
  })

  it('refuses to make a laid-out box Free without where its layers are drawn', () => {
    const { tab } = open()
    tab.run('node.autoLayout', { id: 'row', layout: 'auto' })
    expect(() => tab.run('node.autoLayout', { id: 'row', layout: 'free' })).toThrow(/where .* drawn/)
  })
})

describe('changesLayout', () => {
  it('says the command changes a box exactly when it does: Free on a laid-out box, or a layout it lacks', () => {
    for (const from of [undefined, 'row', 'column', 'grid'] as const)
      for (const to of ['auto', 'row', 'column', 'grid', 'free'] as const) {
        const { store, tab } = open()
        if (from) tab.run('node.autoLayout', { id: 'row', layout: from })
        const before = readDesign(store)
        const was = before.nodes.row?.type === 'box' ? before.nodes.row.props.layout : undefined
        tab.run('node.autoLayout', { id: 'row', layout: to, drawn: {} })
        expect(changesLayout(was, to), `${from ?? 'free'} to ${to}`).toBe(
          JSON.stringify(readDesign(store)) !== JSON.stringify(before),
        )
      }
  })
})
