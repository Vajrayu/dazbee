import { describe, expect, it } from 'vitest'

import type { DesignInput } from '@dazbee/schema'

import { resizedBoxes, scalingTexts, sizingPatch, sizingPatches, switchSizing } from './resize.ts'
import { sessionOf } from './test-boxes.ts'
import { type Box, drawnFrom, resize } from './transform.ts'

const STYLE = { fontFamily: 'Noto Sans', fontSize: 20, color: '#000000FF' }
const rect = (
  parentId: string,
  index: string,
  box: { x: number; y: number; width: number; height: number; rotation?: number },
) => ({
  type: 'graphic' as const,
  parentId,
  index,
  name: 'Rect',
  props: { ...box, shape: { kind: 'rect' as const } },
})
const text = (parentId: string, index: string, boxMode: 'fixed' | 'autoWidth' | 'autoHeight') => ({
  type: 'text' as const,
  parentId,
  index,
  name: 'Text',
  props: { x: 0, y: 0, width: 100, height: 24, text: 'Hi', boxMode, style: STYLE },
})
const row = (parentId: string) => ({
  type: 'box' as const,
  parentId,
  index: 'a2',
  name: 'Row',
  props: { x: 0, y: 200, width: 300, height: 100, layout: { direction: 'row' as const } },
})
/**
 * One page with a square frame and a wide one. The square holds a group with a text and a rect, a
 * box holding a text, a row laid out by auto layout holding a rect, a text that grows with its
 * words, and one whose style is locked; the wide frame holds copies of the row, its rect and the
 * text that grows.
 */
const DESIGN: DesignInput = {
  meta: { designId: 'd', name: 'D' },
  pages: { p1: { name: 'One', order: 'a0' } },
  frames: {
    sq: { pageId: 'p1', name: 'Square', width: 1080, height: 1080, x: 0, y: 0, order: 'a0' },
    wide: { pageId: 'p1', name: 'Wide', width: 1200, height: 628, x: 1280, y: 0, order: 'a1' },
  },
  nodes: {
    group: {
      type: 'group',
      parentId: 'sq',
      link: 'group',
      index: 'a0',
      name: 'Group',
      props: { x: 0, y: 0, width: 100, height: 100 },
    },
    grouped: { ...text('group', 'a0', 'fixed'), link: 'grouped' },
    inGroup: { ...rect('group', 'a1', { x: 50, y: 50, width: 50, height: 50 }), link: 'inGroup' },
    card: {
      type: 'box',
      parentId: 'sq',
      link: 'card',
      index: 'a1',
      name: 'Card',
      props: { x: 0, y: 0, width: 100, height: 100 },
    },
    framed: { ...text('card', 'a0', 'fixed'), link: 'framed' },
    row: { ...row('sq'), link: 'row' },
    flowing: { ...rect('row', 'a0', { x: 0, y: 200, width: 50, height: 50 }), link: 'flowing' },
    grows: { ...text('sq', 'a3', 'autoWidth'), link: 'grows' },
    styled: { ...text('sq', 'a4', 'fixed'), link: 'styled', lock: { style: true } },
    'wide-row': { ...row('wide'), link: 'row' },
    'wide-flowing': { ...rect('wide-row', 'a0', { x: 0, y: 200, width: 50, height: 50 }), link: 'flowing' },
    'wide-grows': { ...text('wide', 'a3', 'autoWidth'), link: 'grows' },
  },
}
const box = (x: number, y: number, width: number, height: number, rotation = 0): Box => ({
  x,
  y,
  width,
  height,
  rotation,
})

/** A session over the design. */
function harness() {
  const session = sessionOf(DESIGN)
  const prop = (id: string, key: string) => (session.design().nodes[id]?.props as Record<string, unknown>)[key]
  /** The wide frame's copies as they are now. */
  const copies = () => Object.entries(session.design().nodes).filter(([id]) => id.startsWith('wide-'))
  return { session, prop, copies }
}

