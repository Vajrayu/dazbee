// Flipping layers at the commands seam: each is drawn as the mirror of what it drew, with what it
// holds, and flipping twice gives back the same document.
import { describe, expect, it } from 'vitest'

import type { DesignInput } from '@dazbee/schema'

import { childrenOf } from '../children.ts'
import { centreOf, flippedPoint, type Point, turn } from '../geometry.ts'
import { readDesign } from '../index.ts'
import { openTestSession } from '../test-design.ts'
import { openTestStore } from '../test-store.ts'

const rect = (x: number, y: number, width: number, height: number, more: Record<string, unknown> = {}) => ({
  x,
  y,
  width,
  height,
  shape: { kind: 'rect' as const },
  fills: [{ type: 'solid' as const, color: '#FF0000FF' }],
  ...more,
})
const layer = (
  parentId: string,
  index: string,
  type: string,
  props: Record<string, unknown>,
  more: Record<string, unknown> = {},
) => ({ type, parentId, index, name: type, props, ...more }) as unknown as DesignInput['nodes'][string]
const ALL_LOCKED = { move: true, resize: true, content: true, style: true, delete: true }
/** A row's three tiles, 40 wide, and one kept where it is put. */
const tiles = (parentId: string) => ({
  [`${parentId}-a`]: layer(parentId, 'a0', 'graphic', rect(0, 0, 40, 40)),
  [`${parentId}-b`]: layer(parentId, 'a1', 'graphic', rect(0, 0, 40, 40)),
  [`${parentId}-c`]: layer(parentId, 'a2', 'graphic', rect(0, 0, 40, 40)),
})
const LAYOUT = {
  direction: 'row',
  gap: 10,
  padding: { top: 1, right: 30, bottom: 2, left: 10 },
  justify: 'start',
  align: 'end',
}
/**
 * A turned square, a turned group holding a turned square and a text, a laid-out row with a layer
 * kept where it is put, a grid of five, and a square locked against resizing.
 */
const DESIGN: DesignInput = {
  meta: { designId: 'd', name: 'Flips' },
  pages: { p1: { name: 'Page', order: 'a0' } },
  frames: { sq: { pageId: 'p1', name: 'Square', width: 1080, height: 1080, x: 0, y: 0, order: 'a0' } },
  nodes: {
    turned: layer('sq', 'a0', 'graphic', rect(100, 100, 200, 100, { rotation: 30 })),
    group: layer('sq', 'a1', 'group', { x: 400, y: 100, width: 300, height: 200, rotation: 90 }),
    inner: layer('group', 'a0', 'graphic', rect(400, 100, 100, 50, { rotation: 10, flipY: true })),
    words: layer(
      'group',
      'a1',
      'text',
      {
        x: 550,
        y: 200,
        width: 150,
        height: 100,
        text: 'Hi',
        style: { fontFamily: 'Noto Sans', fontSize: 40, color: '#000000FF' },
      },
      { lock: ALL_LOCKED },
    ),
    row: layer('sq', 'a2', 'box', { x: 100, y: 500, width: 400, height: 100, layout: LAYOUT }),
    ...tiles('row'),
    kept: layer('row', 'a3', 'graphic', rect(120, 520, 20, 20, { absolute: true })),
    grid: layer('sq', 'a3', 'box', {
      x: 600,
      y: 500,
      width: 300,
      height: 300,
      layout: { direction: 'grid', columns: 2 },
    }),
    ...tiles('grid'),
    'grid-d': layer('grid', 'a3', 'graphic', rect(0, 0, 40, 40)),
    'grid-e': layer('grid', 'a4', 'graphic', rect(0, 0, 40, 40)),
    locked: layer('sq', 'a4', 'graphic', rect(100, 800, 100, 100), {
      lock: { move: false, resize: true, content: false, style: false, delete: false },
    }),
  },
}
// Each layer is its own link.
for (const [id, node] of Object.entries(DESIGN.nodes)) Object.assign(node, { link: id })

const open = () => {
  const store = openTestStore(DESIGN)
  return { store, tab: openTestSession(store) }
}
type Placed = { x: number; y: number; width: number; height: number; rotation?: number }
/**
 * Where a point of a layer's own drawing is drawn in its frame, `u` and `v` its share across and down
 * the layer's box: mirrored as the layer is flipped, turned with it, then by each container about its centre.
 */
