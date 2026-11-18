import { describe, expect, it } from 'vitest'

import { keyInput, keyTarget } from './gestures/test-inputs.ts'
import { editorKeys, type KeysDeps } from './keys.ts'
import type { StageAction } from './shortcuts.ts'

/** What an action that throws throws. */
const thrown = new Error('the command could not be applied')
/** The text style keys, each with the action it runs: Ctrl+B, Ctrl+I, Ctrl+U and Ctrl+Shift+X. */
const STYLE_KEYS = [
  ['bold', keyInput('KeyB', { key: 'b', ctrlKey: true })],
  ['italic', keyInput('KeyI', { key: 'i', ctrlKey: true })],
  ['underline', keyInput('KeyU', { key: 'u', ctrlKey: true })],
  ['strikethrough', keyInput('KeyX', { key: 'X', ctrlKey: true, shiftKey: true })],
] as const

/**
 * The keys over a pointer that takes Space pressed, and Alt pressed while typing and let go, typing that takes single characters while `editing`, and
 * actions that all run but `refused` and throw `thrown` for those in `throwing`; each logs what it is asked.
 */
function harness({ editing = false, refused = [] as StageAction[], throwing = [] as StageAction[] } = {}) {
  const log: string[] = []
  const deps: KeysDeps = {
    place: { aimPaste: (atPointer) => log.push(`aim paste${atPointer ? ' at the pointer' : ''}`) },
    typing: {
      editing: () => (editing ? { id: 'words', frameId: 'sq' } : null),
      key: (e) => {
        log.push(`type ${e.key}`)
        return e.key.length === 1
      },
    },
    pointer: {
      keyDown: (e) => {
        log.push(`pointer down ${e.code}`)
        return e.code === 'Space'
      },
      keyUp: (e) => {
        log.push(`pointer up ${e.code}`)
        return e.key === 'Alt'
      },
      followKey: (e) => {
        log.push(`pointer follows ${e.code}`)
        return e.key === 'Alt'
      },
    },
    // No guide picked: every key goes on to the shortcuts.
    guideDrag: { key: () => false },
    perform: (action) => {
      log.push(`perform ${action}`)
      if (throwing.includes(action)) throw thrown
      return !refused.includes(action)
    },
  }
  return { keys: editorKeys(deps), log }
}

