// Layers snapping to their frame's guides through the editor's core in Node: a move and a resize
// snap to them whether or not the rulers show, only while the drag works in the frame's own space,
// and never to a guide past the frame's edge.
import { afterEach, describe, expect, it } from 'vitest'

import type { DesignInput, Guide } from '@dazbee/schema'

import type { TestEditor } from '../../test-editor.ts'
import { boxOf, hold, layer, open, pull, shape, snapLineAt } from './test-snap-drag.ts'

/** A square frame with its guides, a box from 100 to 200 across and down, and a group turned 30° holding one more. */
const design = (guides: Guide[]): DesignInput => ({
  meta: { designId: 'd', name: 'D' },
  pages: { p1: { name: 'One', order: 'a0' } },
  frames: { sq: { pageId: 'p1', name: 'Square', width: 1080, height: 1080, x: 0, y: 0, order: 'a0', guides } },
  nodes: {
    a: layer('graphic', 'sq', 'a0', shape(100, 100, 100, 100)),
    g: layer('group', 'sq', 'a1', { x: 500, y: 500, width: 200, height: 200, rotation: 30 }),
    in: layer('graphic', 'g', 'a0', shape(500, 500, 100, 100)),
  },
})

let editor: TestEditor | undefined
afterEach(() => {
  editor?.end()
  editor = undefined
})

describe('editorTransformDrag', () => {
  it('moves a layer onto a guide within reach with the rulers hidden, the snap line across the frame', async () => {
    editor = await open(design([{ axis: 'x', at: 333 }]))
    expect(editor.core.rulers()).toBe(false)
    // Its right side, at 200, moved 129 to 329: 4 short of the guide.
    hold(editor, 'a', { x: 150, y: 150 }, { x: 129, y: 0 })
    expect(boxOf(editor, 'a').x).toBe(233)
    const line = snapLineAt(editor.modules.transformDrag.shown()?.snapLines, 'x')
    expect(line).toEqual({ axis: 'x', at: 333, from: 0, to: 1080, points: [100, 200] })
    editor.mouse.up()
  })

  it('resizes a side onto a guide', async () => {
    editor = await open(design([{ axis: 'y', at: 403 }]))
    const [after] = pull(editor, 'a', 's', 0, [{ x: 0, y: 199 }])
    expect(after).toMatchObject({ y: 100, height: 303 })
    editor.mouse.up()
  })

  it('snaps to no guide past the frame’s edge', async () => {
    editor = await open(design([{ axis: 'x', at: 1090 }]))
    // Its right side 2 short of 1090, and 8 past the frame's, too far to snap to.
    hold(editor, 'a', { x: 150, y: 150 }, { x: 888, y: 0 })
    expect(boxOf(editor, 'a').x).toBe(988)
    editor.mouse.up()
  })

  it('snaps to no guide inside a turned group, whose space is not the frame’s', async () => {
    editor = await open(design([{ axis: 'x', at: 640 }]))
    // In the group's space its right side, at 600, moved 36 to 636: 4 short of 640.
    hold(editor, 'in', { x: 550, y: 550 }, { x: 36, y: 0 })
    expect(boxOf(editor, 'in').x).toBe(536)
    editor.mouse.up()
  })
})
