import { afterEach, describe, expect, it } from 'vitest'

import type { Constraints, DesignInput, Point } from '@dazbee/schema'

import { type DragOptions, type TestEditor, testEditor } from '../../test-editor.ts'

type Area = [number, number, number, number]

const rect = (parentId: string, index: string, [x, y, width, height]: Area, more: Record<string, unknown> = {}) => ({
  type: 'graphic' as const,
  parentId,
  link: `${parentId}-${index}`,
  index,
  name: 'Rect',
  props: { x, y, width, height, shape: { kind: 'rect' as const }, ...more },
})
const holder = (parentId: string, index: string, [x, y, width, height]: Area, more: Record<string, unknown> = {}) => ({
  type: 'box' as const,
  parentId,
  link: `${parentId}-${index}`,
  index,
  name: 'Box',
  props: { x, y, width, height, ...more },
})
const set = (horizontal: Constraints['horizontal'], vertical: Constraints['vertical']) => ({
  constraints: { horizontal, vertical },
})
/**
 * A frame holding a card 200 × 150 at (100, 50) with a layer left and top, one set right, a box
 * set right holding a dot set right and a text left and right that grows down with its words; a second card below it; and a column, laid out, holding a box
 * stored at the frame's corner, which the column draws at its own, with a layer set right.
 */
const DESIGN: DesignInput = {
  meta: { designId: 'd', name: 'D' },
  pages: { p1: { name: 'One', order: 'a0' } },
  frames: { F: { pageId: 'p1', name: 'F', width: 800, height: 600, x: 0, y: 0, order: 'a0' } },
  nodes: {
    card: holder('F', 'a0', [100, 50, 200, 150]),
    plain: rect('card', 'a0', [110, 60, 20, 20]),
    right: rect('card', 'a1', [260, 60, 30, 20], set('right', 'top')),
    inner: holder('card', 'a2', [230, 130, 60, 40], set('right', 'bottom')),
    dot: rect('inner', 'a0', [275, 135, 10, 10], set('right', 'top')),
    words: {
      type: 'text' as const,
      parentId: 'card',
      link: 'words',
      index: 'a3',
      name: 'Words',
      props: {
        x: 110,
        y: 90,
        width: 180,
        height: 24,
        boxMode: 'autoHeight' as const,
        text: 'Summer sale on every hat',
        style: { fontFamily: 'Noto Sans', fontSize: 20, color: '#000000FF' },
        constraints: { horizontal: 'leftRight' as const, vertical: 'top' as const },
      },
    },
    card2: holder('F', 'a1', [100, 250, 200, 100]),
    plain2: rect('card2', 'a0', [110, 260, 20, 20]),
    right2: rect('card2', 'a1', [260, 260, 30, 20], set('right', 'top')),
    column: holder('F', 'a2', [450, 50, 300, 400], { layout: { direction: 'column' } }),
    placed: holder('column', 'a0', [0, 0, 200, 100]),
    edge: rect('placed', 'a0', [170, 10, 20, 20], set('right', 'top')),
  },
}
/** Where the frame's top left is on the stage: the camera at zoom 1 puts the page's origin there. */
const ORIGIN = { x: 100, y: 100 }

let opened: TestEditor | null = null
afterEach(() => {
  opened?.end()
  opened = null
})

/** The test editor on the design at zoom 1, with the layers given selected. */
async function editorOn(...ids: string[]) {
  const editor = await testEditor(DESIGN)
  opened = editor
  editor.core.setCamera({ ...ORIGIN, zoom: 1 })
  editor.core.select(ids)
  editor.core.redraw()
  const frame = () => editor.core.session.design().frames.F
  /** Where a layer is drawn in the frame. */
  const drawn = (id: string) => {
    const f = frame()
    const r = f && editor.modules.boxes.drawnRect(editor.modules.view.frameOf('F') ?? { ...f, id: 'F' }, id)
    return r && [r.x, r.y, r.width, r.height]
  }
  /** Drags a handle of the selection by `by` stage pixels, the keys named held for the whole drag. */
  const dragHandle = (handle: Parameters<TestEditor['at']>[0], by: Point, options: DragOptions = {}) => {
    const from = editor.at(handle)
    if (!from) throw new Error(`no handle ${JSON.stringify(handle)}`)
    editor.mouse.drag(from, { x: from.x + by.x, y: from.y + by.y }, options)
  }
  return { editor, drawn, dragHandle }
}

