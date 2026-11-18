import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { Design } from '@dazbee/schema'

import { firstKeyOf, keyLabel, keyOf, keysOf } from './shortcut-keys.ts'

/** The app's root, apps/web. */
const APP = join(import.meta.dirname, '..', '..')
/** What spells a key by hand: the key formatter given a literal, a key named in a tooltip, a menu row or a key test. */
const SPELLED = [
  /\bkey(?:Label|sOf)\(\s*['"`]/,
  /withShortcut\([^)]*,\s*['"`]/,
  /\bkey:\s*['"][A-Z0-9?]['"]/,
  /· [A-Z0-9?]`/,
  /\((?:\?|Ctrl\+|⌘)[^)]*\)['"]/,
  /\.key\s*[!=]==\s*['"][?A-Za-z]['"]/,
]

/** A rect's props with an image fill: a photo's. */
const PHOTO = { shape: { kind: 'rect' }, fills: [{ type: 'image', assetId: 'a1' }] }
/** One frame holding a photo, and a photo box holding a rect. */
const DESIGN = {
  pages: { p1: { name: 'One' } },
  frames: { f1: { pageId: 'p1' } },
  nodes: {
    photo: { type: 'graphic', parentId: 'f1', index: 'a0', props: PHOTO },
    framed: { type: 'box', parentId: 'f1', index: 'a1', props: { fills: PHOTO.fills } },
    inFramed: { type: 'graphic', parentId: 'framed', index: 'a0', props: { shape: { kind: 'rect' } } },
  },
} as unknown as Design

/** The app's source files, its tests and what Next.js builds left out, with their paths from the app's root. */
function sourceFiles(dir = APP): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return ['node_modules', '.next', 'public'].includes(entry.name) ? [] : sourceFiles(path)
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [relative(APP, path)] : []
  })
}

describe('keyOf', () => {
  it("spells an action's first shortcut, and nothing for an action only a menu runs", () => {
    expect(keyOf('zoomIn', undefined, false)).toBe('Ctrl+=')
    expect(keyOf('bringToFront', undefined, true)).toBe('⌘+⇧+]')
    expect(keyOf('zoomToFit', undefined, false)).toBe('Shift+1')
    expect(keyOf('deleteLinked', undefined, false)).toBe('')
  })

  it('spells Enter for the Crop item on a photo holding no layers, which Enter crops, and nothing on a photo box holding layers, which Enter goes into', () => {
    expect(keyOf('editPoints', { design: DESIGN, ids: ['photo'] }, false)).toBe('Enter')
    expect(keyOf('editPoints', { design: DESIGN, ids: ['framed'] }, false)).toBe('')
    expect(keyOf('editPoints', undefined, false)).toBe('')
  })

  it('spells its own shortcut for an action that has one, whatever is selected', () => {
    expect(keyOf('group', { design: DESIGN, ids: ['photo'] }, false)).toBe('Ctrl+G')
    expect(keyOf('duplicate', { design: DESIGN, ids: ['framed'] }, true)).toBe('⌘+D')
  })
})

describe('firstKeyOf', () => {
  it('gives the first shortcut as the table spells it, Enter where Enter runs a keyless action, and nothing else', () => {
    expect(firstKeyOf('zoomIn')).toBe('Mod+Equal')
    expect(firstKeyOf('group', { design: DESIGN, ids: ['photo'] })).toBe('Mod+G')
    expect(firstKeyOf('editPoints', { design: DESIGN, ids: ['photo'] })).toBe('Enter')
    expect(firstKeyOf('editPoints', { design: DESIGN, ids: ['framed'] })).toBeUndefined()
    expect(firstKeyOf('deleteLinked')).toBeUndefined()
  })
})

describe('keyLabel', () => {
  it('joins the keys of a shortcut with +, as this computer names them', () => {
    expect(keyLabel('Mod+C', false)).toBe('Ctrl+C')
    expect(keyLabel('Mod+C', true)).toBe('⌘+C')
  })
})

describe('keysOf', () => {
  it('names the modifiers as the computer does: Ctrl Alt Shift, or ⌘ ⌥ ⇧ on a Mac', () => {
    expect(keysOf('Mod+Alt+Shift+H', false)).toEqual(['Ctrl', 'Alt', 'Shift', 'H'])
    expect(keysOf('Mod+Alt+Shift+H', true)).toEqual(['⌘', '⌥', '⇧', 'H'])
  })

  it('names keys spelled by their code as they are printed on them', () => {
    expect(keysOf('Mod+BracketLeft', false)).toEqual(['Ctrl', '['])
    expect(keysOf('Mod+Minus', false)).toEqual(['Ctrl', '-'])
    expect(keysOf('Shift+Digit0', false)).toEqual(['Shift', '0'])
    expect(keysOf('Shift+ArrowLeft', false)).toEqual(['Shift', '←'])
    expect(keysOf('Backspace', false)).toEqual(['⌫'])
  })
})

describe('the app', () => {
  it('spells a key only here, reading it from the shortcut table everywhere else', () => {
    const spelled = sourceFiles()
      .filter((file) => file !== join('lib', 'editor', 'shortcut-keys.ts'))
      .flatMap((file) =>
        readFileSync(join(APP, file), 'utf8')
          .split('\n')
          .flatMap((line, i) =>
            SPELLED.some((pattern) => pattern.test(line)) ? [`${file}:${i + 1}: ${line.trim()}`] : [],
          ),
      )
    expect(spelled).toEqual([])
  })
})