function drawnAt(store: ReturnType<typeof open>['store'], id: string, u: number, v: number): Point {
  const { nodes } = readDesign(store)
  const props = nodes[id]?.props as Placed & { flipX?: boolean; flipY?: boolean }
  let p = flippedPoint({ x: props.x + u * props.width, y: props.y + v * props.height }, props)
  p = turn(p, centreOf({ ...props, rotation: 0 }), props.rotation ?? 0)
  for (let up = nodes[id]?.parentId; up && nodes[up]; up = nodes[up]?.parentId) {
    const outer = nodes[up]?.props as Placed
    p = turn(p, centreOf({ ...outer, rotation: 0 }), outer.rotation ?? 0)
  }
  return p
}
/** Three points of a layer's own drawing, as drawn. */
const shapeOf = (store: ReturnType<typeof open>['store'], id: string) =>
  [
    [0, 0],
    [1, 0],
    [0.25, 1],
  ].map(([u, v]) => drawnAt(store, id, u as number, v as number))
const near = (points: Point[]) => points.map(({ x, y }) => [Math.round(x * 10) / 10 + 0, Math.round(y * 10) / 10 + 0])
const order = (store: ReturnType<typeof open>['store'], box: string) =>
  childrenOf(readDesign(store), box).map(([id]) => id)