describe('resizedBoxes', () => {
  it('gives one root the new box itself, and scales several within it', () => {
    const { session } = harness()
    const one = resizedBoxes(
      session.design(),
      ['grows'],
      new Map([['grows', box(0, 0, 100, 24)]]),
      box(0, 0, 100, 24),
      box(0, 0, 200, 48),
    )
    expect(one.get('grows')).toEqual(box(0, 0, 200, 48))
    const start = new Map([
      ['grows', box(0, 0, 50, 50)],
      ['styled', box(50, 50, 50, 50)],
    ])
    const several = resizedBoxes(session.design(), ['grows', 'styled'], start, box(0, 0, 100, 100), box(0, 0, 200, 200))
    expect(several.get('grows')).toEqual(box(0, 0, 100, 100))
    expect(several.get('styled')).toEqual(box(100, 100, 100, 100))
  })

  it('gives a layer in a flow a size and never a place', () => {
    const { session } = harness()
    const start = new Map([['flowing', box(0, 200, 50, 50)]])
    const next = resizedBoxes(session.design(), ['flowing'], start, box(0, 200, 50, 50), box(-10, 190, 60, 60))
    expect(next.get('flowing')).toEqual(box(0, 200, 60, 60))
  })

  it("scales a group's layers with it, and with `keep` keeps a box's where they are", () => {
    const { session } = harness()
    const group = resizedBoxes(
      session.design(),
      ['group'],
      new Map([
        ['group', box(0, 0, 100, 100)],
        ['inGroup', box(50, 50, 50, 50)],
      ]),
      box(0, 0, 100, 100),
      box(0, 0, 200, 200),
    )
    expect(group.get('inGroup')).toEqual(box(100, 100, 100, 100))
    const card = resizedBoxes(
      session.design(),
      ['card'],
      new Map([
        ['card', box(0, 0, 100, 100)],
        ['framed', box(10, 10, 50, 24)],
      ]),
      box(0, 0, 100, 100),
      box(-100, 0, 200, 100),
      true,
    )
    expect(card.get('card')).toEqual(box(-100, 0, 200, 100))
    expect(card.get('framed')).toEqual(box(10, 10, 50, 24))
  })

  it('keeps what a turned box holds where it is drawn when a side of the box is dragged with `keep`', () => {
    const { session } = harness()
    const was = box(0, 0, 100, 100, 30)
    const framed = box(10, 10, 50, 24)
    // The west side dragged 40 out along the box's turn: 90 from its centre.
    const to = resize(was, 'w', { x: 50 - 90 * Math.cos(Math.PI / 6), y: 50 - 90 * Math.sin(Math.PI / 6) })
    expect(to.width).toBeCloseTo(140, 6)
    const next = resizedBoxes(
      session.design(),
      ['card'],
      new Map([
        ['card', was],
        ['framed', framed],
      ]),
      was,
      to,
      true,
    )
    const drawn = drawnFrom(next.get('framed') ?? framed, [to])
    const before = drawnFrom(framed, [was])
    for (const key of ['x', 'y', 'width', 'height', 'rotation'] as const) expect(drawn[key]).toBeCloseTo(before[key], 6)
  })

  it("moves a box's layers along with it when several layers are resized", () => {
    const { session } = harness()
    const start = new Map([
      ['card', box(0, 0, 100, 100)],
      ['framed', box(10, 10, 50, 24)],
      ['grows', box(100, 0, 100, 100)],
    ])
    const next = resizedBoxes(session.design(), ['card', 'grows'], start, box(0, 0, 200, 100), box(100, 0, 200, 100))
    expect(next.get('card')).toEqual(box(100, 0, 100, 100))
    expect(next.get('framed')).toEqual(box(110, 10, 50, 24))
  })
})

