import { describe, expect, it } from 'vitest'

import { childrenOf } from '@dazbee/doc'
import type { DesignInput } from '@dazbee/schema'

import { FLOW, harness, TURNED } from '../test-actions.ts'
import { flipAxisOf, flipReady } from './flip.ts'

/** The row of FLOW with a box that fills what the row leaves, a square in it, its stored box stale. */
const CARD: DesignInput = {
  ...FLOW,
  nodes: {
    ...FLOW.nodes,
    card: {
      type: 'box',
      parentId: 'flow',
      link: 'card',
      index: 'a3',
      name: 'Card',
      props: { x: 0, y: 0, width: 50, height: 120, clip: false, sizing: { width: 'fill', height: 'fixed' } },
    },
    badge: {
      type: 'graphic',
      parentId: 'card',
      link: 'badge',
      index: 'a0',
      name: 'Badge',
      props: { x: 5, y: 10, width: 20, height: 20, shape: { kind: 'rect' } },
    },
  },
}
/** A row 150 wide that wraps five 40-wide tiles 10 apart: three on its first line, two on its second. */
const WRAPPING: DesignInput = {
  ...FLOW,
  nodes: {
    ...FLOW.nodes,
    wrap: {
      type: 'box',
      parentId: 'sq',
      link: 'wrap',
      index: 'a6',
      name: 'Wrap',
      props: {
        x: 700,
        y: 100,
        width: 150,
        height: 10,
        sizing: { width: 'fixed', height: 'hug' },
        layout: { direction: 'row', wrap: true, gap: 10, padding: { top: 0, right: 0, bottom: 0, left: 0 } },
      },
    },
    ...Object.fromEntries(
      ['a', 'b', 'c', 'd', 'e'].map((k, i) => [
        `wrap-${k}`,
        {
          type: 'graphic',
          parentId: 'wrap',
          link: `wrap-${k}`,
          index: `a${i}`,
          name: 'Tile',
          props: { x: 0, y: 0, width: 40, height: 40, shape: { kind: 'rect' } },
        },
      ]),
    ),
  },
}
/** A layer's props, as stored. */
const propsOf = (session: ReturnType<typeof harness>['session'], id: string) =>
  session.design().nodes[id]?.props as Record<string, unknown>

describe('flipAxisOf', () => {
  it('gives the way each flip action mirrors, and nothing for any other action', () => {
    expect([flipAxisOf('flipHorizontal'), flipAxisOf('flipVertical'), flipAxisOf('alignLeft')]).toEqual([
      'horizontal',
      'vertical',
      null,
    ])
  })
})

describe('flipReady', () => {
  it('is ready while a frame’s selected layers are none of them locked against resizing', () => {
    const { session } = harness()
    session.run('node.lock', { ids: ['b'], lock: { resize: true } })
    const design = session.design()
    expect(flipReady(design, [{ ids: ['a'] }])).toBe(true)
    expect(flipReady(design, [{ ids: ['a', 'b'] }])).toBe(false)
    expect(flipReady(design, [{ ids: ['a', 'b'] }, { ids: ['c'] }])).toBe(true)
  })

  it('is ready for a layer locked in place alone, which flips where it is, and not with others it would move', () => {
    const { session } = harness()
    const design = session.design()
    expect(flipReady(design, [{ ids: ['pin'] }])).toBe(true)
    expect(flipReady(design, [{ ids: ['a', 'pin'] }])).toBe(false)
  })
})

