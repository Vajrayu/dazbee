// A snapping drag's test fixture: the whole editor opened in Node over a design, layers as a design
// takes them, drags pressed and held in the space of a layer's containers, and what the snap tests
// read of them.
import { expect } from 'vitest'

import type { DesignInput, Point } from '@dazbee/schema'

import type { SnapLine } from '../../layers/snap.ts'
import { boundsOf, type Box, pageFrom } from '../../layers/transform.ts'
import { type TestEditor, testEditor } from '../../test-editor.ts'

/** A layer as a design to open takes it. */
export type NodeInput = DesignInput['nodes'][string]

/** A layer of a type under a parent, at an index, with its props. */
export const layer = (type: NodeInput['type'], parentId: string, index: string, props: Record<string, unknown>) =>
  ({ type, parentId, link: `${parentId}-${index}`, index, name: type, props }) as NodeInput
/** A rectangle's props: its box, a grey fill, and any more given. */
export const shape = (x: number, y: number, width: number, height: number, extra: Record<string, unknown> = {}) => ({
  x,
  y,
  width,
  height,
  shape: { kind: 'rect' },
  fills: [{ type: 'solid', color: '#C9CED6FF' }],
  ...extra,
})
/** A snap line a drag shows along an axis. */
export const snapLineAt = (snapLines: SnapLine[] | undefined, axis: 'x' | 'y') =>
  snapLines?.find((g) => g.axis === axis)

/** The containers around a layer, outermost first, as the design holds them. */
export function aroundOf(editor: TestEditor, id: string): Box[] {
  const nodes = editor.core.design().nodes
  const around: Box[] = []
  for (let up = nodes[id]?.parentId; up && nodes[up]; up = nodes[up]?.parentId) {
    const p = nodes[up]?.props as Omit<Box, 'rotation'> & { rotation?: number }
    around.unshift({ x: p.x, y: p.y, width: p.width, height: p.height, rotation: p.rotation ?? 0 })
  }
  return around
}
/** A layer's box as the design holds it, in the space of its containers. */
export function boxOf(editor: TestEditor, id: string) {
  const p = editor.core.design().nodes[id]?.props as Box
  return { x: p.x, y: p.y, width: p.width, height: p.height }
}
/** Opens the design at a zoom, the frame's corner at the stage's. */
export async function open(input: DesignInput, zoom = 1) {
  const editor = await testEditor(input)
  editor.core.setCamera({ x: 0, y: 0, zoom })
  editor.core.redraw()
  return editor
}
/** A point of the space `around` gives, as a stage point. */
export const stageOf = (editor: TestEditor, p: Point, around: Box[]) => {
  const q = pageFrom(p, around)
  return editor.core.stagePoint(q.x, q.y, 'sq')
}
/**
 * Picks a layer, going into its groups, then presses at a point of its containers' space and moves
 * by a step of that space, leaving the button down.
 */
export function hold(editor: TestEditor, id: string, from: Point, by: Point) {
  const around = aroundOf(editor, id)
  editor.core.pickLayer({ id, frameId: 'sq' })
  editor.core.redraw()
  const a = stageOf(editor, from, around)
  const b = stageOf(editor, { x: from.x + by.x, y: from.y + by.y }, around)
  editor.mouse.move(a.x, a.y)
  editor.mouse.down()
  editor.mouse.move(b.x, b.y, { steps: 4 })
  return around
}
/** Selects layers, presses at a point of the space `around` gives and moves by a step of the stage, leaving the button down. */
export function holdSelection(editor: TestEditor, ids: string[], from: Point, around: Box[], by: Point) {
  editor.core.select(ids)
  editor.core.redraw()
  const a = stageOf(editor, from, around)
  editor.mouse.move(a.x, a.y)
  editor.mouse.down()
  editor.mouse.move(a.x + by.x, a.y + by.y, { steps: 4 })
}
/**
 * Picks a layer, presses one of its handles and drags it along the x and y axes of a space turned
 * by `turn`, to each of `by` in turn, leaving the button down; gives the layer's box after each.
 */
export function pull(
  editor: TestEditor,
  id: string,
  handle: 'n' | 'e' | 's' | 'se',
  turn: number,
  by: Point[],
  keys = {},
) {
  editor.core.pickLayer({ id, frameId: 'sq' })
  editor.core.redraw()
  const at = editor.at(handle)
  if (!at) throw new Error(`no ${handle} handle`)
  const [cos, sin] = [Math.cos((turn * Math.PI) / 180), Math.sin((turn * Math.PI) / 180)]
  editor.mouse.move(at.x, at.y)
  editor.mouse.down()
  return by.map((d) => {
    for (const [key, held] of Object.entries(keys)) if (held) editor.keys.down(key)
    editor.mouse.move(at.x + d.x * cos - d.y * sin, at.y + d.x * sin + d.y * cos, { steps: 4 })
    return boxOf(editor, id)
  })
}
/**
 * The invariant of a drag that snapped: each snap line it shows runs through a side or the middle of
 * the dragged layer's box, in the space its containers give as they are now, so it is drawn on it.
 */
export function expectOnSnapLines(editor: TestEditor, id: string) {
  const box = editor.modules.boxes.boxIn(id)
  const shown = editor.modules.transformDrag.shown()
  const [frame] = editor.core.frames()
  if (!box || !shown || !frame) throw new Error(`no box or no snap for ${id}`)
  expect(shown.around).toEqual(editor.modules.boxes.containersOf(frame, editor.core.design().nodes[id]?.parentId))
  const b = boundsOf([box])
  for (const g of shown.snapLines) {
    const [start, size] = g.axis === 'x' ? [b.x, b.width] : [b.y, b.height]
    const off = Math.min(...[start, start + size / 2, start + size].map((at) => Math.abs(at - g.at)))
    expect(off, `${g.axis} snap line at ${g.at}`).toBeLessThan(0.01)
  }
}