describe('scalingTexts', () => {
  it('gives the text a corner scales, selected or in a group, with its sizes', () => {
    const { session } = harness()
    const texts = scalingTexts(session.design(), ['group', 'grows', 'card'], 'se')
    expect([...texts.keys()]).toEqual(['grouped', 'grows'])
    expect(texts.get('grows')).toMatchObject({ style: STYLE, runs: [] })
  })

  it('gives none for an edge, or for text whose style is locked', () => {
    const { session } = harness()
    expect(scalingTexts(session.design(), ['grows'], 'e').size).toBe(0)
    expect(scalingTexts(session.design(), ['styled'], 'se').size).toBe(0)
  })

  it('leaves out the text in a box inside a group a corner scales, the text beside the box in the group scaled', () => {
    const { session } = harness()
    session.run('node.move', { id: 'card', parentId: 'group' })
    expect([...scalingTexts(session.design(), ['group'], 'se').keys()]).toEqual(['grouped'])
  })
})

describe('switchSizing', () => {
  it('fixes the axes a resize drags: text that grows with its words gets a box, its copy in the other frame not', () => {
    const { session, prop, copies } = harness()
    const before = copies()
    switchSizing(session, ['grows'], 'e', session.design(), new Map())
    expect(prop('grows', 'boxMode')).toBe('autoHeight')
    switchSizing(session, ['grows'], 's', session.design(), new Map())
    expect(prop('grows', 'boxMode')).toBe('fixed')
    expect(copies()).toEqual(before)
  })

  it('leaves the box mode of text a corner scales', () => {
    const { session, prop } = harness()
    switchSizing(session, ['grows'], 'se', session.design(), new Map([['grows', {}]]))
    expect(prop('grows', 'boxMode')).toBe('autoWidth')
  })

  it('fixes the sizing of a layer in a flow, and of an auto layout box, on the axes dragged', () => {
    const { session, prop, copies } = harness()
    session.run('node.update', {
      ids: ['flowing', 'row', 'wide-flowing', 'wide-row'],
      patch: { sizing: { width: 'fill', height: 'hug' } },
    })
    const before = copies()
    switchSizing(session, ['flowing', 'row'], 'e', session.design(), new Map())
    expect(prop('flowing', 'sizing')).toEqual({ width: 'fixed', height: 'hug' })
    expect(prop('row', 'sizing')).toEqual({ width: 'fixed', height: 'hug' })
    expect(copies()).toEqual(before)
  })

  it('fixes the dragged side of a Free box that kept Fit from its layout', () => {
    const { session, prop } = harness()
    session.run('node.update', { ids: ['card'], patch: { sizing: { width: 'hug', height: 'hug' } } })
    switchSizing(session, ['card'], 'e', session.design(), new Map())
    expect(prop('card', 'sizing')).toEqual({ width: 'fixed', height: 'hug' })
  })

  it('keeps a text in a flow filling across while its height is dragged', () => {
    const { session, prop } = harness()
    session.run('node.move', { id: 'grows', parentId: 'row' })
    session.run('node.update', {
      ids: ['grows'],
      patch: { boxMode: 'autoHeight', sizing: { width: 'fill', height: 'hug' } },
    })
    switchSizing(session, ['grows'], 's', session.design(), new Map())
    expect(prop('grows', 'boxMode')).toBe('fixed')
    expect(prop('grows', 'sizing')).toEqual({ width: 'fill', height: 'fixed' })
  })

  it('leaves the sizing of a text in a flow a corner scales, in step with its box mode', () => {
    const { session, prop } = harness()
    session.run('node.move', { id: 'grows', parentId: 'row' })
    session.run('node.update', { ids: ['grows'], patch: { sizing: { width: 'hug', height: 'hug' } } })
    switchSizing(session, ['grows'], 'se', session.design(), new Map([['grows', {}]]))
    expect(prop('grows', 'sizing')).toEqual({ width: 'hug', height: 'hug' })
  })
})

describe('switchSizing on text a corner scales', () => {
  it('fixes a side of it that filled, keeping the sides that grow with its words', () => {
    const { session, prop } = harness()
    session.run('node.move', { id: 'grows', parentId: 'row' })
    session.run('node.update', {
      ids: ['grows'],
      patch: { boxMode: 'autoHeight', sizing: { width: 'fill', height: 'hug' } },
    })
    switchSizing(session, ['grows'], 'se', session.design(), new Map([['grows', {}]]))
    expect(prop('grows', 'sizing')).toEqual({ width: 'fixed', height: 'hug' })
    expect(prop('grows', 'boxMode')).toBe('autoHeight')
  })
})

