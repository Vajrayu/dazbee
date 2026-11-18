import { describe, expect, expectTypeOf, it } from 'vitest'

import { STEP_NAMES } from '@dazbee/doc'

import { keyInput, keyTarget } from './gestures/test-inputs.ts'
import {
  aimsPaste,
  deepKeyHeld,
  keptFromBrowser,
  matchesKey,
  PAGE_ACTIONS,
  pressFor,
  rightClick,
  SHORTCUT_GROUPS,
  shortcutFor,
  SHORTCUTS,
  shortcutsList,
  type StageAction,
  stageShortcutFor,
  stepOf,
  viewAction,
} from './shortcuts.ts'

const key = (
  key: string,
  code: string,
  mods: { ctrl?: boolean; meta?: boolean; shift?: boolean; alt?: boolean } = {},
) => ({
  key,
  code,
  ctrlKey: Boolean(mods.ctrl),
  metaKey: Boolean(mods.meta),
  shiftKey: Boolean(mods.shift),
  altKey: Boolean(mods.alt),
})

/** A press of a shortcut's key as the table spells it: a letter by its character and place, `?` with Shift, any other by its code. */
const pressOf = (spec: string) => {
  const parts = spec.split('+')
  const last = parts.at(-1) ?? ''
  const letter = /^[A-Z]$/.test(last)
  const code = letter ? `Key${last}` : last === '?' ? 'Slash' : last
  return key(letter ? last.toLowerCase() : last, code, {
    ctrl: parts.includes('Mod'),
    shift: parts.includes('Shift') || last === '?',
    alt: parts.includes('Alt'),
  })
}

