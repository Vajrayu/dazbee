import { describe, expect, it } from 'vitest'

import { editorHold } from './hold.ts'

describe('editorHold', () => {
  describe('taken', () => {
    it('answers no until the pointer is held', () => {
      expect(editorHold().taken()).toBe(false)
    })

    it('answers yes once after a hold, however often it was asked for, and no when asked again', () => {
      const hold = editorHold()
      hold.hold()
      hold.hold()
      expect(hold.taken()).toBe(true)
      expect(hold.taken()).toBe(false)
    })

    it('answers yes again for a hold made after it was last asked', () => {
      const hold = editorHold()
      hold.hold()
      hold.taken()
      hold.hold()
      expect(hold.taken()).toBe(true)
    })
  })
})
