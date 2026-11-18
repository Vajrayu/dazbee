// The two-frame design the tests of dragging layers between frames run on: frames A and B side by
// side on one page, 100 apart.
import type { DesignInput } from '@dazbee/schema'

const rect = (x: number, y: number, size = 60) => ({
  x,
  y,
  width: size,
  height: size,
  shape: { kind: 'rect' as const },
})
const layer = (parentId: string, index: string, link: string, props: object, more: object = {}) => ({
  type: 'graphic' as const,
  parentId,
  index,
  link,
  name: link,
  props,
  ...more,
})
const box = (parentId: string, index: string, link: string, props: object) => ({
  type: 'box' as const,
  parentId,
  index,
  link,
  name: link,
  props,
})

/**
 * Frame A (0, 0, 400 by 400) holds a free square `rect`, `logo`, whose link id B holds too, a group
 * `grp` of `g1` (whose link id B holds) and `g2`, a layer locked in place, a layer bound to a brand
 * colour, a Mask group `mg` of the mask `mk` and `mm`, a column `col` of `c1` to `c3`, and a Free
 * box `fbox` holding `inbox`. Frame B (500, 0, 400 by 400) holds its own copies of `logo` and `g1`,
 * a row `brow` of `b1` to `b3` at 20, 150, and a Free box `bfree` at 200, 250.
 */
export const TWO_FRAMES = {
  meta: { designId: 'd', name: 'D' },
  pages: { p1: { name: 'One', order: 'a0' } },
  frames: {
    A: { pageId: 'p1', name: 'A', width: 400, height: 400, x: 0, y: 0, order: 'a0' },
    B: { pageId: 'p1', name: 'B', width: 400, height: 400, x: 500, y: 0, order: 'a1' },
  },
  nodes: {
    rect: layer('A', 'a0', 'rect', rect(20, 20)),
    logo: layer('A', 'a1', 'logo', rect(100, 20)),
    grp: {
      type: 'group',
      parentId: 'A',
      index: 'a2',
      link: 'grp',
      name: 'grp',
      props: { x: 200, y: 20, width: 140, height: 60 },
    },
    g1: layer('grp', 'a0', 'g1', rect(200, 20)),
    g2: layer('grp', 'a1', 'g2', rect(280, 20)),
    locked: layer('A', 'a3', 'locked', rect(20, 120), { lock: { move: true } }),
    bound: layer(
      'A',
      'a4',
      'bound',
      { ...rect(100, 120), fills: [{ type: 'solid', color: '#FF0000FF' }] },
      {
        bindings: { fill: 'brand:primary' },
      },
    ),
    mg: {
      type: 'group',
      parentId: 'A',
      index: 'a5',
      link: 'mg',
      name: 'mg',
      props: { x: 200, y: 120, width: 60, height: 60 },
    },
    mk: layer('mg', 'a0', 'mk', { ...rect(200, 120), mask: 'alpha' }),
    mm: layer('mg', 'a1', 'mm', rect(200, 120)),
    col: box('A', 'a6', 'col', { x: 20, y: 220, width: 80, height: 170, layout: { direction: 'column', gap: 5 } }),
    c1: layer('col', 'a0', 'c1', rect(0, 0, 50)),
    c2: layer('col', 'a1', 'c2', rect(0, 0, 50)),
    c3: layer('col', 'a2', 'c3', rect(0, 0, 50)),
    fbox: box('A', 'a7', 'fbox', { x: 300, y: 220, width: 90, height: 90 }),
    inbox: layer('fbox', 'a0', 'inbox', rect(310, 230, 30)),
    'b-logo': layer('B', 'a0', 'logo', rect(20, 300)),
    'b-g1': layer('B', 'a1', 'g1', rect(100, 300)),
    brow: box('B', 'a2', 'brow', { x: 20, y: 150, width: 360, height: 70, layout: { direction: 'row', gap: 5 } }),
    b1: layer('brow', 'a0', 'b1', rect(0, 0, 50)),
    b2: layer('brow', 'a1', 'b2', rect(0, 0, 50)),
    b3: layer('brow', 'a2', 'b3', rect(0, 0, 50)),
    bfree: box('B', 'a3', 'bfree', { x: 200, y: 250, width: 150, height: 100 }),
  },
} as unknown as DesignInput