describe('shortcuts', () => {
  it('match letters by the character typed and other keys by their code, with exact modifiers', () => {
    expect(shortcutFor(key('d', 'KeyD', { ctrl: true }))).toBe('duplicate')
    expect(shortcutFor(key('d', 'KeyD', { meta: true }))).toBe('duplicate')
    expect(shortcutFor(key('d', 'KeyD'))).toBeNull()
    expect(shortcutFor(key('}', 'BracketRight', { ctrl: true, shift: true }))).toBe('bringToFront')
    expect(shortcutFor(key(']', 'BracketRight', { ctrl: true }))).toBe('bringForward')
    expect(shortcutFor(key('!', 'Digit1', { shift: true }))).toBe('zoomToFit')
    expect(shortcutFor(key('ArrowLeft', 'ArrowLeft', { shift: true }))).toBe('nudgeLeftFar')
    expect(shortcutFor(key('Z', 'KeyZ', { ctrl: true, shift: true }))).toBe('redo')
    // With Alt a Mac types another character; the key's place still names it.
    expect(shortcutFor(key('å', 'KeyA', { alt: true }))).toBe('alignLeft')
    expect(shortcutFor(key('H', 'KeyH', { alt: true, shift: true }))).toBe('distributeHorizontal')
    expect(shortcutFor(key('R', 'KeyR', { shift: true }))).toBe('toggleRulers')
  })

  it('give the style and linked-copy actions Ctrl+Alt, with Shift for the ones that reach the linked copies', () => {
    expect(shortcutFor(key('c', 'KeyC', { ctrl: true, alt: true }))).toBe('copyStyle')
    expect(shortcutFor(key('v', 'KeyV', { ctrl: true, alt: true }))).toBe('pasteStyle')
    expect(shortcutFor(key('C', 'KeyC', { ctrl: true, alt: true, shift: true }))).toBe('styleToLinked')
    expect(shortcutFor(key('T', 'KeyT', { ctrl: true, alt: true, shift: true }))).toBe('textToLinked')
    expect(shortcutFor(key('L', 'KeyL', { ctrl: true, alt: true, shift: true }))).toBe('lockLinked')
    expect(shortcutFor(key('H', 'KeyH', { ctrl: true, alt: true, shift: true }))).toBe('hideLinked')
    // ⌘⌥C on a Mac types ç; the key's place still names it.
    expect(shortcutFor(key('ç', 'KeyC', { meta: true, alt: true }))).toBe('copyStyle')
    expect(shortcutFor(key('l', 'KeyL', { ctrl: true, shift: true }))).toBe('lock')
    expect(pressFor('hideLinked')).toBe('Control+Alt+Shift+KeyH')
    // Copy to other frames ▸ Layer and Delete from all frames are menu items with no key.
    const keysOf = (action: string) => SHORTCUTS.find((s) => s.action === action)?.keys
    expect(keysOf('layerToLinked')).toEqual([])
    expect(keysOf('deleteLinked')).toEqual([])
  })

  it('give Ungroup Ctrl+Backspace too, Back to Free Alt+Shift+A and the Box tool B', () => {
    expect(shortcutFor(key('Backspace', 'Backspace', { ctrl: true }))).toBe('ungroup')
    expect(shortcutFor(key('Backspace', 'Backspace', { meta: true }))).toBe('ungroup')
    expect(shortcutFor(key('G', 'KeyG', { ctrl: true, shift: true }))).toBe('ungroup')
    expect(shortcutFor(key('Backspace', 'Backspace'))).toBe('delete')
    expect(shortcutFor(key('A', 'KeyA', { alt: true, shift: true }))).toBe('layoutFree')
    // ⌥⇧A on a Mac types Å; the key's place still names it.
    expect(shortcutFor(key('Å', 'KeyA', { alt: true, shift: true }))).toBe('layoutFree')
    expect(shortcutFor(key('A', 'KeyA', { shift: true }))).toBe('autoLayout')
    expect(shortcutFor(key('b', 'KeyB'))).toBe('toolBox')
    expect(pressFor('layoutFree')).toBe('Alt+Shift+KeyA')
    expect(pressFor('toolBox')).toBe('KeyB')
  })

  it('give Flip horizontal Shift+H and Flip vertical Shift+V, apart from the Hand’s H and Select’s V, each an undo step named flip', () => {
    expect(shortcutFor(key('H', 'KeyH', { shift: true }))).toBe('flipHorizontal')
    expect(shortcutFor(key('V', 'KeyV', { shift: true }))).toBe('flipVertical')
    expect(shortcutFor(key('h', 'KeyH'))).toBe('toolHand')
    expect(shortcutFor(key('v', 'KeyV'))).toBe('toolSelect')
    expect([stepOf('flipHorizontal'), stepOf('flipVertical')]).toEqual(['flip', 'flip'])
  })

  it('give the text styles Ctrl+B, I and U, and Ctrl+Shift+X for strikethrough, ⌘ on a Mac', () => {
    expect(shortcutFor(key('b', 'KeyB', { ctrl: true }))).toBe('bold')
    expect(shortcutFor(key('i', 'KeyI', { meta: true }))).toBe('italic')
    expect(shortcutFor(key('u', 'KeyU', { ctrl: true }))).toBe('underline')
    expect(shortcutFor(key('X', 'KeyX', { ctrl: true, shift: true }))).toBe('strikethrough')
    // Without Ctrl the letters do their own: I opens Assets.
    expect(shortcutFor(key('i', 'KeyI'))).toBe('assets')
    expect(pressFor('strikethrough')).toBe('Control+Shift+KeyX')
  })

  it('give the booleans FigCraft’s Alt+Shift+U, S, I and E, each an undo step named combine', () => {
    expect(shortcutFor(key('U', 'KeyU', { alt: true, shift: true }))).toBe('booleanUnion')
    expect(shortcutFor(key('S', 'KeyS', { alt: true, shift: true }))).toBe('booleanSubtract')
    expect(shortcutFor(key('I', 'KeyI', { alt: true, shift: true }))).toBe('booleanIntersect')
    expect(shortcutFor(key('E', 'KeyE', { alt: true, shift: true }))).toBe('booleanExclude')
    // ⌥⇧S on a Mac types Í; the key's place still names it.
    expect(shortcutFor(key('Í', 'KeyS', { alt: true, shift: true }))).toBe('booleanSubtract')
    // Ctrl+Alt+U and Ctrl+Alt+X combine nothing; Alt+S alone aligns to the bottom.
    expect(shortcutFor(key('u', 'KeyU', { ctrl: true, alt: true }))).toBeNull()
    expect(shortcutFor(key('x', 'KeyX', { ctrl: true, alt: true }))).toBeNull()
    expect(shortcutFor(key('s', 'KeyS', { alt: true }))).toBe('alignBottom')
    expect((['booleanUnion', 'booleanSubtract', 'booleanIntersect', 'booleanExclude'] as const).map(stepOf)).toEqual([
      'combine',
      'combine',
      'combine',
      'combine',
    ])
    expect(pressFor('booleanExclude')).toBe('Alt+Shift+KeyE')
  })

  it('give Save version Ctrl+Alt+S, ⌘⌥S on a Mac, the page’s and an editing action, and Show versions no key', () => {
    expect(shortcutFor(key('s', 'KeyS', { ctrl: true, alt: true }))).toBe('saveVersion')
    // ⌘⌥S on a Mac types ß; the key's place still names it.
    expect(shortcutFor(key('ß', 'KeyS', { meta: true, alt: true }))).toBe('saveVersion')
    expect(stageShortcutFor(key('s', 'KeyS', { ctrl: true, alt: true }))).toBeNull()
    expect(pressFor('saveVersion')).toBe('Control+Alt+KeyS')
    // It writes no undo step, yet a tab that may only view never offers it.
    expect(stepOf('saveVersion')).toBeNull()
    expect(viewAction('saveVersion')).toBe(false)
    expect(SHORTCUTS.find((s) => s.action === 'showVersions')).toEqual({
      action: 'showVersions',
      keys: [],
      group: 'view',
    })
    expect(viewAction('showVersions')).toBe(true)
    const listed = shortcutsList().flatMap(({ rows }) => rows.map((row) => row.action))
    expect(listed).toContain('saveVersion')
    expect(listed).not.toContain('showVersions')
  })

  it('give picking a colour Shift+I, on one row of the tools, the page’s and never the stage’s, nor a tab that may only view’s', () => {
    expect(shortcutFor(key('I', 'KeyI', { shift: true }))).toBe('pickColour')
    expect(SHORTCUTS.filter((s) => (s.keys as readonly string[]).includes('Shift+I'))).toEqual([
      { action: 'pickColour', keys: ['Shift+I'], group: 'tools' },
    ])
    // The page starts it from a panel's eyedropper, and never while a field or a text takes the key.
    expect(stageShortcutFor(key('I', 'KeyI', { shift: true }))).toBeNull()
    expect(viewAction('pickColour')).toBe(false)
    expect(stepOf('pickColour')).toBeNull()
    // I alone opens Assets.
    expect(shortcutFor(key('i', 'KeyI'))).toBe('assets')
    expect(pressFor('pickColour')).toBe('Shift+KeyI')
  })

  it('give Assets I, in the View group, the page’s and a tab that may only view’s too', () => {
    expect(SHORTCUTS.find((s) => s.action === 'assets')).toEqual({ action: 'assets', keys: ['I'], group: 'view' })
    expect(stageShortcutFor(key('i', 'KeyI'))).toBeNull()
    expect(stepOf('assets')).toBeNull()
    expect(viewAction('assets')).toBe(true)
    expect(pressFor('assets')).toBe('KeyI')
    expect(shortcutsList({ viewOnly: true }).find(({ group }) => group === 'view')?.rows).toContainEqual(
      expect.objectContaining({ action: 'assets' }),
    )
  })

  it('give the arrows with Alt the nudges of the arrows alone, Shift with them the larger step', () => {
    for (const [code, action] of [
      ['ArrowLeft', 'nudgeLeft'],
      ['ArrowRight', 'nudgeRight'],
      ['ArrowUp', 'nudgeUp'],
      ['ArrowDown', 'nudgeDown'],
    ] as const) {
      expect(shortcutFor(key(code, code, { alt: true }))).toBe(action)
      expect(shortcutFor(key(code, code, { alt: true, shift: true }))).toBe(`${action}Far`)
    }
    expect(shortcutFor(key('ArrowLeft', 'ArrowLeft', { alt: true, ctrl: true }))).toBeNull()
  })

  it('give each key one action, the keys kept from the browser too', () => {
    const specs = SHORTCUTS.flatMap((s) => [...s.keys, ...('kept' in s ? s.kept : [])])
    expect(new Set(specs).size).toBe(specs.length)
  })

  it('give copy, cut and paste the keys the browser copies, cuts and pastes with', () => {
    expect(shortcutFor(key('c', 'KeyC', { ctrl: true }))).toBe('copy')
    expect(shortcutFor(key('x', 'KeyX', { meta: true }))).toBe('cut')
    expect(shortcutFor(key('v', 'KeyV', { ctrl: true }))).toBe('paste')
    expect(shortcutFor(key('c', 'KeyC', { ctrl: true, alt: true }))).toBe('copyStyle')
    expect(pressFor('paste')).toBe('Control+KeyV')
  })

  it('open the shortcuts list with ?, by the character typed whatever Shift does to type it, and never with Ctrl or Alt', () => {
    expect(shortcutFor(key('?', 'Slash', { shift: true }))).toBe('shortcuts')
    // A German keyboard types ? with Shift and the key beside 0.
    expect(shortcutFor(key('?', 'Minus', { shift: true }))).toBe('shortcuts')
    expect(shortcutFor(key('?', 'Slash', { ctrl: true, shift: true }))).toBeNull()
    expect(shortcutFor(key('/', 'Slash'))).toBeNull()
    expect(pressFor('shortcuts')).toBe('?')
  })

  it('open Quick actions with Ctrl+K or Ctrl+/, ⌘ on a Mac: K by its place on any layout, / however it is typed', () => {
    expect(shortcutFor(key('k', 'KeyK', { ctrl: true }))).toBe('quickActions')
    expect(shortcutFor(key('k', 'KeyK', { meta: true }))).toBe('quickActions')
    expect(shortcutFor(key('/', 'Slash', { ctrl: true }))).toBe('quickActions')
    // An Arabic keyboard types ن on the K key; a German one types / with Shift and the 7 key.
    expect(shortcutFor(key('ن', 'KeyK', { ctrl: true }))).toBe('quickActions')
    // Dvorak types t on the K key and k on the V key: the letter typed decides on a Latin layout.
    expect(shortcutFor(key('t', 'KeyK', { ctrl: true }))).toBeNull()
    expect(shortcutFor(key('k', 'KeyV', { ctrl: true }))).toBe('quickActions')
    expect(shortcutFor(key('/', 'Digit7', { ctrl: true, shift: true }))).toBe('quickActions')
    // K alone, or with Shift or Alt too, is not it.
    expect(shortcutFor(key('k', 'KeyK'))).toBeNull()
    expect(shortcutFor(key('K', 'KeyK', { ctrl: true, shift: true }))).toBeNull()
    expect(shortcutFor(key('k', 'KeyK', { ctrl: true, alt: true }))).toBeNull()
    expect(pressFor('quickActions')).toBe('Control+KeyK')
    expect(SHORTCUTS.find((s) => s.action === 'quickActions')).toMatchObject({ group: 'view', byPlace: true })
    expect(stepOf('quickActions')).toBeNull()
    expect(viewAction('quickActions')).toBe(true)
  })

  it('leave the keys of copy, copy as PNG, cut, paste, picking a colour, Find and replace, the versions, Assets, the shortcuts list and Quick actions to the page, and give the stage every other action', () => {
    const page = [
      'copy',
      'copyPng',
      'cut',
      'paste',
      'pickColour',
      'findReplace',
      'saveVersion',
      'showVersions',
      'assets',
      'shortcuts',
      'quickActions',
    ]
    expect([...PAGE_ACTIONS]).toEqual(page)
    const taken = SHORTCUTS.flatMap(({ keys }) =>
      keys.map((spec) => [spec, shortcutFor(pressOf(spec)), stageShortcutFor(pressOf(spec))]),
    )
    expect(taken).toEqual(
      SHORTCUTS.flatMap(({ action, keys }) =>
        keys.map((spec) => [spec, action, page.includes(action) ? null : action]),
      ),
    )
    expectTypeOf<
      'copy' | 'copyPng' | 'cut' | 'paste' | 'pickColour' | 'shortcuts' | 'quickActions'
    >().not.toExtend<StageAction>()
    expectTypeOf<'undo' | 'delete'>().toExtend<StageAction>()
  })

  it('put every action in a group of the shortcuts list, and name the undo step of each that writes', () => {
    expect(SHORTCUTS.filter((s) => !SHORTCUT_GROUPS.includes(s.group))).toEqual([])
    expect(SHORTCUTS.flatMap((s) => ('step' in s && !STEP_NAMES.includes(s.step) ? [s.action] : []))).toEqual([])
    expect(stepOf('alignLeft')).toBe('align')
    expect(stepOf('distributeVertical')).toBe('distribute')
    expect(stepOf('duplicate')).toBe('duplicate')
    expect(stepOf('nudgeLeftFar')).toBe('move')
    expect(stepOf('cut')).toBe('cut')
    expect(stepOf('paste')).toBe('paste')
    // Actions that change no design have no step: undo, the view, the tools, the selection.
    for (const action of ['undo', 'redo', 'zoomIn', 'toolPen', 'selectAll', 'copy', 'shortcuts'] as const)
      expect(stepOf(action)).toBeNull()
  })

  it("list each group's actions together, so the table reads in the order the shortcuts list shows", () => {
    const groups = SHORTCUTS.map((s) => s.group).filter((group, i, all) => group !== all[i - 1])
    expect(groups).toEqual([...SHORTCUT_GROUPS])
  })

  it('spell keys the way the test editor presses them', () => {
    expect(pressFor('bringToFront')).toBe('Control+Shift+BracketRight')
    expect(pressFor('lock', 'Meta')).toBe('Meta+Shift+KeyL')
    expect(pressFor('nudgeUpFar')).toBe('Shift+ArrowUp')
  })

  it('give Enter and Shift+Enter going in and out of the layer tree, and Tab and Shift+Tab the layer beside', () => {
    expect(shortcutFor(key('Enter', 'Enter'))).toBe('goIn')
    expect(shortcutFor(key('Enter', 'Enter', { shift: true }))).toBe('goOut')
    expect(shortcutFor(key('Tab', 'Tab'))).toBe('nextLayer')
    expect(shortcutFor(key('Tab', 'Tab', { shift: true }))).toBe('previousLayer')
    // The crop item and Select layer ▸ are menu rows with no key of their own.
    const keysOf = (action: string) => SHORTCUTS.find((s) => s.action === action)?.keys
    expect(keysOf('editPoints')).toEqual([])
    expect(keysOf('selectLayer')).toEqual([])
  })
})

