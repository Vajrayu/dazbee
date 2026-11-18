// A drag of layers out of their flow onto another frame of the page, in the whole editor opened in
// Node: onto its top, kept where they were dropped, or into a flow there; with Alt, copies; what is
// shown meanwhile, what stays, the undo step, and what another tab draws.
import { afterEach, describe, expect, it } from 'vitest'

import type { Design, DesignInput, Member, Point } from '@dazbee/schema'

import { openTab } from '../../open-tab.ts'
import { type TestEditor, testEditor } from '../../test-editor.ts'
import { memorySync } from '../../test-link.ts'
import type { ReorderDrag } from './auto-layout-drag.ts'
import { TWO_FRAMES } from './test-two-frames.ts'

type Box = { x: number; y: number; width: number; height: number }

const editors: TestEditor[] = []
const closing: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const e of editors.splice(0)) e.end()
  for (const close of closing.splice(0)) await close()
})

async function open(design: DesignInput = TWO_FRAMES) {
  const e = await testEditor(design)
  editors.push(e)
  return e
}
/** The frame that holds a layer now. */
function frameOf(design: Design, id: string): string {
  let up = design.nodes[id]?.parentId ?? ''
  while (design.nodes[up]) up = design.nodes[up]?.parentId ?? ''
  return up
}
/** A layer's box as drawn, on the page. */
function onPage(e: TestEditor, id: string): Box {
  const design = e.core.design()
  const frame = design.frames[frameOf(design, id)] as { x: number; y: number }
  const box = e.modules.boxes.boxIn(id) as Box
  return { ...box, x: frame.x + box.x, y: frame.y + box.y }
}
/** The middle of a layer as drawn, as a stage point. */
function middle(e: TestEditor, id: string): Point {
  const box = e.modules.boxes.boxIn(id) as Box
  return e.core.stagePoint(box.x + box.width / 2, box.y + box.height / 2, frameOf(e.core.design(), id))
}
const at = (e: TestEditor, frame: string, x: number, y: number) => e.core.stagePoint(x, y, frame)
/** The layers a frame or layer holds, in the order they are drawn. */
function holds(e: TestEditor, parent: string) {
  return Object.entries(e.core.design().nodes)
    .filter(([, node]) => node.parentId === parent)
    .sort(([, a], [, b]) => (a.index < b.index ? -1 : a.index > b.index ? 1 : 0))
    .map(([id]) => id)
}
/** Presses a layer's middle and walks the pointer to a stage point, the press still held. */
function hold(e: TestEditor, id: string, to: Point) {
  e.core.select([id])
  const from = middle(e, id)
  e.mouse.move(from.x, from.y)
  e.mouse.down()
  e.mouse.move(to.x, to.y, { steps: 8 })
  return e.modules.pointer.gesture() as ReorderDrag
}
function near(box: Box, to: Box) {
  for (const key of ['x', 'y', 'width', 'height'] as const)
    expect(Math.abs(box[key] - to[key]), key).toBeLessThanOrEqual(1)
}

