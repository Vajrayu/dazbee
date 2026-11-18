import { describe, expect, it } from 'vitest'

import { MAX_GUIDES } from '@dazbee/schema'

import { readDesign } from '../index.ts'
import { openTestSession } from '../test-design.ts'
import { openTestStore } from '../test-store.ts'

/** A tab on the test design, whose square frame `sq` is 1080 × 1080 and banner `banner` 320 × 50. */
function open() {
  const store = openTestStore()
  return { store, tab: openTestSession(store), guides: (frameId = 'sq') => readDesign(store).frames[frameId]?.guides }
}

describe('guide.add', () => {
  it('adds a guide after the frame’s others and returns its index, in one undo step', () => {
    const { store, tab, guides } = open()

    expect(tab.run('guide.add', { frameId: 'sq', axis: 'x', at: 540 })).toBe(0)
    expect(tab.run('guide.add', { frameId: 'sq', axis: 'y', at: 1080 })).toBe(1)

    expect(guides()).toEqual([
      { axis: 'x', at: 540 },
      { axis: 'y', at: 1080 },
    ])
    expect(guides('banner')).toBeUndefined()
    expect(tab.undoName()).toBe('addGuide')
    tab.undo()
    expect(guides()).toEqual([{ axis: 'x', at: 540 }])
    tab.undo()
    expect(readDesign(store).frames.sq).not.toHaveProperty('guides')
  })

  it('refuses a missing frame, a place off the frame’s side or off whole pixels, and a frame full of guides', () => {
    const { tab, guides } = open()
    expect(() => tab.run('guide.add', { frameId: 'nope', axis: 'x', at: 0 })).toThrow(/no frame "nope"/)
    expect(() => tab.run('guide.add', { frameId: 'box', axis: 'x', at: 0 })).toThrow(/no frame "box"/)
    expect(() => tab.run('guide.add', { frameId: 'banner', axis: 'x', at: 321 })).toThrow(/from 0 to 320/)
    expect(() => tab.run('guide.add', { frameId: 'banner', axis: 'y', at: 51 })).toThrow(/from 0 to 50/)
    expect(() => tab.run('guide.add', { frameId: 'banner', axis: 'y', at: -1 })).toThrow(/from 0 to 50/)
    expect(() => tab.run('guide.add', { frameId: 'banner', axis: 'y', at: 2.5 })).toThrow(/at/)
    expect(() => tab.run('guide.add', { frameId: 'banner', axis: 'z' as never, at: 2 })).toThrow(/axis/)
    expect(tab.canUndo()).toBe(false)
    expect(tab.run('guide.add', { frameId: 'banner', axis: 'x', at: 320 })).toBe(0)

    for (let at = 0; at < MAX_GUIDES; at++) tab.run('guide.add', { frameId: 'sq', axis: 'y', at })
    expect(guides()).toHaveLength(MAX_GUIDES)
    expect(() => tab.run('guide.add', { frameId: 'sq', axis: 'x', at: 0 })).toThrow(/holds 100 guides already/)
  })
})