describe('shortcutFor', () => {
  it("reads a key event of the browser's and a key input alike", () => {
    const pressed = { key: 'z', code: 'KeyZ', ctrlKey: true, metaKey: false, shiftKey: false, altKey: false }
    expect(shortcutFor(pressed as KeyboardEvent)).toBe('undo')
    expect(shortcutFor(keyInput('KeyZ', { key: 'z', ctrlKey: true }))).toBe('undo')
    expect(shortcutFor(keyInput('KeyZ', { key: 'z' }))).toBeNull()
  })
})

describe('matchesKey', () => {
  it('matches a letter by the character it types, and with byPlace by its place on any keyboard layout too', () => {
    // Ctrl and the K key type ن on an Arabic keyboard, and ⌘ and it type л on a Russian one.
    const arabic = key('ن', 'KeyK', { ctrl: true })
    const russian = key('л', 'KeyK', { meta: true })
    expect(matchesKey('Mod+K', key('k', 'KeyK', { ctrl: true }))).toBe(true)
    expect(matchesKey('Mod+K', arabic)).toBe(false)
    expect(matchesKey('Mod+K', arabic, { byPlace: true })).toBe(true)
    expect(matchesKey('Mod+K', russian, { byPlace: true })).toBe(true)
    // By its place, still with exactly its modifiers, and only for a letter's key.
    expect(matchesKey('Mod+K', key('ن', 'KeyK'), { byPlace: true })).toBe(false)
    expect(matchesKey('Mod+K', key('ن', 'KeyK', { ctrl: true, shift: true }), { byPlace: true })).toBe(false)
    expect(matchesKey('Mod+K', key('ل', 'KeyG', { ctrl: true }), { byPlace: true })).toBe(false)
    expect(matchesKey('Mod+BracketRight', key('ج', 'BracketRight', { ctrl: true }), { byPlace: true })).toBe(true)
  })

  it('matches by place only when the key types no Latin letter, so a Latin layout keeps its own letters', () => {
    // On Dvorak the K key's place types t and the V key's place types k: Ctrl and the letter typed decides.
    expect(matchesKey('Mod+K', key('t', 'KeyK', { ctrl: true }), { byPlace: true })).toBe(false)
    expect(matchesKey('Mod+K', key('k', 'KeyV', { ctrl: true }), { byPlace: true })).toBe(true)
    // On an Arabic layout the K key types ن, no Latin letter: its place decides.
    expect(matchesKey('Mod+K', key('ن', 'KeyK', { ctrl: true }), { byPlace: true })).toBe(true)
  })

  it('is how the table matches its keys, a row without byPlace matching a letter by its place only with Alt', () => {
    expect(shortcutFor(key('ي', 'KeyD', { ctrl: true }))).toBeNull()
    expect(shortcutFor(key('ش', 'KeyA', { alt: true }))).toBe('alignLeft')
    for (const row of SHORTCUTS)
      for (const spec of row.keys) expect(matchesKey(spec, pressOf(spec)), `${row.action} ${spec}`).toBe(true)
  })
})

