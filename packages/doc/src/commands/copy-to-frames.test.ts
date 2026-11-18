import { describe, expect, it } from 'vitest'

import { type Design, frameIdOf } from '@dazbee/schema'

import { childrenOf, descendants } from '../children.ts'
import { copyIn } from '../links.ts'
import { readDesign } from '../store.ts'
import { linkedDesign, openTestSession } from '../test-design.ts'
import { openTestStore } from '../test-store.ts'
import { fitted } from './fit.ts'

const square = { width: 1080, height: 1080 }

function open() {
  const store = openTestStore(linkedDesign())
  return { store, tab: openTestSession(store) }
}

/** The ids under a frame or layer, back to front. */
const kids = (design: Design, parentId: string) => childrenOf(design, parentId).map(([id]) => id)
/** How many layers a frame holds with a link id. */
const held = (design: Design, frameId: string, link: string) =>
  descendants(design, frameId).filter((id) => design.nodes[id]?.link === link).length

describe('node.copyToFrames', () => {
  it('copies a layer into every linked frame that has no copy of it, laid out to fit, on top, in one undo step', () => {
    const { store, tab } = open()
    const before = readDesign(store)

    const copies = tab.run('node.copyToFrames', { ids: ['badge'] })

    const design = readDesign(store)
    expect(copies.map((id) => frameIdOf(design, id))).toEqual(['story', 'wide', 'tall'])
    const badge = before.nodes.badge?.props as { x: number; y: number; width: number; height: number }
    for (const [i, frameId] of (['story', 'wide', 'tall'] as const).entries()) {
      const copy = design.nodes[copies[i] as string]
      expect(copy).toMatchObject({ link: 'badge', parentId: frameId, name: 'badge' })
      const to = design.frames[frameId] as { width: number; height: number }
      expect(copy?.props).toMatchObject(fitted(badge, badge, { from: square, to }))
      expect(kids(design, frameId).at(-1)).toBe(copies[i])
    }
    expect(copyIn(design, 'other', 'badge')).toBeUndefined()

    tab.undo()
    expect(Object.keys(readDesign(store).nodes).sort()).toEqual(Object.keys(before.nodes).sort())
    tab.redo()
    expect(copyIn(readDesign(store), 'tall', 'badge')).toBeDefined()
  })

  it('scales a copy’s stroke and corners by the ratio its box scales by, placing it as before', () => {
    const { store, tab } = open()
    const black = { type: 'solid', color: '#000000FF' } as const
    const look = { shape: { kind: 'rect', cornerRadius: 40 }, strokes: [{ paint: black, width: 6 }] } as const
    tab.run('node.update', { ids: ['badge'], patch: look })
    const box = { x: 900, y: 40, width: 120, height: 120 }

    const copies = tab.run('node.copyToFrames', { ids: ['badge'] })

    const design = readDesign(store)
    const inTall = design.nodes[copies[2] as string]
    // The tall frame is 300 × 600: 300 / 1080 is the smaller ratio, which the stroke and corners scale by too.
    expect(inTall?.props).toMatchObject({
      ...fitted(box, box, { from: square, to: { width: 300, height: 600 } }),
      shape: { kind: 'rect', cornerRadius: 11.11 },
      strokes: [{ paint: black, width: 1.67 }],
    })
  })

  it('puts a copy inside the copy of its parent where the frame has one, laid out to fit it, else at the frame’s top', () => {
    const { store, tab } = open()

    const [inStory, inTall] = tab.run('node.copyToFrames', { ids: ['price'] })

    const design = readDesign(store)
    // The story's group copy is 600 × 100 at 100, 400; the square's group is 600 × 300 at 100, 100.
    expect(design.nodes[inStory as string]).toMatchObject({
      parentId: 'story-grp',
      link: 'price',
      props: { x: 166.67, y: 466.67, width: 66.67, height: 33.33, style: { fontSize: 20 } },
    })
    expect(kids(design, 'story-grp')).toEqual(['story-title', inStory])
    // The tall frame has no copy of the group: the price goes on top of its frame, laid out to fit it.
    expect(design.nodes[inTall as string]).toMatchObject({
      parentId: 'tall',
      props: { x: 27.78, y: 180.56, width: 55.56, height: 27.78, style: { fontSize: 16.67 } },
    })
    expect(kids(design, 'tall')).toEqual(['tall-bg', inTall])
  })

  it('makes a group copied in take in the frame’s own copies of its children, copying the ones it lacks', () => {
    const { store, tab } = open()

    const [inWide, inTall] = tab.run('node.copyToFrames', { ids: ['grp'] })

    const design = readDesign(store)
    expect(design.nodes[inWide as string]).toMatchObject({ type: 'group', link: 'grp', parentId: 'wide' })
    // The wide frame's own title and price move into the copy, as they are, in the group's order.
    expect(kids(design, inWide as string)).toEqual(['wide-title', 'wide-price'])
    expect(design.nodes['wide-title']?.props).toMatchObject({ x: 40, y: 40, style: { fontSize: 40 } })
    expect(held(design, 'wide', 'title')).toBe(1)
    expect(kids(design, 'wide')).toEqual(['wide-bg', inWide])
    // The tall frame had neither: both are copied in, inside the copy, laid out to fit.
    const tallKids = kids(design, inTall as string)
    expect(tallKids.map((id) => design.nodes[id]?.link)).toEqual(['title', 'price'])
    expect(tallKids).not.toContain('title')

    tab.undo()
    const undone = readDesign(store)
    expect(undone.nodes['wide-title']?.parentId).toBe('wide')
    expect(kids(undone, 'wide')).toEqual(['wide-bg', 'wide-title', 'wide-price'])
  })

  it('puts a copy under the copy of the nearest layer above it in its own frame', () => {
    const { store, tab } = open()
    const [, badgeInWide] = tab.run('node.copyToFrames', { ids: ['badge'] })

    const [groupInWide] = tab.run('node.copyToFrames', { ids: ['grp'] })

    expect(kids(readDesign(store), 'wide')).toEqual(['wide-bg', groupInWide, badgeInWide])
  })

  it('copies several layers at once, a layer inside another coming along with it where that one goes', () => {
    const { store, tab } = open()

    const copies = tab.run('node.copyToFrames', { ids: ['badge', 'price', 'grp'] })

    const design = readDesign(store)
    // The group goes into the wide and tall frames with its price; the story has the group, so the price goes into it.
    expect(copies.map((id) => design.nodes[id]?.link)).toEqual(['badge', 'badge', 'badge', 'grp', 'grp', 'price'])
    expect(design.nodes[copies[5] as string]?.parentId).toBe('story-grp')
    for (const frameId of ['story', 'wide', 'tall']) {
      for (const link of ['badge', 'grp', 'title', 'price']) expect(held(design, frameId, link)).toBe(1)
    }
  })

  it('copies a layer out of a parent 0 high with finite numbers, and undo gives the design back', () => {
    const { store, tab } = open()
    tab.run('node.update', { ids: ['grp'], patch: { height: 0 } })
    const before = readDesign(store)

    const [inStory, inTall] = tab.run('node.copyToFrames', { ids: ['price'] })

    const design = readDesign(store)
    // From the group 0 high into the story's 600 wide, the height takes the width's ratio, 1: the price
    // keeps its size and its place 200 below the group's top.
    expect(design.nodes[inStory as string]?.props).toMatchObject({ x: 100, y: 600, width: 200, height: 100 })
    expect(design.nodes[inTall as string]?.parentId).toBe('tall')
    tab.undo()
    expect(readDesign(store)).toEqual(before)
  })

  it('refuses when every linked frame has a copy already, or the frame has none linked', () => {
    const { tab } = open()
    expect(() => tab.run('node.copyToFrames', { ids: ['bg'] })).toThrow(/no linked frame lacks/)
    expect(() => tab.run('node.copyToFrames', { ids: ['other-x'] })).toThrow(/no linked frame lacks/)
    expect(() => tab.run('node.copyToFrames', { ids: ['nope'] })).toThrow(/no layer/)
  })
})