describe('editorKeys', () => {
  describe('key', () => {
    it('gives a key let go to the pointer, wherever it was let go, and answers it was not its own', () => {
      const { keys, log } = harness()
      const up = keyInput('Space', { type: 'keyup', target: keyTarget({ field: true, stage: false }) })
      expect(keys.key(up)).toEqual({ handled: false })
      expect(log).toEqual(['pointer up Space'])
    })

    it('answers a key let go as its own when the pointer takes it', () => {
      const { keys } = harness()
      expect(keys.key(keyInput('AltLeft', { type: 'keyup', key: 'Alt' }))).toEqual({ handled: true })
    })

    it('leaves a key pressed in a field to the field, undo and Space too', () => {
      const { keys, log } = harness()
      const field = keyTarget({ field: true, stage: false })
      expect(keys.key(keyInput('KeyZ', { key: 'z', ctrlKey: true, target: field }))).toEqual({ handled: false })
      expect(keys.key(keyInput('Space', { key: ' ', target: field }))).toEqual({ handled: false })
      expect(log).toEqual([])
    })

    it('leaves the style keys pressed in a field to the field, running no style', () => {
      const { keys, log } = harness()
      const field = keyTarget({ field: true, stage: false })
      for (const [action, pressed] of STYLE_KEYS)
        expect(keys.key({ ...pressed, target: field }), action).toEqual({ handled: false })
      expect(log).toEqual([])
    })

    it('notes whether Shift is down with Ctrl or ⌘ and V, for the paste that follows', () => {
      const { keys, log } = harness()
      keys.key(keyInput('KeyV', { key: 'v', ctrlKey: true }))
      keys.key(keyInput('KeyV', { key: 'V', metaKey: true, shiftKey: true }))
      expect(log.filter((line) => line.startsWith('aim'))).toEqual(['aim paste', 'aim paste at the pointer'])
    })

    it('undoes and redoes from anywhere but a field, in a dialog and while typing too, as its own key', () => {
      for (const target of [
        keyTarget(),
        keyTarget({ dialog: 'modal', stage: false }),
        keyTarget({ toolbarArrow: true }),
      ]) {
        const { keys, log } = harness({ editing: true })
        expect(keys.key(keyInput('KeyZ', { key: 'z', ctrlKey: true, target }))).toEqual({ handled: true })
        expect(keys.key(keyInput('KeyZ', { key: 'Z', ctrlKey: true, shiftKey: true, target }))).toEqual({
          handled: true,
        })
        expect(log).toEqual(['perform undo', 'perform redo'])
      }
    })

    it('leaves the keys pressed in a modal dialog, a popover or a menu to it', () => {
      const { keys, log } = harness()
      const target = keyTarget({ dialog: 'modal', stage: false })
      expect(keys.key(keyInput('Space', { key: ' ', target }))).toEqual({ handled: false })
      expect(keys.key(keyInput('Escape', { target }))).toEqual({ handled: false })
      expect(keys.key(keyInput('KeyR', { key: 'r', target }))).toEqual({ handled: false })
      expect(log).toEqual([])
    })

    it("gives the keys pressed in a dialog that is not modal to the pointer alone, whose Space is the editor's", () => {
      const { keys, log } = harness()
      const target = keyTarget({ dialog: 'modeless', stage: false })
      expect(keys.key(keyInput('Space', { key: ' ', target }))).toEqual({ handled: true })
      expect(keys.key(keyInput('KeyR', { key: 'r', target }))).toEqual({ handled: false })
      expect(log).toEqual(['pointer down Space', 'pointer down KeyR'])
    })

    it('leaves an arrow in a toolbar and Enter on a button to them, and Tab to the page unless the stage has the keys', () => {
      const { keys, log } = harness()
      expect(keys.key(keyInput('ArrowLeft', { target: keyTarget({ toolbarArrow: true, stage: false }) }))).toEqual({
        handled: false,
      })
      expect(keys.key(keyInput('Enter', { target: keyTarget({ buttonEnter: true, stage: false }) }))).toEqual({
        handled: false,
      })
      const elsewhere = keyTarget({ stage: false })
      expect(keys.key(keyInput('Tab', { target: elsewhere }))).toEqual({ handled: false })
      expect(keys.key(keyInput('Tab', { shiftKey: true, target: elsewhere }))).toEqual({ handled: false })
      expect(log).toEqual([])
      expect(keys.key(keyInput('Tab'))).toEqual({ handled: true })
      expect(keys.key(keyInput('Tab', { shiftKey: true }))).toEqual({ handled: true })
      expect(log).toEqual(['pointer down Tab', 'perform nextLayer', 'pointer down Tab', 'perform previousLayer'])
    })

    it("runs a style key as the editor's own whatever is selected, typing or not, and off the stage too", () => {
      for (const editing of [false, true]) {
        const { keys, log } = harness({ editing, refused: ['bold'] })
        const pressed = keyInput('KeyB', { key: 'b', ctrlKey: true, target: keyTarget({ stage: false }) })
        expect(keys.key(pressed)).toEqual({ handled: true })
        expect(log).toEqual(['perform bold'])
      }
    })

    it("answers every style key as the editor's own with no text layer to style, the action refused", () => {
      const { keys, log } = harness({ refused: STYLE_KEYS.map(([action]) => action) })
      for (const [action, pressed] of STYLE_KEYS) expect(keys.key(pressed), action).toEqual({ handled: true })
      expect(log).toEqual(STYLE_KEYS.map(([action]) => `perform ${action}`))
    })

    it('answers that undo, redo and a style key are its own when their action throws, giving back what it threw', () => {
      const { keys, log } = harness({ throwing: ['undo', 'redo', 'bold'] })
      expect(keys.key(keyInput('KeyZ', { key: 'z', ctrlKey: true }))).toEqual({ handled: true, thrown })
      expect(keys.key(keyInput('KeyY', { key: 'y', ctrlKey: true }))).toEqual({ handled: true, thrown })
      expect(keys.key(keyInput('KeyB', { key: 'b', ctrlKey: true }))).toEqual({ handled: true, thrown })
      expect(log).toEqual(['perform undo', 'perform redo', 'perform bold'])
    })

    it("asks the pointer first, then runs the key's action, its own key only when the action ran", () => {
      const { keys, log } = harness({ refused: ['delete'] })
      expect(keys.key(keyInput('Space', { key: ' ' }))).toEqual({ handled: true })
      expect(keys.key(keyInput('KeyR', { key: 'r' }))).toEqual({ handled: true })
      expect(keys.key(keyInput('Delete'))).toEqual({ handled: false })
      expect(keys.key(keyInput('F5'))).toEqual({ handled: false })
      expect(log).toEqual([
        'pointer down Space',
        'pointer down KeyR',
        'perform toolRect',
        'pointer down Delete',
        'perform delete',
        'pointer down F5',
      ])
    })

    it('nudges with Alt and an arrow, as with the arrow alone, and further with Shift, as its own key', () => {
      const { keys, log } = harness()
      for (const [code, action] of [
        ['ArrowLeft', 'nudgeLeft'],
        ['ArrowRight', 'nudgeRight'],
        ['ArrowUp', 'nudgeUp'],
        ['ArrowDown', 'nudgeDown'],
      ] as const) {
        log.length = 0
        expect(keys.key(keyInput(code, { altKey: true }))).toEqual({ handled: true })
        expect(keys.key(keyInput(code, { altKey: true, shiftKey: true }))).toEqual({ handled: true })
        expect(log).toEqual([
          `pointer down ${code}`,
          `perform ${action}`,
          `pointer down ${code}`,
          `perform ${action}Far`,
        ])
      }
    })

    it('answers Alt with an arrow as its own key while the stage has the keys, with nothing to nudge too', () => {
      const nudges = ['nudgeLeft', 'nudgeRight', 'nudgeUp', 'nudgeDown'] as const
      const { keys } = harness({ refused: [...nudges, ...nudges.map((n) => `${n}Far` as const)] })
      for (const code of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
        expect(keys.key(keyInput(code, { altKey: true }))).toEqual({ handled: true })
        expect(keys.key(keyInput(code, { altKey: true, shiftKey: true }))).toEqual({ handled: true })
        // The arrow alone with nothing to nudge is not the editor's, nor Alt with one off the stage.
        expect(keys.key(keyInput(code))).toEqual({ handled: false })
        expect(keys.key(keyInput(code, { altKey: true, target: keyTarget({ stage: false }) }))).toEqual({
          handled: false,
        })
      }
    })

    it('leaves Alt with an arrow in a field to the field', () => {
      const { keys, log } = harness()
      const field = keyTarget({ field: true, stage: false })
      expect(keys.key(keyInput('ArrowLeft', { altKey: true, target: field }))).toEqual({ handled: false })
      expect(keys.key(keyInput('ArrowRight', { altKey: true, shiftKey: true, target: field }))).toEqual({
        handled: false,
      })
      expect(log).toEqual([])
    })

    it("leaves the keys of copy, cut, paste, the shortcuts list and Quick actions to the page: no action runs and none is the editor's", () => {
      const { keys, log } = harness()
      expect(keys.key(keyInput('KeyC', { key: 'c', ctrlKey: true }))).toEqual({ handled: false })
      expect(keys.key(keyInput('KeyX', { key: 'x', metaKey: true }))).toEqual({ handled: false })
      expect(keys.key(keyInput('KeyV', { key: 'v', ctrlKey: true }))).toEqual({ handled: false })
      expect(keys.key(keyInput('Slash', { key: '?', shiftKey: true }))).toEqual({ handled: false })
      expect(keys.key(keyInput('KeyK', { key: 'k', ctrlKey: true }))).toEqual({ handled: false })
      expect(keys.key(keyInput('Slash', { key: '/', metaKey: true }))).toEqual({ handled: false })
      expect(log).toEqual([
        'pointer down KeyC',
        'pointer down KeyX',
        'aim paste',
        'pointer down KeyV',
        'pointer down Slash',
        'pointer down KeyK',
        'pointer down Slash',
      ])
    })

    it('answers Duplicate as its own key on the stage even when there was nothing to duplicate, so the browser never takes it', () => {
      const { keys, log } = harness({ refused: ['duplicate'] })
      expect(keys.key(keyInput('KeyD', { key: 'd', ctrlKey: true }))).toEqual({ handled: true })
      expect(log).toEqual(['perform duplicate'])
    })

    it('answers Duplicate as its own key while a text is typed in, and copies nothing nor types', () => {
      const { keys, log } = harness({ editing: true })
      expect(keys.key(keyInput('KeyD', { key: 'd', ctrlKey: true }))).toEqual({ handled: true })
      expect(log).toEqual([])
    })

    it('gives the other keys to the text being typed in, the held keys followed, Space to no pan and none to an action', () => {
      const { keys, log } = harness({ editing: true })
      expect(keys.key(keyInput('KeyR', { key: 'r' }))).toEqual({ handled: true })
      expect(keys.key(keyInput('Space', { key: ' ' }))).toEqual({ handled: true })
      expect(keys.key(keyInput('F5'))).toEqual({ handled: false })
      expect(log).toEqual([
        'pointer follows KeyR',
        'type r',
        'pointer follows Space',
        'type  ',
        'pointer follows F5',
        'type F5',
      ])
    })

    it('answers Alt pressed and let go while a text is typed in as its own key, typing nothing for it', () => {
      const { keys, log } = harness({ editing: true })
      expect(keys.key(keyInput('AltLeft', { key: 'Alt', altKey: true }))).toEqual({ handled: true })
      expect(keys.key(keyInput('AltLeft', { type: 'keyup', key: 'Alt' }))).toEqual({ handled: true })
      expect(log).toEqual(['pointer follows AltLeft', 'pointer up AltLeft'])
    })
  })
})
