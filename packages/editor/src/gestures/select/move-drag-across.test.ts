// A move drag of layers onto another frame of their page, in the whole editor opened in Node: what
// lands in the other frame, kept where it was dropped on the page, what stays, the undo step, the
// selection after, and what another tab draws meanwhile.
import { afterEach, describe, expect, it } from 'vitest'

import type { Design, DesignInput, Member, Point } from '@dazbee/schema'

import { openTab } from '../../open-tab.ts'
import { type TestEditor, testEditor } from '../../test-editor.ts'
import { memorySync } from '../../test-link.ts'
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
/** A point of a frame as a stage point. */
const at = (e: TestEditor, frame: string, x: number, y: number) => e.core.stagePoint(x, y, frame)
/** The layers a frame or layer holds, in the order they are drawn. */
function holds(e: TestEditor, parent: string) {
  return Object.entries(e.core.design().nodes)
    .filter(([, node]) => node.parentId === parent)
    .sort(([, a], [, b]) => (a.index < b.index ? -1 : a.index > b.index ? 1 : 0))
    .map(([id]) => id)
}
/** Selects a layer and drags it from its middle to a point of a frame. */
function dragTo(e: TestEditor, ids: string[], frame: string, x: number, y: number, grab = middle(e, ids[0] ?? '')) {
  e.core.select(ids)
  e.mouse.drag(grab, at(e, frame, x, y), { steps: 8 })
}
/** Expects a box on the page within 1 px of another. */
function near(box: Box, to: Box) {
  for (const key of ['x', 'y', 'width', 'height'] as const)
    expect(Math.abs(box[key] - to[key]), key).toBeLessThanOrEqual(1)
}

