// The frame stepper: which of the page's frames the layers panel shows, as its arrows step, as the
// selection or a picked frame takes it, as the panel opens, and once the frame shown is gone.
import { describe, expect, it } from 'vitest'

import { Design } from '@dazbee/schema'

import {
  ARROW_KEYS,
  canStep,
  followedFrame,
  keptFrame,
  nameKey,
  openingFrame,
  shownAt,
  stepFrame,
} from './frame-stepper.ts'

const frame = (name: string, width: number, height: number, order: string) => ({
  pageId: 'p1',
  name,
  width,
  height,
  x: 0,
  y: 0,
  order,
})
const shape = (parentId: string, index: string) => ({
  type: 'graphic' as const,
  parentId,
  index,
  name: 'Shape',
  link: `L-${parentId}-${index}`,
  props: { x: 0, y: 0, width: 10, height: 10, shape: { kind: 'rect' as const } },
})

/** Page 1 holds Square, Story and Banner; Square's Photo group holds Picture, and Story holds Headline. */
const design = (): Design =>
  Design.parse({
    meta: { designId: 'd', name: 'Summer sale' },
    pages: { p1: { name: 'Page 1', order: 'a0' } },
    frames: {
      square: frame('Square', 1080, 1080, 'a0'),
      story: frame('Story', 1080, 1920, 'a1'),
      banner: frame('Banner', 300, 250, 'a2'),
    },
    nodes: {
      photo: { ...shape('square', 'a0'), type: 'group', props: { x: 0, y: 0, width: 10, height: 10 } },
      picture: shape('photo', 'a0'),
      head: shape('story', 'a0'),
    },
  })
const FRAMES = ['square', 'story', 'banner']

describe('ARROW_KEYS', () => {
  it('are the four arrow keys', () => {
    expect([...ARROW_KEYS].sort()).toEqual(['ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp'])
  })
})

describe('canStep', () => {
  it('shows the arrows only when the page has another frame to step to', () => {
    expect(canStep(FRAMES)).toBe(true)
    expect(canStep(['square', 'story'])).toBe(true)
    expect(canStep(['square'])).toBe(false)
    expect(canStep([])).toBe(false)
  })
})

describe('shownAt', () => {
  it('places a frame shown at its place among the page’s frames', () => {
    expect(shownAt(FRAMES, 'banner')).toEqual({ id: 'banner', at: 2 })
  })

  it('places none, or a frame the page lacks, first', () => {
    expect(shownAt(FRAMES, null)).toEqual({ id: null, at: 0 })
    expect(shownAt(FRAMES, 'gone')).toEqual({ id: 'gone', at: 0 })
  })
})

describe('stepFrame', () => {
  it('steps to the next or previous frame in the page’s order', () => {
    expect(stepFrame(FRAMES, 'square', 1)).toBe('story')
    expect(stepFrame(FRAMES, 'banner', -1)).toBe('story')
  })

  it('wraps round from the last frame to the first and back', () => {
    expect(stepFrame(FRAMES, 'banner', 1)).toBe('square')
    expect(stepFrame(FRAMES, 'square', -1)).toBe('banner')
  })

  it('stays on the only frame, and goes to the first from a frame the page lacks', () => {
    expect(stepFrame(['square'], 'square', 1)).toBe('square')
    expect(stepFrame(FRAMES, 'gone', 1)).toBe('square')
    expect(stepFrame([], 'gone', 1)).toBeNull()
  })
})

describe('followedFrame', () => {
  it('follows a selected layer to its frame, however deep it is', () => {
    expect(followedFrame(design(), ['picture'], null)).toBe('square')
    expect(followedFrame(design(), ['head'], null)).toBe('story')
  })

  it('with layers selected in several frames, follows the most recently selected one', () => {
    expect(followedFrame(design(), ['picture', 'head'], null)).toBe('story')
    expect(followedFrame(design(), ['head', 'picture'], null)).toBe('square')
  })

  it('follows a picked frame', () => {
    expect(followedFrame(design(), [], 'banner')).toBe('banner')
  })

  it('follows nothing with nothing selected, or what the design no longer has', () => {
    expect(followedFrame(design(), [], null)).toBeNull()
    expect(followedFrame(design(), ['gone'], 'gone too')).toBeNull()
  })
})

describe('openingFrame', () => {
  it('opens on the selection’s frame, else the frame in the middle of the view, else the first', () => {
    expect(openingFrame(FRAMES, 'banner', 'story')).toBe('banner')
    expect(openingFrame(FRAMES, null, 'story')).toBe('story')
    expect(openingFrame(FRAMES, null, null)).toBe('square')
  })

  it('opens on no frame of a page with none', () => {
    expect(openingFrame([], null, null)).toBeNull()
  })
})

describe('keptFrame', () => {
  it('keeps the frame shown while the page has it, at its place now', () => {
    expect(keptFrame(FRAMES, { id: 'story', at: 1 })).toEqual({ id: 'story', at: 1 })
    expect(keptFrame(['story', 'banner'], { id: 'story', at: 1 })).toEqual({ id: 'story', at: 0 })
  })

  it('once the frame shown is gone, shows the frame now at its place, else the last one left', () => {
    expect(keptFrame(['square', 'banner'], { id: 'story', at: 1 })).toEqual({ id: 'banner', at: 1 })
    expect(keptFrame(['square', 'story'], { id: 'banner', at: 2 })).toEqual({ id: 'story', at: 1 })
  })

  it('shows the first frame of a page with nothing shown yet, and none once the page has no frame', () => {
    expect(keptFrame(FRAMES, { id: null, at: 0 })).toEqual({ id: 'square', at: 0 })
    expect(keptFrame([], { id: 'story', at: 1 })).toEqual({ id: null, at: 0 })
  })
})

describe('nameKey', () => {
  it('renames the frame with Enter or F2, and with neither in a tab that may only view', () => {
    expect(nameKey('Enter', false)).toBe('rename')
    expect(nameKey('F2', false)).toBe('rename')
    expect(nameKey('Enter', true)).toBeNull()
    expect(nameKey('F2', true)).toBeNull()
  })

  it('goes down into the tree with the down arrow', () => {
    expect(nameKey('ArrowDown', false)).toBe('into tree')
  })

  it('holds the other arrow keys, so none of them moves the frame or a layer on the stage', () => {
    for (const key of ['ArrowUp', 'ArrowLeft', 'ArrowRight']) expect(nameKey(key, false)).toBe('held')
  })

  it('leaves every other key to the stage and the button', () => {
    expect(nameKey(' ', false)).toBeNull()
    expect(nameKey('Delete', false)).toBeNull()
  })
})
