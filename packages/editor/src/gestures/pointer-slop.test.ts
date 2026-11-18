// The click slop over the real pointer, select press, drags and drawing: a press that stays inside it
// moves, resizes, turns, reorders and moves a frame by nothing, leaving nothing to undo, and a draw
// that ends with no size is a click.
import { describe, expect, it } from 'vitest'

import { pairsIn } from '../selection.ts'
import { stage } from '../test-stage.ts'
import type { Tool } from '../tools.ts'
import type { ReorderDrag } from './select/auto-layout-drag.ts'
import { pointerInput } from './test-inputs.ts'

/** Each drag a press of the select tool starts: what is selected first, and where it is pressed. */
const PRESSES = [
  { name: 'a move of an unselected layer', selected: [], at: { x: 150, y: 150 } },
  { name: 'a move of a lone selected layer', selected: ['a'], at: { x: 150, y: 150 } },
  { name: 'a move of several selected layers', selected: ['a', 'b'], at: { x: 150, y: 150 } },
  { name: 'a resize from an edge', selected: ['a'], at: { x: 200, y: 150 } },
  { name: 'a turn from outside a corner', selected: ['a'], at: { x: 212, y: 212 } },
  { name: "a frame's move from its label", selected: [], at: { x: 20, y: -10 }, label: 'sq' },
  { name: 'an auto layout reorder', selected: ['inRow'], at: { x: 125, y: 525 } },
] as const
/** How far a press wanders and is still a click, and how far it goes and is a drag, by mouse, pen and finger. */
const WANDERS = [
  ['mouse', 2, 4],
  ['pen', 2, 4],
  ['touch', 7, 9],
] as const

/**
 * What a click at 300, 300 with each drawing tool makes: the layer it adds, the frames it adds, and
 * the tool in use after. Text grows with its words, an image is at its own size, a shape at its
 * default size, each centred there; the Frame tool adds none and stays in use.
 */
const DRAW_CLICKS = [
  ['text', { layers: [expect.objectContaining({ x: 300, y: 300, boxMode: 'autoWidth' })], frames: 0, tool: 'select' }],
  [
    'image',
    { layers: [expect.objectContaining({ x: 100, y: 200, width: 400, height: 200 })], frames: 0, tool: 'select' },
  ],
  [
    'rect',
    { layers: [expect.objectContaining({ x: 250, y: 250, width: 100, height: 100 })], frames: 0, tool: 'select' },
  ],
  ['frame', { layers: [], frames: 0, tool: 'frame' }],
] as const

/**
 * Presses with a tool at 300, 300 by a pointer of a type, moves the pointer to each of the
 * distances to the right of the press in turn, and lets go where it is: the props of the layers
 * added, how many frames were added, and the tool after.
 */
function drawn(tool: Tool, moves: number[] = [], pointerType = 'mouse') {
  const on = stage(tool)
  const layersBefore = new Set(Object.keys(on.session.design().nodes))
  const framesBefore = Object.keys(on.session.design().frames).length
  const at = (by: number) => pointerInput({ at: { x: 300 + by, y: 300 }, pointerType })
  on.send('pointerdown', at(0))
  for (const by of moves) on.send('pointermove', at(by))
  on.send('pointerup', at(moves.at(-1) ?? 0))
  const { nodes, frames } = on.session.design()
  const layers = Object.keys(nodes)
    .filter((id) => !layersBefore.has(id))
    .map((id) => nodes[id]?.props)
  return { layers, frames: Object.keys(frames).length - framesBefore, tool: on.tool() }
}

/** Presses at a stage point, moves the pointer across by `by` and lets go, by a pointer of a type. */
function pressAndGo(
  { send }: ReturnType<typeof stage>,
  at: { x: number; y: number },
  by: number,
  pointerType: string,
  label?: string,
) {
  const e = (x: number) => pointerInput({ at: { x, y: at.y }, pointerType, ...(label ? { label } : {}) })
  send('pointerdown', e(at.x))
  send('pointermove', e(at.x + by))
}

describe('the click slop', () => {
  it('writes nothing for a press that wanders inside it, leaving nothing to undo, by mouse, pen and finger', () => {
    for (const { name, selected, at, ...rest } of PRESSES)
      for (const [pointerType, within] of WANDERS) {
        const on = stage()
        on.selection.select([...selected], 'sq')
        const before = JSON.stringify(on.session.design())
        pressAndGo(on, at, within, pointerType, 'label' in rest ? rest.label : undefined)
        on.send('pointerup', pointerInput({ at }))
        expect(JSON.stringify(on.session.design()), `${name} by ${pointerType}`).toEqual(before)
        expect(on.session.canUndo(), `${name} by ${pointerType}`).toBe(false)
      }
  })

  it('drags once the press goes past it, by mouse, pen and finger', () => {
    for (const { name, selected, at, ...rest } of PRESSES)
      for (const [pointerType, , past] of WANDERS) {
        const on = stage()
        on.selection.select([...selected], 'sq')
        const before = JSON.stringify(on.session.design())
        pressAndGo(on, at, past, pointerType, 'label' in rest ? rest.label : undefined)
        const g = on.pointer.gesture()
        // A reorder a few pixels along its flow drops where it was, which writes nothing.
        if (g?.kind === 'reorder') expect((g as ReorderDrag).moved, `${name} by ${pointerType}`).toBe(true)
        else expect(JSON.stringify(on.session.design()), `${name} by ${pointerType}`).not.toEqual(before)
        on.send('pointerup', pointerInput({ at }))
        if (g?.kind !== 'reorder') expect(on.session.canUndo(), `${name} by ${pointerType}`).toBe(true)
      }
  })

  it('keeps a drag going once the pointer comes back inside it', () => {
    const on = stage()
    pressAndGo(on, { x: 150, y: 150 }, 20, 'mouse')
    on.send('pointermove', pointerInput({ at: { x: 151, y: 150 } }))
    expect(on.x()).toBe(101)
  })

  it('selects alone what a click picked, as a click does', () => {
    const on = stage()
    on.selection.select(['a', 'b'], 'sq')
    pressAndGo(on, { x: 150, y: 150 }, 2, 'mouse')
    on.send('pointerup', pointerInput({ at: { x: 152, y: 150 } }))
    expect(on.selection.current()).toEqual(pairsIn('sq', ['a']))
  })

  for (const [tool, made] of DRAW_CLICKS)
    it(`ends a draw with the ${tool} tool dragged past it and back to the press as a click with that tool`, () => {
      const clicked = drawn(tool)
      expect(clicked, 'a click').toEqual(made)
      expect(drawn(tool, [10, 0]), 'a draw out and back').toEqual(clicked)
    })

  for (const [tool] of DRAW_CLICKS)
    it(`ends a press with the ${tool} tool let go inside it as a click with that tool, by mouse and finger`, () => {
      const clicked = drawn(tool)
      expect(drawn(tool, [2]), 'a mouse wandering 2 px').toEqual(clicked)
      expect(drawn(tool, [7], 'touch'), 'a finger wandering 7 px').toEqual(clicked)
    })
})
