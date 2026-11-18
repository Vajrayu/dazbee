// An Alt-drag of layers auto layout places, in the whole editor opened in Node: the copies land where
// the same drag without Alt drops the originals, at each of its ends.
import { describe, expect, it } from 'vitest'

import { childrenOf, descendants, type DesignStore, openSession } from '@dazbee/doc'
import { anotherTab } from '@dazbee/doc/test-store'
import type { Design, DesignInput, Point, Rect } from '@dazbee/schema'

import { FLOW } from '../../test-actions.ts'
import type { ReorderDrag } from './auto-layout-drag.ts'
import { openAltDrag } from './test-alt-drag.ts'

const deepCopy = (design: Design) => JSON.parse(JSON.stringify(design)) as Design
const PAD = { top: 20, right: 20, bottom: 20, left: 20 }

type NodeInput = DesignInput['nodes'][string]
const FLOW_BOX = FLOW.nodes.flow as NodeInput

/** FLOW with a node changed or added. */
function withNodes(nodes: Record<string, NodeInput>): DesignInput {
  return { ...FLOW, nodes: { ...FLOW.nodes, ...nodes } }
}
/** FLOW with its row's props changed. */
function withFlow(props: Partial<NodeInput['props']>): DesignInput {
  return withNodes({ flow: { ...FLOW_BOX, props: { ...FLOW_BOX.props, ...props } } as NodeInput })
}
const GRID = withFlow({ layout: { direction: 'grid', columns: 2, gap: 20, padding: PAD } })
const TURNED = withFlow({ rotation: 90 })
const COLUMN = withFlow({
  sizing: { width: 'hug', height: 'hug' },
  layout: { direction: 'column', gap: 20, padding: PAD },
})
const IN_GROUP = withNodes({
  grp: {
    type: 'group',
    parentId: 'sq',
    link: 'grp',
    index: 'a5',
    name: 'Grp',
    props: { x: 40, y: 800, width: 560, height: 160 },
  },
  flow: { ...FLOW_BOX, parentId: 'grp', index: 'a0' },
})
const LOCKED = withNodes({ fixed: { ...(FLOW.nodes.fixed as NodeInput), lock: { delete: true } } })
/** A layer of a type linked by `link`, stored at a box, with its other props. */
const layer = (link: string, type: string, parentId: string, index: string, box: Rect, props = {}) =>
  ({ type, parentId, link, index, name: link, props: { ...box, ...props } }) as NodeInput
const RECT = { shape: { kind: 'rect' } }
const MASK = { shape: { kind: 'ellipse' }, mask: 'alpha' }
/** FLOW with a group last in its row, holding two rectangles of different sizes and a Mask group under them. */
const GROUPED = withNodes({
  grp: layer('grp', 'group', 'flow', 'a3', { x: 400, y: 800, width: 120, height: 120 }),
  g1: layer('g1', 'graphic', 'grp', 'a0', { x: 400, y: 800, width: 50, height: 50 }, RECT),
  g2: layer('g2', 'graphic', 'grp', 'a1', { x: 470, y: 800, width: 50, height: 60 }, RECT),
  masked: layer('masked', 'group', 'grp', 'a2', { x: 400, y: 860, width: 120, height: 60 }),
  mask: layer('mask', 'graphic', 'masked', 'a0', { x: 400, y: 860, width: 120, height: 60 }, MASK),
  inMask: layer('inMask', 'graphic', 'masked', 'a1', { x: 420, y: 870, width: 60, height: 40 }, RECT),
})

/** A design whose every layer is named by its id, so a copy, which keeps its original's name, names the layer it copies. */
function named(design: DesignInput): DesignInput {
  return {
    ...design,
    nodes: Object.fromEntries(Object.entries(design.nodes).map(([id, node]) => [id, { ...node, name: id }])),
  }
}

/** Deletes layers in another tab and brings the change into the editor's store. */
function deleteElsewhere(store: DesignStore, ids: string[]) {
  const other = anotherTab(store)
  openSession(other.store).run('node.delete', { ids })
  other.deliver()
}

/** A layer as stored, without its order key. */
function unindexed(design: Design, id: string) {
  return { ...design.nodes[id], index: undefined }
}

/** A design point, or the middle of a layer as drawn. */
type To = Point | string

