import { afterEach, describe, expect, it } from 'vitest'

import type { DesignInput, Guide } from '@dazbee/schema'

import { type TestEditor, testEditor } from '../../test-editor.ts'
import { layer, shape } from '../select/test-snap-drag.ts'

/**
 * A square frame at the page's origin holding a dot from 10 to 50 on both axes and a box from 301 to
 * 501 across and 201 to 301 down, and a wide frame beside it; the square's guides as given.
 */
function design(guides?: Guide[], extra: Partial<DesignInput['nodes']> = {}): DesignInput {
  return {
    meta: { designId: 'd', name: 'D' },
    pages: { p1: { name: 'One', order: 'a0' } },
    frames: {
      sq: {
        pageId: 'p1',
        name: 'Square',
        width: 1080,
        height: 1080,
        x: 0,
        y: 0,
        order: 'a0',
        ...(guides && { guides }),
      },
      wide: { pageId: 'p1', name: 'Wide', width: 1200, height: 628, x: 1280, y: 0, order: 'a1' },
    },
    nodes: {
      dot: layer('graphic', 'sq', 'a0', shape(10, 10, 40, 40)),
      box: layer('graphic', 'sq', 'a1', shape(301, 201, 200, 100)),
      ...extra,
    } as DesignInput['nodes'],
  }
}

let ed: TestEditor | undefined

/** The editor on a design, at half size with the page's origin 100 px in from the stage's corner, the rulers shown. */
async function open(given: DesignInput = design(), { rulers = true } = {}) {
  ed = await testEditor(given)
  ed.core.setCamera({ x: 100, y: 100, zoom: 0.5 })
  if (rulers) ed.press('toggleRulers')
  ed.core.redraw()
  return ed
}
/** Where a point of the square is on the stage. */
const at = (x: number, y: number) => ({ x: 100 + x / 2, y: 100 + y / 2 })
/** A frame's guides now. */
const guidesOf = (editor: TestEditor, frameId = 'sq') => editor.core.design().frames[frameId]?.guides

afterEach(() => {
  ed?.end()
  ed = undefined
})

