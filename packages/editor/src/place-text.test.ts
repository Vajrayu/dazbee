// Pasting text from outside the editor: plain text pasted on the canvas becomes a text layer, and a
// paste with no text while a text is typed in is left to the page.
import { describe, expect, it } from 'vitest'

import type { ClipboardFile } from './clipboard.ts'
import { firstFrameOf, idsOf } from './selection.ts'
import { DESIGN, WORDS } from './test-actions.ts'
import { testEditor } from './test-editor.ts'
import { harness } from './test-place.ts'

/** A picture on the clipboard, as a browser names one copied from a page. */
const IMAGE: ClipboardFile = {
  name: 'image.png',
  type: 'image/png',
  text: async () => '',
  bytes: async () => new Uint8Array(),
}

describe('editorPlace', () => {
  describe('paste of plain text from outside', () => {
    it('makes a text layer in the text tool’s style, growing with its words and named by its first line, in the middle of the frame in view, selected, as one undo step called paste', () => {
      const { place, session, selection, wide, log } = harness()
      expect(place.paste({ text: '\n  Sale today  \r\nOnly 9\rEnds soon' }, () => null)).toBe(true)
      const [id = ''] = idsOf(selection.current())
      expect(firstFrameOf(selection.current())).toBe(wide.id)
      expect(session.design().nodes[id]).toMatchObject({
        type: 'text',
        parentId: 'wide',
        name: 'Sale today',
        props: {
          text: '\n  Sale today  \nOnly 9\nEnds soon',
          boxMode: 'autoWidth',
          style: { fontFamily: 'Noto Sans', fontSize: 48, fontWeight: 400, color: '#1F2329FF' },
          // Fitted by typing, which here measures nothing: its corner stays in the middle.
          x: 600,
          y: 314,
        },
      })
      expect(log).toEqual([`fit ${id}`, 'tool select'])
      expect(session.undoName()).toBe('paste')
      session.undo()
      expect(session.design().nodes[id]).toBeUndefined()
      expect(session.canUndo()).toBe(false)
    })

    it('puts its corner on the pointer after Mod+Shift+V while typing measures nothing, on whole pixels in the frame under it', () => {
      const { place, session, selection, square, stage } = harness()
      place.aimPaste(true)
      expect(place.paste({ text: 'Hi' }, () => stage(square, 600.4, 599.6))).toBe(true)
      const [id = ''] = idsOf(selection.current())
      expect(session.design().nodes[id]).toMatchObject({ parentId: 'sq', props: { x: 600, y: 600 } })
    })

    it('goes in the middle of the selection’s frame after Mod+Shift+V with the pointer off every frame, as an SVG pasted there does', () => {
      const { place, session, selection, square } = harness()
      selection.select(['a'], square.id)
      place.aimPaste(true)
      expect(place.paste({ text: 'Hi' }, () => ({ x: -500, y: -500 }))).toBe(true)
      const [id = ''] = idsOf(selection.current())
      expect(session.design().nodes[id]).toMatchObject({ parentId: 'sq', props: { x: 540, y: 540 } })
    })

    it('leaves the plain text a file brings beside it, as a file copied from the computer brings its name', () => {
      const { place, session } = harness()
      expect(place.paste({ text: 'image.png', files: [IMAGE] }, () => null)).toBe(false)
      expect(session.canUndo()).toBe(false)
    })

    it('is measured in its font and centred in the frame placing goes in, through the editor’s clipboard', async () => {
      const editor = await testEditor(DESIGN)
      const { core, clipboard } = editor
      expect(clipboard.paste({ text: 'Hello there' })).toBe(true)
      const [id = ''] = core.selection()
      const node = core.design().nodes[id]
      const frame = core.design().frames[node?.parentId ?? '']
      const { x, y, width, height } = node?.props as { x: number; y: number; width: number; height: number }
      expect(node?.type).toBe('text')
      expect(width).toBeGreaterThan(100)
      expect(height).toBeGreaterThan(40)
      expect(Math.abs(x + width / 2 - (frame?.width ?? 0) / 2)).toBeLessThanOrEqual(0.5)
      expect(Math.abs(y + height / 2 - (frame?.height ?? 0) / 2)).toBeLessThanOrEqual(0.5)
      expect(core.undoName()).toBe('paste')
      editor.end()
    })
  })

  describe('paste while a text is typed in', () => {
    it('leaves an image to the page, the text and its range as they were', async () => {
      const editor = await testEditor(WORDS)
      const { core, clipboard } = editor
      core.select(['words'])
      editor.press('goIn')
      editor.keys.press('End')
      editor.keys.press('Shift+ArrowLeft')
      const before = core.textSelection()
      const text = core.design().nodes.words?.props
      expect(clipboard.paste({ files: [IMAGE] })).toBe(false)
      expect(core.design().nodes.words?.props).toBe(text)
      expect(core.textSelection()).toEqual(before)
      editor.end()
    })
  })
})