describe('keptFromBrowser', () => {
  it('keeps Alt with an arrow, the browser’s Back and Forward, from the browser while the stage has the keys', () => {
    for (const code of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
      expect(keptFromBrowser(keyInput(code, { altKey: true }))).toBe(true)
      expect(keptFromBrowser(keyInput(code, { altKey: true, shiftKey: true }))).toBe(true)
      expect(keptFromBrowser(keyInput(code))).toBe(false)
      expect(keptFromBrowser(keyInput(code, { altKey: true, target: keyTarget({ stage: false }) }))).toBe(false)
    }
    expect(keptFromBrowser(keyInput('KeyA', { key: 'a', altKey: true }))).toBe(false)
  })
})

describe('deepKeyHeld', () => {
  it('says the key that reaches the deepest layer is held: ⌘ on a Mac, Ctrl elsewhere', () => {
    expect(deepKeyHeld({ ctrlKey: true, metaKey: false }, false)).toBe(true)
    expect(deepKeyHeld({ ctrlKey: false, metaKey: true }, false)).toBe(false)
    expect(deepKeyHeld({ ctrlKey: true, metaKey: false }, true)).toBe(false)
    expect(deepKeyHeld({ ctrlKey: false, metaKey: true }, true)).toBe(true)
  })
})

describe('rightClick', () => {
  it('says a press is the right-click: the right button, or on a Mac the left one with Ctrl', () => {
    expect(rightClick({ button: 2, ctrlKey: false }, false)).toBe(true)
    expect(rightClick({ button: 0, ctrlKey: true }, false)).toBe(false)
    expect(rightClick({ button: 0, ctrlKey: true }, true)).toBe(true)
    expect(rightClick({ button: 0, ctrlKey: false }, true)).toBe(false)
  })
})

