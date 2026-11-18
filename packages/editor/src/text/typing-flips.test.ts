// Typing in a flipped text: the caret and the range are shown where its words are drawn, mirrored,
// and a press finds the offset of the word drawn under it.
import { describe, expect, it } from 'vitest'

import { caretPosition, selectionBoxes } from '@dazbee/renderer'
import { loadCanvasKit } from '@dazbee/renderer/node'
import type { DesignInput, TextProps } from '@dazbee/schema'

import { testEditor } from '../test-editor.ts'

/** One line of text in a box wider and taller than its words. */
const BOX = { x: 80, y: 100, width: 920, height: 300 }
const DESIGN: DesignInput = {
  meta: { designId: 'd', name: 'D' },
  pages: { p1: { name: 'One', order: 'a0' } },
  frames: { sq: { pageId: 'p1', name: 'Square', width: 1080, height: 1080, x: 0, y: 0, order: 'a0' } },
  nodes: {
    words: {
      type: 'text',
      parentId: 'sq',
      link: 'words',
      index: 'a0',
      name: 'Words',
      props: { ...BOX, text: 'Fresh roast', style: { fontFamily: 'Noto Sans', fontSize: 96, color: '#15121AFF' } },
    },
  },
}

/** The design open with the text typed in, flipped as asked, and its layout as drawn. */
async function typingIn(flips: { flipX?: boolean; flipY?: boolean }) {
  const editor = await testEditor(DESIGN)
  editor.core.session.run('node.update', { ids: ['words'], patch: flips })
  editor.core.select(['words'])
  editor.press('goIn')
  const { typing, scenes } = editor.modules
  const laid = scenes.layout(editor.core.design().nodes.words?.props as TextProps)
  return { editor, typing, laid }
}

describe('typing in a flipped text', () => {
  it('shows the caret and the range mirrored, as the text draws them', async () => {
    const ck = await loadCanvasKit()
    const { editor, typing, laid } = await typingIn({ flipX: true, flipY: true })
    const right = BOX.x + BOX.width
    const bottom = BOX.y + BOX.height
    typing.caretTo(2)
    const at = caretPosition(ck, laid, 2)
    expect(typing.shown()?.caret).toEqual({
      x: right - at.x,
      y: bottom - laid.dy - at.y - at.height,
      height: at.height,
    })
    typing.selectText({ start: 1, end: 4 })
    expect(typing.shown()?.range).toEqual(
      selectionBoxes(ck, laid, 1, 4).map((box) => ({
        x: right - box.x - box.width,
        y: bottom - laid.dy - box.y - box.height,
        width: box.width,
        height: box.height,
      })),
    )
    editor.end()
  })

  it('finds the offset of the word drawn under a point, mirrored', async () => {
    const plain = await typingIn({})
    const offset = plain.typing.caretFromPoint({ x: BOX.x + 100, y: BOX.y + 40 })
    expect(offset).toBeGreaterThan(0)
    plain.editor.end()
    const { editor, typing } = await typingIn({ flipX: true })
    expect(typing.caretFromPoint({ x: BOX.x + BOX.width - 100, y: BOX.y + 40 })).toBe(offset)
    editor.end()
  })
})
