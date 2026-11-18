import { afterEach, describe, expect, it } from 'vitest'

import type { DesignInput } from '@dazbee/schema'

import { type TestEditor, testEditor } from './test-editor.ts'

const rect = (parentId: string, index: string, x: number, y: number, more: Record<string, unknown> = {}) => ({
  type: 'graphic' as const,
  parentId,
  link: `${parentId}-${index}`,
  index,
  name: 'Rect',
  props: { x, y, width: 20, height: 20, shape: { kind: 'rect' as const }, ...more },
})
/** A frame holding a card 200 × 150 at (100, 50) with a layer left and top, one set right and one locked in place and set right. */
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
      props: { x: 100, y: 50, width: 200, height: 150 },
    },
    plain: rect('card', 'a0', 110, 60),
    right: rect('card', 'a1', 270, 60, { constraints: { horizontal: 'right', vertical: 'bottom' } }),
    pinned: {
      ...rect('card', 'a2', 270, 120, { constraints: { horizontal: 'right', vertical: 'top' } }),
      lock: { move: true },
    },
  },
}

let opened: TestEditor | null = null
afterEach(() => {
  opened?.end()
  opened = null
})

/** The test editor on the design, and each layer's stored x and y. */
async function editorOn() {
  const editor = await testEditor(DESIGN)
  opened = editor
  const { session } = editor.core
  const place = (id: string) => {
    const props = session.design().nodes[id]?.props
    return props && [props.x, props.y]
  }
  return { editor, session, place }
}

describe('editorLayerEdits', () => {
  describe('setProps on a box', () => {
    it('typed a width or height moves a layer set right or bottom in it by the change and leaves one with no constraints, as one undo step', async () => {
      const { editor, session, place } = await editorOn()
      expect(editor.core.setProps(['card'], () => ({ width: 240 }))).toBe(true)
      expect(place('right')).toEqual([310, 60])
      expect(place('plain')).toEqual([110, 60])
      expect(editor.core.setProps(['card'], () => ({ height: 180 }))).toBe(true)
      expect(place('right')).toEqual([310, 90])
      session.undo()
      expect(place('right')).toEqual([310, 60])
      session.undo()
      expect(place('right')).toEqual([270, 60])
      expect(session.design().nodes.card?.props.width).toBe(200)
    })

    it('typed a width keeps a layer locked in place where it is', async () => {
      const { editor, place } = await editorOn()
      editor.core.setProps(['card'], () => ({ width: 240 }))
      expect(place('pinned')).toEqual([270, 120])
    })

    it('typed an X still moves everything inside it', async () => {
      const { editor, place } = await editorOn()
      editor.core.setProps(['card'], () => ({ x: 130 }))
      expect(place('plain')).toEqual([140, 60])
      expect(place('right')).toEqual([300, 60])
    })

    it('typed a width on a box locked against resizing moves nothing it holds', async () => {
      const { editor, session, place } = await editorOn()
      session.run('node.lock', { ids: ['card'], lock: { resize: true } })
      editor.core.setProps(['card'], () => ({ width: 240 }))
      expect(session.design().nodes.card?.props.width).toBe(200)
      expect(place('right')).toEqual([270, 60])
    })
  })
})
