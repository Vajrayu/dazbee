// The layers panel's tree: one frame's layers, what a selection opens, and where the arrow keys go.
import { describe, expect, it } from 'vitest'

import { Design, type DesignInput } from '@dazbee/schema'

import { arrowStep, opensFor, rowClick, treeRows } from './layer-tree.ts'

type Input = DesignInput['nodes'][string]

const shape = (parentId: string, index: string, name: string, link: string): Input => ({
  type: 'graphic',
  parentId,
  index,
  name,
  link,
  props: { x: 0, y: 0, width: 10, height: 10, shape: { kind: 'rect' } },
})
const group = (parentId: string, index: string, name: string, link: string): Input => ({
  type: 'group',
  parentId,
  index,
  name,
  link,
  props: { x: 0, y: 0, width: 10, height: 10 },
})
const mask = (input: Input): Input => ({ ...input, props: { ...input.props, mask: 'alpha' } }) as Input
const hidden = (input: Input): Input => ({ ...input, props: { ...input.props, visible: false } }) as Input
const frame = (pageId: string, name: string, width: number, height: number, order: string) => ({
  pageId,
  name,
  width,
  height,
  x: 0,
  y: 0,
  order,
})

/**
 * Page 1 holds Sale square and Sale story, linked (Headline and Photo in both, Badge only in the
 * square), and Fresh square, linked to neither; Page 2 holds Other. The square's Photo is a group
 * holding Picture.
 */
const design = (): Design =>
  Design.parse({
    meta: { designId: 'd', name: 'Summer sale' },
    pages: { p1: { name: 'Page 1', order: 'a0' }, p2: { name: 'Page 2', order: 'a1' } },
    frames: {
      story: frame('p1', 'Sale story', 1080, 1920, 'a1'),
      square: frame('p1', 'Sale square', 1080, 1080, 'a0'),
      fresh: frame('p1', 'Fresh square', 1080, 1080, 'a2'),
      other: frame('p2', 'Other', 300, 250, 'a0'),
    },
    nodes: {
      photo: group('square', 'a0', 'Photo', 'L-photo'),
      picture: shape('photo', 'a0', 'Picture', 'L-picture'),
      head: shape('square', 'a1', 'Headline', 'L-head'),
      badge: shape('square', 'a2', 'Badge', 'L-badge'),
      sPhoto: group('story', 'a0', 'Photo', 'L-photo'),
      sPicture: shape('sPhoto', 'a0', 'Picture', 'L-picture'),
      sHead: shape('story', 'a1', 'Headline', 'L-head'),
      fHead: shape('fresh', 'a0', 'Headline', 'L-fresh-head'),
      oHead: shape('other', 'a0', 'Headline', 'L-head'),
    },
  })

/**
 * Page 1 holds Masks, whose layers bottom to top are Base, a Mask group (its Ellipse mask under
 * Photo, a Card group holding Back, and Title) and a Loose mask under Badge.
 */
const masked = (): Design =>
  Design.parse({
    meta: { designId: 'm', name: 'Masks' },
    pages: { p1: { name: 'Page 1', order: 'a0' } },
    frames: { masks: frame('p1', 'Masks', 1080, 1080, 'a0') },
    nodes: {
      base: shape('masks', 'a0', 'Base', 'L-base'),
      mg: group('masks', 'a1', 'Mask group', 'L-mg'),
      ellipse: mask(shape('mg', 'a0', 'Ellipse', 'L-ellipse')),
      photo: shape('mg', 'a1', 'Photo', 'L-photo'),
      card: group('mg', 'a2', 'Card', 'L-card'),
      back: shape('card', 'a0', 'Back', 'L-back'),
      title: shape('mg', 'a3', 'Title', 'L-title'),
      loose: mask(shape('masks', 'a2', 'Loose', 'L-loose')),
      badge: shape('masks', 'a3', 'Badge', 'L-badge'),
    },
  })
/** The design with a layer changed. */
const changed = (design: Design, id: string, change: (input: Input) => Input): Design =>
  Design.parse({ ...design, nodes: { ...design.nodes, [id]: change(design.nodes[id] as Input) } })

/** The rows as the panel lists them: each indented by its depth. */
const listed = (rows: ReturnType<typeof treeRows>['rows']) =>
  rows.map((row) => `${'  '.repeat(row.depth)}${row.node.name}`)