describe('shortcutsList', () => {
  it('lists every action with a key once, in its group, groups and rows in the table’s order', () => {
    const listed = shortcutsList()
    expect(listed.map(({ group }) => group)).toEqual([...SHORTCUT_GROUPS])
    expect(listed.flatMap(({ rows }) => rows.map((row) => row.action))).toEqual(
      SHORTCUTS.filter((s) => s.keys.length > 0).map((s) => s.action),
    )
    for (const { group, rows } of listed) for (const row of rows) expect(row.group).toBe(group)
  })

  it('shows each nudge by its arrow alone, with Shift for the larger step, and not with Alt', () => {
    const move = shortcutsList().find(({ group }) => group === 'move')
    expect(move?.rows.map(({ action, keys }) => [action, keys])).toEqual([
      ['nudgeLeft', ['ArrowLeft']],
      ['nudgeRight', ['ArrowRight']],
      ['nudgeUp', ['ArrowUp']],
      ['nudgeDown', ['ArrowDown']],
      ['nudgeLeftFar', ['Shift+ArrowLeft']],
      ['nudgeRightFar', ['Shift+ArrowRight']],
      ['nudgeUpFar', ['Shift+ArrowUp']],
      ['nudgeDownFar', ['Shift+ArrowDown']],
    ])
  })

  it('leaves out an action only a menu runs', () => {
    const listed = shortcutsList().flatMap(({ rows }) => rows.map((row) => row.action))
    expect(listed).not.toContain('layerToLinked')
    expect(listed).not.toContain('deleteLinked')
    expect(listed).toEqual(expect.arrayContaining(['copy', 'cut', 'paste', 'shortcuts', 'quickActions']))
  })
})

