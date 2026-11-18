// Path layers reshaped by the pen and point editing, at the commands seam (#45).
import { describe, expect, it } from 'vitest'

import { type DesignInput, parseDesign, pathScale } from '@dazbee/schema'

import { type Box, centreOf, flippedPoint, turn } from '../geometry.ts'
import { readDesign } from '../index.ts'
import { openTestSession } from '../test-design.ts'
import { openTestStore } from '../test-store.ts'

const zig = { x: 100, y: 100, width: 100, height: 50, shape: { kind: 'path' as const, d: 'M0 0 L100 50' } }
const box = { x: 0, y: 0, width: 10, height: 10, shape: { kind: 'rect' as const } }

/** A path and a box in a square frame, and their linked copies in a wide frame, where the path sits further right, and a tall one, where it is turned. */
const design = (): DesignInput => ({
  meta: { designId: 'd1', name: 'Paths' },
  pages: { p1: { name: 'Page 1', order: 'a0' } },
  frames: {
    sq: { pageId: 'p1', name: 'Square', width: 1080, height: 1080, x: 0, y: 0, order: 'a0' },
    wide: { pageId: 'p1', name: 'Wide', width: 1200, height: 628, x: 1280, y: 0, order: 'a1' },
    tall: { pageId: 'p1', name: 'Tall', width: 1080, height: 1920, x: 2680, y: 0, order: 'a2' },
  },
  nodes: {
    zig: { type: 'graphic', parentId: 'sq', link: 'zig', index: 'a0', name: 'Zig', props: zig },
    box: { type: 'graphic', parentId: 'sq', link: 'box', index: 'a1', name: 'Box', props: box },
    'wide-zig': { type: 'graphic', parentId: 'wide', link: 'zig', index: 'a0', name: 'Zig', props: { ...zig, x: 400 } },
    'wide-box': { type: 'graphic', parentId: 'wide', link: 'box', index: 'a1', name: 'Box', props: box },
    'tall-zig': {
      type: 'graphic',
      parentId: 'tall',
      link: 'zig',
      index: 'a0',
      name: 'Zig',
      props: { ...zig, rotation: 90 },
    },
    'tall-box': { type: 'graphic', parentId: 'tall', link: 'box', index: 'a1', name: 'Box', props: box },
  },
})

const open = () => {
  const result = parseDesign(design())
  if (!result.success) throw new Error(result.errors.join('\n'))
  const store = openTestStore(result.design)
  return { store, tab: openTestSession(store) }
}

type Props = {
  x: number
  y: number
  width: number
  height: number
  rotation: number
  flipX?: boolean
  flipY?: boolean
  shape: { d: string; drawnIn?: { width: number; height: number } }
}
const placed = (store: ReturnType<typeof open>['store'], id: string) => readDesign(store).nodes[id]?.props as Props
/** Where a point of the path data is drawn in its frame: scaled to the box, mirrored as it is flipped, the box turned about its centre. */
const drawn = (p: Props, at: { x: number; y: number }) => {
  const { sx, sy } = pathScale(p.shape, p.width, p.height)
  return turn(flippedPoint({ x: p.x + at.x * sx, y: p.y + at.y * sy }, p), centreOf(p as Box), p.rotation ?? 0)
}

