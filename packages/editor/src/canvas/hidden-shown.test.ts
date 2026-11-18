// The hidden layers shown (`hiddenShown`), a view only this tab's stage has, held against the core
// opened in Node: the stage draws every hidden layer, a click, a marquee or a double click picks one
// to edit, and the design, its undo history, its export and its pictures stay as they were, every
// layer still hidden.
import { describe, expect, it } from 'vitest'

import { WORDS } from '../test-actions.ts'
import { textOf } from '../test-core.ts'
import { testEditor } from '../test-editor.ts'

describe('hiddenShown', () => {
  const rect = (parentId: string, index: string, x: number, y: number, props: Record<string, unknown> = {}) => ({
    type: 'graphic' as const,
    parentId,
    index,
    name: index,
    props: {
      x,
      y,
      width: 100,
      height: 100,
      shape: { kind: 'rect' as const },
      fills: [{ type: 'solid' as const, color: '#FF0000FF' }],
      ...props,
    },
  })
  /** Two frames: a shown square and a hidden one in the first, a hidden group holding a hidden square, and a hidden square in the second. */
  const HIDDEN = {
    meta: { designId: 'd', name: 'D' },
    pages: { p1: { name: 'One', order: 'a0' } },
    frames: {
      sq: { pageId: 'p1', name: 'Square', width: 400, height: 400, x: 0, y: 0, order: 'a0' },
      two: { pageId: 'p1', name: 'Two', width: 400, height: 400, x: 500, y: 0, order: 'a1' },
    },
    nodes: {
      shown: { ...rect('sq', 'a0', 20, 20), link: 'shown' },
      faded: { ...rect('sq', 'a1', 200, 200, { visible: false }), link: 'faded' },
      hiddenGroup: {
        type: 'group' as const,
        parentId: 'sq',
        link: 'hiddenGroup',
        index: 'a2',
        name: 'Group',
        props: { x: 20, y: 250, width: 100, height: 100, visible: false },
      },
      deep: { ...rect('hiddenGroup', 'a0', 20, 250, { visible: false }), link: 'deep' },
      far: { ...rect('two', 'a0', 100, 100, { visible: false }), link: 'far' },
    },
  }
  const idsIn = (layers: readonly { id: string; children: readonly unknown[] }[]): string[] =>
    layers.flatMap((layer) => [layer.id, ...idsIn(layer.children as typeof layers)])

  it('draws every hidden layer on the stage alone: no write, no undo step, and the export and the page picture as they were', async () => {
    const editor = await testEditor(HIDDEN)
    const { core, modules } = editor
    core.redraw()
    const before = { design: core.design(), pixels: core.exportPixels('sq'), page: core.pageThumbnail('p1') }
    const heard: boolean[] = []
    core.onView(() => heard.push(core.hiddenShown()))
    expect(core.hiddenShown()).toBe(false)
    core.setHiddenShown(true)
    core.setHiddenShown(true)
    core.redraw()
    expect(heard).toEqual([true])
    const [sq, two] = core.frames()
    if (!sq || !two) throw new Error('two frames')
    expect(idsIn(modules.scenes.shownScene(sq).layers)).toEqual(['shown', 'faded', 'hiddenGroup', 'deep'])
    expect(idsIn(modules.scenes.shownScene(two).layers)).toEqual(['far'])
    expect(idsIn(modules.scenes.scene(sq).layers)).toEqual(['shown'])
    expect(core.design()).toBe(before.design)
    expect(core.canUndo()).toBe(false)
    expect(Buffer.from(core.exportPixels('sq')).equals(Buffer.from(before.pixels))).toBe(true)
    expect(core.pageThumbnail('p1')).toBe(before.page)
    core.perform('toggleHiddenShown')
    expect([core.hiddenShown(), heard]).toEqual([false, [true, false]])
    editor.end()
  })

  it('lets a faded layer be clicked, marqueed and moved, and it stays hidden; turned off, a click there misses it', async () => {
    const editor = await testEditor(HIDDEN)
    const { core, mouse } = editor
    core.redraw()
    core.setHiddenShown(true)
    core.redraw()
    const on = core.stagePoint(250, 250, 'sq')
    mouse.click(on.x, on.y)
    expect(core.selection()).toEqual(['faded'])
    mouse.drag(on, core.stagePoint(300, 250, 'sq'))
    expect(core.design().nodes.faded?.props).toMatchObject({ x: 250, visible: false })
    core.select([])
    mouse.drag(core.stagePoint(180, 180, 'sq'), core.stagePoint(395, 395, 'sq'))
    expect(core.selection()).toEqual(['faded'])
    core.select([])
    core.setHiddenShown(false)
    core.redraw()
    const moved = core.stagePoint(300, 250, 'sq')
    mouse.click(moved.x, moved.y)
    expect(core.selection()).toEqual([])
    editor.end()
  })

  it('never turns on where the hidden layers may not show, as in a version viewed', async () => {
    const editor = await testEditor(HIDDEN, { hiddenShowable: false })
    const { core } = editor
    expect(core.actionReady('toggleHiddenShown')).toBe(false)
    core.setHiddenShown(true)
    expect(core.perform('toggleHiddenShown')).toBe(false)
    expect(core.hiddenShown()).toBe(false)
    editor.end()
  })

  it('lets a click pick a hidden layer that is faint itself, as it would pick it shown', async () => {
    const faint = rect('sq', 'a1', 200, 200, { visible: false, opacity: 0.3 })
    const editor = await testEditor({
      ...HIDDEN,
      nodes: { shown: HIDDEN.nodes.shown, faint: { ...faint, link: 'faint' } },
    })
    const { core, mouse } = editor
    core.setHiddenShown(true)
    core.redraw()
    const on = core.stagePoint(250, 250, 'sq')
    mouse.click(on.x, on.y)
    expect(core.selection()).toEqual(['faint'])
    editor.end()
  })
})

describe('typing in a hidden text', () => {
  it('starts on a double click while hidden layers are shown, and the text stays hidden', async () => {
    const words = WORDS.nodes.words
    if (words?.type !== 'text') throw new Error('no words')
    const editor = await testEditor({
      ...WORDS,
      nodes: { ...WORDS.nodes, words: { ...words, props: { ...words.props, visible: false } } },
    })
    const { core, modules, keys } = editor
    core.setHiddenShown(true)
    core.redraw()
    const on = core.stagePoint(180, 850, 'sq')
    editor.mouse.dblclick(on.x, on.y)
    expect(modules.typing.editing()?.id).toBe('words')
    keys.press('KeyA')
    expect(core.design().nodes.words?.props).toMatchObject({ visible: false })
    expect(textOf(editor)).not.toBe('Hello there')
    editor.end()
  })
})
