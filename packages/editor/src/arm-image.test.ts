// An image armed from Assets, in the whole editor opened in Node with a mouse and keys: a click on a
// frame places it at its own size, a drag draws it at the box dragged, each one undo step with the
// select tool back after; Escape, disarming, another tool and a press off every frame each end it
// with nothing placed.
import { describe, expect, it } from 'vitest'

import { DESIGN } from './test-actions.ts'
import { testEditor } from './test-editor.ts'
import type { PlacedAsset } from './tools.ts'

const PHOTO: PlacedAsset = { id: 'a1', name: 'Photo', width: 400, height: 200 }

/** The editor on the test design with PHOTO armed, and the layers made since it opened. */
async function armed() {
  const editor = await testEditor(DESIGN)
  const before = new Set(Object.keys(editor.core.design().nodes))
  editor.core.armImage(PHOTO)
  const made = () => Object.keys(editor.core.design().nodes).filter((id) => !before.has(id))
  return { editor, core: editor.core, mouse: editor.mouse, made }
}

type Armed = Awaited<ReturnType<typeof armed>>

describe('an image armed from Assets', () => {
  it('places at its own size centred on a click on a frame, one undo step, then the select tool is back', async () => {
    const { editor, core, mouse, made } = await armed()
    expect([core.tool(), core.imageArmed()]).toEqual(['image', true])
    const on = core.stagePoint(500, 500, 'sq')
    mouse.click(on.x, on.y)
    const [id = ''] = made()
    expect(made()).toHaveLength(1)
    expect(core.boxOf(id)).toMatchObject({ x: 300, y: 400, width: 400, height: 200 })
    expect(core.selection()).toEqual([id])
    expect([core.tool(), core.imageArmed()]).toEqual(['select', false])
    core.perform('undo')
    expect(made()).toEqual([])
    editor.end()
  })

  it('draws at the box dragged on a frame, Shift keeping its shape', async () => {
    const { editor, core, mouse, made } = await armed()
    mouse.drag(core.stagePoint(100, 600, 'sq'), core.stagePoint(500, 1000, 'sq'), { shift: true })
    const [id = ''] = made()
    expect(core.boxOf(id)).toMatchObject({ x: 100, y: 600, width: 800, height: 400 })
    expect(core.tool()).toBe('select')
    editor.end()
  })

  it.each([
    ['Escape', (e: Armed) => e.editor.press('deselect')],
    ['disarming', (e: Armed) => e.core.armImage(null)],
    ['another tool', (e: Armed) => e.editor.press('toolSelect')],
    [
      'a press off every frame',
      (e: Armed) => {
        const off = e.core.stagePoint(-400, 500, 'sq')
        e.mouse.click(off.x, off.y)
      },
    ],
  ])('ends with %s, placing nothing, the select tool back', async (_how, end) => {
    const e = await armed()
    end(e)
    expect([e.core.tool(), e.core.imageArmed()]).toEqual(['select', false])
    const on = e.core.stagePoint(500, 500, 'sq')
    e.mouse.click(on.x, on.y)
    expect(e.made()).toEqual([])
    e.editor.end()
  })
})
