import { describe, expect, it } from 'vitest'

import type { Constraints, DesignInput } from '@dazbee/schema'

import { heldDesign, resizedBoxes } from './resize.ts'
import { sessionOf } from './test-boxes.ts'
import { type Box, drawnFrom, resize } from './transform.ts'

type Area = [number, number, number, number]

const rect = (parentId: string, index: string, [x, y, width, height]: Area, more: Record<string, unknown> = {}) => ({
  type: 'graphic' as const,
  parentId,
  link: `${parentId}-${index}`,
  index,
  name: 'Rect',
  props: { x, y, width, height, shape: { kind: 'rect' as const }, ...more },
})
const holder = (parentId: string, index: string, [x, y, width, height]: Area, more: Record<string, unknown> = {}) => ({
  type: 'box' as const,
  parentId,
  link: `${parentId}-${index}`,
  index,
  name: 'Box',
  props: { x, y, width, height, ...more },
})
const set = (horizontal: Constraints['horizontal'], vertical: Constraints['vertical']) => ({
  constraints: { horizontal, vertical },
})
/**
 * A frame holding a card 200 × 150 at (100, 50) with a layer set to each constraint, one locked in
 * place and a box set right and bottom that holds a dot set right; a second card below it; and a
 * row laid out by auto layout holding a layer its flow places and one kept where it is put, set right.
 */
const DESIGN: DesignInput = {
  meta: { designId: 'd', name: 'D' },
  pages: { p1: { name: 'One', order: 'a0' } },
  frames: { F: { pageId: 'p1', name: 'F', width: 800, height: 600, x: 0, y: 0, order: 'a0' } },
  nodes: {
    card: holder('F', 'a0', [100, 50, 200, 150]),
    plain: rect('card', 'a0', [110, 60, 20, 20]),
    right: rect('card', 'a1', [260, 60, 30, 20], set('right', 'top')),
    wide: rect('card', 'a2', [110, 100, 180, 20], set('leftRight', 'top')),
    middle: rect('card', 'a3', [190, 150, 20, 20], set('center', 'center')),
    scaled: rect('card', 'a4', [120, 170, 40, 20], set('scale', 'top')),
    pinned: { ...rect('card', 'a5', [150, 130, 10, 10]), lock: { move: true } },
    inner: holder('card', 'a6', [230, 130, 60, 40], set('right', 'bottom')),
    dot: rect('inner', 'a0', [275, 135, 10, 10], set('right', 'top')),
    card2: holder('F', 'a1', [100, 250, 200, 100]),
    plain2: rect('card2', 'a0', [110, 260, 20, 20]),
    right2: rect('card2', 'a1', [260, 260, 30, 20], set('right', 'top')),
    row: holder('F', 'a2', [400, 400, 300, 100], { layout: { direction: 'row' } }),
    flowing: rect('row', 'a0', [0, 0, 50, 50]),
    kept: rect('row', 'a1', [660, 410, 30, 30], { absolute: true, ...set('right', 'top') }),
  },
}
const box = (x: number, y: number, width: number, height: number, rotation = 0): Box => ({
  x,
  y,
  width,
  height,
  rotation,
})

/** The stored box of each layer under `root`, and `root`'s, as the drawn boxes a resize begins from. */
function startOf(root: string) {
  const design = heldDesign(sessionOf(DESIGN).design(), ['card', 'card2', 'row'])
  const boxes = new Map<string, Box>()
  const add = (id: string) => {
    const node = design.nodes[id]
    if (!node) return
    const { x, y, width, height, rotation } = node.props
    boxes.set(id, box(x, y, width, height, rotation))
    for (const [child, layer] of Object.entries(design.nodes)) if (layer.parentId === id) add(child)
  }
  add(root)
  return { design, boxes }
}

/** The x, y, width and height each layer is given, or has as it began where it is given none. */
function placesAfter(root: string, to: Box, keep = false) {
  const { design, boxes } = startOf(root)
  const from = boxes.get(root) ?? box(0, 0, 0, 0)
  const next = resizedBoxes(design, [root], boxes, from, to, keep)
  return (id: string) => {
    const b = next.get(id) ?? boxes.get(id)
    return b && [b.x, b.y, b.width, b.height]
  }
}

