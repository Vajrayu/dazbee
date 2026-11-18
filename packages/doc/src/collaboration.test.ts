import { describe, expect, it } from 'vitest'

import { parseDesign } from '@dazbee/schema'

import { readDesign } from './index.ts'
import { openTestSession, testDesign } from './test-design.ts'
import { openTestStore, twoTabs } from './test-store.ts'

describe('changes no one undoes', () => {
  it('a change made untracked stays through undo and redo, and undo reverts the edit before it', () => {
    const result = parseDesign(testDesign())
    if (!result.success) throw new Error(result.errors.join('\n'))
    const session = openTestSession(openTestStore(result.design))
    const [id] = Object.keys(session.design().nodes)
    if (!id) throw new Error('no layer')
    session.run('node.update', { ids: [id], patch: { x: 11 } })
    session.untracked(() => session.run('node.update', { ids: [id], patch: { y: 22 } }))
    expect(session.canUndo()).toBe(true)
    session.undo()
    expect(session.design().nodes[id]?.props).toMatchObject({ y: 22 })
    expect((session.design().nodes[id]?.props as { x: number }).x).not.toBe(11)
    expect(session.canUndo()).toBe(false)
    session.redo()
    expect(session.design().nodes[id]?.props).toMatchObject({ x: 11, y: 22 })
  })
})

describe('what undo and redo can do', () => {
  it('says whether there is a step to undo or redo, and calls back each time that may change', () => {
    const result = parseDesign(testDesign())
    if (!result.success) throw new Error(result.errors.join('\n'))
    const session = openTestSession(openTestStore(result.design))
    const [id] = Object.keys(session.design().nodes)
    if (!id) throw new Error('no layer')
    let calls = 0
    const stop = session.onHistory(() => calls++)
    expect([session.canUndo(), session.canRedo()]).toEqual([false, false])
    session.run('node.update', { ids: [id], patch: { x: 11 } })
    expect([session.canUndo(), session.canRedo(), calls > 0]).toEqual([true, false, true])
    calls = 0
    session.undo()
    expect([session.canUndo(), session.canRedo(), calls > 0]).toEqual([false, true, true])
    calls = 0
    session.redo()
    expect([session.canUndo(), session.canRedo(), calls > 0]).toEqual([true, false, true])
    stop()
    calls = 0
    session.undo()
    expect(calls).toBe(0)
  })

  it('a change from another tab gives this tab nothing to undo', () => {
    const { tabA, tabB, sync } = twoTabs()
    const [id] = Object.keys(tabB.design().nodes)
    if (!id) throw new Error('no layer')
    tabB.run('node.update', { ids: [id], patch: { x: 5 } })
    sync()
    expect([tabA.canUndo(), tabA.canRedo()]).toEqual([false, false])
  })
})