describe('a drag out of a flow onto another frame', () => {
  it('lands a layer of a column on the top of the frame, where it was dropped, the column keeping the rest in order, as one undo step', async () => {
    const e = await open()
    const before = JSON.stringify(e.core.design())
    const was = onPage(e, 'c2')
    const from = middle(e, 'c2')
    const to = at(e, 'B', 200, 330)
    const drag = hold(e, 'c2', to)
    expect(drag).toMatchObject({ kind: 'reorder', outside: true, target: { id: 'B' }, drop: null })
    // The frame is outlined; the column it leaves is not.
    expect(e.modules.autoLayoutDrag.shown(drag).map((part) => part.kind)).toEqual(['ghost'])
    e.mouse.up()
    const zoom = e.core.camera().zoom
    expect(e.core.design().nodes.c2).toMatchObject({ parentId: 'B', link: 'c2' })
    expect(holds(e, 'B').at(-1)).toBe('c2')
    expect(holds(e, 'col')).toEqual(['c1', 'c3'])
    near(onPage(e, 'c2'), { ...was, x: was.x + (to.x - from.x) / zoom, y: was.y + (to.y - from.y) / zoom })
    expect(e.core.undoName()).toBe('move')
    expect(e.modules.selection.current()).toEqual([{ id: 'c2', frameId: 'B' }])
    e.press('undo')
    expect(JSON.stringify(e.core.design())).toBe(before)
  })

  it('drops it into the row of the other frame past a layer’s middle, after that layer, the line shown there', async () => {
    const e = await open()
    const b2 = middle(e, 'b2')
    const drag = hold(e, 'c2', { x: b2.x + 10, y: b2.y })
    expect(drag).toMatchObject({ target: { id: 'B' }, drop: { boxId: 'brow', slot: 2 } })
    const line = e.modules.autoLayoutDrag.shown(drag).find((part) => part.kind === 'line')
    expect(line?.frame.id).toBe('B')
    e.mouse.up()
    expect(holds(e, 'brow')).toEqual(['b1', 'b2', 'c2', 'b3'])
    expect(holds(e, 'col')).toEqual(['c1', 'c3'])
    e.press('undo')
    expect(holds(e, 'col')).toEqual(['c1', 'c2', 'c3'])
  })

  it('lands it on the top of the frame over a Free box there, not in the box', async () => {
    const e = await open()
    hold(e, 'c2', at(e, 'B', 275, 300))
    e.mouse.up()
    expect(e.core.design().nodes.c2?.parentId).toBe('B')
  })

  it('gives a layer whose link id the frame holds a new one there', async () => {
    // The logo, whose link id B holds, in the column in place of its last layer.
    const nodes = TWO_FRAMES.nodes as Record<string, { parentId: string; index: string }>
    const rest = Object.fromEntries(Object.entries(nodes).filter(([id]) => id !== 'c3'))
    const logo = { ...nodes.logo, parentId: 'col', index: 'a2' }
    const e = await open({ ...TWO_FRAMES, nodes: { ...rest, logo } } as unknown as DesignInput)
    hold(e, 'logo', at(e, 'B', 200, 100))
    e.mouse.up()
    expect(e.core.design().nodes.logo?.parentId).toBe('B')
    expect(e.core.design().nodes.logo?.link).not.toBe('logo')
  })

  it('with Alt, leaves the original in its flow and lands a copy where the move would, selected, its original’s link id kept, as one duplicate step', async () => {
    const e = await open()
    const before = JSON.stringify(e.core.design())
    const b2 = middle(e, 'b2')
    e.core.select(['c2'])
    e.mouse.drag(middle(e, 'c2'), { x: b2.x + 10, y: b2.y }, { steps: 8, alt: true })
    const [copy = ''] = e.core.selection()
    expect(holds(e, 'col')).toEqual(['c1', 'c2', 'c3'])
    expect(holds(e, 'brow')).toEqual(['b1', 'b2', copy, 'b3'])
    expect(e.core.design().nodes[copy]?.link).toBe('c2')
    expect(e.modules.selection.current()).toEqual([{ id: copy, frameId: 'B' }])
    expect(e.core.undoName()).toBe('duplicate')
    e.press('undo')
    expect(JSON.stringify(e.core.design())).toBe(before)
  })

  it('shows the leave outline over the gap between frames, and keeps the layer in its frame there', async () => {
    const e = await open()
    const drag = hold(e, 'c2', at(e, 'A', 450, 330))
    expect(drag.target).toBeNull()
    expect(e.modules.autoLayoutDrag.shown(drag).map((part) => part.kind)).toEqual(['ghost', 'leave'])
    e.mouse.up()
    expect(e.core.design().nodes.c2?.parentId).toBe('A')
  })

  it('moves nothing into the other frame on Escape or when the browser takes the drag away, with no undo step', async () => {
    for (const end of ['escape', 'cancel'] as const) {
      const e = await open()
      const before = JSON.stringify(e.core.design())
      const to = at(e, 'B', 200, 330)
      hold(e, 'c2', to)
      if (end === 'escape') e.keys.press('Escape')
      else
        e.core.input.pointer({
          type: 'pointercancel',
          at: to,
          button: 0,
          detail: 0,
          shiftKey: false,
          altKey: false,
          ctrlKey: false,
          metaKey: false,
          pointerType: 'mouse',
        })
      e.core.redraw()
      expect(JSON.stringify(e.core.design()), end).toBe(before)
      expect(e.core.undoName(), end).toBeNull()
    }
  })

  it('shows another tab the layer in its old frame while the drag is open, and in the new one after the drop', async () => {
    const mem = memorySync(TWO_FRAMES)
    const tabOf = async (userId: string) => {
      const member: Member = { userId, workspaceId: 'w1' }
      const tab = await openTab({
        designId: 'd',
        member,
        url: 'ws://s',
        token: () => Promise.resolve(userId),
        socket: mem.socket,
      })
      closing.push(() => tab.close())
      const e = await testEditor(TWO_FRAMES, { tab })
      editors.push(e)
      return e
    }
    const settle = async () => {
      for (let n = 0; n < 5; n++) {
        await mem.settle()
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
    }
    const a = await tabOf('ann')
    const b = await tabOf('bob')
    hold(a, 'c2', at(a, 'B', 200, 330))
    await new Promise((resolve) => setTimeout(resolve, 80))
    await settle()
    b.core.redraw()
    expect(b.modules.view.previewed().nodes.c2?.parentId).toBe('col')
    a.mouse.up()
    await settle()
    b.core.redraw()
    expect(b.core.design().nodes.c2?.parentId).toBe('B')
  })
})