describe('sizingPatch', () => {
  const graphic = (sizing?: { width: 'fixed' | 'hug' | 'fill'; height: 'fixed' | 'hug' | 'fill' }) => ({
    type: 'graphic',
    props: sizing ? { sizing } : {},
  })
  const words = (boxMode: string, sizing?: { width: 'fixed' | 'hug' | 'fill'; height: 'fixed' | 'hug' | 'fill' }) => ({
    type: 'text',
    props: { boxMode, ...(sizing ? { sizing } : {}) },
  })

  it('writes only what changes', () => {
    expect(sizingPatch(graphic(), { width: 'fixed' })).toEqual({})
    expect(sizingPatch(graphic(), { width: 'fill' })).toEqual({ sizing: { width: 'fill', height: 'fixed' } })
    expect(sizingPatch(graphic({ width: 'hug', height: 'hug' }), { width: 'fixed', height: 'fixed' })).toEqual({
      sizing: { width: 'fixed', height: 'fixed' },
    })
    expect(sizingPatch(words('fixed'), { width: 'fixed' })).toEqual({})
  })

  it('keeps a text’s box mode in step: fitting across fits down, fixing down fixes across', () => {
    expect(sizingPatch(words('autoWidth'), { width: 'fixed' })).toEqual({ boxMode: 'autoHeight' })
    expect(sizingPatch(words('autoWidth'), { height: 'fixed' })).toEqual({ boxMode: 'fixed' })
    expect(sizingPatch(words('fixed'), { width: 'hug' })).toEqual({ boxMode: 'autoWidth' })
    expect(sizingPatch(words('autoHeight'), { height: 'fixed' })).toEqual({ boxMode: 'fixed' })
  })

  it('gives a text sizing of its own only where it has one or a side fills', () => {
    expect(sizingPatch(words('autoHeight'), { width: 'fill' })).toEqual({ sizing: { width: 'fill', height: 'hug' } })
    expect(sizingPatch(words('autoHeight', { width: 'fill', height: 'hug' }), { height: 'fixed' })).toEqual({
      boxMode: 'fixed',
      sizing: { width: 'fill', height: 'fixed' },
    })
  })

  it('keeps the sizing a text has of its own when it is asked to fit its words both ways, as the auto width Box tile asks', () => {
    expect(sizingPatch(words('autoHeight', { width: 'fill', height: 'hug' }), { width: 'hug', height: 'hug' })).toEqual(
      {
        boxMode: 'autoWidth',
        sizing: { width: 'hug', height: 'hug' },
      },
    )
  })
})

describe('sizingPatches', () => {
  it('sets the side of each layer; Fill along the flow of a box that fits it fixes that box too', () => {
    const { session } = harness()
    session.run('node.update', { ids: ['row'], patch: { sizing: { width: 'hug', height: 'hug' } } })
    const design = session.design()
    expect(sizingPatches(design, ['flowing'], { width: 'fill' })).toEqual(
      new Map([
        ['flowing', { sizing: { width: 'fill', height: 'fixed' } }],
        ['row', { sizing: { width: 'fixed', height: 'hug' } }],
      ]),
    )
    expect(sizingPatches(design, ['flowing'], { height: 'fill' })).toEqual(
      new Map([['flowing', { sizing: { width: 'fixed', height: 'fill' } }]]),
    )
  })

  it('keeps the side asked of a box that is itself given, over the Fixed a layer it holds would ask', () => {
    const { session } = harness()
    session.run('node.update', { ids: ['row'], patch: { sizing: { width: 'hug', height: 'hug' } } })
    expect(sizingPatches(session.design(), ['flowing', 'row'], { width: 'fill' })).toEqual(
      new Map([
        ['flowing', { sizing: { width: 'fill', height: 'fixed' } }],
        ['row', { sizing: { width: 'fill', height: 'hug' } }],
      ]),
    )
  })
})