describe('two tabs', () => {
  it('undo in one tab reverts only its own edits, never the other tab’s', () => {
    const { a, b, tabA, tabB, sync } = twoTabs()

    tabA.run('node.update', { ids: ['box'], patch: { x: 500 } })
    sync()
    tabB.run('node.update', { ids: ['box'], patch: { y: 700 } })
    tabB.run('text.edit', { id: 'headline', op: { kind: 'insert', at: 0, text: 'Big ' } })
    sync()

    tabA.undo()
    sync()

    for (const doc of [a, b]) {
      const design = readDesign(doc)
      expect(design.nodes.box?.props).toMatchObject({ x: 100, y: 700 })
      expect(design.nodes.headline?.type === 'text' && design.nodes.headline.props.text).toBe('Big Summer sale')
    }

    // The other tab's undo takes back its own last edit, the text, and leaves the rest.
    tabB.undo()
    sync()

    for (const doc of [a, b]) {
      const design = readDesign(doc)
      expect(design.nodes.box?.props).toMatchObject({ x: 100, y: 700 })
      expect(design.nodes.headline?.type === 'text' && design.nodes.headline.props.text).toBe('Summer sale')
    }
  })

  it('the same property set by each tab in turn: each undo takes back only its own tab’s value', () => {
    const { a, b, tabA, tabB, sync } = twoTabs()

    tabA.run('node.update', { ids: ['box'], patch: { y: 400 } })
    sync()
    tabB.run('node.update', { ids: ['box'], patch: { y: 600 } })
    sync()

    // A's undo leaves B's later value.
    tabA.undo()
    sync()
    for (const doc of [a, b]) expect(readDesign(doc).nodes.box?.props.y).toBe(600)

    // B's undo puts back the value B replaced, which was A's.
    tabB.undo()
    sync()
    for (const doc of [a, b]) expect(readDesign(doc).nodes.box?.props.y).toBe(400)
  })

  it('undoing an edit that won over a concurrent edit restores the old value instead of leaving it unset', () => {
    for (const [first, second] of [
      ['a', 'b'],
      ['b', 'a'],
    ] as const) {
      const tabs = twoTabs()
      const tab = { a: tabs.tabA, b: tabs.tabB }
      tab[first].run('node.update', { ids: ['box'], patch: { x: 1 } })
      tab[second].run('node.update', { ids: ['box'], patch: { x: 2 } })
      tabs.sync()

      const bValue = first === 'b' ? 1 : 2
      const bWon = readDesign(tabs.a).nodes.box?.props.x === bValue

      tab.a.undo()
      tabs.sync()

      // If b's edit won, a's undo must leave it alone; if a's won, undo goes back to the value before.
      const expected = bWon ? bValue : 100
      expect(readDesign(tabs.a).nodes.box?.props.x).toBe(expected)
      expect(readDesign(tabs.b).nodes.box?.props.x).toBe(expected)

      tab.a.redo()
      tabs.sync()
      expect(readDesign(tabs.a).nodes.box?.props.x).toBeTypeOf('number')
      tab.a.undo()
      tabs.sync()
      expect(readDesign(tabs.a).nodes.box?.props.x).toBeTypeOf('number')
      expect(readDesign(tabs.b)).toEqual(readDesign(tabs.a))
    }
  })

  it('a drag is one undo step, and undoing it leaves the other tab’s edits made during it', () => {
    const { a, b, tabA, tabB, sync } = twoTabs()

    tabA.gesture(() => {
      for (let i = 1; i <= 30; i++) {
        tabA.run('node.update', { ids: ['box'], patch: { x: 100 + i * 10 } })
        if (i % 10 === 0) {
          sync()
          tabB.run('node.update', { ids: ['box'], patch: { y: 100 + i } })
          sync()
        }
      }
    })
    tabA.run('node.update', { ids: ['box'], patch: { width: 50 } })
    sync()

    tabA.undo()
    sync()
    expect(readDesign(a).nodes.box?.props).toMatchObject({ x: 400, width: 200 })
    tabA.undo()
    sync()
    expect(tabA.canUndo()).toBe(false)
    for (const doc of [a, b]) expect(readDesign(doc).nodes.box?.props).toMatchObject({ x: 100, y: 130, width: 200 })
  })

  it('undoing a gesture that won over another tab’s edit restores the value from before the gesture', () => {
    const { a, b, tabA, tabB, sync } = twoTabs()
    tabB.run('node.update', { ids: ['box'], patch: { x: 7 } })
    tabA.gesture(() => {
      tabA.run('node.update', { ids: ['box'], patch: { x: 300 } })
      tabA.run('node.update', { ids: ['box'], patch: { x: 310 } })
    })
    sync()
    // Both tabs set x at once; whichever won, undoing A must not leave x unset.
    tabA.undo()
    sync()
    for (const doc of [a, b]) expect(readDesign(doc).nodes.box?.props.x).toBeTypeOf('number')
  })

  it('edits to linked copies in two tabs at once both land, each copy keeping its own', () => {
    const { a, b, tabA, tabB, sync } = twoTabs()
    tabA.run('node.update', { ids: ['box'], patch: { x: 500 } })
    tabB.run('node.update', { ids: ['banner-box'], patch: { x: 7 } })
    tabA.run('text.edit', { id: 'headline', op: { kind: 'insert', at: 0, text: 'Big ' } })
    tabB.run('text.edit', { id: 'banner-headline', op: { kind: 'insert', at: 4, text: '!' } })
    sync()
    for (const doc of [a, b]) {
      const design = readDesign(doc)
      expect(design.nodes.box?.props.x).toBe(500)
      expect(design.nodes['banner-box']?.props.x).toBe(7)
      expect(design.nodes.headline?.props).toMatchObject({ text: 'Big Summer sale' })
      expect(design.nodes['banner-headline']?.props).toMatchObject({ text: 'Sale!' })
    }
  })
})