describe('treeRows', () => {
  it('lists one frame’s layers, topmost first, its top-level layers at the first level', () => {
    const { rows } = treeRows(design(), 'square', new Set())
    expect(listed(rows)).toEqual(['Badge', 'Headline', 'Photo'])
    expect(rows.map((row) => [row.id, row.depth, row.parentId, row.frameId, row.position, row.siblings])).toEqual([
      ['badge', 0, 'square', 'square', 1, 3],
      ['head', 0, 'square', 'square', 2, 3],
      ['photo', 0, 'square', 'square', 3, 3],
    ])
  })

  it('lists an open group’s layers inside it, a level deeper, and no other frame’s', () => {
    expect(listed(treeRows(design(), 'square', new Set(['photo', 'sPhoto'])).rows)).toEqual([
      'Badge',
      'Headline',
      'Photo',
      '  Picture',
    ])
    expect(listed(treeRows(design(), 'story', new Set(['photo', 'sPhoto'])).rows)).toEqual([
      'Headline',
      'Photo',
      '  Picture',
    ])
  })

  it('lists no row for a frame the design lacks, or none', () => {
    expect(treeRows(design(), 'gone', new Set()).rows).toEqual([])
    expect(treeRows(design(), null, new Set()).rows).toEqual([])
  })

  it('marks a layer only here when its frame is linked to another on the page and no other frame there holds its link', () => {
    const marked = (frameId: string, open: string[]) =>
      treeRows(design(), frameId, new Set(open)).rows.flatMap((row) => (row.onlyHere ? [row.id] : []))
    // Badge is in Sale square alone; Headline and Photo have copies in Sale story; Other's Headline
    // shares a link but is on another page.
    expect(marked('square', ['photo'])).toEqual(['badge'])
    expect(marked('story', ['sPhoto'])).toEqual([])
    // Fresh square shares no link with any frame: none of its layers is marked.
    expect(marked('fresh', [])).toEqual([])
  })

  describe('arrows', () => {
    /** Each arrow as the names of its rows, topmost masked layer to mask, and the mask's depth. */
    const arrowsOf = (design: Design, open: string[]) => {
      const { rows, arrows } = treeRows(design, 'masks', new Set(open))
      const name = (i: number) => rows[i]?.node.name ?? `row ${i}`
      return arrows.map(({ from, to, depth }) => `${name(from)} → ${name(to)} at ${depth}`)
    }

    it('draws one arrow per shown mask that masks a layer, from the topmost masked row to the mask’s', () => {
      expect(arrowsOf(masked(), ['mg'])).toEqual(['Title → Ellipse at 1', 'Badge → Loose at 0'])
    })

    it('counts the rows of an open group between them, and none of a closed parent', () => {
      const { rows, arrows } = treeRows(masked(), 'masks', new Set(['mg', 'card']))
      const at = (id: string) => rows.findIndex((row) => row.id === id)
      expect(arrows).toContainEqual({ from: at('title'), to: at('ellipse'), depth: 1 })
      expect(at('ellipse') - at('title')).toBe(4)
      expect(arrowsOf(masked(), [])).toEqual(['Badge → Loose at 0'])
    })

    it('leaves out hidden layers: a hidden mask draws none, and a hidden masked layer is no arrow’s end', () => {
      expect(arrowsOf(changed(masked(), 'ellipse', hidden), ['mg'])).toEqual(['Badge → Loose at 0'])
      expect(arrowsOf(changed(masked(), 'title', hidden), ['mg'])).toEqual([
        'Card → Ellipse at 1',
        'Badge → Loose at 0',
      ])
      expect(arrowsOf(changed(masked(), 'badge', hidden), ['mg'])).toEqual(['Title → Ellipse at 1'])
    })

    it('draws none for a mask with nothing shown above it, or only a mask', () => {
      // Badge, at the top, becomes a mask: neither it nor Loose under it masks a layer.
      expect(arrowsOf(changed(masked(), 'badge', mask), ['mg'])).toEqual(['Title → Ellipse at 1'])
    })
  })
})

describe('opensFor', () => {
  it('opens the groups a selected layer is in', () => {
    expect(opensFor(design(), ['picture'])).toEqual(['photo'])
    expect(opensFor(design(), ['sHead'])).toEqual([])
    expect(opensFor(design(), [])).toEqual([])
  })

  it('opens a selected Mask group itself, and no other selected group', () => {
    expect(opensFor(masked(), ['mg'])).toEqual(['mg'])
    expect(opensFor(masked(), ['card'])).toEqual(['mg'])
  })

  it('opens nothing for a layer the design no longer has', () => {
    expect(opensFor(design(), ['gone'])).toEqual([])
  })
})

