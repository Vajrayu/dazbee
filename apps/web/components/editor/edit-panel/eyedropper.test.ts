// Shift+I's ask for the colour row's eyedropper, heard through the frame it was asked in.
import { describe, expect, it } from 'vitest'

import { frameAsk } from './eyedropper.tsx'

/** A frame clock to step by hand: each callback asked for runs at the next `step`. */
function testFrames() {
  let waiting: (() => void)[] = []
  return {
    next: (then: () => void) => waiting.push(then),
    step: () => {
      const now = waiting
      waiting = []
      for (const then of now) then()
    },
  }
}

describe('frameAsk', () => {
  it('is not heard before it is asked', () => {
    expect(frameAsk(testFrames().next).heard()).toBe(false)
  })

  it('is heard by every row that shows in the frame it was asked in, as a row mounted twice is', () => {
    const frames = testFrames()
    const ask = frameAsk(frames.next)
    ask.ask()
    expect(ask.heard()).toBe(true)
    expect(ask.heard()).toBe(true)
  })

  it('is no longer heard from the next frame, so a row shown later was not asked', () => {
    const frames = testFrames()
    const ask = frameAsk(frames.next)
    ask.ask()
    frames.step()
    expect(ask.heard()).toBe(false)
  })
})
