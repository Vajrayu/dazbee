// Position's Constraints part sets one axis of the selected layers' constraints through `setProps`,
// each layer keeping its own other axis, as one undo step named edit.
import { describe, expect, it } from 'vitest'

import { LEFT_TOP } from '@dazbee/doc'
import type { Constraints, DesignInput } from '@dazbee/schema'

import { testEditor } from './test-editor.ts'

/** A rectangle in the square frame, with these constraints and lock where given. */
const rect = (index: string, x: number, extra: Record<string, unknown> = {}) => ({
  type: 'graphic' as const,
  parentId: 'sq',
  link: index,
  index,
  name: 'Rect',
  props: { x, y: 100, width: 50, height: 50, shape: { kind: 'rect' as const }, ...extra },
})
/**
 * A square frame holding a layer set right and bottom, one with no constraints, one already set
 * centre and top and one set right and bottom that is locked in place.
 */
const DESIGN: DesignInput = {
  meta: { designId: 'd', name: 'D' },
  pages: { p1: { name: 'One', order: 'a0' } },
  frames: { sq: { pageId: 'p1', name: 'Square', width: 1080, height: 1080, x: 0, y: 0, order: 'a0' } },
  nodes: {
    corner: rect('a0', 100, { constraints: { horizontal: 'right', vertical: 'bottom' } }),
    plain: rect('a1', 200),
    middle: rect('a2', 300, { constraints: { horizontal: 'center', vertical: 'top' } }),
    pinned: {
      ...rect('a3', 400, { constraints: { horizontal: 'right', vertical: 'bottom' } }),
      lock: { move: true },
    },
  },
}

/** What a pick of one axis asks of a layer: that axis set, its own other axis kept, left or top where it has none. */
const pick =
  (change: Partial<Constraints>) =>
  (_id: string, now: Readonly<Record<string, unknown>>): Record<string, unknown> => ({
    constraints: { ...((now.constraints as Constraints | undefined) ?? LEFT_TOP), ...change },
  })

describe('setProps with constraints', () => {
  it('sets one axis on every selected layer, each keeping its own other axis, as one undo step named edit', async () => {
    const { core, press, end } = await testEditor(DESIGN)
    const before = core.design()
    expect(core.setProps(['corner', 'plain'], pick({ horizontal: 'center' }))).toBe(true)
    const { nodes } = core.design()
    expect(nodes.corner?.props.constraints).toEqual({ horizontal: 'center', vertical: 'bottom' })
    expect(nodes.plain?.props.constraints).toEqual({ horizontal: 'center', vertical: 'top' })
    expect(core.undoName()).toBe('edit')
    press('undo')
    expect(core.design()).toEqual(before)
    expect(core.canUndo()).toBe(false)
    end()
  })

  it('writes the whole pair on a layer with none picked left, and leaves a layer already set as asked unwritten', async () => {
    const { core, end } = await testEditor(DESIGN)
    const before = core.design()
    expect(core.setProps(['plain', 'middle'], pick({ vertical: 'top' }))).toBe(true)
    const { nodes } = core.design()
    expect(nodes.plain?.props.constraints).toEqual({ horizontal: 'left', vertical: 'top' })
    expect(nodes.middle).toBe(before.nodes.middle)
    end()
  })

  it('makes no undo step when every layer is already set as asked', async () => {
    const { core, end } = await testEditor(DESIGN)
    const before = core.design()
    core.setProps(['middle'], pick({ horizontal: 'center' }))
    expect(core.design()).toBe(before)
    expect(core.canUndo()).toBe(false)
    end()
  })

  it('answers false for a layer locked in place, writing nothing to it, and sets the rest', async () => {
    const { core, press, end } = await testEditor(DESIGN)
    const before = core.design()
    expect(core.setProps(['pinned'], pick({ vertical: 'center' }))).toBe(false)
    expect(core.design()).toEqual(before)
    expect(core.setProps(['pinned', 'corner'], pick({ vertical: 'center' }))).toBe(false)
    const { nodes } = core.design()
    expect(nodes.pinned).toEqual(before.nodes.pinned)
    expect(nodes.corner?.props.constraints).toEqual({ horizontal: 'right', vertical: 'center' })
    press('undo')
    expect(core.design()).toEqual(before)
    end()
  })
})