describe('viewAction', () => {
  it('keeps the actions that only look, select, copy or move the view, and none that writes or edits', () => {
    const kept = SHORTCUTS.filter((s) => viewAction(s.action)).map((s) => s.action)
    expect(kept).toEqual([
      'copy',
      'copyPng',
      'selectAll',
      'selectSameFill',
      'selectSameFont',
      'findReplace',
      'deselect',
      'goIn',
      'goOut',
      'nextLayer',
      'previousLayer',
      'selectLayer',
      'copyStyle',
      'toolSelect',
      'toolHand',
      'selectLinkedCopies',
      'zoomIn',
      'zoomOut',
      'zoomToFit',
      'zoomToSelection',
      'zoomTo100',
      'toggleRulers',
      'toggleHiddenShown',
      'showVersions',
      'assets',
      'quickActions',
      'shortcuts',
    ])
    for (const s of SHORTCUTS) if ('step' in s) expect(viewAction(s.action)).toBe(false)
  })

  it('lists only those actions in the shortcuts list of a tab that may only view', () => {
    const listed = shortcutsList({ viewOnly: true }).flatMap(({ rows }) => rows.map((row) => row.action))
    expect(listed.every(viewAction)).toBe(true)
    expect(listed).toContain('zoomToFit')
    expect(listed).not.toContain('undo')
    expect(listed).not.toContain('toolRect')
  })
})

describe('aimsPaste', () => {
  it('finds Mod and the paste key by its place, with or without Shift, on any keyboard layout', () => {
    expect(aimsPaste(key('v', 'KeyV', { ctrl: true }))).toBe(true)
    expect(aimsPaste(key('V', 'KeyV', { meta: true, shift: true }))).toBe(true)
    // An Arabic layout types ر on the paste key.
    expect(aimsPaste(key('ر', 'KeyV', { ctrl: true, shift: true }))).toBe(true)
    expect(aimsPaste(key('v', 'KeyV'))).toBe(false)
    expect(aimsPaste(key('c', 'KeyC', { ctrl: true }))).toBe(false)
  })
})
