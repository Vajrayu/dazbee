import { describe, expect, it } from 'vitest'

import type { DesignInput } from '@dazbee/schema'

import { idsOf } from '../../selection.ts'
import { runAs } from '../../test-platform.ts'
import { DESIGN, harness, NESTED, SQUARE } from './test-select-press.ts'

/** The nested design with the group Pair locked in place. */
const PAIR_LOCKED: DesignInput = {
  ...NESTED,
  nodes: { ...NESTED.nodes, pair: { ...NESTED.nodes.pair, lock: { move: true } } as DesignInput['nodes'][string] },
}

describe('editorSelectPress', () => {
  describe('press with Ctrl', () => {
    it('selects the deepest layer under a press with Ctrl, going into the group it is in', () => {
      runAs(false)
      const { selection, press } = harness(null, NESTED)
      press({ x: 225, y: 225 }, false, true)
      expect(idsOf(selection.current())).toEqual(['left'])
      expect(selection.entered()).toBe('pair')
      // Inside the group gone into, a plain press picks the layer beside it.
      press({ x: 325, y: 225 })
      expect(idsOf(selection.current())).toEqual(['right'])
      expect(selection.entered()).toBe('pair')
    })

    it('adds the deepest layer with Ctrl and Shift, or takes it out again, the group gone into following the selection', () => {
      runAs(false)
      const { selection, press } = harness(null, NESTED)
      selection.select(['box'], SQUARE.id)
      press({ x: 225, y: 225 }, true, true)
      expect(idsOf(selection.current())).toEqual(['box', 'left'])
      expect(press({ x: 225, y: 225 }, true, true)).toBeNull()
      expect(idsOf(selection.current())).toEqual(['box'])
      expect(selection.entered()).toBeNull()
    })

    it('selects the deepest layer at once inside the selection’s box, and a drag moves it', () => {
      runAs(false)
      const { selection, press, log } = harness(null, NESTED)
      selection.select(['card'], SQUARE.id)
      expect(press({ x: 225, y: 225 }, false, true)?.kind).toBe('move')
      expect(idsOf(selection.current())).toEqual(['left'])
      expect(selection.entered()).toBe('pair')
      expect(log).toContain('press move left')
    })

    it('selects the layer under it inside a group locked in place, going into the group, and moves nothing', () => {
      runAs(false)
      const { selection, press, log } = harness(null, PAIR_LOCKED)
      expect(press({ x: 325, y: 225 }, false, true)).toBeNull()
      expect(idsOf(selection.current())).toEqual(['right'])
      expect(selection.entered()).toBe('pair')
      expect(log.filter((line) => line.startsWith('press move'))).toEqual([])
    })

    it('selects a top-level layer locked in place at once, and moves nothing', () => {
      runAs(false)
      const { selection, press, log } = harness(null, DESIGN)
      expect(press({ x: 605, y: 705 }, false, true)).toBeNull()
      expect(idsOf(selection.current())).toEqual(['pin'])
      expect(log.filter((line) => line.startsWith('press move'))).toEqual([])
    })

    it('reaches the deepest layer with ⌘ on a Mac, where a press with Ctrl picks as a plain one', () => {
      runAs(true)
      const { selection, press } = harness(null, NESTED)
      press({ x: 225, y: 225 }, false, true)
      expect(idsOf(selection.current())).toEqual(['card'])
      press({ x: 225, y: 225 }, false, false, true)
      expect(idsOf(selection.current())).toEqual(['left'])
    })
  })
})
