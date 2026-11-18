import { describe, expect, it } from 'vitest'

import { idsOf } from '../selection.ts'
import { runAs } from '../test-platform.ts'
import type { MoveDrag } from './select/move-drag.ts'
import { keyInput, keyTarget } from './test-inputs.ts'
import { event, harness, SQUARE } from './test-pointer.ts'

describe('editorPointer', () => {
  describe('keyDown, keyUp and blur', () => {
    it('cancels the drag held with Escape through its own step, with no drop and no click, the selection as the press found it', () => {
      const { pointer, send, log, selection } = harness()
      selection.select(['before'], SQUARE.id)
      selection.enter('outer')
      send('pointerdown', event(10, 10))
      // The press picks another layer, as a press on one not selected does.
      selection.select(['pressed'], SQUARE.id)
      send('pointermove', event(30, 12))
      const drag = pointer.gesture() as MoveDrag
      drag.drop = { boxId: 'row', around: [], slot: 0, near: null }
      log.length = 0
      expect(pointer.cancelOnEscape(keyInput('Escape'))).toBe(true)
      expect(pointer.gesture()).toBeNull()
      expect(log).toEqual(['cancel step', 'cancel press', 'redraw', 'shown changed'])
      expect(idsOf(selection.current())).toEqual(['before'])
      expect(selection.entered()).toBe('outer')
      log.length = 0
      send('pointermove', event(60, 12))
      send('pointerup')
      expect(log).not.toContain('release move')
      expect(log).not.toContain('release move into a flow')
      // With nothing held, Escape is the page's: it deselects.
      expect(pointer.cancelOnEscape(keyInput('Escape'))).toBe(false)
    })

    it('drops the drag held when asked, as Escape does, so the moves after it reach no drag', () => {
      const { pointer, send, log, selection } = harness()
      selection.select(['before'], SQUARE.id)
      send('pointerdown', event(10, 10))
      selection.select(['pressed'], SQUARE.id)
      send('pointermove', event(30, 12))
      log.length = 0
      pointer.dropDrag()
      expect(pointer.gesture()).toBeNull()
      expect(log).toEqual(['cancel step', 'cancel press', 'redraw', 'shown changed'])
      expect(idsOf(selection.current())).toEqual(['before'])
      log.length = 0
      send('pointermove', event(60, 12))
      send('pointerup')
      expect(log.filter((line) => line.startsWith('drag') || line.startsWith('release move'))).toEqual([])
      // With nothing held, there is nothing to drop.
      log.length = 0
      pointer.dropDrag()
      expect(log).toEqual([])
    })

    it("cancels a drag that holds no step with Escape, cancelling no one else's, and gives back a frame the press picked", () => {
      const { pointer, send, log, selection } = harness()
      selection.pickFrame(SQUARE.id)
      // A press on the label picks the frame again; before the pointer goes far, the move holds no step.
      send('pointerdown', event(10, -10))
      selection.select(['pressed'], SQUARE.id)
      log.length = 0
      expect(pointer.cancelOnEscape(keyInput('Escape'))).toBe(true)
      expect(log).not.toContain('cancel step')
      expect(selection.current()).toBeNull()
      expect(selection.pickedFrame()).toBe(SQUARE.id)
    })

    it('holds space to pan with a drag, until it is let go or the window loses focus', () => {
      runAs(false)
      const { pointer, send, log, cursor } = harness()
      expect(pointer.keyDown(keyInput('KeyA'))).toBe(false)
      expect(pointer.keyDown(keyInput('Space', { ctrlKey: true }))).toBe(false)
      expect(pointer.keyDown(keyInput('Space'))).toBe(true)
      expect(cursor()).toBe('grab')
      send('pointerdown', event(10, 10))
      expect(cursor()).toBe('grabbing')
      send('pointermove', event(30, 25))
      send('pointerup')
      expect(cursor()).toBe('grab')
      pointer.keyUp(keyInput('KeyA'))
      expect(cursor()).toBe('grab')
      pointer.keyUp(keyInput('Space'))
      expect(cursor()).toBe('')
      pointer.keyDown(keyInput('Space'))
      pointer.blur()
      expect(cursor()).toBe('')
      // Ctrl held with Space and let go asks for a redraw each, which outlines what Ctrl reaches.
      expect(log).toEqual(['redraw', 'redraw', 'camera 20 15', 'release press', 'shown changed'])
    })

    it('on a Mac starts no pan from a press with Ctrl while space is held', () => {
      runAs(true)
      const { pointer, send, log, cursor } = harness()
      pointer.keyDown(keyInput('Space'))
      send('pointerdown', event(10, 10, { ctrlKey: true }))
      send('pointermove', event(40, 30, { ctrlKey: true }))
      expect(cursor()).toBe('grab')
      expect(pointer.gesture()).toBeNull()
      expect(log.filter((line) => line.startsWith('camera'))).toEqual([])
    })

    it('leaves space to a field, and to a control the keys moved the focus to, which it presses', () => {
      const { pointer, log, cursor } = harness()
      expect(pointer.keyDown(keyInput('Space', { target: keyTarget({ field: true }) }))).toBe(false)
      expect(pointer.keyDown(keyInput('Space', { target: keyTarget({ control: true }) }))).toBe(false)
      expect(cursor()).toBe('')
      expect(log).toEqual([])
    })

    it('pans with space from the edit panel, a dialog that is not modal and no control', () => {
      const { pointer, cursor } = harness()
      expect(pointer.keyDown(keyInput('Space', { target: keyTarget({ dialog: 'modeless', stage: false }) }))).toBe(true)
      expect(cursor()).toBe('grab')
    })
  })
})
