import { describe, expect, it } from 'vitest'

import { type Design, parseDesign } from '@dazbee/schema'

import { childrenOf } from './children.ts'
import { previewedDesign } from './previewed-design.ts'
import { testDesign } from './test-design.ts'

const working = (): Design => {
  const parsed = parseDesign(testDesign())
  if (!parsed.success) throw new Error(parsed.errors.join('\n'))
  return parsed.design
}

const box = (design: Design) => design.nodes.box as Design['nodes'][string]
const group = (parentId: string, index = 'a5') => ({
  type: 'group',
  parentId,
  link: `link-${parentId}-${index}`,
  index,
  name: 'Group',
  props: { x: 0, y: 0, width: 10, height: 10 },
})
const ids = (design: Design, parentId: string) => childrenOf(design, parentId).map(([id]) => id)

describe('previewedDesign', () => {
  it('is the working design itself when no layer is previewed', () => {
    const design = working()
    expect(previewedDesign(design, new Map())).toBe(design)
  })

  it('draws a layer as the preview has it, and leaves the working design and every other layer as they are', () => {
    const design = working()
    const moved = { ...box(design), props: { ...box(design).props, x: 300 } }
    const shown = previewedDesign(design, new Map([['box', moved]]))
    expect(shown.nodes.box?.props.x).toBe(300)
    expect(design.nodes.box?.props.x).toBe(100)
    expect(shown.nodes.headline).toBe(design.nodes.headline)
    expect(shown.frames).toBe(design.frames)
    expect(shown.pages).toBe(design.pages)
    expect(shown.meta).toBe(design.meta)
    expect(Object.isFrozen(shown.nodes)).toBe(true)
  })

  it('keeps the working layer where the schema refuses the previewed one', () => {
    const design = working()
    const bad = { ...box(design), props: { ...box(design).props, width: 'wide' } }
    expect(previewedDesign(design, new Map([['box', bad]])).nodes.box).toBe(design.nodes.box)
  })

  it('draws a layer the preview deletes as gone, and one it creates in its parent by index', () => {
    const design = working()
    const shown = previewedDesign(
      design,
      new Map<string, unknown>([
        ['headline', undefined],
        ['g', group('sq', 'Zz')],
      ]),
    )
    expect(shown.nodes.headline).toBeUndefined()
    expect(ids(shown, 'sq')).toEqual(['g', 'box'])
    expect(ids(design, 'sq')).toEqual(['box', 'headline'])
  })

  it('takes a move into a layer that holds it, and none into a layer that cannot, or round a cycle', () => {
    const design = working()
    const into = (parentId: string) => ({ ...box(design), parentId })
    const held = previewedDesign(
      design,
      new Map<string, unknown>([
        ['g', group('sq')],
        ['box', into('g')],
      ]),
    )
    expect(ids(held, 'g')).toEqual(['box'])
    expect(ids(held, 'sq')).toEqual(['headline', 'g'])
    // A text holds no layer: the box stays where it is.
    expect(previewedDesign(design, new Map([['box', into('headline')]])).nodes.box).toBe(design.nodes.box)
    // Two groups each in the other: neither is drawn, nor what one holds.
    const cycle = previewedDesign(
      design,
      new Map<string, unknown>([
        ['g1', group('g2')],
        ['g2', group('g1')],
        ['box', into('g1')],
      ]),
    )
    expect(cycle.nodes.g1).toBeUndefined()
    expect(cycle.nodes.g2).toBeUndefined()
    expect(cycle.nodes.box).toBe(design.nodes.box)
  })

  it('keeps a deleted layer that still holds one, though the layer holding it is deleted too', () => {
    const parsed = parseDesign({
      ...testDesign(),
      nodes: { ...testDesign().nodes, p: group('sq'), c: group('p'), g: group('c') },
    })
    if (!parsed.success) throw new Error(parsed.errors.join('\n'))
    const design = parsed.design
    const shown = previewedDesign(
      design,
      new Map<string, unknown>([
        ['p', undefined],
        ['c', undefined],
      ]),
    )
    expect(shown.nodes.p).toBe(design.nodes.p)
    expect(shown.nodes.c).toBe(design.nodes.c)
    expect(
      previewedDesign(
        design,
        new Map<string, unknown>([
          ['g', undefined],
          ['c', undefined],
        ]),
      ).nodes.c,
    ).toBeUndefined()
  })

  it('reads an unchanged record as the same layer with a memo, and a changed one again', () => {
    const design = working()
    const memo = new Map()
    const moved = (x: number) => new Map([['box', { ...box(design), props: { ...box(design).props, x } }]])
    const first = previewedDesign(design, moved(300), memo).nodes.box
    expect(previewedDesign(design, moved(300), memo).nodes.box).toBe(first)
    expect(previewedDesign(design, moved(320), memo).nodes.box?.props.x).toBe(320)
    previewedDesign(design, new Map(), memo)
    expect(memo.size).toBe(0)
  })

  it('takes no layer under an id a frame has', () => {
    const design = working()
    expect(previewedDesign(design, new Map([['banner', group('sq')]])).nodes.banner).toBeUndefined()
  })
})