describe('arrowStep', () => {
  const open = new Set(['photo'])
  // Badge, Headline, Photo, Picture.
  const { rows } = treeRows(design(), 'square', open)
  const at = (id: string) => rows.findIndex((row) => row.id === id)
  const step = (from: string, key: string, rtl = false) => {
    const to = arrowStep(rows, at(from), key, open, rtl)
    return to === null ? null : 'go' in to ? to.go.id : `${to.open ? 'open' : 'close'} ${to.toggle}`
  }

  it('goes up and down through the frame’s layers, and to the first and last row', () => {
    expect(step('badge', 'ArrowDown')).toBe('head')
    expect(step('photo', 'ArrowDown')).toBe('picture')
    expect(step('picture', 'ArrowUp')).toBe('photo')
    expect(step('picture', 'ArrowDown')).toBeNull()
    expect(step('badge', 'ArrowUp')).toBeNull()
    expect(step('head', 'Home')).toBe('badge')
    expect(step('head', 'End')).toBe('picture')
  })

  it('opens a closed group inward, then goes to its first layer', () => {
    const closed = treeRows(design(), 'square', new Set()).rows
    expect(arrowStep(closed, 2, 'ArrowRight', new Set(), false)).toEqual({ toggle: 'photo', open: true })
    expect(step('photo', 'ArrowRight')).toBe('picture')
    expect(step('badge', 'ArrowRight')).toBeNull()
  })

  it('closes an open group outward, goes from a layer to its group’s row, and from a top-level layer nowhere', () => {
    expect(step('photo', 'ArrowLeft')).toBe('close photo')
    expect(step('picture', 'ArrowLeft')).toBe('photo')
    expect(step('head', 'ArrowLeft')).toBeNull()
  })

  it('swaps left and right in a right-to-left language', () => {
    expect(step('photo', 'ArrowLeft', true)).toBe('picture')
    expect(step('picture', 'ArrowRight', true)).toBe('photo')
  })

  it('leaves every other key alone', () => {
    expect(step('head', 'Enter')).toBeNull()
  })
})

describe('rowClick', () => {
  // Badge, Headline, Photo, Picture.
  const { rows } = treeRows(design(), 'square', new Set(['photo']))
  const plain = { shift: false, mod: false }
  const shift = { shift: true, mod: false }
  const mod = { shift: false, mod: true }
  const both = { shift: true, mod: true }

  it('selects the row clicked alone and makes it the anchor', () => {
    expect(rowClick(rows, 'head', plain, ['badge'], 'badge')).toEqual({ select: ['head'], anchor: 'head' })
  })

  it('with Ctrl or Cmd, adds the row or takes it out, and makes it the anchor', () => {
    expect(rowClick(rows, 'head', mod, ['badge'], 'badge')).toEqual({ toggle: 'head', anchor: 'head' })
  })

  it('with Shift, selects the layers listed from the anchor to the row, either way, the anchor staying', () => {
    expect(rowClick(rows, 'picture', shift, ['badge'], 'badge')).toEqual({
      select: ['badge', 'head', 'photo', 'picture'],
      anchor: 'badge',
    })
    expect(rowClick(rows, 'head', shift, ['picture', 'head'], 'picture')).toEqual({
      select: ['head', 'photo', 'picture'],
      anchor: 'picture',
    })
  })

  it('with Shift and Ctrl or Cmd, adds the range to the selection', () => {
    expect(rowClick(rows, 'photo', both, ['sPhoto', 'badge'], 'badge')).toEqual({
      select: ['sPhoto', 'badge', 'head', 'photo'],
      anchor: 'badge',
    })
  })

  it('with Shift and no anchor still selected, adds the row or takes it out as Ctrl or Cmd does', () => {
    expect(rowClick(rows, 'head', shift, ['badge'], null)).toEqual({ toggle: 'head', anchor: 'head' })
    expect(rowClick(rows, 'head', shift, ['badge'], 'picture')).toEqual({ toggle: 'head', anchor: 'head' })
    // A selected anchor no longer listed, in a closed group or in another frame, ranges nothing either.
    const closed = treeRows(design(), 'square', new Set()).rows
    expect(rowClick(closed, 'head', shift, ['picture'], 'picture')).toEqual({ toggle: 'head', anchor: 'head' })
    expect(rowClick(rows, 'head', shift, ['sHead'], 'sHead')).toEqual({ toggle: 'head', anchor: 'head' })
  })

  it('with Shift and no anchor selected, ranges from the fallback, as Shift and an arrow key range from the focused row', () => {
    expect(rowClick(rows, 'photo', shift, ['picture'], 'badge', 'head')).toEqual({
      select: ['head', 'photo'],
      anchor: 'head',
    })
    // The anchor still selected wins over it.
    expect(rowClick(rows, 'photo', shift, ['badge'], 'badge', 'head')).toEqual({
      select: ['badge', 'head', 'photo'],
      anchor: 'badge',
    })
    // Without Shift it selects alone.
    expect(rowClick(rows, 'photo', plain, ['badge'], 'badge', 'head')).toEqual({ select: ['photo'], anchor: 'photo' })
  })
})
