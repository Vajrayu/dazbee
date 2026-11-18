// A Reviewer's editor (C35): selecting, going into a text and copying work; every edit, however it
// comes (the stage, keys, the clipboard, the page's panels and their promises), changes nothing,
// throws nothing to its caller, ends what was open on the stage, and the page is told View only once.
import { afterEach, describe, expect, it } from 'vitest'

import { CommandError, openSession, VIEW_ONLY } from '@dazbee/doc'
import { openTestStore } from '@dazbee/doc/test-store'

import type { TabAccess } from './core-interface.ts'
import { DESIGN, WORDS } from './test-actions.ts'
import { openPhotoPages } from './test-core.ts'
import { type TestEditor, testEditor } from './test-editor.ts'
import { editorViewOnly } from './view-only.ts'

/** An access a test turns to view only and back. */
function testAccess() {
  let readOnly = false
  let quiet = false
  const listeners = new Set<() => void>()
  const access: TabAccess = {
    readOnly: () => readOnly,
    quiet: () => quiet,
    onChange(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  return {
    access,
    set(to: boolean) {
      readOnly = to
      for (const listener of listeners) listener()
    },
    /** The tab's link ended: it may only view, and the page says why already. */
    end() {
      readOnly = quiet = true
      for (const listener of listeners) listener()
    },
  }
}

/** Lets the refused calls end, as the browser's next turn does. */
const turn = () => new Promise((resolve) => setTimeout(resolve, 0))

/** An SVG file on the clipboard. */
const SVG_FILE = {
  name: 'star.svg',
  type: 'image/svg+xml',
  text: () =>
    Promise.resolve(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>',
    ),
  bytes: () => Promise.resolve(new Uint8Array()),
}

let editor: TestEditor | undefined
afterEach(() => editor?.end())

/** The middle of layer `id` of the square frame, as a stage point. */
function middleOf(e: TestEditor, id: string) {
  const box = e.core.design().nodes[id]?.props as { x: number; y: number; width: number; height: number }
  return e.core.stagePoint(box.x + box.width / 2, box.y + box.height / 2, 'sq')
}

describe('a Reviewer’s editor', () => {
  it('selects with a click, goes into a text, selects in it and copies, with no notice', async () => {
    const { access, set } = testAccess()
    editor = await testEditor(WORDS, { access })
    set(true)
    const { core } = editor
    const on = middleOf(editor, 'words')
    editor.mouse.click(on.x, on.y)
    expect(core.selection()).toEqual(['words'])
    editor.press('goIn')
    editor.keys.press('End')
    editor.keys.press('Shift+ArrowLeft')
    editor.keys.press('Shift+ArrowLeft')
    expect(core.textSelection()).toMatchObject({ id: 'words' })
    expect(editor.clipboard.copy()).toMatchObject({ text: 're' })
    await turn()
    expect(editor.told).toEqual([])
  })

  it('changes nothing for any edit, throws nothing, ends the drag and the typing, and says View only once', async () => {
    const { access, set } = testAccess()
    editor = await testEditor(WORDS, { access })
    const { core } = editor
    // A step to undo, made while the tab could edit.
    core.select(['a'])
    editor.press('nudgeRight')
    const copied = editor.clipboard.copy() ?? {}
    set(true)
    const before = JSON.stringify(core.design())
    const unchanged = () => expect(JSON.stringify(core.design())).toBe(before)

    // A drag past the slop: dropped, with no gesture open after.
    const from = middleOf(editor, 'b')
    editor.mouse.drag(from, { x: from.x + 80, y: from.y + 40 })
    await turn()
    unchanged()
    expect(core.gesturing()).toBe(false)

    // Typing into a text: the first key is refused, and typing ends.
    core.select(['words'])
    editor.press('goIn')
    editor.keys.press('a')
    await turn()
    unchanged()
    expect(core.textSelection()).toBeNull()
    expect(core.gesturing()).toBe(false)

    // Keys, the clipboard, a drop, a font picked, an SVG file and text pasted, the page's own edits, a brand kit change, undo.
    core.select(['a'])
    editor.press('nudgeRight')
    editor.press('flipHorizontal')
    editor.press('delete')
    expect(() => editor?.clipboard.paste(copied)).not.toThrow()
    core.placeImage({ id: 'img', name: 'Photo', width: 10, height: 10 })
    core.select(['words'])
    await core.setFont('Noto Sans', 700)
    editor.clipboard.paste({ files: [SVG_FILE] })
    editor.clipboard.paste({ text: 'From outside' })
    core.setProps(['a'], () => ({ x: 1 }))
    core.renameLayer('a', 'Mine')
    expect(
      core.session.run('page.add', { name: 'Page 2', frame: { name: 'Square', width: 100, height: 100 } }),
    ).toBeUndefined()
    expect(core.session.undo()).toBeUndefined()
    expect(core.session.redo()).toBeUndefined()
    expect(core.session.batch(() => core.session.run('node.rename', { id: 'a', name: 'Batched' }))).toBeUndefined()
    await core.setVariables({ 'brand:heading': 'Noto Sans' })
    editor.press('undo')
    await turn()
    unchanged()
    expect(core.gesturing()).toBe(false)
    expect(editor.told).toEqual([['viewOnly']])
  })

  it('picks a frame whose label is double-clicked, and asks the page to rename nothing', async () => {
    const { access, set } = testAccess()
    editor = await testEditor(DESIGN, { access })
    const { core } = editor
    const renames: string[] = []
    core.onFrameRename((id) => renames.push(id))
    set(true)
    core.renameFrame('sq')
    expect(renames).toEqual([])
    expect(core.pickedFrame()).toBe('sq')
    set(false)
    core.renameFrame('sq')
    expect(renames).toEqual(['sq'])
  })

  it('keeps the picked frame picked when Delete, by its key or perform, is refused', async () => {
    const { access, set } = testAccess()
    editor = await testEditor(DESIGN, { access })
    const { core } = editor
    set(true)
    core.pickFrame('sq')
    editor.press('delete')
    core.perform('delete')
    await turn()
    expect(core.pickedFrame()).toBe('sq')
    expect(core.design().frames.sq).toBeDefined()
  })

  it('takes only the tools that look, and ends a drawing tool, a crop and a path edit once the tab turns to view only', async () => {
    const { access, set } = testAccess()
    editor = await openPhotoPages({ access })
    const { core, modules, mouse } = editor
    const onPhoto = core.stagePoint(250, 440, 'sq')
    mouse.dblclick(onPhoto.x, onPhoto.y)
    expect(modules.selection.cropping()).not.toBeNull()
    editor.press('toolText')
    set(true)
    expect([core.tool(), modules.selection.cropping()]).toEqual(['select', null])
    // The access is told again with nothing changed: what the Reviewer has open stays.
    editor.press('toolHand')
    set(true)
    expect(core.tool()).toBe('hand')
    for (const tool of ['toolText', 'toolRect', 'toolFrame', 'toolPen'] as const) editor.press(tool)
    core.armImage({ id: 'img', name: 'Photo', width: 10, height: 10 })
    expect([core.tool(), core.imageArmed()]).toEqual(['hand', false])
    editor.press('toolSelect')
    // A double click on the photo selects it, and starts no crop; nor does Enter or the Crop item.
    mouse.dblclick(onPhoto.x, onPhoto.y)
    expect([modules.selection.cropping(), core.selection()]).toEqual([null, ['photo']])
    editor.press('goIn')
    expect(modules.selection.cropping()).toBeNull()
    core.perform('editPoints')
    expect(modules.selection.cropping()).toBeNull()
    await turn()
    expect(editor.told).toEqual([])
  })

  it('says View only again only after the tab could edit in between', async () => {
    const { access, set } = testAccess()
    editor = await testEditor(DESIGN, { access })
    const { core } = editor
    set(true)
    core.select(['a'])
    editor.press('nudgeRight')
    await turn()
    editor.press('nudgeRight')
    await turn()
    expect(editor.told).toEqual([['viewOnly']])
    set(false)
    editor.press('nudgeRight')
    expect(core.design().nodes.a?.props).toMatchObject({ x: 101 })
    set(true)
    editor.press('nudgeRight')
    await turn()
    expect(editor.told).toEqual([['viewOnly'], ['viewOnly']])
  })

  it('tells the page whether it may only view and when that changes, and View only once for what the page turns away', async () => {
    const { access, set, end } = testAccess()
    editor = await testEditor(DESIGN, { access })
    const { core } = editor
    const heard: boolean[] = []
    const stop = core.onAccess(() => heard.push(core.readOnly()))
    expect(core.readOnly()).toBe(false)
    set(true)
    expect(heard).toEqual([true])
    core.tellViewOnly()
    core.select(['a'])
    editor.press('nudgeRight')
    await turn()
    // A drop the page turned away and a refused key share the once.
    expect(editor.told).toEqual([['viewOnly']])
    set(false)
    stop()
    set(true)
    expect(heard).toEqual([true, false])
    // A tab whose link ended is never told, though it could edit in between.
    end()
    core.tellViewOnly()
    expect(editor.told).toEqual([['viewOnly']])
  })

  it('changes nothing and says nothing once the link ended, as the page shows why already', async () => {
    const { access, end } = testAccess()
    editor = await testEditor(DESIGN, { access })
    const { core } = editor
    end()
    core.select(['a'])
    editor.press('nudgeRight')
    await turn()
    expect(core.design().nodes.a?.props).toMatchObject({ x: 100 })
    expect(editor.told).toEqual([])
  })
})

describe('editorViewOnly’s guard', () => {
  it('ends a refusal, thrown or in a promise, as what it is given, and throws anything else on', async () => {
    const session = openSession(openTestStore())
    const { access } = testAccess()
    const ending = new AbortController()
    const { guard } = editorViewOnly({ session, access, endOpen: () => {}, notify: () => {}, signal: ending.signal })
    const refusal = new CommandError('node.rename', { kind: 'refused', reason: VIEW_ONLY })
    expect(
      guard(() => {
        throw refusal
      }, 'refused')(),
    ).toBe('refused')
    await expect(guard(() => Promise.reject(refusal))()).resolves.toBeUndefined()
    const other = new Error('a bug')
    expect(() =>
      guard(() => {
        throw other
      })(),
    ).toThrow(other)
    await expect(guard(() => Promise.reject(other))()).rejects.toBe(other)
    ending.abort()
    session.destroy()
  })
})
