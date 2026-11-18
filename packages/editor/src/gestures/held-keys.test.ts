import { describe, expect, it } from 'vitest'

import { onMac, runAs } from '../test-platform.ts'
import { editorHeldKeys } from './held-keys.ts'
import { keyInput, keyTarget, pointerInput } from './test-inputs.ts'

/** The held keys over a pan that takes no key, logging each redraw asked for, and the keys held each time they are told changed. */
function harness() {
  const log: string[] = []
  const told: string[] = []
  const held = editorHeldKeys({
    view: { redraw: () => log.push('redraw') },
    pan: { keyDown: () => false, keyUp: () => {}, blur: () => {} },
    onMac,
    keysChanged: () => told.push([held.deep() && 'deep', held.alt() && 'alt'].filter(Boolean).join(' ') || 'none'),
  })
  return { held, log, told }
}

describe('editorHeldKeys', () => {
  describe('alt', () => {
    it('measures while Alt is held, asking for a redraw when it is pressed and let go with no pointer move', () => {
      const { held, log } = harness()
      expect(held.alt()).toBe(false)
      held.keyDown(keyInput('AltLeft', { key: 'Alt', altKey: true }))
      expect(held.alt()).toBe(true)
      expect(log).toEqual(['redraw'])
      // The key repeating asks for nothing more.
      held.keyDown(keyInput('AltLeft', { key: 'Alt', altKey: true, repeat: true }))
      expect(log).toEqual(['redraw'])
      held.keyUp(keyInput('AltLeft', { type: 'keyup', key: 'Alt', altKey: false }))
      expect(held.alt()).toBe(false)
      expect(log).toEqual(['redraw', 'redraw'])
    })

    it('stops measuring at once when the window loses the focus', () => {
      const { held, log } = harness()
      held.keyDown(keyInput('AltRight', { key: 'Alt', altKey: true }))
      log.length = 0
      held.blur()
      expect(held.alt()).toBe(false)
      expect(log).toEqual(['redraw'])
    })

    it('follows Alt from a pointer input, saying whether a held key changed', () => {
      runAs(false)
      const { held, log } = harness()
      expect(held.followPointer(pointerInput({ altKey: true }))).toBe(true)
      expect(held.alt()).toBe(true)
      expect(held.followPointer(pointerInput({ altKey: true }))).toBe(false)
      expect(held.followPointer(pointerInput({ altKey: true, ctrlKey: true }))).toBe(true)
      expect(held.deep()).toBe(true)
      expect(held.followPointer(pointerInput())).toBe(true)
      expect(held.alt()).toBe(false)
      expect(held.deep()).toBe(false)
      // The move that follows draws what changed: no redraw is asked for.
      expect(log).toEqual([])
    })
  })

  describe('keysChanged', () => {
    it('is told when a key presses or lets go of Alt, and when the window losing the focus lets go of it', () => {
      const { held, told } = harness()
      held.keyDown(keyInput('AltLeft', { key: 'Alt', altKey: true }))
      held.keyDown(keyInput('AltLeft', { key: 'Alt', altKey: true, repeat: true }))
      held.keyUp(keyInput('AltLeft', { type: 'keyup', key: 'Alt' }))
      held.followKey(keyInput('AltLeft', { key: 'Alt', altKey: true }))
      held.blur()
      expect(told).toEqual(['alt', 'none', 'alt', 'none'])
    })

    it('is told when a key presses or lets go of the deep key, Alt held or not, and not when a pointer input changes a key', () => {
      runAs(false)
      const { held, told } = harness()
      held.keyDown(keyInput('ControlLeft', { key: 'Control', ctrlKey: true }))
      held.keyDown(keyInput('AltLeft', { key: 'Alt', ctrlKey: true, altKey: true }))
      held.keyUp(keyInput('ControlLeft', { type: 'keyup', key: 'Control', altKey: true }))
      held.keyUp(keyInput('AltLeft', { type: 'keyup', key: 'Alt' }))
      expect(held.followPointer(pointerInput({ ctrlKey: true }))).toBe(true)
      held.blur()
      expect(told).toEqual(['deep', 'deep alt', 'alt', 'none', 'none'])
    })
  })

  describe('keyDown and keyUp', () => {
    it('answers Alt pressed and let go as handled while the stage has the keys, so the browser’s menu takes no focus', () => {
      const { held } = harness()
      expect(held.keyDown(keyInput('AltLeft', { key: 'Alt', altKey: true }))).toBe(true)
      expect(held.keyUp(keyInput('AltLeft', { type: 'keyup', key: 'Alt' }))).toBe(true)
      const elsewhere = keyTarget({ stage: false })
      expect(held.keyDown(keyInput('AltLeft', { key: 'Alt', altKey: true, target: elsewhere }))).toBe(false)
      expect(held.keyUp(keyInput('AltLeft', { type: 'keyup', key: 'Alt', target: elsewhere }))).toBe(false)
      // Other keys are not answered for Alt's sake, with Alt held or not.
      expect(held.keyDown(keyInput('KeyA', { altKey: true }))).toBe(false)
      expect(held.keyUp(keyInput('KeyA', { type: 'keyup', altKey: true }))).toBe(false)
    })
  })

  describe('followKey', () => {
    it('follows the held keys from a key pressed, answering Alt as handled while the stage has the keys and leaving Space to the text', () => {
      const log: string[] = []
      const held = editorHeldKeys({
        view: { redraw: () => log.push('redraw') },
        pan: { keyDown: () => log.push('pan') > 0, keyUp: () => {}, blur: () => {} },
        onMac,
        keysChanged: () => {},
      })
      expect(held.followKey(keyInput('AltLeft', { key: 'Alt', altKey: true }))).toBe(true)
      expect(held.alt()).toBe(true)
      expect(held.followKey(keyInput('Space', { key: ' ', altKey: true }))).toBe(false)
      expect(
        held.followKey(keyInput('AltLeft', { key: 'Alt', altKey: true, target: keyTarget({ stage: false }) })),
      ).toBe(false)
      expect(log).toEqual(['redraw'])
    })
  })
})
