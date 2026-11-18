import { describe, expect, it } from 'vitest'

import { design } from '../canvas/test-design.ts'
import { testMotion } from '../canvas/test-motion.ts'
import { editorView } from '../canvas/view.ts'
import { editorPan } from './pan.ts'
import { pointerInput } from './test-inputs.ts'

/** A pan on a real view of a 1000 × 800 stage at 100%, with the hand tool, its glides stepped by hand. */
function harness() {
  const clock = testMotion()
  const view = editorView({
    session: { design: () => design, changes: () => 0 },
    onZoom: () => {},
    motion: clock.motion,
  })
  view.setViewport({ width: 1000, height: 800, dpr: 1 })
  view.setCamera({ x: 0, y: 0, zoom: 1 })
  const pan = editorPan({ view, tools: { tool: () => 'hand' }, hold: () => {}, showCursor: () => {} })
  return { pan, view, clock }
}

describe('editorPan', () => {
  describe('press', () => {
    it('stops a glide under way where it is, and the drag pans from there', () => {
      const { pan, view, clock } = harness()
      view.showWhole({ x: 3000, y: 100, width: 400, height: 300 })
      clock.tick(1000)
      clock.tick(1100)
      const pressed = view.camera()
      pan.press(pointerInput({ type: 'pointerdown', at: { x: 500, y: 400 } }))
      clock.tick(1200)
      expect(view.camera()).toBe(pressed)
      expect(clock.waiting()).toBe(0)
      pan.move(pointerInput({ at: { x: 510, y: 400 } }))
      expect(view.camera()).toEqual({ ...pressed, x: pressed.x + 10 })
    })
  })
})
