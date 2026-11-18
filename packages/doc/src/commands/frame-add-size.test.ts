import { describe, expect, it } from 'vitest'

import type { Design, DesignInput, Layer, Rect } from '@dazbee/schema'

import { readDesign } from '../index.ts'
import { openTestSession } from '../test-design.ts'
import { openTestStore } from '../test-store.ts'

type NodeInput = DesignInput['nodes'][string]

const STYLE = { fontFamily: 'Noto Sans', fontSize: 60, color: '#111111FF' }
const CROP_PHOTO = [{ type: 'image', assetId: 'photo', fit: 'crop', opacity: 1 }]
const LOCKED = { move: true, resize: true, content: true, style: true, delete: true }
/** The six sizes the sample ad is added at. */
const SIZES = [
  [1080, 1920],
  [1200, 628],
  [1080, 1350],
  [300, 250],
  [728, 90],
  [160, 600],
] as const

let order = 0
/** A layer of `type` under `parentId` at x, y, width and height, its link its id, with more props and fields. */
const layer = (
  id: string,
  parentId: string,
  type: 'graphic' | 'text' | 'box' | 'group',
  [x, y, width, height]: [number, number, number, number],
  props: Record<string, unknown> = {},
  more: Record<string, unknown> = {},
): [string, NodeInput] => {
  order += 1
  const own =
    type === 'graphic'
      ? { shape: { kind: 'rect' } }
      : type === 'text'
        ? { text: id, boxMode: 'autoHeight', style: STYLE }
        : {}
  const node = {
    type,
    parentId,
    link: id,
    index: `a${order}`,
    name: id,
    props: { x, y, width, height, ...own, ...props },
  }
  return [id, { ...node, ...more } as NodeInput]
}

/** A design whose one page holds the 1080 square frame `sq`, holding `nodes`. */
const adOf = (nodes: Record<string, NodeInput>): DesignInput => ({
  meta: { designId: 'd1', name: 'Ad' },
  pages: { p1: { name: 'Page 1', order: 'a0' } },
  frames: { sq: { pageId: 'p1', name: 'Square', width: 1080, height: 1080, x: 0, y: 0, order: 'a0' } },
  nodes,
})

/**
 * The sample ad, in the 1080 square frame `sq`: a photo behind everything, a logo top left, a badge
 * top right, a headline, a product, a button at the bottom middle and small print at the foot.
 * `changes` adds props and fields to its layers, by id.
 */
const sampleAd = (
  changes: Record<string, { props?: Record<string, unknown>; more?: Record<string, unknown> }> = {},
): DesignInput => {
  const layers: [string, 'graphic' | 'text', [number, number, number, number], object?][] = [
    ['photo', 'graphic', [0, 0, 1080, 1080]],
    ['logo', 'graphic', [60, 60, 200, 80]],
    ['badge', 'graphic', [860, 60, 160, 160], { shape: { kind: 'ellipse' } }],
    ['headline', 'text', [90, 260, 900, 160]],
    ['product', 'graphic', [340, 440, 400, 400], { shape: { kind: 'path', d: 'M0 0L400 400' } }],
    ['button', 'graphic', [390, 880, 300, 90]],
    ['legal', 'text', [90, 1000, 900, 40]],
  ]
  return adOf(
    Object.fromEntries(
      layers.map(([id, type, box, props]) =>
        layer(id, 'sq', type, box, { ...props, ...changes[id]?.props }, changes[id]?.more),
      ),
    ),
  )
}

/** Adds a size of `sq` to the design: the design after, and the copy of each layer by its original's id. */
function addSize(input: DesignInput, width: number, height: number) {
  const store = openTestStore(input)
  const tab = openTestSession(store)
  const before = readDesign(store)
  const frameId = tab.run('frame.addSize', { frameId: 'sq', width, height })
  const design = readDesign(store)
  const copies = new Map(
    Object.values(design.nodes)
      .filter((node) => node !== design.nodes[node.link])
      .map((node) => [node.link, node]),
  )
  const copy = (id: string) => copies.get(id) as Layer
  const box = (id: string): Rect => {
    const { x, y, width: w, height: h } = copy(id).props
    return { x, y, width: w, height: h }
  }
  return { store, tab, before, design, frameId, copy, box }
}