/**
 * Drags the layers `picked` of a design, each named by its id, from the middle of `fromId` to a
 * point or another layer's middle, with Alt held from before the press or without, another tab
 * deleting `gone` just before the release; and tells what the drag dropped: each dropped layer (the
 * copies with Alt, the layers themselves without), its parent, the names of the layers there other
 * than the originals in their order, its box, its sizing, and the box of each layer inside it by
 * name; and whether the originals, the selection and one undo are as they should be.
 */
async function dragged(
  design: DesignInput,
  picked: string[],
  fromId: string,
  to: To,
  alt: boolean,
  gone: string[] = [],
) {
  const { editor, core, mouse, keys, at, made, before } = await openAltDrag(named(design))
  core.select(picked)
  core.redraw()
  const middle = (id: string) => {
    const box = core.boxOf(id) as { x: number; y: number; width: number; height: number }
    return at(box.x + box.width / 2, box.y + box.height / 2)
  }
  const [from, end] = [middle(fromId), typeof to === 'string' ? middle(to) : at(to.x, to.y)]
  if (alt) keys.down('Alt')
  mouse.move(from.x, from.y)
  mouse.down()
  mouse.move(end.x, end.y, { steps: 8 })
  if (gone.length > 0) {
    deleteElsewhere(core.store, gone)
    core.redraw()
  }
  mouse.up()
  if (alt) keys.up('Alt')
  const now = deepCopy(core.design())
  const copies = made().filter((id) => !made().includes(now.nodes[id]?.parentId ?? ''))
  const name = (id: string) => now.nodes[id]?.name
  const dropped = picked
    .filter((id) => now.nodes[id])
    .map((id) => (alt ? (copies.find((copy) => name(copy) === id) ?? '') : id))
  const parent = now.nodes[dropped[0] ?? '']?.parentId ?? ''
  const result = {
    made: copies.length,
    parents: dropped.map((id) => now.nodes[id]?.parentId),
    place: childrenOf(now, parent)
      .map(([id]) => id)
      .filter((id) => !(alt && picked.includes(id)))
      .map(name),
    boxes: dropped.map((id) => core.boxOf(id)),
    sizing: dropped.map((id) => (now.nodes[id]?.props as { sizing?: unknown } | undefined)?.sizing),
    inner: Object.fromEntries(dropped.flatMap((id) => descendants(now, id)).map((id) => [name(id), core.boxOf(id)])),
  }
  // As before the press but for the stored order key, which a copy beside them rewrites.
  const originals = picked.map((id) => JSON.stringify(unindexed(now, id)) === JSON.stringify(unindexed(before, id)))
  const after = { selection: core.selection(), undoName: core.undoName(), originals, copies }
  core.perform('undo')
  const undone = JSON.stringify(deepCopy(core.design())) === JSON.stringify(before)
  const more = core.canUndo()
  editor.end()
  return { result, after, undone, more }
}

/**
 * D5's cases: the design, the layers selected, the one pressed on, where the drag ends, and whether
 * the drop keeps them in their flow, where the flow and not the drop places them.
 */
const CASES: [name: string, design: DesignInput, picked: string[], fromId: string, to: To, inFlow: boolean][] = [
  ['a row: past the next layer', FLOW, ['fixed'], 'fixed', { x: 450, y: 880 }, true],
  ['a row: dropped where it is', FLOW, ['fixed'], 'fixed', { x: 130, y: 880 }, true],
  ['a row: a filling layer out onto the frame', FLOW, ['filling'], 'filling', { x: 620, y: 300 }, false],
  ['a row: a box holding a layer out onto the frame', FLOW, ['hugging'], 'hugging', { x: 800, y: 400 }, false],
  ['a row: into another flow', FLOW, ['fixed'], 'fixed', { x: 300, y: 550 }, false],
  ['a row: two layers at once past the last', FLOW, ['fixed', 'filling'], 'fixed', { x: 590, y: 880 }, true],
  ['a row: two layers at once out onto the frame', FLOW, ['fixed', 'filling'], 'fixed', { x: 500, y: 300 }, false],
  [
    'a row: a group holding layers and a Mask group out onto the frame',
    GROUPED,
    ['grp'],
    'grp',
    { x: 800, y: 300 },
    false,
  ],
  ['a grid: onto the last cell', GRID, ['fixed'], 'fixed', 'hugging', true],
  ['a grid: out onto the frame', GRID, ['filling'], 'filling', { x: 800, y: 300 }, false],
  ['a turned flow box: along it', TURNED, ['fixed'], 'fixed', 'hugging', true],
  ['a turned flow box: out onto the frame', TURNED, ['filling'], 'filling', { x: 800, y: 300 }, false],
  ['a hugging column: along it', COLUMN, ['fixed'], 'fixed', 'hugging', true],
  ['a hugging column: out onto the frame', COLUMN, ['fixed'], 'fixed', { x: 800, y: 300 }, false],
  ['a flow box inside a group: along it', IN_GROUP, ['fixed'], 'fixed', 'hugging', true],
  ['a flow box inside a group: out onto what holds the box', IN_GROUP, ['fixed'], 'fixed', { x: 800, y: 300 }, false],
]

