import { describe, expect, it } from 'vitest'

import { type Design, type DesignInput, parseDesign } from '@dazbee/schema'

import { render, type SceneLayer, sceneMemo } from './scene.ts'

const white = [{ type: 'solid' as const, color: '#FFFFFFFF' }]

const card = { type: 'box', index: 'a1', name: 'Card', props: { x: 0, y: 0, width: 500, height: 500 } } as const
const box = {
  type: 'graphic' as const,
  index: 'a0',
  name: 'Box',
  props: {
    x: 100,
    y: 100,
    width: 200,
    height: 100,
    shape: { kind: 'rect' as const },
    fills: [{ type: 'solid' as const, color: '#FF5A36FF' }],
  },
}
const hidden = {
  type: 'graphic',
  index: 'a1',
  name: 'Hidden',
  props: { x: 0, y: 0, width: 10, height: 10, visible: false, shape: { kind: 'ellipse' } },
} as const
const headline = {
  type: 'text',
  index: 'a0',
  name: 'Headline',
  props: {
    x: 60,
    y: 600,
    width: 960,
    height: 100,
    text: 'Summer sale',
    style: { fontFamily: 'Noto Sans', fontSize: 84, color: '#111111FF' },
  },
} as const
const other = {
  type: 'graphic',
  index: 'a0',
  name: 'Other page',
  props: { x: 0, y: 0, width: 10, height: 10, shape: { kind: 'rect' } },
} as const

/** Two pages, each with a square frame and a banner frame holding linked copies of its layers. */
const input = (): DesignInput => ({
  meta: { designId: 'd1', name: 'Test' },
  pages: {
    p1: { name: 'Page 1', order: 'a0' },
    p2: { name: 'Page 2', order: 'a1' },
  },
  frames: {
    'p1-sq': { pageId: 'p1', name: 'Square', width: 1080, height: 1080, x: 0, y: 0, fills: white, order: 'a0' },
    'p1-banner': { pageId: 'p1', name: 'Banner', width: 320, height: 50, x: 1280, y: 0, fills: white, order: 'a1' },
    'p2-sq': { pageId: 'p2', name: 'Square', width: 1080, height: 1080, x: 0, y: 0, order: 'a0' },
    'p2-banner': { pageId: 'p2', name: 'Banner', width: 320, height: 50, x: 1280, y: 0, order: 'a1' },
  },
  nodes: {
    card: { ...card, parentId: 'p1-sq', link: 'card' },
    box: { ...box, parentId: 'card', link: 'box' },
    hidden: { ...hidden, parentId: 'card', link: 'hidden' },
    headline: { ...headline, parentId: 'p1-sq', link: 'headline' },
    other: { ...other, parentId: 'p2-sq', link: 'other' },
    'banner-card': { ...card, parentId: 'p1-banner', link: 'card' },
    'banner-box': { ...box, parentId: 'banner-card', link: 'box' },
    'banner-hidden': {
      ...hidden,
      parentId: 'banner-card',
      link: 'hidden',
      props: { ...hidden.props, visible: true },
    },
    'banner-headline': {
      ...headline,
      parentId: 'p1-banner',
      link: 'headline',
      props: { ...headline.props, text: 'Sale', x: 4 },
    },
    'banner-other': { ...other, parentId: 'p2-banner', link: 'other' },
  },
})

const design = (): Design => {
  const parsed = parseDesign(input())
  if (!parsed.success) throw new Error(parsed.errors.join('\n'))
  return parsed.design
}

