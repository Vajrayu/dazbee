import { describe, expect, it } from 'vitest'

import { runAs } from '../test-platform.ts'
import { keyInput } from './test-inputs.ts'
import { event, harness, SQUARE } from './test-pointer.ts'

const ALT = { altKey: true }
const FRAME_BOX = { x: 0, y: 0, width: SQUARE.width, height: SQUARE.height }

describe('editorPointer', () => {
  describe('measured', () => {
    it('measures from the selection to the layer under the pointer while Alt is held', () => {
      const { pointer, send, selection } = harness()
      selection.select(['sel'], SQUARE.id)
      send('pointermove', event(5, 6))
      expect(pointer.measured()).toBeNull()
      send('pointermove', event(5, 6, ALT))
      expect(pointer.measured()).toEqual({
        frame: SQUARE,
        from: { x: 200, y: 300, width: 40, height: 20 },
        to: { x: 0, y: 0, width: 100, height: 100 },
      })
    })

    it('measures to the deepest layer there with the deep key held as well', () => {
      runAs(false)
      const { pointer, send, selection } = harness()
      selection.select(['sel'], SQUARE.id)
      send('pointermove', event(5, 6, { altKey: true, ctrlKey: true }))
      expect(pointer.measured()?.to).toEqual({ x: 10, y: 10, width: 20, height: 20 })
    })

    it('measures to the frame over the selection itself and over empty space of its frame', () => {
      const { pointer, send, selection } = harness()
      selection.select(['under picked'], SQUARE.id)
      send('pointermove', event(5, 6, ALT))
      expect(pointer.measured()?.to).toEqual(FRAME_BOX)
      send('pointermove', event(500, 600, ALT))
      expect(pointer.measured()?.to).toEqual(FRAME_BOX)
    })

    it('measures to the group or box the selection is in, over it or empty space', () => {
      const nodes = { sel: { type: 'graphic', parentId: 'group' }, group: { type: 'group', parentId: SQUARE.id } }
      const { pointer, send, selection } = harness('select', undefined, false, null, nodes)
      selection.select(['sel'], SQUARE.id)
      send('pointermove', event(500, 600, ALT))
      expect(pointer.measured()?.to).toEqual({ x: 150, y: 250, width: 400, height: 200 })
    })

    it('measures from the box round turned layers as drawn, and round several selected', () => {
      const { pointer, send, selection } = harness()
      selection.select(['turned'], SQUARE.id)
      send('pointermove', event(5, 6, ALT))
      const half = 20 * Math.SQRT2
      const from = pointer.measured()?.from
      expect(from?.x).toBeCloseTo(220 - half)
      expect(from?.width).toBeCloseTo(2 * half)
      selection.select(['sel', 'other'], SQUARE.id)
      send('pointermove', event(5, 7, ALT))
      expect(pointer.measured()?.from).toEqual({ x: 200, y: 300, width: 240, height: 20 })
    })

    it('shows the lines when Alt is pressed with no pointer move, and clears them when it is let go or the window loses the focus', () => {
      const { pointer, send, selection, log } = harness()
      selection.select(['sel'], SQUARE.id)
      send('pointermove', event(5, 6))
      log.length = 0
      pointer.keyDown(keyInput('AltLeft', { key: 'Alt', altKey: true }))
      expect(log).toEqual(['redraw'])
      expect(pointer.measured()).not.toBeNull()
      pointer.keyUp(keyInput('AltLeft', { type: 'keyup', key: 'Alt' }))
      expect(pointer.measured()).toBeNull()
      pointer.keyDown(keyInput('AltLeft', { key: 'Alt', altKey: true }))
      pointer.blur()
      expect(pointer.measured()).toBeNull()
    })

    it('tells that what is shown changed on each move while measuring, and when the pointer leaves', () => {
      const { send, selection, log } = harness()
      selection.select(['sel'], SQUARE.id)
      send('pointermove', event(500, 600, ALT))
      log.length = 0
      send('pointermove', event(510, 600, ALT))
      send('pointerleave', event(510, 600, ALT))
      expect(log).toEqual(['shown changed', 'shown changed'])
    })

    describe('shows nothing', () => {
      it('with nothing selected, off every frame, or with the pointer off the stage', () => {
        const { pointer, send, selection } = harness()
        send('pointermove', event(5, 6, ALT))
        expect(pointer.measured()).toBeNull()
        selection.select(['sel'], SQUARE.id)
        send('pointermove', event(1200, 6, ALT))
        expect(pointer.measured()).toBeNull()
        send('pointermove', event(5, 6, ALT))
        send('pointerleave', event(5, 6, ALT))
        expect(pointer.measured()).toBeNull()
      })

      it('over another frame than the selection’s, and for a selection across frames', () => {
        const { pointer, send, selection } = harness()
        selection.select(['sel'], 'one-story')
        send('pointermove', event(5, 6, ALT))
        expect(pointer.measured()).toBeNull()
        selection.selectAcross([
          { id: 'sel', frameId: SQUARE.id },
          { id: 'other', frameId: 'one-story' },
        ])
        send('pointermove', event(5, 7, ALT))
        expect(pointer.measured()).toBeNull()
      })

      it('during a drag, from its press', () => {
        const { pointer, send, selection } = harness()
        selection.select(['sel'], SQUARE.id)
        send('pointermove', event(5, 6, ALT))
        send('pointerdown', event(5, 6, ALT))
        expect(pointer.measured()).toBeNull()
        send('pointermove', event(40, 6, ALT))
        expect(pointer.measured()).toBeNull()
        send('pointerup', event(40, 6, ALT))
        send('pointermove', event(41, 6, ALT))
        expect(pointer.measured()).not.toBeNull()
      })

      it('while typing, cropping or editing points', () => {
        const typing = harness('select', undefined, false, 'words')
        typing.selection.select(['sel'], SQUARE.id)
        typing.send('pointermove', event(5, 6, ALT))
        expect(typing.pointer.measured()).toBeNull()
        const { pointer, send, selection } = harness()
        selection.select(['sel'], SQUARE.id)
        selection.crop({ id: 'sel', frameId: SQUARE.id })
        send('pointermove', event(5, 6, ALT))
        expect(pointer.measured()).toBeNull()
        selection.crop(null)
        selection.editPath({ id: 'sel', frameId: SQUARE.id })
        send('pointermove', event(5, 7, ALT))
        expect(pointer.measured()).toBeNull()
      })

      it('with another tool, with Space held to pan, and by touch', () => {
        const other = harness('rect')
        other.selection.select(['sel'], SQUARE.id)
        other.send('pointermove', event(5, 6, ALT))
        expect(other.pointer.measured()).toBeNull()
        const { pointer, send, selection } = harness()
        selection.select(['sel'], SQUARE.id)
        pointer.keyDown(keyInput('Space', { altKey: true }))
        send('pointermove', event(5, 6, ALT))
        expect(pointer.measured()).toBeNull()
        pointer.keyUp(keyInput('Space', { type: 'keyup', altKey: true }))
        send('pointermove', event(5, 7, { altKey: true, pointerType: 'touch' }))
        expect(pointer.measured()).toBeNull()
      })
    })
  })

  describe('busy', () => {
    it('is busy for as long as Alt shows a measure, until Alt is let go or the window loses the focus', () => {
      const { pointer, send, selection } = harness()
      selection.select(['sel'], SQUARE.id)
      send('pointermove', event(5, 6))
      expect(pointer.busy()).toBe(false)
      pointer.keyDown(keyInput('AltLeft', { key: 'Alt', altKey: true }))
      expect(pointer.busy()).toBe(true)
      pointer.keyUp(keyInput('AltLeft', { type: 'keyup', key: 'Alt' }))
      expect(pointer.busy()).toBe(false)
      pointer.keyDown(keyInput('AltLeft', { key: 'Alt', altKey: true }))
      expect(pointer.busy()).toBe(true)
      pointer.blur()
      expect(pointer.busy()).toBe(false)
    })

    it('is not busy with Alt held and nothing measured, and is busy while a drag runs', () => {
      const { pointer, send, selection } = harness()
      selection.select(['sel'], SQUARE.id)
      send('pointermove', event(1200, 6, ALT))
      expect(pointer.busy()).toBe(false)
      send('pointermove', event(5, 6))
      send('pointerdown', event(5, 6))
      send('pointermove', event(40, 6))
      expect(pointer.busy()).toBe(true)
      send('pointerup', event(40, 6))
      expect(pointer.busy()).toBe(false)
    })
  })
})