describe('editorResizeDrag', () => {
  describe('resizeTo and what a box holds', () => {
    it("by a box's west handle carries a layer with no constraints with the edge and leaves one set right where it was", async () => {
      const { drawn, dragHandle } = await editorOn('card')
      dragHandle('w', { x: -40, y: 0 })
      expect(drawn('card')).toEqual([60, 50, 240, 150])
      expect(drawn('plain')).toEqual([70, 60, 20, 20])
      expect(drawn('right')).toEqual([260, 60, 30, 20])
    })

    it("by its east handle leaves a layer with no constraints and moves one set right with the edge, a nested box's dot by its own", async () => {
      const { drawn, dragHandle } = await editorOn('card')
      dragHandle('e', { x: 40, y: 0 })
      expect(drawn('plain')).toEqual([110, 60, 20, 20])
      expect(drawn('right')).toEqual([300, 60, 30, 20])
      expect(drawn('inner')).toEqual([270, 130, 60, 40])
      expect(drawn('dot')).toEqual([315, 135, 10, 10])
    })

    it('with the deep key held leaves every layer the box holds where it was, from any handle', async () => {
      const { editor, drawn, dragHandle } = await editorOn('card')
      const ids = ['plain', 'right', 'inner', 'dot']
      const before = ids.map(drawn)
      for (const handle of ['w', 'e', 'n', 'se'] as const) {
        dragHandle(handle, { x: -30, y: -20 }, { ctrl: true })
        expect([handle, ids.map(drawn)]).toEqual([handle, before])
        editor.press('undo')
        editor.core.redraw()
      }
    })

    it('applies the rule to what each of two boxes resized together holds, and with the deep key keeps it', async () => {
      const { editor, drawn, dragHandle } = await editorOn('card', 'card2')
      dragHandle('e', { x: 40, y: 0 })
      expect(drawn('right')).toEqual([300, 60, 30, 20])
      expect(drawn('right2')).toEqual([300, 260, 30, 20])
      expect(drawn('plain2')).toEqual([110, 260, 20, 20])
      editor.press('undo')
      editor.core.redraw()
      dragHandle('e', { x: 40, y: 0 }, { ctrl: true })
      expect(drawn('right')).toEqual([260, 60, 30, 20])
      expect(drawn('right2')).toEqual([260, 260, 30, 20])
    })

    it("keeps what a box a column places holds in the right place under the column's shift, from its west handle", async () => {
      const { drawn, dragHandle } = await editorOn('placed')
      expect(drawn('placed')).toEqual([450, 50, 200, 100])
      expect(drawn('edge')).toEqual([620, 60, 20, 20])
      dragHandle('w', { x: -20, y: 0 })
      // The column keeps the box at its start: it grows to the east, and the layer set right with it.
      expect(drawn('placed')).toEqual([450, 50, 220, 100])
      expect(drawn('edge')).toEqual([640, 60, 20, 20])
    })

    it('is one undo step that puts the box and what it holds back', async () => {
      const { editor, drawn, dragHandle } = await editorOn('card')
      const before = ['card', 'plain', 'right', 'inner', 'dot'].map(drawn)
      dragHandle('w', { x: -40, y: 0 })
      editor.press('undo')
      editor.core.redraw()
      expect(['card', 'plain', 'right', 'inner', 'dot'].map(drawn)).toEqual(before)
    })

    it('puts back a layer set right when the drag returns to where it began', async () => {
      const { editor, drawn } = await editorOn('card')
      const from = editor.at('e')
      if (!from) throw new Error('no east handle')
      editor.mouse.move(from.x, from.y)
      editor.mouse.down()
      editor.mouse.move(from.x + 40, from.y)
      editor.mouse.move(from.x, from.y)
      editor.mouse.up()
      expect(drawn('right')).toEqual([260, 60, 30, 20])
    })

    it('fits a text left and right in the box to its words as the box narrows', async () => {
      const { editor, dragHandle } = await editorOn('card')
      const height = () => editor.core.session.design().nodes.words?.props.height
      const before = height()
      dragHandle('e', { x: -100, y: 0 })
      expect(editor.core.session.design().nodes.words?.props.width).toBe(80)
      expect(height()).toBeGreaterThan(before ?? Infinity)
    })

    it('keeps what a box a centred column places holds in place over a drag of many moves, and puts it back', async () => {
      const { editor, drawn } = await editorOn()
      editor.core.session.run('node.update', {
        ids: ['column'],
        patch: { layout: { direction: 'column', align: 'center' } },
      })
      editor.core.select(['placed'])
      editor.core.redraw()
      expect(drawn('placed')).toEqual([500, 50, 200, 100])
      const from = editor.at('e')
      if (!from) throw new Error('no east handle')
      editor.mouse.drag(from, { x: from.x + 40, y: from.y }, { steps: 6 })
      // The column centres the wider box; the layer set right keeps its distance from its right edge.
      expect(drawn('placed')).toEqual([480, 50, 240, 100])
      expect(drawn('edge')).toEqual([690, 60, 20, 20])
      // Back by as much, in a drag of its own: the box takes its width again, and the layer its place.
      const back = editor.at('e')
      if (!back) throw new Error('no east handle')
      editor.mouse.drag(back, { x: back.x - 40, y: back.y }, { steps: 4 })
      expect(drawn('placed')).toEqual([500, 50, 200, 100])
      expect(drawn('edge')).toEqual([670, 60, 20, 20])
      expect(editor.core.session.design().nodes.edge?.props.x).toBe(170)
    })
  })
})