describe('render', () => {
  it('builds the frame’s tree in index order, with the frame’s size and fills', () => {
    const scene = render(design(), 'p1-sq')
    expect(scene).toMatchObject({ frameId: 'p1-sq', width: 1080, height: 1080, fills: white })
    expect(scene.layers.map((l) => l.id)).toEqual(['headline', 'card'])
    expect(scene.layers[1]?.children.map((l) => l.id)).toEqual(['box'])
  })

  it('leaves out hidden layers', () => {
    const ids = render(design(), 'p1-sq').layers.flatMap((l) => [l.id, ...l.children.map((c) => c.id)])
    expect(ids).not.toContain('hidden')
  })

  it('draws another frame’s linked copies with their own props', () => {
    const scene = render(design(), 'p1-banner')
    expect(scene).toMatchObject({ width: 320, height: 50 })
    expect(scene.layers[0]).toMatchObject({ id: 'banner-headline', props: { text: 'Sale', x: 4, y: 600 } })
    expect(scene.layers[1]?.children.map((l) => l.id)).toEqual(['banner-box', 'banner-hidden'])
  })

  it('only takes layers from the frame asked for', () => {
    expect(render(design(), 'p2-sq').layers.map((l) => l.id)).toEqual(['other'])
    expect(render(design(), 'p2-sq').fills).toEqual([])
  })

  it('does not change the design', () => {
    const d = design()
    const before = structuredClone(d)
    render(d, 'p1-banner')
    expect(d).toEqual(before)
  })

  it('refuses a frame the design does not have', () => {
    for (const id of ['nope', 'p1', 'card', 'constructor'])
      expect(() => render(design(), id)).toThrow(`no frame "${id}"`)
  })

  it('with a memo, keeps a layer object while the layer and its children are the same objects', () => {
    const memo = sceneMemo()
    const d = design()
    const first = render(d, 'p1-sq', memo)
    const [kept, changed] = first.layers
    // A new snapshot that changes only the box, the way the editor's design does.
    const moved = d.nodes['box']
    if (moved?.type !== 'graphic') throw new Error('no box')
    const next: Design = { ...d, nodes: { ...d.nodes, box: { ...moved, props: { ...moved.props, x: 140 } } } }
    const second = render(next, 'p1-sq', memo)
    expect(second.layers[0]).toBe(kept)
    expect(second.layers[1]).not.toBe(changed)
    expect(second.layers[1]?.children[0]?.props.x).toBe(140)
    // A change to a linked copy in another frame changes nothing here, and the same snapshot gives the same layers.
    const copy = next.nodes['banner-headline']
    if (copy?.type !== 'text') throw new Error('no copy')
    const third = render(
      { ...next, nodes: { ...next.nodes, 'banner-headline': { ...copy, props: { ...copy.props, x: 1 } } } },
      'p1-sq',
      memo,
    )
    expect(third.layers[0]).toBe(kept)
    expect(third.layers[1]).toBe(second.layers[1])
    expect(render(next, 'p1-banner', memo).layers[0]).not.toBe(kept)
  })

  describe('with hiddenOpacity', () => {
    /**
     * A frame with a row laying out `a`, hidden `b` and `c`; a hidden group holding a hidden layer
     * and a shown one; a hidden mask; and a boolean of a shown and a hidden shape.
     */
    const hiddenDesign = (): Design => {
      const shape = (parentId: string, index: string, props: Record<string, unknown> = {}) => ({
        type: 'graphic' as const,
        parentId,
        link: `${parentId}-${index}`,
        index,
        name: index,
        props: { x: 400, y: 400, width: 50, height: 50, shape: { kind: 'rect' as const }, ...props },
      })
      const parsed = parseDesign({
        meta: { designId: 'd', name: 'Hidden' },
        pages: { p: { name: 'P', order: 'a0' } },
        frames: { sq: { pageId: 'p', name: 'Square', width: 1080, height: 1080, x: 0, y: 0, order: 'a0' } },
        nodes: {
          row: {
            type: 'box',
            parentId: 'sq',
            link: 'row',
            index: 'a0',
            name: 'Row',
            props: { x: 0, y: 0, width: 600, height: 100, layout: { direction: 'row', gap: 10 } },
          },
          a: shape('row', 'a0', { width: 100 }),
          b: shape('row', 'a1', { width: 100, visible: false }),
          c: shape('row', 'a2', { width: 100 }),
          group: {
            type: 'group',
            parentId: 'sq',
            link: 'group',
            index: 'a1',
            name: 'Group',
            props: { x: 400, y: 400, width: 50, height: 50, opacity: 0.8, visible: false },
          },
          inner: shape('group', 'a0', { visible: false }),
          shown: shape('group', 'a1'),
          mask: shape('sq', 'a2', { mask: 'alpha', visible: false }),
          bool: {
            type: 'boolean',
            parentId: 'sq',
            link: 'bool',
            index: 'a3',
            name: 'Boolean',
            props: { x: 400, y: 400, width: 50, height: 50 },
          },
          left: shape('bool', 'a0'),
          right: shape('bool', 'a1', { visible: false }),
        } as DesignInput['nodes'],
      })
      if (!parsed.success) throw new Error(parsed.errors.join('\n'))
      return parsed.design
    }
    const byId = (layers: SceneLayer[], into = new Map<string, SceneLayer>()) => {
      for (const layer of layers) {
        into.set(layer.id, layer)
        byId(layer.children, into)
      }
      return into
    }

    it('keeps hidden layers, still hidden, the outermost at that share of its opacity and masking nothing', () => {
      const layers = byId(render(hiddenDesign(), 'sq', undefined, undefined, undefined, { hiddenOpacity: 0.25 }).layers)
      expect(layers.get('b')?.props).toMatchObject({ visible: false, opacity: 0.25 })
      expect(layers.get('group')?.props).toMatchObject({ visible: false, opacity: 0.2 })
      expect(layers.get('inner')?.props).toMatchObject({ visible: false, opacity: 1 })
      expect(layers.get('shown')?.props).toMatchObject({ visible: true, opacity: 1 })
      expect(layers.get('mask')?.props).toMatchObject({ visible: false, opacity: 0.25 })
      expect(layers.get('mask')?.props.mask).toBeUndefined()
    })

    it("lays the shown layers out as without it, and leaves out a boolean's hidden shapes, which would change its outline", () => {
      const without = byId(render(hiddenDesign(), 'sq').layers)
      const withHidden = byId(
        render(hiddenDesign(), 'sq', undefined, undefined, undefined, { hiddenOpacity: 0.25 }).layers,
      )
      for (const id of ['row', 'a', 'c']) expect(withHidden.get(id)?.props).toEqual(without.get(id)?.props)
      expect(withHidden.get('c')?.props.x).toBe(110)
      expect(withHidden.get('b')?.props.x).toBe(400)
      expect(withHidden.get('bool')?.children.map((l) => l.id)).toEqual(['left'])
      expect(without.has('b')).toBe(false)
    })

    it('with a memo, builds a hidden layer again once a holder is hidden or shown', () => {
      const memo = sceneMemo()
      const d = hiddenDesign()
      const options = { hiddenOpacity: 0.25 }
      expect(byId(render(d, 'sq', memo, undefined, undefined, options).layers).get('inner')?.props.opacity).toBe(1)
      const group = d.nodes['group']
      if (group?.type !== 'group') throw new Error('no group')
      const next: Design = {
        ...d,
        nodes: { ...d.nodes, group: { ...group, props: { ...group.props, visible: true } } },
      }
      expect(byId(render(next, 'sq', memo, undefined, undefined, options).layers).get('inner')?.props.opacity).toBe(
        0.25,
      )
    })
  })
})
