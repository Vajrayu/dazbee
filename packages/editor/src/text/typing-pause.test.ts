// A typing step ends on a pause of two seconds with no key, or when the tab is hidden, and the next
// key opens another, so undo takes back a burst at a time (C47); and starting to edit a text another
// tab types in tells the page so, once.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { DesignInput } from '@dazbee/schema'

import { testEditor } from '../test-editor.ts'
import { TYPING_PAUSE_MS } from './typing.ts'

const STYLE = { fontFamily: 'Noto Sans', fontSize: 40, color: '#000000FF' }
const DESIGN: DesignInput = {
  meta: { designId: 'd', name: 'D' },
  pages: { p1: { name: 'One', order: 'a0' } },
  frames: { sq: { pageId: 'p1', name: 'Square', width: 1080, height: 1080, x: 0, y: 0, order: 'a0' } },
  nodes: {
    title: {
      type: 'text',
      parentId: 'sq',
      link: 'title',
      index: 'a0',
      name: 'Title',
      props: { x: 80, y: 100, width: 920, height: 60, text: 'Hello', style: STYLE },
    },
  },
}

/** An editor typing at the end of the title. */
async function typingAtEnd() {
  const editor = await testEditor(DESIGN)
  editor.core.select(['title'])
  editor.press('goIn')
  editor.keys.press('End')
  const textOf = () => {
    const node = editor.core.session.design().nodes.title
    return node?.type === 'text' ? node.props.text : undefined
  }
  const type = (text: string) => {
    for (const key of text) editor.keys.press(key)
  }
  return { editor, textOf, type }
}

describe('the typing pause', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('ends the step after two seconds with no key, so undo takes back one burst', async () => {
    const { editor, textOf, type } = await typingAtEnd()
    const { session } = editor.core
    type(' wo')
    vi.advanceTimersByTime(TYPING_PAUSE_MS - 1)
    // Each key starts the pause again: still the same step.
    type('rld')
    vi.advanceTimersByTime(TYPING_PAUSE_MS - 1)
    type('!')
    vi.advanceTimersByTime(TYPING_PAUSE_MS)
    type('?')
    expect(textOf()).toBe('Hello world!?')
    editor.core.stopEditing()
    session.undo()
    expect(textOf()).toBe('Hello world!')
    session.undo()
    expect(textOf()).toBe('Hello')
    expect(session.canUndo()).toBe(false)
    editor.end()
  })

  it('ends the step when the tab is hidden, and keeps typing', async () => {
    const { editor, textOf, type } = await typingAtEnd()
    const { session } = editor.core
    type('!')
    editor.core.input.hidden()
    expect(editor.modules.typing.editing()).toMatchObject({ id: 'title' })
    type('?')
    expect(textOf()).toBe('Hello!?')
    editor.core.stopEditing()
    session.undo()
    expect(textOf()).toBe('Hello!')
    editor.end()
  })

  it("leaves a panel's scrub one step of its own across the pause, and keys after it a step of theirs", async () => {
    const { editor, textOf, type } = await typingAtEnd()
    const { session } = editor.core
    const opacity = () => session.design().nodes.title?.props.opacity
    type('!')
    const end = editor.core.beginGesture()
    session.run('node.update', { ids: ['title'], patch: { opacity: 0.8 } })
    vi.advanceTimersByTime(TYPING_PAUSE_MS)
    // Its writes after the pause stay in it, and its own end closes it.
    session.run('node.update', { ids: ['title'], patch: { opacity: 0.5 } })
    end()
    type('??')
    editor.core.stopEditing()
    session.undo()
    expect(textOf()).toBe('Hello!')
    session.undo()
    expect(opacity()).toBe(1)
    session.undo()
    expect(textOf()).toBe('Hello')
    editor.end()
  })

  it('starts no pause before the first key, nor after the core ended', async () => {
    const { editor, type } = await typingAtEnd()
    vi.advanceTimersByTime(TYPING_PAUSE_MS * 2)
    expect(editor.core.session.canUndo()).toBe(false)
    type('!')
    vi.advanceTimersByTime(TYPING_PAUSE_MS - 1)
    editor.end()
    expect(() => vi.advanceTimersByTime(TYPING_PAUSE_MS)).not.toThrow()
  })
})