describe('node.flip', () => {
  it('draws a turned layer as its mirror across its own centre line, either way, as one undo step named flip', () => {
    for (const axis of ['horizontal', 'vertical'] as const) {
      const { store, tab } = open()
      const before = shapeOf(store, 'turned')
      const c = drawnAt(store, 'turned', 0.5, 0.5)
      tab.run('node.flip', { ids: ['turned'], axis })
      const mirrored = before.map((p) =>
        axis === 'horizontal' ? { ...p, x: 2 * c.x - p.x } : { ...p, y: 2 * c.y - p.y },
      )
      expect(near(shapeOf(store, 'turned')), axis).toEqual(near(mirrored))
      expect(readDesign(store).nodes.turned?.props).toMatchObject(
        axis === 'horizontal' ? { rotation: -30, flipX: true } : { rotation: -30, flipY: true },
      )
      expect(tab.undoName()).toBe('flip')
    }
  })

  it('mirrors what a turned group holds across the frame as drawn, a locked layer inside it too, and gives the group no flag', () => {
    const { store, tab } = open()
    const c = drawnAt(store, 'group', 0.5, 0.5)
    const before = { inner: shapeOf(store, 'inner'), words: shapeOf(store, 'words') }
    tab.run('node.flip', { ids: ['group'], axis: 'horizontal' })
    for (const id of ['inner', 'words'] as const)
      expect(near(shapeOf(store, id)), id).toEqual(near(before[id].map((p) => ({ ...p, x: 2 * c.x - p.x }))))
    const { nodes } = readDesign(store)
    expect(nodes.group?.props).toMatchObject({ rotation: -90 })
    expect(nodes.group?.props).not.toHaveProperty('flipX')
    expect(nodes.inner?.props).toMatchObject({ flipX: true, flipY: true, rotation: -10 })
  })

  it('flips a layer inside a turned group across the frame as drawn, its turn the negative of its own less twice the group’s', () => {
    const { store, tab } = open()
    const before = shapeOf(store, 'inner')
    const c = drawnAt(store, 'inner', 0.5, 0.5)
    tab.run('node.flip', { ids: ['inner'], axis: 'vertical' })
    expect(near(shapeOf(store, 'inner'))).toEqual(near(before.map((p) => ({ ...p, y: 2 * c.y - p.y }))))
    expect(readDesign(store).nodes.inner?.props).toMatchObject({ rotation: 170 })
    expect(readDesign(store).nodes.inner?.props).not.toHaveProperty('flipY')
  })

  it('gives back the same document when flipped twice, along either axis, several layers at once', () => {
    for (const axis of ['horizontal', 'vertical'] as const) {
      const { store, tab } = open()
      const before = JSON.stringify(readDesign(store))
      const ids = ['turned', 'group', 'row', 'grid']
      tab.run('node.flip', { ids, axis })
      expect(JSON.stringify(readDesign(store))).not.toBe(before)
      tab.run('node.flip', { ids, axis })
      expect(JSON.stringify(readDesign(store)), axis).toBe(before)
    }
  })

  it('runs a laid-out row the other way when flipped across it, its lining up and paddings swapped; down it, only those across', () => {
    const { store, tab } = open()
    tab.run('node.flip', { ids: ['row'], axis: 'horizontal' })
    expect(order(store, 'row')).toEqual(['row-c', 'row-b', 'row-a', 'kept'])
    expect(readDesign(store).nodes.row?.props).toMatchObject({
      layout: { justify: 'end', align: 'end', padding: { top: 1, right: 10, bottom: 2, left: 30 } },
    })
    // The layer kept where it is put is mirrored about the row's centre, x 300.
    expect(readDesign(store).nodes.kept?.props).toMatchObject({ x: 460, y: 520 })
    const down = open()
    down.tab.run('node.flip', { ids: ['row'], axis: 'vertical' })
    expect(order(down.store, 'row')).toEqual(['row-a', 'row-b', 'row-c', 'kept'])
    expect(readDesign(down.store).nodes.row?.props).toMatchObject({
      layout: { justify: 'start', align: 'start', padding: { top: 2, right: 30, bottom: 1, left: 10 } },
    })
  })

  it("reverses a grid's order within each row when flipped across it, and keeps it when flipped down it", () => {
    const { store, tab } = open()
    tab.run('node.flip', { ids: ['grid'], axis: 'horizontal' })
    expect(order(store, 'grid')).toEqual(['grid-b', 'grid-a', 'grid-d', 'grid-c', 'grid-e'])
    const down = open()
    down.tab.run('node.flip', { ids: ['grid'], axis: 'vertical' })
    expect(order(down.store, 'grid')).toEqual(['grid-a', 'grid-b', 'grid-c', 'grid-d', 'grid-e'])
  })

  it("reverses a full grid's rows when flipped down it", () => {
    const { store, tab } = open()
    tab.run('node.delete', { ids: ['grid-e'] })
    tab.run('node.flip', { ids: ['grid'], axis: 'vertical' })
    expect(order(store, 'grid')).toEqual(['grid-c', 'grid-d', 'grid-a', 'grid-b'])
  })

  it('keeps the order of a flow that holds a mask, so the mask still masks what it did', () => {
    const { store, tab } = open()
    tab.run('node.mask', { ids: ['row-a'], mask: 'alpha' })
    tab.run('node.flip', { ids: ['row'], axis: 'horizontal' })
    expect(order(store, 'row')).toEqual(['row-a', 'row-b', 'row-c', 'kept'])
    expect(readDesign(store).nodes.row?.props).toMatchObject({ layout: { justify: 'end' } })
  })

  describe('a wrapping flow', () => {
    /** A row 150 wide that wraps five 40-wide tiles 10 apart: three on its first line, two on its second. */
    const wrapping = (direction: 'row' | 'column') => {
      const store = openTestStore({
        ...DESIGN,
        nodes: {
          wrap: {
            ...layer('sq', 'a5', 'box', {
              x: 0,
              y: 0,
              width: 150,
              height: 150,
              layout: { direction, wrap: true, gap: 10, padding: { top: 0, right: 0, bottom: 0, left: 0 } },
            }),
            link: 'wrap',
          },
          ...Object.fromEntries(
            ['a', 'b', 'c', 'd', 'e'].map((k, i) => [
              `wrap-${k}`,
              { ...layer('wrap', `a${i}`, 'graphic', rect(0, 0, 40, 40)), link: `wrap-${k}` },
            ]),
          ),
        },
      })
      return { store, tab: openTestSession(store) }
    }
    /** Where the tiles are drawn, in their order: three a line, 50 apart along it and across it. */
    const drawn = (ids: string[], row = true) =>
      Object.fromEntries(
        ids.map((id, i) => {
          const along = (i % 3) * 50
          const across = Math.floor(i / 3) * 50
          return [id, { x: row ? along : across, y: row ? across : along, width: 40, height: 40 }]
        }),
      )
    const tiles = ['wrap-a', 'wrap-b', 'wrap-c', 'wrap-d', 'wrap-e']

    it('runs each line the other way when flipped along it, its lines breaking where they did', () => {
      const { store, tab } = wrapping('row')
      tab.run('node.flip', { ids: ['wrap'], axis: 'horizontal', drawn: drawn(tiles) })
      expect(order(store, 'wrap')).toEqual(['wrap-c', 'wrap-b', 'wrap-a', 'wrap-e', 'wrap-d'])
      expect(readDesign(store).nodes.wrap?.props).toMatchObject({ layout: { justify: 'end' } })
    })

    it('keeps its order when flipped across it, lining its lines up at the other side', () => {
      const { store, tab } = wrapping('row')
      tab.run('node.flip', { ids: ['wrap'], axis: 'vertical', drawn: drawn(tiles) })
      expect(order(store, 'wrap')).toEqual(tiles)
      expect(readDesign(store).nodes.wrap?.props).toMatchObject({ layout: { align: 'end' } })
    })

    it('does the same for a column on the other axes', () => {
      const along = wrapping('column')
      along.tab.run('node.flip', { ids: ['wrap'], axis: 'vertical', drawn: drawn(tiles, false) })
      expect(order(along.store, 'wrap')).toEqual(['wrap-c', 'wrap-b', 'wrap-a', 'wrap-e', 'wrap-d'])
      const across = wrapping('column')
      across.tab.run('node.flip', { ids: ['wrap'], axis: 'horizontal', drawn: drawn(tiles, false) })
      expect(order(across.store, 'wrap')).toEqual(tiles)
    })

    it('keeps its order where a line run the other way would start with a shorter layer, which could break the lines elsewhere', () => {
      const { store, tab } = wrapping('row')
      // Lines of a, of b and c, and of d and e: c is shorter than b, so it might fit after a.
      const uneven = {
        'wrap-a': { x: 0, y: 0, width: 100, height: 40 },
        'wrap-b': { x: 0, y: 50, width: 60, height: 40 },
        'wrap-c': { x: 70, y: 50, width: 30, height: 40 },
        'wrap-d': { x: 0, y: 100, width: 40, height: 40 },
        'wrap-e': { x: 50, y: 100, width: 40, height: 40 },
      }
      tab.run('node.flip', { ids: ['wrap'], axis: 'horizontal', drawn: uneven })
      expect(order(store, 'wrap')).toEqual(tiles)
    })

    it('gives back the order when flipped twice, each time as it is drawn', () => {
      const { store, tab } = wrapping('row')
      tab.run('node.flip', { ids: ['wrap'], axis: 'horizontal', drawn: drawn(tiles) })
      tab.run('node.flip', { ids: ['wrap'], axis: 'horizontal', drawn: drawn(order(store, 'wrap')) })
      expect(order(store, 'wrap')).toEqual(tiles)
    })

    it('keeps its order where it is not told where its layers are drawn, and where it holds a mask', () => {
      const unplaced = wrapping('row')
      unplaced.tab.run('node.flip', { ids: ['wrap'], axis: 'horizontal' })
      expect(order(unplaced.store, 'wrap')).toEqual(tiles)
      const masked = wrapping('row')
      masked.tab.run('node.mask', { ids: ['wrap-a'], mask: 'alpha' })
      masked.tab.run('node.flip', { ids: ['wrap'], axis: 'horizontal', drawn: drawn(tiles) })
      expect(order(masked.store, 'wrap')).toEqual(tiles)
    })
  })

  it('flips a layer given inside another given one once, with it', () => {
    const { store, tab } = open()
    tab.run('node.flip', { ids: ['group', 'inner'], axis: 'horizontal' })
    expect(readDesign(store).nodes.inner?.props).toMatchObject({ flipX: true })
  })

  it('refuses a missing layer and one locked against resizing, changing nothing', () => {
    const { store, tab } = open()
    const before = JSON.stringify(readDesign(store))
    expect(() => tab.run('node.flip', { ids: ['gone'], axis: 'horizontal' })).toThrow(/no layer "gone"/)
    expect(() => tab.run('node.flip', { ids: ['turned', 'locked'], axis: 'horizontal' })).toThrow(
      /"locked" is locked \(resize\)/,
    )
    expect(JSON.stringify(readDesign(store))).toBe(before)
  })
})
