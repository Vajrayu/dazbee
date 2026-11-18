import { describe, expect, it } from 'vitest'

import { DESIGN, TURNED, WORDS } from './test-actions.ts'
import { BUTTON, LABEL, openPhotoPages, SALE, textOf } from './test-core.ts'
import { testEditor } from './test-editor.ts'

describe('buildCore, opened in Node with nothing stubbed: double clicks', () => {
  it('a double click on a text starts typing in it, a second selects the word there, and a third click puts the caret, its press carrying no count as a browser sends it', async () => {
    const editor = await testEditor(WORDS)
    const { core, modules } = editor
    const on = core.stagePoint(180, 850, 'sq')
    editor.mouse.dblclick(on.x, on.y)
    expect([modules.typing.editing()?.id, core.textSelection()]).toEqual(['words', null])
    editor.mouse.dblclick(on.x, on.y)
    expect(core.textSelection()).toEqual({ id: 'words', range: { start: 0, end: 5 } })
    editor.mouse.click(on.x, on.y, { count: 3 })
    expect([modules.typing.editing()?.id, core.textSelection()]).toEqual(['words', null])
    expect(modules.typing.shown()?.caret).toMatchObject({ y: expect.closeTo(800, 0) as number })
    editor.end()
  })

  it('double clicks on a text in a button in a row go into the row, then the button, then start typing in the text', async () => {
    const editor = await testEditor(BUTTON)
    const { core, modules } = editor
    const label = core.boxOf('label')
    if (!label) throw new Error('the label is not drawn')
    const on = core.stagePoint(label.x + label.width / 2, label.y + label.height / 2, 'sq')
    editor.mouse.dblclick(on.x, on.y)
    expect([core.selection(), modules.selection.entered(), modules.typing.editing()]).toEqual([['btn'], 'bar', null])
    editor.mouse.dblclick(on.x, on.y)
    expect([core.selection(), modules.selection.entered(), modules.typing.editing()]).toEqual([['label'], 'btn', null])
    editor.mouse.dblclick(on.x, on.y)
    expect(modules.typing.editing()?.id).toBe('label')
    editor.end()
  })

  it('a double click on a layer inside a box on the frame goes into the box and selects that layer', async () => {
    const editor = await testEditor(DESIGN)
    const { core, modules } = editor
    const at = core.stagePoint(125, 525, 'sq')
    editor.mouse.click(at.x, at.y)
    expect([core.selection(), modules.selection.entered()]).toEqual([['row'], null])
    editor.mouse.dblclick(at.x, at.y)
    expect([core.selection(), modules.selection.entered()]).toEqual([['inRow'], 'row'])
    editor.end()
  })

  it('a double click on a group goes into it and selects the layer under the pointer', async () => {
    const editor = await testEditor(DESIGN)
    const { core, modules } = editor
    core.select(['a', 'b'])
    editor.press('group')
    const [group] = core.selection()
    const at = core.stagePoint(300, 350, 'sq')
    editor.mouse.click(at.x, at.y)
    expect([core.selection(), modules.selection.entered()]).toEqual([[group], null])
    editor.mouse.dblclick(at.x, at.y)
    expect([core.selection(), modules.selection.entered()]).toEqual([['b'], group])
    editor.end()
  })

  it('inside a turned group, a double click selects the layer under the pointer and a drag moves it along the page as drawn', async () => {
    const editor = await testEditor(TURNED)
    const { core, mouse } = editor
    core.setSnapping(false)
    const centre = () => {
      const box = core.boxOf('inTurned')
      return box && { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    }
    const at = core.stagePoint(450, 850, 'sq')
    mouse.click(at.x, at.y)
    expect(core.selection()).toEqual(['turned'])
    mouse.dblclick(at.x, at.y)
    expect(core.selection()).toEqual(['inTurned'])

    mouse.drag(at, core.stagePoint(550, 850, 'sq'))
    const dragged = centre()
    expect(dragged && Math.hypot(dragged.x - 550, dragged.y - 850)).toBeLessThan(1)
    expect(core.selection()).toEqual(['inTurned'])
    editor.end()
  })

  it('a double click on a path drawn with the pen goes into its points', async () => {
    const editor = await testEditor(DESIGN)
    const { core, mouse, modules } = editor
    const before = Object.keys(core.design().nodes)
    editor.press('toolPen')
    for (const x of [100, 400]) {
      const at = core.stagePoint(x, 700, 'sq')
      mouse.click(at.x, at.y)
    }
    editor.press('goIn')
    const path = Object.keys(core.design().nodes).find((id) => !before.includes(id))
    expect([core.selection(), core.tool(), modules.selection.pathEditing()]).toEqual([[path], 'select', null])
    const middle = core.stagePoint(250, 700, 'sq')
    mouse.dblclick(middle.x, middle.y)
    expect([core.selection(), modules.selection.pathEditing()?.id]).toEqual([[path], path])
    editor.end()
  })

  it("a double click 3 px inside a selected auto-width text's side, wandering 1 and 2 px, starts typing in it and changes no width or sizing", async () => {
    const editor = await testEditor(LABEL)
    const { core, mouse, modules } = editor
    core.select(['label'])
    const before = JSON.stringify(core.design().nodes.label)
    const box = core.boxOf('label')
    if (!box) throw new Error('no label')
    const side = core.stagePoint(box.x + box.width, box.y + box.height / 2, 'sq')
    mouse.move(side.x - 3, side.y)
    for (const count of [1, 2]) {
      mouse.down()
      mouse.move(side.x - 3 + count, side.y)
      mouse.up({ count })
    }
    expect([modules.typing.editing()?.id, core.canUndo()]).toEqual(['label', false])
    editor.keys.press('Escape')
    expect([JSON.stringify(core.design().nodes.label), core.canUndo()]).toEqual([before, false])
    editor.end()
  })

  it("a double click in a selected text's empty box, after or below its line, types into it, and in an unselected one's selects what shows there", async () => {
    const editor = await testEditor(SALE)
    const { core, mouse, modules } = editor
    const at = (x: number, y: number) => core.stagePoint(x, y, 'sq')
    const [onText, after, below, onA] = [at(100, 720), at(500, 720), at(400, 900), at(150, 150)]
    for (const spot of [after, below]) {
      mouse.click(onText.x, onText.y)
      expect(core.selection()).toEqual(['words'])
      mouse.dblclick(spot.x, spot.y)
      expect([modules.typing.editing()?.id, core.selection()]).toEqual(['words', ['words']])
      // The caret goes to the nearest place in the text: after its one short line.
      editor.keys.press('!')
      editor.keys.press('Escape')
      expect(textOf(editor)).toBe('Sale!')
      editor.press('undo')
      expect(textOf(editor)).toBe('Sale')
    }
    mouse.click(onA.x, onA.y)
    mouse.dblclick(after.x, after.y)
    expect([modules.typing.editing(), core.selection()]).toEqual([null, ['panel']])
    editor.end()
  })

  it('a double click on a photo with nothing selected starts cropping it, and a click off the photo ends the crop', async () => {
    const editor = await openPhotoPages()
    const { core, mouse, modules } = editor
    const [onPhoto, off] = [core.stagePoint(250, 440, 'sq'), core.stagePoint(900, 900, 'sq')]
    mouse.dblclick(onPhoto.x, onPhoto.y)
    expect([modules.selection.cropping(), core.selection()]).toEqual([{ id: 'photo', frameId: 'sq' }, ['photo']])
    mouse.click(off.x, off.y)
    expect(modules.selection.cropping()).toBeNull()
    editor.end()
  })
})
