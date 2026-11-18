import { describe, expect, it } from 'vitest'

import type { DesignInput } from '@dazbee/schema'

import { HALF } from '../../canvas/test-images.ts'
import { testEditor } from '../../test-editor.ts'

/** A frame holding a box filled with a photo, which holds a layer set right. */
const DESIGN: DesignInput = {
  meta: { designId: 'd', name: 'D' },
  pages: { p1: { name: 'One', order: 'a0' } },
  frames: { F: { pageId: 'p1', name: 'F', width: 800, height: 600, x: 0, y: 0, order: 'a0' } },
  nodes: {
    card: {
      type: 'box',
      parentId: 'F',
      link: 'card',
      index: 'a0',
      name: 'Card',
      props: { x: 100, y: 100, width: 300, height: 200, fills: [{ type: 'image', assetId: 'a1', fit: 'crop' }] },
    },
    badge: {
      type: 'graphic',
      parentId: 'card',
      link: 'badge',
      index: 'a0',
      name: 'Badge',
      props: {
        x: 360,
        y: 110,
        width: 30,
        height: 30,
        shape: { kind: 'rect' },
        constraints: { horizontal: 'right', vertical: 'top' },
      },
    },
  },
}

describe('editorCropping', () => {
  describe('drag', () => {
    it("sizes a box's crop window keeping what the box holds where it is on the page", async () => {
      const bytes = HALF.encodeToBytes()
      if (!bytes) throw new Error('no image')
      const editor = await testEditor(DESIGN, { sources: { assetBytes: () => Promise.resolve(bytes) } })
      try {
        editor.core.setCamera({ x: 0, y: 0, zoom: 1 })
        editor.core.select(['card'])
        editor.modules.selection.crop({ id: 'card', frameId: 'F' })
        editor.core.redraw()
        const east = editor.core.stagePoint(400, 200, 'F')
        editor.mouse.drag(east, { x: east.x - 50, y: east.y })
        const { session } = editor.core
        expect(session.design().nodes.card?.props.width).toBe(250)
        expect(session.design().nodes.badge?.props.x).toBe(360)
      } finally {
        editor.end()
      }
    })
  })
})
