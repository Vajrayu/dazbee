import { describe, expect, it } from 'vitest'

import { pairsIn } from '../selection.ts'
import { keyInput } from './test-inputs.ts'
import { event, harness, SQUARE } from './test-pointer.ts'

const ALT = { altKey: true }
const altDown = keyInput('AltLeft', { key: 'Alt', altKey: true })
const altUp = keyInput('AltLeft', { type: 'keyup', key: 'Alt' })

describe('editorPointer', () => {
  describe('Alt during a move', () => {
    it('tells the move held when a key presses or lets go of Alt, and nothing with no move held', () => {
      const { pointer, send, log } = harness()
      pointer.keyDown(altDown)
      pointer.keyUp(altUp)
      expect(log.filter((line) => line.startsWith('alt'))).toEqual([])
      send('pointerdown', event(10, 10))
      send('pointermove', event(40, 10))
      pointer.keyDown(altDown)
      pointer.keyDown({ ...altDown, repeat: true })
      pointer.keyUp(altUp)
      expect(log.filter((line) => line.startsWith('alt'))).toEqual(['alt down', 'alt up'])
    })

    it('tells the move Alt is let go when the window loses the focus', () => {
      const { pointer, send, log } = harness()
      send('pointerdown', event(10, 10, ALT))
      send('pointermove', event(40, 10, ALT))
      pointer.blur()
      expect(log.filter((line) => line.startsWith('alt'))).toEqual(['alt up'])
    })

    it('follows Alt from the press and its moves, so a key letting go of Alt held before the window had the focus is heard', () => {
      const { pointer, send, log } = harness()
      send('pointerdown', event(10, 10, ALT))
      pointer.keyUp(altUp)
      send('pointermove', event(40, 10))
      send('pointermove', event(50, 10, ALT))
      pointer.keyUp(altUp)
      expect(log.filter((line) => line.startsWith('alt'))).toEqual(['alt up', 'alt up'])
    })

    it('tells the move, before it ends, of Alt changed by the release itself', () => {
      const { send, log } = harness()
      send('pointerdown', event(10, 10))
      send('pointermove', event(40, 10))
      send('pointerup', event(40, 10, ALT))
      const told = log.filter((line) => line.startsWith('alt') || line === 'release move')
      expect(told).toEqual(['alt down', 'release move'])
    })

    it('drops a move whose copies are where their originals are, as Escape does, the originals selected as they were', () => {
      const { pointer, send, log, selection, copiesUnmovedFor } = harness()
      selection.select(['found'], SQUARE.id)
      send('pointerdown', event(10, 10, ALT))
      send('pointermove', event(12, 10, ALT))
      selection.select(['original'], SQUARE.id)
      copiesUnmovedFor(selection.held())
      selection.select(['copy'], SQUARE.id)
      send('pointerup', event(12, 10, ALT))
      expect(log).toContain('cancel step')
      expect(log).not.toContain('release move')
      expect(pointer.gesture()).toBeNull()
      expect(selection.current()).toEqual(pairsIn(SQUARE.id, ['original']))
    })
  })
})
