import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { fake, harness } from './test-overlay.ts'

beforeEach(() => {
  vi.stubGlobal('document', { createElement: () => fake(), createElementNS: (_ns: string, name: string) => fake(name) })
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('editorOverlay', () => {
  describe('draw', () => {
    it('draws the four corner handles on the picked frame that shows them, and says which corners and edges a press grabs', () => {
      const { overlay, part } = harness({ selected: false, picked: true, frameHandles: true })
      overlay.draw()
      const picked = part('frame-picked')
      expect(picked?.dataset).toEqual({ frame: 'one-sq', handles: 'nw n ne e se s sw w' })
      expect(picked?.children.map((h) => [h.className, h.dataset.handle, h.style.left, h.style.top])).toEqual([
        ['handle', 'nw', '0%', '0%'],
        ['handle', 'ne', '100%', '0%'],
        ['handle', 'se', '100%', '100%'],
        ['handle', 'sw', '0%', '100%'],
      ])
    })

    it('draws no handles on a picked frame that shows none', () => {
      const { overlay, part } = harness({ selected: false, picked: true })
      overlay.draw()
      expect(part('frame-picked')?.dataset).toEqual({ frame: 'one-sq' })
      expect(part('frame-picked')?.children).toEqual([])
    })
  })
})