describe('a move drag onto another frame', () => {
  it('moves a free layer into the frame under the pointer, kept where it was dropped, its link id kept, as one undo step', async () => {
    const e = await open()
    const before = JSON.stringify(e.core.design())
    const was = onPage(e, 'rect')
    dragTo(e, ['rect'], 'B', 50, 50)
    const design = e.core.design()
    expect(design.nodes.rect).toMatchObject({ parentId: 'B', link: 'rect' })
    expect(holds(e, 'B').at(-1)).toBe('rect')
    near(onPage(e, 'rect'), { ...was, x: 500 + 50 - was.width / 2, y: 50 - was.height / 2 })
    expect(e.core.undoName()).toBe('move')
    const after = JSON.stringify(design)
    e.press('undo')
    expect(JSON.stringify(e.core.design())).toBe(before)
    e.press('redo')
    expect(JSON.stringify(e.core.design())).toBe(after)
  })

  it('gives a layer whose link id the frame holds a new one there', async () => {
    const e = await open()
    dragTo(e, ['logo'], 'B', 200, 50)
    const { nodes } = e.core.design()
    expect(nodes.logo?.parentId).toBe('B')
    expect(nodes.logo?.link).not.toBe('logo')
    expect(nodes['b-logo']?.link).toBe('logo')
  })

  it('lets the pointer decide, not the layer: grabbed at its right edge and released 5 px into the frame, it lands there', async () => {
    const e = await open()
    dragTo(e, ['rect'], 'B', 5, 50, at(e, 'A', 75, 50))
    expect(e.core.design().nodes.rect?.parentId).toBe('B')
    // Its middle is over the gap between the frames.
    expect(onPage(e, 'rect').x + 30).toBeLessThan(500)
  })

  it('judges the frame by where Shift carries the pressed spot, so a layer kept to one axis never lands in a frame it is off', async () => {
    const e = await open()
    /** Drags a layer from its middle with Shift held once it is pressed. */
    const shiftDrag = (id: string, to: Point) => {
      e.core.select([id])
      const from = middle(e, id)
      e.mouse.move(from.x, from.y)
      e.mouse.down()
      e.keys.down('Shift')
      e.mouse.move(to.x, to.y, { steps: 8 })
      e.mouse.up()
      e.keys.up('Shift')
    }
    // Further up than across: Shift keeps the layer in A's column while the pointer is over B.
    shiftDrag('inbox', at(e, 'B', 5, 4))
    expect(e.core.design().nodes.inbox?.parentId).toBe('fbox')
    expect(e.modules.boxes.boxIn('inbox')).toMatchObject({ x: 310 })
    // Further across than down: the pressed spot is carried into B, and the layer lands there.
    shiftDrag('rect', at(e, 'B', 50, 90))
    expect(e.core.design().nodes.rect?.parentId).toBe('B')
    expect(onPage(e, 'rect')).toMatchObject({ x: 520, y: 20 })
  })

  it('keeps a layer released with the pointer over the gap between frames in its own, drawn past its edge', async () => {
    const e = await open()
    dragTo(e, ['rect'], 'A', 450, 50)
    expect(e.core.design().nodes.rect?.parentId).toBe('A')
    expect(e.modules.boxes.boxIn('rect')).toMatchObject({ x: 420, y: 20 })
  })

  it('brings what a group holds, each kept where it is drawn, a layer whose link id the frame holds taking a new one', async () => {
    const e = await open()
    const was = ['g1', 'g2'].map((id) => onPage(e, id))
    const grab = middle(e, 'grp')
    dragTo(e, ['grp'], 'B', 200, 60, grab)
    const step = { x: onPage(e, 'grp').x - 200, y: onPage(e, 'grp').y - 20 }
    const { nodes } = e.core.design()
    expect(nodes.grp?.parentId).toBe('B')
    expect([nodes.g1?.parentId, nodes.g2?.parentId]).toEqual(['grp', 'grp'])
    expect(nodes.g1?.link).not.toBe('g1')
    expect(nodes.g2?.link).toBe('g2')
    ;['g1', 'g2'].forEach((id, i) => {
      const box = was[i] as Box
      near(onPage(e, id), { ...box, x: box.x + step.x, y: box.y + step.y })
    })
  })

  it('moves a whole Mask group, and a layer out of a Free box', async () => {
    const e = await open()
    dragTo(e, ['mg'], 'B', 300, 60)
    expect(e.core.design().nodes.mg?.parentId).toBe('B')
    expect(e.core.design().nodes.mk?.parentId).toBe('mg')
    dragTo(e, ['inbox'], 'B', 300, 120)
    expect(e.core.design().nodes.inbox?.parentId).toBe('B')
  })

  it('drops a layer released over a row of the frame into its flow at the place under the pointer, the line shown there', async () => {
    const e = await open()
    e.core.select(['rect'])
    const [b1, b2] = [middle(e, 'b1'), middle(e, 'b2')]
    const from = middle(e, 'rect')
    e.mouse.move(from.x, from.y)
    e.mouse.down()
    e.mouse.move((b1.x + b2.x) / 2 + 1, b1.y, { steps: 8 })
    const gesture = e.modules.pointer.gesture()
    expect(gesture).toMatchObject({ kind: 'move', target: { id: 'B' }, drop: { boxId: 'brow', slot: 1 } })
    e.mouse.up()
    expect(holds(e, 'brow')).toEqual(['b1', 'rect', 'b2', 'b3'])
    expect(e.core.design().nodes.rect?.link).toBe('rect')
  })

  it('drops a group of two layers, and a turned layer, into the row', async () => {
    const e = await open()
    e.core.select(['rect', 'bound'])
    e.press('group')
    const [group = ''] = e.core.selection()
    const b3 = middle(e, 'b3')
    e.mouse.drag(middle(e, group), { x: b3.x + 20, y: b3.y }, { steps: 8 })
    expect(holds(e, 'brow')).toEqual(['b1', 'b2', 'b3', group])
    expect(holds(e, group)).toEqual(['rect', 'bound'])

    const nodes = TWO_FRAMES.nodes as Record<string, { props: object }>
    const turned = { ...nodes.logo, props: { ...nodes.logo?.props, rotation: 45 } }
    const t = await open({ ...TWO_FRAMES, nodes: { ...TWO_FRAMES.nodes, logo: turned } } as unknown as DesignInput)
    t.core.select(['logo'])
    t.mouse.drag(middle(t, 'logo'), { x: middle(t, 'b1').x - 20, y: middle(t, 'b1').y }, { steps: 8 })
    expect(holds(t, 'brow')).toEqual(['logo', 'b1', 'b2', 'b3'])
  })

  it('lands a layer released over a Free box of the frame on top of the frame, not in the box', async () => {
    const e = await open()
    dragTo(e, ['rect'], 'B', 275, 300)
    expect(e.core.design().nodes.rect?.parentId).toBe('B')
  })

  it('keeps layers that can’t leave in their frame, moved by the drag, with no frame outlined', async () => {
    for (const ids of [['g2'], ['mk'], ['rect', 'b-logo'], ['rect', 'g2']]) {
      const e = await open()
      const parents = ids.map((id) => e.core.design().nodes[id]?.parentId)
      if (ids.includes('b-logo'))
        e.modules.selection.selectAcross([
          { id: 'rect', frameId: 'A' },
          { id: 'b-logo', frameId: 'B' },
        ])
      else e.modules.selection.selectAcross(ids.map((id) => ({ id, frameId: 'A' })))
      const from = middle(e, ids[0] ?? '')
      e.mouse.move(from.x, from.y)
      e.mouse.down()
      e.mouse.move(at(e, 'B', 250, 60).x, at(e, 'B', 250, 60).y, { steps: 8 })
      expect(e.modules.pointer.gesture(), ids.join()).toMatchObject({ kind: 'move', target: null })
      e.mouse.up()
      expect(
        ids.map((id) => e.core.design().nodes[id]?.parentId),
        ids.join(),
      ).toEqual(parents)
    }
  })

  it('lands several layers of one frame together, on top in the order they are drawn', async () => {
    const e = await open()
    e.core.select(['bound', 'rect'])
    e.mouse.drag(middle(e, 'rect'), at(e, 'B', 100, 60), { steps: 8 })
    expect(holds(e, 'B').slice(-2)).toEqual(['rect', 'bound'])
  })

  it('keeps bindings, lock, hidden state and name', async () => {
    const e = await open()
    const was = e.core.design().nodes.bound
    dragTo(e, ['bound'], 'B', 300, 60)
    const now = e.core.design().nodes.bound
    expect(now?.parentId).toBe('B')
    expect([now?.bindings, now?.lock, now?.props.visible, now?.name]).toEqual([
      was?.bindings,
      was?.lock,
      was?.props.visible,
      was?.name,
    ])
  })

  it('leaves the layer in its frame where it was on Escape, or when the browser takes the drag away, with no undo step', async () => {
    for (const end of ['escape', 'cancel'] as const) {
      const e = await open()
      const before = JSON.stringify(e.core.design())
      e.core.select(['rect'])
      const from = middle(e, 'rect')
      const to = at(e, 'B', 50, 50)
      e.mouse.move(from.x, from.y)
      e.mouse.down()
      e.mouse.move(to.x, to.y, { steps: 8 })
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
      expect(e.core.design().nodes.rect?.parentId, end).toBe('A')
      if (end === 'escape') expect(JSON.stringify(e.core.design())).toBe(before)
      expect(e.core.undoName(), end).toBe(end === 'escape' ? null : 'move')
    }
  })

  it('with Alt, leaves the originals and lands copies in the frame, selected, each keeping its original’s link id there, as one duplicate step', async () => {
    const e = await open()
    const before = JSON.stringify(e.core.design())
    e.core.select(['grp'])
    e.mouse.drag(middle(e, 'grp'), at(e, 'B', 200, 60), { steps: 8, alt: true })
    const design = e.core.design()
    const [copy = ''] = e.core.selection()
    expect(copy).not.toBe('grp')
    expect(design.nodes.grp?.parentId).toBe('A')
    expect(design.nodes[copy]).toMatchObject({ parentId: 'B', link: 'grp' })
    const inside = holds(e, copy).map((id) => design.nodes[id]?.link)
    // B holds g1's link already: that copy takes a new one; g2's keeps its original's.
    expect(inside[0]).not.toBe('g1')
    expect(inside[1]).toBe('g2')
    expect(e.modules.selection.current()).toEqual([{ id: copy, frameId: 'B' }])
    expect(e.core.undoName()).toBe('duplicate')
    e.press('undo')
    expect(JSON.stringify(e.core.design())).toBe(before)
  })

  it('with Alt let go before the release, moves the originals instead', async () => {
    const e = await open()
    e.core.select(['rect'])
    const from = middle(e, 'rect')
    const to = at(e, 'B', 50, 50)
    e.mouse.move(from.x, from.y)
    e.mouse.down()
    e.keys.down('Alt')
    e.mouse.move(to.x, to.y, { steps: 8 })
    e.keys.up('Alt')
    e.mouse.up()
    expect(e.core.design().nodes.rect?.parentId).toBe('B')
    expect(Object.keys(e.core.design().nodes)).toHaveLength(Object.keys(TWO_FRAMES.nodes).length)
  })

  it('with Alt, lands two copies on the frame’s top, or in its row, each with its original’s link id', async () => {
    for (const into of ['top', 'row'] as const) {
      const e = await open()
      e.core.select(['rect', 'bound'])
      const b2 = middle(e, 'b2')
      const to = into === 'top' ? at(e, 'B', 100, 60) : { x: b2.x + 10, y: b2.y }
      e.mouse.drag(middle(e, 'rect'), to, { steps: 8, alt: true })
      const design = e.core.design()
      const copies = e.core.selection()
      expect(copies.map((id) => design.nodes[id]?.link).sort(), into).toEqual(['bound', 'rect'])
      const parent = into === 'top' ? 'B' : 'brow'
      expect(
        copies.every((id) => design.nodes[id]?.parentId === parent),
        into,
      ).toBe(true)
      expect([design.nodes.rect?.parentId, design.nodes.bound?.parentId]).toEqual(['A', 'A'])
    }
  })

  it('after an Alt-drag whose copies landed in another frame, Duplicate places its copies 20 right and down of them', async () => {
    const e = await open()
    e.core.select(['rect'])
    e.mouse.drag(middle(e, 'rect'), at(e, 'B', 50, 50), { steps: 8, alt: true })
    const [copy = ''] = e.core.selection()
    const was = e.modules.boxes.boxIn(copy) as Box
    e.press('duplicate')
    const [next = ''] = e.core.selection()
    expect(e.core.design().nodes[next]?.parentId).toBe('B')
    expect(e.modules.boxes.boxIn(next)).toMatchObject({ x: was.x + 20, y: was.y + 20 })
  })

  it('keeps the layer selected in the frame that holds it after the drop, its undo and its redo, with its handles there', async () => {
    const e = await open()
    dragTo(e, ['rect'], 'B', 50, 50)
    const picked = () => [e.modules.selection.current(), e.modules.boxes.selectionBox()?.frame.id]
    expect(picked()).toEqual([[{ id: 'rect', frameId: 'B' }], 'B'])
    e.press('undo')
    expect(picked()).toEqual([[{ id: 'rect', frameId: 'A' }], 'A'])
    e.press('redo')
    expect(picked()).toEqual([[{ id: 'rect', frameId: 'B' }], 'B'])
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
    a.core.select(['rect'])
    const from = middle(a, 'rect')
    const to = at(a, 'B', 50, 50)
    a.mouse.move(from.x, from.y)
    a.mouse.down()
    a.mouse.move(to.x, to.y, { steps: 8 })
    await new Promise((resolve) => setTimeout(resolve, 80))
    await settle()
    b.core.redraw()
    const shown = b.modules.view.previewed()
    expect(shown.nodes.rect?.parentId).toBe('A')
    // Where Ann's drag has it: past A's edge, at B's point 50, 50 on the page.
    expect(shown.nodes.rect?.props).toMatchObject({ x: 520, y: 20 })
    a.mouse.up()
    await settle()
    b.core.redraw()
    expect(b.core.design().nodes.rect?.parentId).toBe('B')
    expect(b.modules.view.previewed().nodes.rect?.parentId).toBe('B')
  })
})
