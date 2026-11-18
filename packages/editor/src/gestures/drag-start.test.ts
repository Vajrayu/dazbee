import { describe, expect, it } from 'vitest'

import { editorDragStart } from './drag-start.ts'

describe('editorDragStart', () => {
  const at = (x: number, y = 100) => ({ x, y })

  describe('moved', () => {
    it('answers no while a mouse press wanders 2 pixels, and yes at 4', () => {
      const start = editorDragStart()
      start.press(at(100), 'mouse')
      expect(start.moved(at(102))).toBe(false)
      expect(start.moved(at(104))).toBe(true)
    })

    it('answers no while a finger wanders 7 pixels, and yes at 9', () => {
      const start = editorDragStart()
      start.press(at(100), 'touch')
      expect(start.moved(at(107))).toBe(false)
      expect(start.moved(at(109))).toBe(true)
    })

    it('keeps a drag one once the pointer comes back inside the slop', () => {
      const start = editorDragStart()
      start.press(at(100), 'mouse')
      start.moved(at(110))
      expect(start.moved(at(100))).toBe(true)
    })

    it('starts each press as a click again, from where it went down', () => {
      const start = editorDragStart()
      start.press(at(100), 'mouse')
      start.moved(at(110))
      start.press(at(200), 'mouse')
      expect(start.moved(at(110))).toBe(true)
      start.press(at(200), 'touch')
      expect(start.moved(at(205))).toBe(false)
    })

    it('answers no with no press held', () => {
      expect(editorDragStart().moved(at(500))).toBe(false)
    })
  })

  describe('clicking', () => {
    it('answers yes for a press that never went past the slop, and no once it has', () => {
      const start = editorDragStart()
      start.press(at(100), 'mouse')
      start.moved(at(102))
      expect(start.clicking()).toBe(true)
      start.moved(at(104))
      start.moved(at(100))
      expect(start.clicking()).toBe(false)
    })
  })
})