describe('editorGuideDrag', () => {
  describe('a drag out of a ruler', () => {
    it('adds a horizontal guide from the top ruler where it is let go on a frame, as one undo step', async () => {
      const editor = await open()
      editor.mouse.drag({ x: 300, y: 10 }, at(700, 400))
      expect(guidesOf(editor)).toEqual([{ axis: 'y', at: 400 }])
      editor.press('undo')
      expect(guidesOf(editor)).toBeUndefined()
    })

    it('adds a vertical guide from the start ruler, to the frame under the pointer', async () => {
      const editor = await open()
      editor.mouse.drag({ x: 10, y: 300 }, editor.core.stagePoint(600, 300, 'wide'))
      expect(guidesOf(editor, 'wide')).toEqual([{ axis: 'x', at: 600 }])
      expect(guidesOf(editor)).toBeUndefined()
    })

    it('adds nothing while the rulers are hidden, and the press selects as it would without guides', async () => {
      const editor = await open(design(), { rulers: false })
      editor.mouse.drag({ x: 300, y: 10 }, at(700, 400))
      expect(guidesOf(editor)).toBeUndefined()
    })

    it('adds nothing let go past the frame the rulers count from, off every frame', async () => {
      const editor = await open()
      editor.mouse.drag({ x: 300, y: 10 }, { x: 300, y: 700 })
      expect(guidesOf(editor)).toBeUndefined()
      expect(editor.core.canUndo()).toBe(false)
    })

    it('adds nothing let go back on its ruler, and nothing while Escape drops the drag', async () => {
      const editor = await open()
      editor.mouse.drag({ x: 300, y: 10 }, { x: 300, y: 12 })
      editor.mouse.move(300, 10)
      editor.mouse.down()
      editor.mouse.move(...xy(at(700, 400)), { steps: 4 })
      editor.keys.press('Escape')
      editor.mouse.up()
      expect(guidesOf(editor)).toBeUndefined()
      expect(editor.core.canUndo()).toBe(false)
    })

    it('snaps to the frame’s middle and to the sides of the layers it shows, within 6 screen pixels', async () => {
      const editor = await open()
      // 8 design pixels past the dot's bottom, 4 on screen at half size.
      editor.mouse.drag({ x: 300, y: 10 }, at(700, 58))
      editor.mouse.drag({ x: 10, y: 300 }, at(546, 700))
      expect(guidesOf(editor)).toEqual([
        { axis: 'y', at: 50 },
        { axis: 'x', at: 540 },
      ])
    })

    it('lands on whole pixels where nothing is near, and where it is with the deep key held', async () => {
      const editor = await open()
      editor.mouse.drag({ x: 300, y: 10 }, at(700, 700.8))
      editor.mouse.drag({ x: 300, y: 10 }, at(700, 58), { ctrl: true })
      expect(guidesOf(editor)).toEqual([
        { axis: 'y', at: 701 },
        { axis: 'y', at: 58 },
      ])
    })
  })

  describe('a drag on a guide', () => {
    it('moves it along its axis, as one undo step, and picks it', async () => {
      const editor = await open(design([{ axis: 'y', at: 400 }]))
      editor.mouse.drag(at(700, 400), at(700, 700))
      expect(guidesOf(editor)).toEqual([{ axis: 'y', at: 700 }])
      expect(editor.modules.guideDrag.selected()).toEqual({ frameId: 'sq', index: 0, axis: 'y', at: 700 })
      editor.press('undo')
      expect(guidesOf(editor)).toEqual([{ axis: 'y', at: 400 }])
    })

    it('with Alt at the press adds a copy and leaves the guide where it is', async () => {
      const editor = await open(design([{ axis: 'x', at: 200 }]))
      editor.mouse.drag(at(200, 700), at(800, 700), { alt: true })
      expect(guidesOf(editor)).toEqual([
        { axis: 'x', at: 200 },
        { axis: 'x', at: 800 },
      ])
    })

    it('removes it let go on its own ruler', async () => {
      const editor = await open(
        design([
          { axis: 'x', at: 200 },
          { axis: 'y', at: 400 },
        ]),
      )
      editor.mouse.drag(at(200, 700), { x: 8, y: 400 })
      expect(guidesOf(editor)).toEqual([{ axis: 'y', at: 400 }])
    })

    it('stays in its frame dragged past its edge', async () => {
      const editor = await open(design([{ axis: 'x', at: 200 }]))
      editor.mouse.drag(at(200, 700), { x: 700, y: 400 })
      expect(guidesOf(editor)).toEqual([{ axis: 'x', at: 1080 }])
    })

    it('moves the guide it pressed though another tab removed one before it meanwhile, and nothing once it is gone', async () => {
      const editor = await open(
        design([
          { axis: 'y', at: 100 },
          { axis: 'y', at: 400 },
        ]),
      )
      editor.mouse.move(...xy(at(700, 400)))
      editor.mouse.down()
      editor.mouse.move(...xy(at(700, 700)), { steps: 4 })
      editor.core.session.run('guide.remove', { frameId: 'sq', index: 0 })
      editor.mouse.up()
      expect(guidesOf(editor)).toEqual([{ axis: 'y', at: 700 }])

      editor.mouse.move(...xy(at(700, 700)))
      editor.mouse.down()
      editor.mouse.move(...xy(at(700, 900)), { steps: 4 })
      editor.core.session.run('guide.clear', { frameId: 'sq' })
      editor.mouse.up()
      expect(guidesOf(editor)).toBeUndefined()
    })

    it('leaves a guide past its frame’s edge alone: the press there takes what is under it', async () => {
      const editor = await open(design([{ axis: 'y', at: 1200 }]))
      expect(editor.modules.guideDrag.shown(null)).toEqual([])
      editor.mouse.drag({ x: 300, y: 700 }, { x: 300, y: 720 })
      expect(guidesOf(editor)).toEqual([{ axis: 'y', at: 1200 }])
    })

    it('gives way to the selection’s handles over it', async () => {
      const editor = await open(design([{ axis: 'x', at: 301 }]))
      editor.core.select(['box'])
      editor.core.redraw()
      const corner = editor.at('nw')
      if (!corner) throw new Error('no corner')
      editor.mouse.drag(corner, { x: corner.x + 20, y: corner.y })
      expect(guidesOf(editor)).toEqual([{ axis: 'x', at: 301 }])
      expect(editor.core.design().nodes.box?.props).toMatchObject({ x: 341 })
    })
  })

  describe('a picked guide', () => {
    it('is picked by a click, which lets the layers go; Delete removes it', async () => {
      const editor = await open(
        design([
          { axis: 'y', at: 400 },
          { axis: 'x', at: 200 },
        ]),
      )
      editor.core.select(['dot'])
      editor.mouse.click(...xy(at(700, 400)))
      expect(editor.core.selection()).toEqual([])
      expect(editor.modules.guideDrag.selected()).toMatchObject({ axis: 'y', at: 400 })
      editor.keys.press('Delete')
      expect(guidesOf(editor)).toEqual([{ axis: 'x', at: 200 }])
      expect(editor.modules.guideDrag.selected()).toBeNull()
    })

    it('moves with the arrows across it, 10 with Shift, and goes with Escape', async () => {
      const editor = await open(design([{ axis: 'y', at: 400 }]))
      editor.mouse.click(...xy(at(700, 400)))
      editor.keys.press('ArrowDown')
      editor.keys.press('Shift+ArrowUp')
      editor.keys.press('ArrowLeft')
      expect(guidesOf(editor)).toEqual([{ axis: 'y', at: 391 }])
      editor.keys.press('Escape')
      expect(editor.modules.guideDrag.selected()).toBeNull()
      editor.keys.press('ArrowDown')
      expect(guidesOf(editor)).toEqual([{ axis: 'y', at: 391 }])
    })

    it('goes once a layer is selected, and a click elsewhere selects as ever', async () => {
      const editor = await open(design([{ axis: 'y', at: 400 }]))
      editor.mouse.click(...xy(at(700, 400)))
      editor.mouse.click(...xy(at(400, 250)))
      expect(editor.core.selection()).toEqual(['box'])
      expect(editor.modules.guideDrag.selected()).toBeNull()
      editor.keys.press('Delete')
      expect(guidesOf(editor)).toEqual([{ axis: 'y', at: 400 }])
    })

    it('goes with a press off every frame', async () => {
      const editor = await open(design([{ axis: 'y', at: 400 }]))
      editor.mouse.click(...xy(at(700, 400)))
      editor.mouse.click(700, 700)
      expect(editor.modules.guideDrag.selected()).toBeNull()
      editor.keys.press('Delete')
      expect(guidesOf(editor)).toEqual([{ axis: 'y', at: 400 }])
    })

    it('stays picked once a nudge is undone, back where it was', async () => {
      const editor = await open(design([{ axis: 'y', at: 400 }]))
      editor.mouse.click(...xy(at(700, 400)))
      editor.keys.press('ArrowDown')
      editor.press('undo')
      expect(editor.modules.guideDrag.selected()).toMatchObject({ at: 400 })
      editor.keys.press('ArrowUp')
      expect(guidesOf(editor)).toEqual([{ axis: 'y', at: 399 }])
    })

    it('stays picked while another guide is dragged onto its ruler', async () => {
      const editor = await open(
        design([
          { axis: 'x', at: 200 },
          { axis: 'y', at: 400 },
        ]),
      )
      editor.mouse.click(...xy(at(700, 400)))
      editor.mouse.drag(at(200, 700), { x: 8, y: 400 })
      expect(editor.modules.guideDrag.selected()).toEqual({ frameId: 'sq', index: 0, axis: 'y', at: 400 })
    })

    it('takes no key while another tool is on', async () => {
      const editor = await open(design([{ axis: 'y', at: 400 }]))
      editor.mouse.click(...xy(at(700, 400)))
      editor.core.setTool('pen')
      editor.keys.press('ArrowDown')
      editor.keys.press('Delete')
      expect(guidesOf(editor)).toEqual([{ axis: 'y', at: 400 }])
    })
  })

  describe('shown', () => {
    it('draws no new guide over a frame that holds the most guides, where letting go would add none', async () => {
      const full = Array.from({ length: 100 }, (_, i) => ({ axis: 'x' as const, at: i }))
      const editor = await open(design(full))
      editor.mouse.move(300, 10)
      editor.mouse.down()
      editor.mouse.move(...xy(at(700, 400)), { steps: 4 })
      const g = editor.modules.pointer.gesture()
      expect(editor.modules.guideDrag.shown(g?.kind === 'guide' ? g : null).some((line) => line.axis === 'y')).toBe(
        false,
      )
      editor.mouse.up()
      expect(guidesOf(editor)).toHaveLength(100)
    })

    it('draws no guide hot under the selection’s handles, which a press takes first', async () => {
      const editor = await open(design([{ axis: 'x', at: 301 }]))
      editor.core.select(['box'])
      editor.core.redraw()
      const corner = editor.at('nw')
      if (!corner) throw new Error('no corner')
      editor.mouse.move(corner.x, corner.y)
      expect(editor.modules.guideDrag.shown(null)).toEqual([expect.objectContaining({ hot: false })])
    })

    it('draws each guide the frames show, the one under the pointer hot, nothing with the rulers hidden', async () => {
      const editor = await open(
        design([
          { axis: 'y', at: 400 },
          { axis: 'x', at: 200 },
        ]),
      )
      editor.mouse.move(...xy(at(700, 401)))
      const shown = editor.modules.guideDrag.shown(null).map(({ frame, ...line }) => ({ frame: frame.id, ...line }))
      expect(shown).toEqual([
        { frame: 'sq', axis: 'y', at: 400, hot: true },
        { frame: 'sq', axis: 'x', at: 200, hot: false },
      ])
      editor.press('toggleRulers')
      expect(editor.modules.guideDrag.shown(null)).toEqual([])
    })

    it('draws a guide being moved where it would land, hot, and not where it was', async () => {
      const editor = await open(design([{ axis: 'y', at: 400 }]))
      editor.mouse.move(...xy(at(700, 400)))
      editor.mouse.down()
      editor.mouse.move(...xy(at(700, 600)), { steps: 4 })
      const g = editor.modules.pointer.gesture()
      expect(g?.kind).toBe('guide')
      const shown = editor.modules.guideDrag.shown(g?.kind === 'guide' ? g : null)
      expect(shown.map(({ at: place, hot }) => [place, hot])).toEqual([[600, true]])
      // The rulers count from its frame.
      expect(editor.modules.guideDrag.rulerFrame(g?.kind === 'guide' ? g : null)?.id).toBe('sq')
      editor.mouse.up()
    })
  })

  describe('cursorAt', () => {
    it('resizes across the guide a press would drag: down the stage for the top ruler and a horizontal guide', async () => {
      const editor = await open(design([{ axis: 'x', at: 200 }]))
      const { cursorAt } = editor.modules.guideDrag
      expect([cursorAt({ x: 300, y: 10 }, false), cursorAt({ x: 10, y: 300 }, false)]).toEqual([
        'row-resize',
        'col-resize',
      ])
      expect([cursorAt(at(200, 700), false), cursorAt(at(200, 700), true), cursorAt({ x: 10, y: 10 }, false)]).toEqual([
        'col-resize',
        '',
        '',
      ])
      editor.mouse.move(...xy(at(200, 700)))
      expect(editor.core.input.cursor()).toBe('col-resize')
    })
  })

  it('starts nothing in a tab that may only view', async () => {
    ed = await testEditor(design(), { access: { readOnly: () => true, onChange: () => () => {} } })
    ed.core.setCamera({ x: 100, y: 100, zoom: 0.5 })
    ed.press('toggleRulers')
    ed.mouse.drag({ x: 300, y: 10 }, at(700, 400))
    expect(guidesOf(ed)).toBeUndefined()
  })
})

/** A point as the two numbers the mouse takes. */
function xy(p: { x: number; y: number }): [number, number] {
  return [p.x, p.y]
}