describe('Alt-drag in an auto layout box', () => {
  describe('drops the copies where the same drag without Alt drops the originals', () => {
    for (const [name, design, picked, fromId, to, inFlow] of CASES) {
      it(name, async () => {
        const plain = await dragged(design, picked, fromId, to, false)
        const copy = await dragged(design, picked, fromId, to, true)
        expect(plain.result.made).toBe(0)
        expect(copy.result.made).toBe(picked.length)
        expect(copy.result.parents).toEqual(plain.result.parents)
        expect(copy.result.place).toEqual(plain.result.place)
        expect(copy.result.sizing).toEqual(plain.result.sizing)
        // Out of their flow the drop places them; in it, the flow does, beside the originals that stay.
        if (!inFlow) {
          expect(copy.result.boxes).toEqual(plain.result.boxes)
          expect(copy.result.inner).toEqual(plain.result.inner)
        }
        expect(copy.after.originals).toEqual(picked.map(() => true))
        expect(copy.after.selection).toEqual(copy.after.copies)
        expect(copy.after.undoName).toBe('duplicate')
        expect(copy.undone).toBe(true)
        expect(copy.more).toBe(false)
      })
    }
  })

  /** FLOW with its fixed layer selected, opened in Node, and what a drag in its row shows. */
  async function open(design: DesignInput = FLOW, picked = ['fixed']) {
    const opened = await openAltDrag(design)
    const { editor, core } = opened
    core.select(picked)
    core.redraw()
    const { autoLayoutDrag, pointer } = editor.modules
    const shown = () => autoLayoutDrag.shown(pointer.gesture() as ReorderDrag).map((part) => part.kind)
    const flow = () => childrenOf(core.design(), 'flow').map(([id]) => (opened.made().includes(id) ? 'copy' : id))
    return { ...opened, shown, flow }
  }

  describe('makes the copies at the release', () => {
    it('shows no outline of the box the layers would leave while Alt is held, and makes nothing before the release', async () => {
      const { editor, core, mouse, keys, go, made, shown } = await open()
      go(120, 880)
      mouse.down()
      go(700, 300)
      expect(shown()).toEqual(['ghost', 'leave'])
      keys.down('Alt')
      expect(shown()).toEqual(['ghost'])
      expect(made()).toEqual([])
      expect(core.selection()).toEqual(['fixed'])
      keys.up('Alt')
      expect(shown()).toEqual(['ghost', 'leave'])
      keys.down('Alt')
      mouse.up()
      keys.up('Alt')
      expect(made()).toHaveLength(1)
      expect(core.selection()).toEqual(made())
      editor.end()
    })

    it('shows the line where the copies would go in the flow with Alt as without it', async () => {
      const { editor, mouse, keys, go, shown } = await open()
      go(120, 880)
      mouse.down()
      go(450, 880)
      expect(shown()).toEqual(['ghost', 'line'])
      keys.down('Alt')
      expect(shown()).toEqual(['ghost', 'line'])
      mouse.up()
      keys.up('Alt')
      editor.end()
    })

    it('Alt pressed by a key with the pointer still, then the release: a copy; one undo, then redo', async () => {
      const { editor, core, mouse, keys, go, made, flow, unchanged } = await open()
      go(120, 880)
      mouse.down()
      go(450, 880)
      keys.down('Alt')
      mouse.up()
      keys.up('Alt')
      expect(flow()).toEqual(['fixed', 'filling', 'copy', 'hugging'])
      expect(core.undoName()).toBe('duplicate')
      core.perform('undo')
      unchanged()
      expect(core.canUndo()).toBe(false)
      core.perform('redo')
      expect(made()).toHaveLength(1)
      expect(flow()).toEqual(['fixed', 'filling', 'copy', 'hugging'])
      editor.end()
    })

    it('Alt from pointer inputs alone, pressed during the drag, makes a copy; let go at the release with no key heard, a reorder', async () => {
      const { editor, core, send, made, flow } = await open()
      send('pointermove', 120, 880)
      send('pointerdown', 120, 880)
      send('pointermove', 300, 880)
      send('pointermove', 450, 880, true)
      send('pointerup', 450, 880, true)
      expect(flow()).toEqual(['fixed', 'filling', 'copy', 'hugging'])
      core.perform('undo')
      core.select(['fixed'])
      send('pointermove', 120, 880, true)
      send('pointerdown', 120, 880, true)
      send('pointermove', 450, 880, true)
      send('pointerup', 450, 880, false)
      expect(made()).toEqual([])
      expect(flow()).toEqual(['filling', 'fixed', 'hugging'])
      expect(core.undoName()).toBe('move')
      editor.end()
    })

    it('dropped where it is, lands the copy right after its original', async () => {
      const { editor, mouse, keys, go, flow } = await open()
      keys.down('Alt')
      go(120, 880)
      mouse.down()
      go(130, 880)
      mouse.up()
      keys.up('Alt')
      expect(flow()).toEqual(['fixed', 'copy', 'filling', 'hugging'])
      editor.end()
    })

    it('Alt pressed only at the release makes a copy', async () => {
      const { editor, send, flow } = await open()
      send('pointermove', 120, 880)
      send('pointerdown', 120, 880)
      send('pointermove', 450, 880)
      send('pointerup', 450, 880, true)
      expect(flow()).toEqual(['fixed', 'filling', 'copy', 'hugging'])
      editor.end()
    })

    it('copies a layer locked against deleting; one undo takes the copy away', async () => {
      const { editor, core, keys, mouse, go, made, unchanged } = await open(LOCKED)
      keys.down('Alt')
      go(120, 880)
      mouse.down()
      go(700, 300)
      mouse.up()
      keys.up('Alt')
      const [copy = ''] = made()
      expect(core.design().nodes[copy]).toMatchObject({ parentId: 'sq', lock: { delete: true } })
      expect(core.design().nodes.fixed?.parentId).toBe('flow')
      core.perform('undo')
      unchanged()
      editor.end()
    })
  })

  describe('ends as a reorder ends', () => {
    it('Escape drops it: nothing made, nothing to undo', async () => {
      const { editor, core, mouse, keys, go, unchanged } = await open()
      keys.down('Alt')
      go(120, 880)
      mouse.down()
      go(450, 880)
      keys.down('Escape')
      mouse.up()
      keys.up('Alt')
      unchanged()
      expect(core.canUndo()).toBe(false)
      editor.end()
    })

    it('copies only the layers still in the design at the release: one of two deleted by another tab, one copy, nothing thrown', async () => {
      const { editor, core, mouse, keys, go, made } = await open(FLOW, ['fixed', 'filling'])
      keys.down('Alt')
      go(120, 880)
      mouse.down()
      go(700, 300)
      deleteElsewhere(core.store, ['filling'])
      core.redraw()
      mouse.up()
      keys.up('Alt')
      expect(made()).toHaveLength(1)
      expect(core.design().nodes[made()[0] ?? '']?.parentId).toBe('sq')
      expect(core.selection()).toEqual(made())
      editor.end()
    })

    for (const gone of ['fixed', 'filling']) {
      it(`${gone} of two layers dragged out deleted by another tab before the release: the other's copy lands where the same drag without Alt drops it`, async () => {
        const picked = ['fixed', 'filling']
        const plain = await dragged(FLOW, picked, 'fixed', { x: 700, y: 300 }, false, [gone])
        const copy = await dragged(FLOW, picked, 'fixed', { x: 700, y: 300 }, true, [gone])
        expect(copy.result).toEqual({ ...plain.result, made: 1 })
        expect(copy.after.selection).toEqual(copy.after.copies)
      })
    }
  })

  describe('the cursor', () => {
    it('shows copy over a selected layer a flow places with Alt, and through its reorder; none once Alt is let go', async () => {
      const { editor, core, mouse, keys, go } = await open()
      keys.down('Alt')
      go(120, 880)
      expect(core.input.cursor()).toBe('copy')
      mouse.down()
      go(450, 880)
      expect(core.input.cursor()).toBe('copy')
      keys.up('Alt')
      expect(core.input.cursor()).toBe('')
      mouse.up()
      editor.end()
    })
  })
})
