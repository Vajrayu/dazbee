import { describe, expect, it } from 'vitest'

import { type Frame, pageFrames } from '../../canvas/frames.ts'
import { sessionOf } from '../../layers/test-boxes.ts'
import { canLeaveFrame, targetFrame } from './into-frame.ts'
import { TWO_FRAMES } from './test-two-frames.ts'

const design = sessionOf(TWO_FRAMES).design()
const frames = pageFrames(design, 'p1').frames

describe('canLeaveFrame', () => {
  it('lets layers of one frame leave it whose parent is the frame or a box, Free or laid out', () => {
    expect(canLeaveFrame(design, ['rect'], false)).toBe(true)
    expect(canLeaveFrame(design, ['rect', 'grp', 'bound'], false)).toBe(true)
    expect(canLeaveFrame(design, ['inbox'], false)).toBe(true)
    expect(canLeaveFrame(design, ['c2'], false)).toBe(true)
  })

  it('lets a whole Mask group leave, but not its mask nor its masked layer', () => {
    expect(canLeaveFrame(design, ['mg'], false)).toBe(true)
    expect(canLeaveFrame(design, ['mk'], false)).toBe(false)
    expect(canLeaveFrame(design, ['mm'], false)).toBe(false)
  })

  it('keeps a layer in a group in it, and a layer locked in place where it is', () => {
    expect(canLeaveFrame(design, ['g2'], false)).toBe(false)
    expect(canLeaveFrame(design, ['locked'], false)).toBe(false)
  })

  it('keeps a layer a mask in its parent masks there, so masking never breaks across frames', () => {
    const session = sessionOf(TWO_FRAMES)
    session.run('node.mask', { ids: ['rect'], mask: 'alpha' })
    // The mask masks the shown layers above it in the frame: the logo is the first.
    expect(canLeaveFrame(session.design(), ['logo'], false)).toBe(false)
    expect(canLeaveFrame(design, ['logo'], false)).toBe(true)
  })

  it('lets none leave when one of them can’t, layers of another frame are carried with them, or there are none', () => {
    expect(canLeaveFrame(design, ['rect', 'g2'], false)).toBe(false)
    expect(canLeaveFrame(design, ['rect'], true)).toBe(false)
    expect(canLeaveFrame(design, [], false)).toBe(false)
  })
})

describe('targetFrame', () => {
  const b = frames.find((f) => f.id === 'B') as Frame

  it('is the other frame under the point, when the layers can leave', () => {
    expect(targetFrame(frames, { x: 505, y: 50 }, 'A', true)).toBe(b)
    expect(targetFrame(frames, { x: 505, y: 50 }, 'A', false)).toBeNull()
  })

  it('is none over the layers’ own frame or between frames', () => {
    expect(targetFrame(frames, { x: 50, y: 50 }, 'A', true)).toBeNull()
    expect(targetFrame(frames, { x: 450, y: 50 }, 'A', true)).toBeNull()
  })
})
