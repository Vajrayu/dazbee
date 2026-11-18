import { describe, expect, it, vi } from 'vitest'

import type { PointerInput } from './gestures/inputs.ts'
import { DESIGN } from './test-actions.ts'
import { testEditor } from './test-editor.ts'

/** The type, click count and place of each pointer input a spy saw, in order. */
const seen = (calls: [PointerInput][]) => calls.map(([e]) => [e.type, e.detail, e.at])

describe('testEditor', () => {
  it('opens the design fitted in the stage, drawn once, with nothing selected', async () => {
    const editor = await testEditor(DESIGN)
    expect(editor.core.viewport()).toEqual({ width: 1280, height: 760 })
    expect(editor.core.frames().map((frame) => frame.id)).toEqual(['sq', 'wide'])
    expect(editor.modules.view.inView().map((frame) => frame.id)).toEqual(['sq', 'wide'])
    expect(editor.core.selection()).toEqual([])
    editor.end()
    expect(editor.core.destroyed()).toBe(true)
  })

  it('a click sends the move, the press, the release, the capture lost and the click with its count, and selects the layer there', async () => {
    const editor = await testEditor(DESIGN)
    const p = editor.core.stagePoint(150, 150, 'sq')
    const sent = vi.spyOn(editor.core.input, 'pointer')
    editor.mouse.click(p.x, p.y)
    expect(seen(sent.mock.calls)).toEqual([
      ['pointermove', 0, p],
      ['pointerdown', 0, p],
      ['pointerup', 0, p],
      ['lostpointercapture', 0, p],
      ['click', 1, p],
    ])
    expect(editor.core.selection()).toEqual(['a'])
    editor.end()
  })

  it('a double click sends two clicks counted 1 and 2, then the double click', async () => {
    const editor = await testEditor(DESIGN)
    const p = editor.core.stagePoint(150, 150, 'sq')
    const sent = vi.spyOn(editor.core.input, 'pointer')
    editor.mouse.dblclick(p.x, p.y)
    expect(seen(sent.mock.calls).map(([type, detail]) => [type, detail])).toEqual([
      ['pointermove', 0],
      ['pointerdown', 0],
      ['pointerup', 0],
      ['lostpointercapture', 0],
      ['click', 1],
      ['pointerdown', 0],
      ['pointerup', 0],
      ['lostpointercapture', 0],
      ['click', 2],
      ['dblclick', 2],
    ])
    editor.end()
  })

  it('a triple click sends the double click after its second click, and a third click counted 3', async () => {
    const editor = await testEditor(DESIGN)
    const sent = vi.spyOn(editor.core.input, 'pointer')
    editor.mouse.click(5, 5, { count: 3 })
    expect(seen(sent.mock.calls).map(([type, detail]) => `${String(type)} ${String(detail)}`)).toEqual([
      'pointermove 0',
      'pointerdown 0',
      'pointerup 0',
      'lostpointercapture 0',
      'click 1',
      'pointerdown 0',
      'pointerup 0',
      'lostpointercapture 0',
      'click 2',
      'dblclick 2',
      'pointerdown 0',
      'pointerup 0',
      'lostpointercapture 0',
      'click 3',
    ])
    editor.end()
  })

  it('a move in steps sends a move at each step, in a line from where the pointer is', async () => {
    const editor = await testEditor(DESIGN)
    editor.mouse.move(100, 100)
    const sent = vi.spyOn(editor.core.input, 'pointer')
    editor.mouse.move(130, 160, { steps: 3 })
    expect(seen(sent.mock.calls)).toEqual([
      ['pointermove', 0, { x: 110, y: 120 }],
      ['pointermove', 0, { x: 120, y: 140 }],
      ['pointermove', 0, { x: 130, y: 160 }],
    ])
    editor.end()
  })

  it('a move lands exactly on the point it is sent to, in one step or in several', async () => {
    const editor = await testEditor(DESIGN)
    editor.mouse.move(0.7, 0.7)
    const sent = vi.spyOn(editor.core.input, 'pointer')
    editor.mouse.move(0.1, 0.1)
    editor.mouse.move(0.7, 0.7)
    editor.mouse.move(0.1, 0.1, { steps: 3 })
    expect(seen(sent.mock.calls).map(([, , at]) => at)).toEqual([
      { x: 0.1, y: 0.1 },
      { x: 0.7, y: 0.7 },
      expect.anything(),
      expect.anything(),
      { x: 0.1, y: 0.1 },
    ])
    editor.end()
  })

  it('a drag moves the layer the same with a redraw pass after each of its inputs and with none', async () => {
    const drawnAfter = async (redraws: boolean) => {
      const editor = await testEditor(DESIGN)
      const [from, to] = [editor.core.stagePoint(150, 150, 'sq'), editor.core.stagePoint(350, 250, 'sq')]
      let passes = 0
      editor.core.onDraw(() => passes++)
      editor.mouse.drag(from, to, { steps: 4, redraws })
      const result = { passes, box: editor.core.boxOf('a') }
      editor.end()
      return result
    }
    const [each, none] = [await drawnAfter(true), await drawnAfter(false)]
    // The move to the press, the press, four moves, the release, the capture lost and the click.
    expect([each.passes, none.passes]).toEqual([9, 0])
    expect(none.box).toEqual(each.box)
    expect(each.box).toMatchObject({ x: 300, y: 200 })
  })

  it('a release sends what a browser sends after it: the capture lost when the press asked for the pointer to be held, then the click', async () => {
    const editor = await testEditor(DESIGN)
    const [from, to] = [editor.core.stagePoint(150, 150, 'sq'), editor.core.stagePoint(350, 250, 'sq')]
    const sent = vi.spyOn(editor.core.input, 'pointer')
    editor.mouse.drag(from, to, { steps: 2 })
    expect(sent.mock.results.some((answer) => (answer.value as { hold: boolean }).hold)).toBe(true)
    expect(seen(sent.mock.calls).map(([type, detail]) => `${String(type)} ${String(detail)}`)).toEqual([
      'pointermove 0',
      'pointerdown 0',
      'pointermove 0',
      'pointermove 0',
      'pointerup 0',
      'lostpointercapture 0',
      'click 1',
    ])
    expect(editor.core.boxOf('a')).toMatchObject({ x: 300, y: 200 })

    // A press the editor does not ask to hold loses no capture.
    sent.mockReset()
    sent.mockReturnValue({ handled: false, hold: false })
    editor.mouse.down()
    editor.mouse.up()
    expect(sent.mock.calls.map(([e]) => e.type)).toEqual(['pointerdown', 'pointerup', 'click'])
    editor.end()
  })

  it('a drag holds the keys it names from its press to its release', async () => {
    const editor = await testEditor(DESIGN)
    const sent = vi.spyOn(editor.core.input, 'pointer')
    editor.mouse.drag({ x: 5, y: 5 }, { x: 9, y: 9 }, { steps: 1, shift: true, alt: true })
    expect(sent.mock.calls.map(([e]) => [e.type, e.shiftKey, e.altKey, e.ctrlKey, e.metaKey])).toEqual([
      ['pointermove', true, true, false, false],
      ['pointerdown', true, true, false, false],
      ['pointermove', true, true, false, false],
      ['pointerup', true, true, false, false],
      ['lostpointercapture', true, true, false, false],
      ['click', true, true, false, false],
    ])
    editor.end()
  })

  it('a key pressed goes down and comes up through the keys, a modifier held on the key after it', async () => {
    const editor = await testEditor(DESIGN)
    const sent = vi.spyOn(editor.core.input, 'key')
    editor.keys.press('Control+Shift+KeyZ')
    expect(sent.mock.calls.map(([e]) => [e.type, e.code, e.key, e.ctrlKey, e.shiftKey])).toEqual([
      ['keydown', 'ControlLeft', 'Control', true, false],
      ['keydown', 'ShiftLeft', 'Shift', true, true],
      ['keydown', 'KeyZ', 'Z', true, true],
      ['keyup', 'KeyZ', 'Z', true, true],
      ['keyup', 'ShiftLeft', 'Shift', true, false],
      ['keyup', 'ControlLeft', 'Control', false, false],
    ])
    expect(sent.mock.calls[0]?.[0].target).toMatchObject({ stage: true, field: false, dialog: 'none' })
    editor.end()
  })

  it('a press lets its keys go however it ends: after a key whose action throws, the key is pressed afresh with no modifier held', async () => {
    const editor = await testEditor(DESIGN)
    const key = editor.core.input.key
    let throws = true
    const sent = vi.spyOn(editor.core.input, 'key').mockImplementation((input) => {
      if (!throws || input.code !== 'KeyZ') return key(input)
      throws = false
      return { handled: true, thrown: new Error('the action threw') }
    })
    expect(() => editor.keys.press('Control+KeyZ')).toThrow('the action threw')
    sent.mockClear()
    editor.keys.press('KeyZ')
    expect(sent.mock.calls.map(([e]) => [e.type, e.code, e.repeat, e.ctrlKey])).toEqual([
      ['keydown', 'KeyZ', false, false],
      ['keyup', 'KeyZ', false, false],
    ])
    editor.end()
  })

  it('a press runs what it is given while its keys are down, told whether the editor took the last key', async () => {
    const editor = await testEditor(DESIGN)
    editor.core.select(['a'])
    const sent = vi.spyOn(editor.core.input, 'key')
    const between: [boolean, string[]][] = []
    const during = (taken: boolean) => between.push([taken, sent.mock.calls.map(([e]) => `${e.type} ${e.code}`)])
    editor.keys.press('Shift+Delete', { field: true, stage: false }, during)
    sent.mockClear()
    editor.keys.press('Delete', {}, during)
    expect(between).toEqual([
      [false, ['keydown ShiftLeft', 'keydown Delete']],
      [true, ['keydown Delete']],
    ])
    editor.end()
  })

  it("presses an action's first key from the shortcut table", async () => {
    const editor = await testEditor(DESIGN)
    editor.core.select(['a'])
    editor.press('nudgeRightFar')
    expect(editor.core.boxOf('a')).toMatchObject({ x: 110, y: 100 })
    editor.press('undo')
    expect(editor.core.boxOf('a')).toMatchObject({ x: 100, y: 100 })
    editor.end()
  })

  it('a key pressed in a field is left to the page', async () => {
    const editor = await testEditor(DESIGN)
    editor.core.select(['a'])
    expect(editor.keys.press('Delete', { field: true, stage: false })).toEqual({ handled: false })
    expect(editor.core.design().nodes.a).toBeDefined()
    expect(editor.keys.press('Delete')).toEqual({ handled: true })
    expect(editor.core.design().nodes.a).toBeUndefined()
    editor.end()
  })

  describe('at', () => {
    it('gives a point the press grabs as asked: each corner, each edge and the turning band outside a corner', async () => {
      const editor = await testEditor(DESIGN)
      editor.core.select(['a'])
      for (const handle of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const) {
        const p = editor.at(handle)
        expect(p && editor.modules.transformDrag.handleUnder(p)).toMatchObject({ kind: 'resize', handle })
      }
      const [corner, band] = [editor.at('se'), editor.at({ turn: 'se' })]
      expect(corner).toEqual(editor.core.stagePoint(200, 200, 'sq'))
      expect(band && editor.modules.transformDrag.handleUnder(band)).toMatchObject({ kind: 'rotate' })
      editor.end()
    })

    it('a drag from the point resizes the layer by the corner asked for', async () => {
      const editor = await testEditor(DESIGN)
      editor.core.select(['a'])
      const from = editor.at('se')
      if (!from) throw new Error('no se handle')
      editor.mouse.drag(from, editor.core.stagePoint(300, 260, 'sq'))
      expect(editor.core.boxOf('a')).toEqual({ x: 100, y: 100, width: 200, height: 160 })
      editor.end()
    })

    it('gives null with nothing selected, and for a selection locked in place, which has no handles', async () => {
      const editor = await testEditor(DESIGN)
      expect(editor.at('se')).toBeNull()
      editor.core.select(['pin'])
      expect([editor.at('se'), editor.at({ turn: 'se' })]).toEqual([null, null])
      editor.end()
    })

    it('throws when the press at its point grabs something else: on a box a few pixels wide on screen, the middle of an edge is the layer’s, to move it', async () => {
      const editor = await testEditor(DESIGN)
      editor.core.select(['a'])
      editor.core.setCamera({ x: 0, y: 0, zoom: 0.04 })
      editor.core.redraw()
      expect(() => editor.at('n')).toThrow(/for "n" grabs null/)
      editor.end()
    })
  })
})
