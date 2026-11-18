import { describe, expect, it } from 'vitest'

import { keyInput } from './test-inputs.ts'
import { event, harness, SQUARE } from './test-pointer.ts'

const ALT = { altKey: true }

describe('editorStageCursor', () => {
  describe('onCursor', () => {
    it('tells its listeners the cursor only when it changes', () => {
      const { pointer, send, told } = harness('hand')
      pointer.showCursor()
      pointer.showCursor()
      send('pointerdown', event(10, 10))
      send('pointermove', event(40, 30))
      send('pointermove', event(50, 40))
      send('pointerup', event(50, 40))
      expect(told()).toEqual(['grab', 'grabbing', 'grab'])
    })
  })

  describe('the copy cursor', () => {
    it('shows with Alt held where a press would move the selection, as Alt is pressed and let go with the pointer still', () => {
      const { pointer, send, selection, cursor } = harness()
      send('pointermove', event(10, 10, ALT))
      expect(cursor()).toBe('')
      selection.select(['sel'], SQUARE.id)
      send('pointermove', event(11, 10, ALT))
      expect(cursor()).toBe('copy')
      send('pointermove', event(600, 10, ALT))
      expect(cursor()).toBe('')
      send('pointermove', event(10, 10))
      expect(cursor()).toBe('')
      pointer.keyDown(keyInput('AltLeft', { key: 'Alt', altKey: true }))
      expect(cursor()).toBe('copy')
      pointer.keyUp(keyInput('AltLeft', { type: 'keyup', key: 'Alt' }))
      expect(cursor()).toBe('')
    })

    it('shows from the press to the release of a move with Alt held, and as Alt changes during it', () => {
      const { pointer, send, cursor } = harness()
      send('pointerdown', event(10, 10, ALT))
      expect(cursor()).toBe('copy')
      send('pointermove', event(40, 10, ALT))
      expect(cursor()).toBe('copy')
      pointer.keyUp(keyInput('AltLeft', { type: 'keyup', key: 'Alt' }))
      expect(cursor()).toBe('')
      send('pointermove', event(45, 10, ALT))
      expect(cursor()).toBe('copy')
      send('pointerup', event(45, 10))
      expect(cursor()).toBe('')
    })

    it('shows none through a resize or a marquee held with Alt: a resize keeps its handle’s', () => {
      const resize = harness('select', undefined, true)
      resize.selection.select(['sel'], SQUARE.id)
      resize.pressAs('resize')
      resize.send('pointermove', event(10, 10, ALT))
      resize.send('pointerdown', event(10, 10, ALT))
      resize.send('pointermove', event(40, 10, ALT))
      expect(resize.cursor()).toBe('ns-resize')
      const marquee = harness()
      marquee.pressAs('marquee')
      marquee.send('pointermove', event(10, 10, ALT))
      marquee.send('pointerdown', event(10, 10, ALT))
      marquee.send('pointermove', event(40, 10, ALT))
      expect(marquee.cursor()).toBe('')
    })

    it('leaves a handle its own cursor, and shows none while typing, and another tool’s own', () => {
      const onHandle = harness('select', undefined, true)
      onHandle.selection.select(['sel'], SQUARE.id)
      onHandle.send('pointermove', event(10, 10, ALT))
      expect(onHandle.cursor()).toBe('ns-resize')
      const typing = harness('select', undefined, false, 'words')
      typing.selection.select(['sel'], SQUARE.id)
      typing.send('pointermove', event(10, 10, ALT))
      expect(typing.cursor()).toBe('')
      const hand = harness('hand')
      hand.selection.select(['sel'], SQUARE.id)
      hand.send('pointermove', event(10, 10, ALT))
      expect(hand.cursor()).toBe('grab')
    })
  })
})
