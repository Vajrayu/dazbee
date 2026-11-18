// A key that carries one grapheme types it, an emoji key of several code points too (an on-screen
// or custom layout's 👍🏽 or 🇮🇳), and AltGr's; a named key types nothing, nor an input method's
// while it composes. Text that comes with no key, from the system's emoji keyboard or an input
// method's commit, is typed too.
import { afterEach, describe, expect, it } from 'vitest'

import { keyInput } from '../gestures/test-inputs.ts'
import { WORDS } from '../test-actions.ts'
import { type TestEditor, testEditor } from '../test-editor.ts'

let editor: TestEditor | undefined
afterEach(() => editor?.end())

/** An editor typing at the end of the words; their text. */
async function typingWords() {
  editor = await testEditor(WORDS)
  const { core } = editor
  core.select(['words'])
  editor.press('goIn')
  editor.keys.press('End')
  const words = () => {
    const node = core.design().nodes.words
    return node?.type === 'text' ? node.props.text : undefined
  }
  return { core, words }
}

describe('typing a key', () => {
  it('types an emoji key whole, and no named key', async () => {
    editor = await testEditor(WORDS)
    editor.core.select(['words'])
    editor.press('goIn')
    editor.keys.press('End')
    for (const key of ['👍🏽', '🇮🇳', '👨‍👩‍👧', 'é', 'Dead', 'Unidentified']) editor.keys.press(key)
    const words = editor.core.design().nodes.words
    expect(words?.type === 'text' && words.props.text).toBe('Hello there👍🏽🇮🇳👨‍👩‍👧é')
  })
})

describe('typing', () => {
  it('types AltGr’s character, which Chrome on Windows sends with Ctrl and Alt, and runs no shortcut', async () => {
    const { core, words } = await typingWords()
    const altGr = { ctrlKey: true, altKey: true, altGraph: true }
    expect(core.input.key(keyInput('KeyQ', { key: '@', ...altGr })).handled).toBe(true)
    expect(core.input.key(keyInput('KeyE', { key: '€', ...altGr })).handled).toBe(true)
    expect(words()).toBe('Hello there@€')
  })

  it('takes ⌘ with AltGr as ⌘: Firefox on a Mac says AltGraph whenever Option is held', async () => {
    const { core, words } = await typingWords()
    expect(core.input.key(keyInput('KeyB', { key: '∫', metaKey: true, altKey: true, altGraph: true })).handled).toBe(
      false,
    )
    expect(words()).toBe('Hello there')
  })

  it('leaves an input method’s keys to it while it composes: nothing typed, no shortcut run', async () => {
    const { core, words } = await typingWords()
    editor?.keys.press('!')
    for (const [code, extra] of [
      ['Enter', { key: 'Enter' }],
      ['Backspace', { key: 'Backspace' }],
      ['KeyZ', { key: 'z', ctrlKey: true }],
      ['KeyB', { key: 'b', ctrlKey: true }],
    ] as const)
      expect(core.input.key(keyInput(code, { ...extra, composing: true })).handled).toBe(false)
    expect(words()).toBe('Hello there!')
    const node = core.design().nodes.words
    expect(node?.type === 'text' ? node.props.style.fontWeight : undefined).toBe(400)
  })

  it('types text that came with no key over the range, in the typing step, and none while no text is edited', async () => {
    const { core, words } = await typingWords()
    editor?.keys.press('!')
    expect(core.input.text('😀')).toBe(true)
    expect(words()).toBe('Hello there!😀')
    editor?.keys.press('Escape')
    core.session.undo()
    expect(words()).toBe('Hello there')
    expect(core.input.text('😀')).toBe(false)
    expect(words()).toBe('Hello there')
  })
})