describe('node.reshape', () => {
  it('writes the path and moves its box by the same amount, in one undo step; its linked copies stay', () => {
    const { store, tab } = open()
    const copies = [placed(store, 'wide-zig'), placed(store, 'tall-zig')]
    // A new first point 20 to the left and 10 above: the outline now starts there.
    tab.run('node.reshape', { id: 'zig', d: 'M0 0 L20 10 L120 60', dx: -20, dy: -10, width: 120, height: 60 })
    // The new data is drawn in the new box, so that is its size.
    expect(placed(store, 'zig')).toMatchObject({
      x: 80,
      y: 90,
      width: 120,
      height: 60,
      shape: { kind: 'path', d: 'M0 0 L20 10 L120 60', drawnIn: { width: 120, height: 60 } },
    })
    expect([placed(store, 'wide-zig'), placed(store, 'tall-zig')]).toEqual(copies)
    tab.undo()
    expect(placed(store, 'zig')).toMatchObject({ x: 100, y: 100, width: 100, height: 50, shape: { d: 'M0 0 L100 50' } })
  })

  it('keeps the points that did not change where they are drawn, on a turned path too', () => {
    for (const id of ['zig', 'tall-zig']) {
      const { store, tab } = open()
      const before = [drawn(placed(store, id), { x: 0, y: 0 }), drawn(placed(store, id), { x: 100, y: 50 })]
      tab.run('node.reshape', { id, d: 'M0 0 L20 10 L120 60', dx: -20, dy: -10, width: 120, height: 60 })
      const after = [drawn(placed(store, id), { x: 20, y: 10 }), drawn(placed(store, id), { x: 120, y: 60 })]
      after.forEach((p, i) => {
        expect(p.x, id).toBeCloseTo(before[i]?.x ?? NaN, 1)
        expect(p.y, id).toBeCloseTo(before[i]?.y ?? NaN, 1)
      })
    }
  })

  it('keeps the points that did not change where they are drawn, on a flipped path, turned or not', () => {
    for (const id of ['zig', 'tall-zig'])
      for (const flips of [{ flipX: true }, { flipY: true }, { flipX: true, flipY: true }]) {
        const { store, tab } = open()
        tab.run('node.update', { ids: [id], patch: flips })
        const before = [drawn(placed(store, id), { x: 0, y: 0 }), drawn(placed(store, id), { x: 100, y: 50 })]
        tab.run('node.reshape', { id, d: 'M0 0 L20 10 L120 60', dx: -20, dy: -10, width: 120, height: 60 })
        const after = [drawn(placed(store, id), { x: 20, y: 10 }), drawn(placed(store, id), { x: 120, y: 60 })]
        const name = `${id} ${JSON.stringify(flips)}`
        after.forEach((p, i) => {
          expect(p.x, name).toBeCloseTo(before[i]?.x ?? NaN, 1)
          expect(p.y, name).toBeCloseTo(before[i]?.y ?? NaN, 1)
        })
      }
  })

  it('reshapes only paths, and not a locked one', () => {
    const { tab } = open()
    expect(() => tab.run('node.reshape', { id: 'box', d: 'M0 0 L1 1', dx: 0, dy: 0, width: 1, height: 1 })).toThrow(
      /"box" is not a path/,
    )
    expect(() => tab.run('node.reshape', { id: 'gone', d: 'M0 0 L1 1', dx: 0, dy: 0, width: 1, height: 1 })).toThrow(
      /no layer "gone"/,
    )
    tab.run('node.lock', { ids: ['zig'], lock: { style: true } })
    expect(() => tab.run('node.reshape', { id: 'zig', d: 'M0 0 L1 1', dx: 0, dy: 0, width: 1, height: 1 })).toThrow(
      /"zig" is locked \(style\)/,
    )
    tab.run('node.reshape', { id: 'wide-zig', d: 'M0 0 L1 1', dx: 0, dy: 0, width: 1, height: 1 })
  })
})

describe('the box a path is drawn in', () => {
  it('is its box once a path with none first changes size, in the same undo step; its linked copies keep none', () => {
    const { store, tab } = open()
    tab.run('node.update', { ids: ['wide-zig'], patch: { width: 200, height: 100 } })
    expect(placed(store, 'wide-zig').shape).toMatchObject({ drawnIn: { width: 100, height: 50 } })
    // Wide draws the outline twice the size now; the square as before.
    expect(drawn(placed(store, 'wide-zig'), { x: 100, y: 50 })).toEqual({ x: 600, y: 200 })
    expect(drawn(placed(store, 'zig'), { x: 100, y: 50 })).toEqual({ x: 200, y: 150 })
    expect(placed(store, 'zig').shape).not.toHaveProperty('drawnIn')
    tab.undo()
    expect(placed(store, 'wide-zig').shape).not.toHaveProperty('drawnIn')
  })
})