describe('guide.move', () => {
  it('moves one guide along its axis, leaving the others, in one undo step', () => {
    const { tab, guides } = open()
    tab.run('guide.add', { frameId: 'sq', axis: 'x', at: 540 })
    tab.run('guide.add', { frameId: 'sq', axis: 'y', at: 100 })

    tab.run('guide.move', { frameId: 'sq', index: 1, at: 1080 })

    expect(guides()).toEqual([
      { axis: 'x', at: 540 },
      { axis: 'y', at: 1080 },
    ])
    expect(tab.undoName()).toBe('moveGuide')
    tab.undo()
    expect(guides()).toEqual([
      { axis: 'x', at: 540 },
      { axis: 'y', at: 100 },
    ])
  })

  it('refuses a missing frame, an index it has no guide at, and a place off the frame’s side', () => {
    const { tab } = open()
    tab.run('guide.add', { frameId: 'banner', axis: 'y', at: 10 })
    expect(() => tab.run('guide.move', { frameId: 'nope', index: 0, at: 0 })).toThrow(/no frame "nope"/)
    expect(() => tab.run('guide.move', { frameId: 'banner', index: 1, at: 0 })).toThrow(/no guide 1/)
    expect(() => tab.run('guide.move', { frameId: 'sq', index: 0, at: 0 })).toThrow(/no guide 0/)
    expect(() => tab.run('guide.move', { frameId: 'banner', index: -1, at: 0 })).toThrow(/index/)
    expect(() => tab.run('guide.move', { frameId: 'banner', index: 0.5, at: 0 })).toThrow(/index/)
    // The guide is horizontal: it goes as far as the banner is high, not as wide.
    expect(() => tab.run('guide.move', { frameId: 'banner', index: 0, at: 51 })).toThrow(/from 0 to 50/)
    expect(() => tab.run('guide.move', { frameId: 'banner', index: 0, at: 1.5 })).toThrow(/at/)
  })
})

describe('guide.remove', () => {
  it('removes one guide, the later ones moving up one place, and the last leaves the frame none', () => {
    const { store, tab, guides } = open()
    tab.run('guide.add', { frameId: 'sq', axis: 'x', at: 10 })
    tab.run('guide.add', { frameId: 'sq', axis: 'y', at: 20 })
    tab.run('guide.add', { frameId: 'sq', axis: 'x', at: 30 })

    tab.run('guide.remove', { frameId: 'sq', index: 1 })

    expect(guides()).toEqual([
      { axis: 'x', at: 10 },
      { axis: 'x', at: 30 },
    ])
    expect(tab.undoName()).toBe('deleteGuide')
    tab.run('guide.remove', { frameId: 'sq', index: 1 })
    tab.run('guide.remove', { frameId: 'sq', index: 0 })
    expect(readDesign(store).frames.sq).not.toHaveProperty('guides')
    tab.undo()
    tab.undo()
    tab.undo()
    expect(guides()).toHaveLength(3)
  })

  it('refuses a missing frame and an index it has no guide at', () => {
    const { tab } = open()
    tab.run('guide.add', { frameId: 'banner', axis: 'y', at: 10 })
    expect(() => tab.run('guide.remove', { frameId: 'nope', index: 0 })).toThrow(/no frame "nope"/)
    expect(() => tab.run('guide.remove', { frameId: 'banner', index: 1 })).toThrow(/no guide 1/)
    expect(() => tab.run('guide.remove', { frameId: 'sq', index: 0 })).toThrow(/no guide 0/)
  })
})

describe('guide.clear', () => {
  it('removes every guide of a frame, leaving the others’, in one undo step', () => {
    const { store, tab, guides } = open()
    tab.run('guide.add', { frameId: 'sq', axis: 'x', at: 10 })
    tab.run('guide.add', { frameId: 'sq', axis: 'y', at: 20 })
    tab.run('guide.add', { frameId: 'banner', axis: 'y', at: 20 })

    tab.run('guide.clear', { frameId: 'sq' })

    expect(readDesign(store).frames.sq).not.toHaveProperty('guides')
    expect(guides('banner')).toEqual([{ axis: 'y', at: 20 }])
    expect(tab.undoName()).toBe('deleteGuides')
    tab.undo()
    expect(guides()).toHaveLength(2)
  })

  it('refuses a missing frame, and leaves a frame with no guides as it was, with no step to undo', () => {
    const { store, tab } = open()
    expect(() => tab.run('guide.clear', { frameId: 'nope' })).toThrow(/no frame "nope"/)
    const before = readDesign(store)
    tab.run('guide.clear', { frameId: 'sq' })
    expect(readDesign(store)).toEqual(before)
    expect(tab.canUndo()).toBe(false)
  })
})