const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
const inside = (b: Rect, width: number, height: number) =>
  b.x >= -0.01 && b.y >= -0.01 && b.x + b.width <= width + 0.01 && b.y + b.height <= height + 0.01
const boxOf = (design: Design, id: string): Rect => {
  const { x, y, width, height } = (design.nodes[id] as Layer).props
  return { x, y, width, height }
}

describe('frame.addSize', () => {
  describe.each(SIZES)('the sample ad at %i × %i', (width, height) => {
    const ids = ['photo', 'logo', 'badge', 'headline', 'product', 'button', 'legal']

    it('keeps every layer in the frame, overlaps none that did not overlap in the square, and fills it with the photo', () => {
      const { before, box } = addSize(sampleAd(), width, height)
      for (const id of ids) expect(inside(box(id), width, height), id).toBe(true)
      for (const a of ids)
        for (const b of ids)
          if (a < b && overlaps(box(a), box(b)))
            expect(overlaps(boxOf(before, a), boxOf(before, b)), `${a} and ${b}`).toBe(true)
      expect(box('photo')).toEqual({ x: 0, y: 0, width, height })
    })

    it('fills it with the photo while the photo is locked', () => {
      const { box } = addSize(sampleAd({ photo: { more: { lock: LOCKED } } }), width, height)
      expect(box('photo')).toEqual({ x: 0, y: 0, width, height })
    })

    it('draws the product path’s whole drawing scaled, in the box it was drawn in', () => {
      const { copy } = addSize(sampleAd(), width, height)
      const s = Math.min(width / 1080, height / 1080)
      expect(copy('product').props).toMatchObject({ shape: { kind: 'path', drawnIn: { width: 400, height: 400 } } })
      expect(copy('product').props.width).toBeCloseTo(400 * s, 2)
      expect(copy('product').props.height).toBeCloseTo(400 * s, 2)
    })
  })

  it('places the sample ad at 1080 × 1920 as the prototype did, each copy storing the guess it was placed by', () => {
    const { box, copy, design } = addSize(sampleAd(), 1080, 1920)
    expect(box('logo')).toEqual({ x: 60, y: 60, width: 200, height: 80 })
    expect(box('button')).toEqual({ x: 390, y: 1720, width: 300, height: 90 })
    expect(box('legal')).toEqual({ x: 90, y: 1840, width: 900, height: 40 })
    const guesses = Object.fromEntries(
      ['photo', 'logo', 'badge', 'headline', 'product', 'button', 'legal'].map((id) => [
        id,
        copy(id).props.constraints,
      ]),
    )
    expect(guesses).toEqual({
      photo: { horizontal: 'leftRight', vertical: 'topBottom' },
      logo: { horizontal: 'left', vertical: 'top' },
      badge: { horizontal: 'right', vertical: 'top' },
      headline: { horizontal: 'leftRight', vertical: 'top' },
      product: { horizontal: 'center', vertical: 'center' },
      button: { horizontal: 'center', vertical: 'bottom' },
      legal: { horizontal: 'leftRight', vertical: 'bottom' },
    })
    for (const id of Object.keys(guesses)) expect(design.nodes[id]?.props.constraints, id).toBeUndefined()
  })

  it('widens the headline guessed left and right across a wide size, from the scale to the new width', () => {
    // 628 / 1080 scales the headline to 52.33, 523.33 wide; the frame's 572 more across go to its width.
    const { box } = addSize(sampleAd(), 1200, 628)
    expect(box('headline')).toMatchObject({ x: 52.33, width: 1095.33 })
  })

  it('places a copy whose original has constraints by them, which it keeps', () => {
    const set = { props: { constraints: { horizontal: 'right', vertical: 'bottom' } } }
    const tall = addSize(sampleAd({ logo: set }), 1080, 1920)
    expect(tall.box('logo')).toEqual({ x: 60, y: 900, width: 200, height: 80 })
    expect(tall.copy('logo').props.constraints).toEqual({ horizontal: 'right', vertical: 'bottom' })
    const wide = addSize(sampleAd({ logo: set }), 1920, 1080)
    expect(wide.box('logo')).toEqual({ x: 900, y: 60, width: 200, height: 80 })
  })

  it('keeps a photo in Crop fit its shape, leaving bands where the frame grew', () => {
    const { box, copy } = addSize(sampleAd({ photo: { props: { fills: CROP_PHOTO } } }), 1080, 1920)
    expect(box('photo')).toEqual({ x: 0, y: 420, width: 1080, height: 1080 })
    expect(copy('photo').props.constraints).toEqual({ horizontal: 'center', vertical: 'center' })
  })

  it('places the layers in a group with it and those a flow places with their box, giving neither constraints', () => {
    const layout = { direction: 'row', gap: 0, padding: { top: 0, right: 0, bottom: 0, left: 0 } }
    const input = adOf(
      Object.fromEntries([
        layer('card', 'sq', 'group', [100, 100, 200, 880], {
          constraints: { horizontal: 'left', vertical: 'topBottom' },
        }),
        layer('inCard', 'card', 'graphic', [100, 100, 100, 440]),
        layer('row', 'sq', 'box', [300, 800, 600, 100], { layout }),
        layer('flowed', 'row', 'graphic', [300, 800, 100, 100]),
        layer('absolute', 'row', 'graphic', [320, 810, 50, 50], { absolute: true }),
      ]),
    )
    const { box, copy } = addSize(input, 1080, 1920)
    // The card is set to keep its top and bottom: 840 taller, it scales what it holds down by 1720 / 880.
    expect(box('card')).toEqual({ x: 100, y: 100, width: 200, height: 1720 })
    expect(box('inCard')).toEqual({ x: 100, y: 100, width: 100, height: 860 })
    expect(copy('inCard').props.constraints).toBeUndefined()
    // The row's middle is in the bottom third: it moves down 840, carrying what it holds.
    expect(copy('row').props.constraints).toEqual({ horizontal: 'center', vertical: 'bottom' })
    expect(box('flowed')).toEqual({ x: 300, y: 1640, width: 100, height: 100 })
    expect(copy('flowed').props.constraints).toBeUndefined()
    expect(box('absolute')).toEqual({ x: 320, y: 1650, width: 50, height: 50 })
    expect(copy('absolute').props.constraints).toEqual({ horizontal: 'left', vertical: 'center' })
  })

  it('stores a guess on a layer in a box the resize leaves where it was, from its place in that box', () => {
    const input = adOf(
      Object.fromEntries([
        layer('panel', 'sq', 'box', [0, 0, 1080, 200]),
        layer('mark', 'panel', 'graphic', [980, 60, 80, 80], { shape: { kind: 'ellipse' } }),
      ]),
    )
    // The panel is guessed left and right, and top: at 1080 × 1920 nothing about it changes.
    const { box, copy } = addSize(input, 1080, 1920)
    expect(box('panel')).toEqual({ x: 0, y: 0, width: 1080, height: 200 })
    expect(copy('mark').props.constraints).toEqual({ horizontal: 'right', vertical: 'center' })
  })

  it('writes nothing of the original frame and its layers, and undo removes the new frame whole, in one step', () => {
    const { store, tab, before, design, frameId } = addSize(sampleAd(), 728, 90)
    expect(design.frames.sq).toEqual(before.frames.sq)
    for (const id of Object.keys(before.nodes)) expect(design.nodes[id], id).toEqual(before.nodes[id])
    tab.undo()
    expect(readDesign(store)).toEqual(before)
    expect(readDesign(store).frames[frameId]).toBeUndefined()
    expect(tab.canUndo()).toBe(false)
  })
})