describe('flipLayers', () => {
  it('flips one layer in place with Shift+H, as one undo step named flip', () => {
    const { actions, session, selection, frame, at } = harness()
    selection.select(['a'], frame.id)
    expect(actions.perform('flipHorizontal')).toBe(true)
    expect(propsOf(session, 'a')).toMatchObject({ x: 100, y: 100, flipX: true })
    expect(session.undoName()).toBe('flip')
    session.undo()
    expect(propsOf(session, 'a')).not.toHaveProperty('flipX')
    expect(at('a')).toEqual({ x: 100, y: 100 })
  })

  it('moves several layers to their mirrors across the centre of the box round them, each flipped, and back again', () => {
    const { actions, session, selection, frame, at } = harness()
    const before = JSON.stringify(session.design())
    selection.select(['a', 'c'], frame.id)
    // a runs from x 100 to 200 and c from 700 to 800: the centre is x 450.
    actions.perform('flipHorizontal')
    expect([at('a'), at('c')]).toEqual([
      { x: 700, y: 100 },
      { x: 100, y: 120 },
    ])
    expect([propsOf(session, 'a').flipX, propsOf(session, 'c').flipX]).toEqual([true, true])
    actions.perform('flipVertical')
    // Down, a runs from y 100 to 200 and c from 120 to 220: the centre is y 160.
    expect([at('a'), at('c')]).toEqual([
      { x: 700, y: 120 },
      { x: 100, y: 100 },
    ])
    actions.perform('flipVertical')
    actions.perform('flipHorizontal')
    expect(JSON.stringify(session.design())).toBe(before)
  })

  it('flips the selected layers about the centre of their box in each frame', () => {
    const { actions, session, selection, frame, wide, at } = harness()
    selection.selectAcross([
      { id: 'a', frameId: frame.id },
      { id: 'b', frameId: frame.id },
      { id: 'wide-a', frameId: wide.id },
    ])
    actions.perform('flipHorizontal')
    expect([at('a'), at('b'), at('wide-a')]).toEqual([
      { x: 250, y: 100 },
      { x: 100, y: 300 },
      { x: 100, y: 100 },
    ])
    expect(propsOf(session, 'wide-a').flipX).toBe(true)
  })

  it('flips a layer in a turned group across the frame as drawn', () => {
    const { actions, session, selection, frame } = harness(false, TURNED)
    selection.select(['inTurned'], frame.id)
    actions.perform('flipVertical')
    expect(propsOf(session, 'inTurned')).toMatchObject({ rotation: 180, flipY: true })
  })

  it('keeps a layer a flow places in its slot, flipped, and mirrors the others round the box of them all', () => {
    const { actions, session, selection, boxes, frame, at } = harness()
    selection.select(['a', 'inRow'], frame.id)
    const slot = boxes.drawnBoxOf(frame, 'inRow')
    // a runs from x 100 to 200, and the row draws inRow from 100 to 150: the centre is x 150.
    actions.perform('flipHorizontal')
    expect(at('a')).toEqual({ x: 100, y: 100 })
    expect(boxes.drawnBoxOf(frame, 'inRow')).toEqual(slot)
    expect(propsOf(session, 'inRow').flipX).toBe(true)
  })

  it('mirrors what a box a flow places and sizes holds about the box’s centre as drawn, not as stored', () => {
    const { actions, selection, boxes, frame } = harness(false, CARD)
    const card = boxes.drawnBoxOf(frame, 'card')
    const badge = boxes.drawnBoxOf(frame, 'badge')
    if (!card || !badge) throw new Error('not drawn')
    selection.select(['card'], frame.id)
    actions.perform('flipHorizontal')
    expect(boxes.drawnBoxOf(frame, 'card')).toEqual(card)
    expect(boxes.drawnBoxOf(frame, 'badge')?.x).toBeCloseTo(2 * (card.x + card.width / 2) - badge.x - badge.width, 1)
  })

  it('runs each line of a wrapping row the other way as it is drawn, and back again; down it, keeps its order', () => {
    const { actions, session, selection, frame } = harness(false, WRAPPING)
    const order = () => childrenOf(session.design(), 'wrap').map(([id]) => id)
    selection.select(['wrap'], frame.id)
    actions.perform('flipHorizontal')
    expect(order()).toEqual(['wrap-c', 'wrap-b', 'wrap-a', 'wrap-e', 'wrap-d'])
    actions.perform('flipHorizontal')
    expect(order()).toEqual(['wrap-a', 'wrap-b', 'wrap-c', 'wrap-d', 'wrap-e'])
    actions.perform('flipVertical')
    expect(order()).toEqual(['wrap-a', 'wrap-b', 'wrap-c', 'wrap-d', 'wrap-e'])
  })

  it('runs each line of a wrapping row the other way inside a group flipped with it', () => {
    const { actions, session, selection, frame } = harness(false, {
      ...WRAPPING,
      nodes: {
        ...WRAPPING.nodes,
        group: {
          type: 'group',
          parentId: 'sq',
          link: 'group',
          index: 'a7',
          name: 'Group',
          props: { x: 700, y: 100, width: 150, height: 90 },
        },
        wrap: { ...WRAPPING.nodes.wrap, parentId: 'group', index: 'a0' } as DesignInput['nodes'][string],
      },
    })
    selection.select(['group'], frame.id)
    actions.perform('flipHorizontal')
    expect(childrenOf(session.design(), 'wrap').map(([id]) => id)).toEqual([
      'wrap-c',
      'wrap-b',
      'wrap-a',
      'wrap-e',
      'wrap-d',
    ])
  })

  it('leaves a frame whose layers can’t all flip as it is, and says it did nothing with none flipped', () => {
    const { actions, session, selection, frame } = harness()
    session.run('node.lock', { ids: ['b'], lock: { resize: true } })
    const before = JSON.stringify(session.design())
    selection.select(['a', 'b'], frame.id)
    expect(actions.perform('flipHorizontal')).toBe(false)
    expect(JSON.stringify(session.design())).toBe(before)
  })
})