describe('resizedBoxes', () => {
  it('moves what a box holds with its west edge by their constraints: left with the edge, right where it was', () => {
    const at = placesAfter('card', box(60, 50, 240, 150))
    expect(at('card')).toEqual([60, 50, 240, 150])
    expect(at('plain')).toEqual([70, 60, 20, 20])
    expect(at('right')).toEqual([260, 60, 30, 20])
    expect(at('wide')).toEqual([70, 100, 220, 20])
    expect(at('middle')).toEqual([170, 150, 20, 20])
    expect(at('scaled')).toEqual([84, 170, 48, 20])
    expect(at('inner')).toEqual([230, 130, 60, 40])
    expect(at('dot')).toEqual([275, 135, 10, 10])
  })

  it('moves what a box holds with its east edge: left where it was, right with the edge, a nested box by its own and what it holds by theirs', () => {
    const at = placesAfter('card', box(100, 50, 240, 150))
    expect(at('plain')).toEqual([110, 60, 20, 20])
    expect(at('right')).toEqual([300, 60, 30, 20])
    expect(at('wide')).toEqual([110, 100, 220, 20])
    expect(at('middle')).toEqual([210, 150, 20, 20])
    expect(at('inner')).toEqual([270, 130, 60, 40])
    expect(at('dot')).toEqual([315, 135, 10, 10])
  })

  it('moves a nested box set to bottom with the south edge, what it holds with it', () => {
    const at = placesAfter('card', box(100, 50, 200, 180))
    expect(at('inner')).toEqual([230, 160, 60, 40])
    expect(at('dot')).toEqual([275, 165, 10, 10])
    expect(at('plain')).toEqual([110, 60, 20, 20])
  })

  it('keeps a layer locked in place where it is', () => {
    expect(placesAfter('card', box(60, 50, 240, 150))('pinned')).toEqual([150, 130, 10, 10])
  })

  it('with `keep` leaves everything the box holds where it is on the page, from any side', () => {
    const still = placesAfter('card', box(100, 50, 200, 150))
    for (const to of [box(60, 50, 240, 150), box(100, 20, 200, 180), box(80, 30, 260, 200)]) {
      const at = placesAfter('card', to, true)
      for (const id of ['plain', 'right', 'wide', 'middle', 'scaled', 'inner', 'dot'])
        expect([id, at(id)]).toEqual([id, still(id)])
    }
  })

  it("moves a laid-out box's layer kept where it is put by its constraints, and leaves the flow's to the flow", () => {
    const at = placesAfter('row', box(400, 400, 340, 100))
    expect(at('kept')).toEqual([700, 410, 30, 30])
    expect(at('flowing')).toEqual([0, 0, 50, 50])
  })

  it('applies the rule to what each of several boxes holds', () => {
    const { design, boxes } = startOf('card')
    for (const [id, b] of startOf('card2').boxes) boxes.set(id, b)
    const next = resizedBoxes(design, ['card', 'card2'], boxes, box(100, 50, 200, 300), box(100, 50, 240, 300))
    expect(next.get('right')).toMatchObject({ x: 300, y: 60 })
    expect(next.get('right2')).toMatchObject({ x: 300, y: 260 })
    expect(next.get('plain')).toEqual(boxes.get('plain'))
    expect(next.get('plain2')).toEqual(boxes.get('plain2'))
  })
  it('gives a layer the rule leaves its box as the resize began, so one an earlier move moved goes back', () => {
    const { design, boxes } = startOf('card')
    const from = box(100, 50, 200, 150)
    expect(resizedBoxes(design, ['card'], boxes, from, from).get('right')).toEqual(boxes.get('right'))
  })

  it('keeps a layer left and top where it is drawn when a turned box is dragged by its east side', () => {
    const { design, boxes } = startOf('card')
    const was = box(100, 50, 200, 150, 30)
    boxes.set('card', was)
    // The east side dragged 40 out along the box's turn: 140 from its centre. The rule rounds to hundredths.
    const to = resize(was, 'e', { x: 200 + 140 * Math.cos(Math.PI / 6), y: 125 + 140 * Math.sin(Math.PI / 6) })
    expect(to.width).toBeCloseTo(240, 6)
    const plain = boxes.get('plain') ?? box(0, 0, 0, 0)
    const next = resizedBoxes(design, ['card'], boxes, was, to)
    const drawn = drawnFrom(next.get('plain') ?? plain, [to])
    const before = drawnFrom(plain, [was])
    for (const key of ['x', 'y', 'width', 'height', 'rotation'] as const) expect(drawn[key]).toBeCloseTo(before[key], 2)
  })
})
