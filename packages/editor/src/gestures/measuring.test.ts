import { describe, expect, it } from 'vitest'

import type { Frame } from '../canvas/frames.ts'
import type { Tool } from '../tools.ts'
import { editorMeasuring } from './measuring.ts'

const SQUARE: Frame = { id: 'sq', pageId: 'p1', name: 'Square', x: 0, y: 0, width: 1080, height: 1080 }

/**
 * Measuring a layer selected in the square, the pointer hovering over it, with Alt held or not, a
 * tool, and nothing typed in, cropped or edited by its points unless told.
 */
function measuringWith({
  alt = true,
  tool = 'select' as Tool,
  typing = false,
  cropping = false,
  pathEditing = false,
} = {}) {
  const picked = { id: 'a', frameId: SQUARE.id }
  return editorMeasuring({
    view: { design: () => ({ nodes: {} }) as never },
    tools: { tool: () => tool },
    selection: {
      current: () => [picked],
      hovered: () => null,
      cropping: () => (cropping ? picked : null),
      pathEditing: () => (pathEditing ? { ...picked, selected: [] } : null),
    },
    boxes: { drawnBoxOf: () => ({ x: 100, y: 100, width: 100, height: 100, rotation: 0 }) },
    typing: { editing: () => (typing ? picked : null) },
    held: { alt: () => alt },
    hoverAt: () => ({ frame: SQUARE, p: { x: 600, y: 600 } }),
  })
}

describe('editorMeasuring', () => {
  describe('measured', () => {
    it('measures while Alt is held with the Select tool and nothing typed in, cropped or edited by its points', () => {
      expect(measuringWith().measured()).not.toBeNull()
      expect(measuringWith({ alt: false }).measured()).toBeNull()
    })

    it('measures nothing with another tool, while typing, cropping or editing points', () => {
      expect(measuringWith({ tool: 'rect' }).measured()).toBeNull()
      expect(measuringWith({ tool: 'image' }).measured()).toBeNull()
      expect(measuringWith({ typing: true }).measured()).toBeNull()
      expect(measuringWith({ cropping: true }).measured()).toBeNull()
      expect(measuringWith({ pathEditing: true }).measured()).toBeNull()
    })
  })
})
