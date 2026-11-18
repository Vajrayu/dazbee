// The Alt-drag over each kind of layer of the gesture matrix's design and the states the test grid
// names, in the whole editor opened in Node: what is copied, where the copy lands, and one undo.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import type { Design, DesignInput } from '@dazbee/schema'

import { HALF } from '../../canvas/test-images.ts'
import { DESIGN } from '../../test-actions.ts'
import { testEditor } from '../../test-editor.ts'
import { FLOW as PLACED_BY, matrixDesign, SUBJECTS } from '../../test-matrix/matrix-design.ts'
import type { PointerInput } from '../inputs.ts'

type Opened = Awaited<ReturnType<typeof testEditor>>

const deepCopy = (design: Design) => JSON.parse(JSON.stringify(design)) as Design
const PHOTO_ID = 'alt-drag-photo'
const PHOTO = HALF.encodeToBytes() as Uint8Array
/** How far each Alt-drag goes, in the square frame's design pixels: small, so nothing drops into a flow. */
const BY = { x: 16, y: 12 }

/** Where a layer is drawn in the square frame: its centre, in design pixels, rounded. */
function centreOf(editor: Opened, id: string) {
  const box = editor.core.boxOf(id)
  if (!box) throw new Error(`${id} is not drawn`)
  return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) }
}
/** A drag of a layer's selection from its centre by `BY`, with Alt held throughout or not. */
function dragBy(editor: Opened, id: string, alt: boolean) {
  const from = centreOf(editor, id)
  const stage = (p: { x: number; y: number }) => editor.core.stagePoint(p.x, p.y, 'sq')
  editor.mouse.drag(stage(from), stage({ x: from.x + BY.x, y: from.y + BY.y }), { alt })
}
/** A layer as stored, but for the key that orders it among its siblings. */
function unordered(design: Design, id: string) {
  return Object.fromEntries(Object.entries(design.nodes[id] ?? {}).filter(([key]) => key !== 'index'))
}
/** The ids a container holds, in their order, leaving out any not in `kept`. */
function orderIn(design: Design, parentId: string, kept: Design) {
  return Object.entries(design.nodes)
    .filter(([id, node]) => node.parentId === parentId && id in kept.nodes)
    .sort(([, a], [, b]) => (a.index < b.index ? -1 : 1))
    .map(([id]) => id)
}

describe('Alt-drag over the gesture matrix', () => {
  let editor: Opened
  let before: Design
  const made = () => Object.keys(editor.core.design().nodes).filter((id) => !(id in before.nodes))

  beforeAll(async () => {
    editor = await testEditor(matrixDesign(PHOTO_ID), {
      sources: { assetBytes: (id) => (id === PHOTO_ID ? Promise.resolve(PHOTO) : Promise.reject(new Error(id))) },
    })
    editor.core.setSnapping(false)
    before = deepCopy(editor.core.design())
  })
  afterAll(() => editor.end())
  // Each test starts from the design as opened, whatever the one before left.
  afterEach(() => {
    while (editor.core.canUndo() && made().length > 0) editor.core.perform('undo')
  })

  /** The boxes whose flow places layers. */
  const flows = new Set(Object.values(PLACED_BY))
  const free = SUBJECTS.filter((subject) => !(subject in PLACED_BY) && !flows.has(subject))
  /**
   * An Alt-drag of a layer selected alone puts its one copy where a move by the same drag puts the
   * layer, leaves the layer as it was and selects the copy; one undo gives the design as opened.
   */
  function copiesWhereAMoveGoes(id: string) {
    const { core } = editor
    core.pickLayer({ id, frameId: 'sq' })
    core.redraw()
    dragBy(editor, id, false)
    const moved = { parentId: core.design().nodes[id]?.parentId, centre: centreOf(editor, id) }
    core.perform('undo')
    dragBy(editor, id, true)
    const now = core.design()
    const roots = made().filter((copy) => !made().includes(now.nodes[copy]?.parentId ?? ''))
    expect(roots).toHaveLength(1)
    const [copy = ''] = roots
    expect(now.nodes[copy]?.type).toBe(before.nodes[id]?.type)
    expect({ parentId: now.nodes[copy]?.parentId, centre: centreOf(editor, copy) }).toEqual(moved)
    expect(unordered(deepCopy(now), id)).toEqual(unordered(before, id))
    const parentId = before.nodes[id]?.parentId ?? ''
    expect(orderIn(now, parentId, before)).toEqual(orderIn(before, parentId, before))
    expect(core.selection()).toEqual([copy])
    expect(core.undoName()).toBe('duplicate')
    core.perform('undo')
    expect(deepCopy(core.design())).toEqual(before)
  }
  it.each(free)(
    'copies %s where a move by the same drag puts it, the original as it was, the copy selected; one undo',
    copiesWhereAMoveGoes,
  )

  it.each(Object.keys(PLACED_BY).filter((id) => (SUBJECTS as readonly string[]).includes(id)))(
    'drops the copy of %s, which a flow places, in its flow where the same drag without Alt drops it, the original staying',
    (id) => {
      const { core } = editor
      const parentId = before.nodes[id]?.parentId ?? ''
      core.pickLayer({ id, frameId: 'sq' })
      core.redraw()
      dragBy(editor, id, false)
      const reordered = orderIn(core.design(), parentId, before)
      if (core.canUndo()) core.perform('undo')
      core.pickLayer({ id, frameId: 'sq' })
      core.redraw()
      dragBy(editor, id, true)
      const now = deepCopy(core.design())
      const roots = made().filter((one) => !made().includes(now.nodes[one]?.parentId ?? ''))
      expect(roots).toHaveLength(1)
      const [copy = ''] = roots
      expect(now.nodes[copy]?.parentId).toBe(parentId)
      const withCopy = orderIn(now, parentId, {
        ...before,
        nodes: { ...before.nodes, [copy]: now.nodes[copy] },
      } as Design)
      expect(withCopy.filter((one) => one !== id).map((one) => (one === copy ? id : one))).toEqual(reordered)
      expect(unordered(now, id)).toEqual(unordered(before, id))
      expect(core.selection()).toEqual([copy])
      expect(core.undoName()).toBe('duplicate')
      core.perform('undo')
      expect(deepCopy(core.design())).toEqual(before)
    },
  )

  it.each([...flows].filter((id) => (SUBJECTS as readonly string[]).includes(id)))(
    'lands the copy of %s, an auto layout box, beside its original, as a move of the box would',
    copiesWhereAMoveGoes,
  )

  it('copies a mask alone as an ordinary layer, its Mask group keeping its one mask', () => {
    const { core } = editor
    core.pickLayer({ id: 'mask', frameId: 'sq' })
    core.redraw()
    dragBy(editor, 'mask', true)
    const [copy = ''] = made()
    const props = (id: string) => core.design().nodes[id]?.props as { mask?: string }
    expect(props(copy).mask).toBeUndefined()
    expect(props('mask').mask).toBe('alpha')
    core.perform('undo')
  })

  it('copies a whole Mask group where a move puts it, the copy holding a mask and what it masks', () => {
    copiesWhereAMoveGoes('maskGroup')
    const { core } = editor
    core.perform('redo')
    const now = core.design()
    const [group = ''] = made().filter((id) => now.nodes[id]?.parentId === 'sq')
    const held = made().filter((id) => now.nodes[id]?.parentId === group)
    const masks = held.map((id) => (now.nodes[id]?.props as { mask?: string }).mask)
    expect(now.nodes[group]?.type).toBe('group')
    expect(masks.sort()).toEqual(['alpha', undefined])
  })

  it('copies several selected layers, each moved alike', () => {
    const { core } = editor
    core.select(['shape', 'box'])
    core.redraw()
    const was = [centreOf(editor, 'shape'), centreOf(editor, 'box')]
    dragBy(editor, 'shape', true)
    const copies = made().filter((id) => core.design().nodes[id]?.parentId === 'sq')
    expect(copies).toHaveLength(2)
    expect(copies.map((id) => centreOf(editor, id))).toEqual(was.map(({ x, y }) => ({ x: x + BY.x, y: y + BY.y })))
    core.perform('undo')
    expect(deepCopy(core.design())).toEqual(before)
  })

  it('copies the selected layers of linked frames in each frame, the copies unlinked', () => {
    const { core } = editor
    core.select(['shape', 'wide-shape'])
    core.redraw()
    dragBy(editor, 'shape', true)
    const now = core.design()
    const copies = made().filter((id) => now.nodes[id]?.type === 'graphic')
    expect(copies.map((id) => now.nodes[id]?.parentId).sort()).toEqual(['sq', 'wide'])
    const links = copies.map((id) => now.nodes[id]?.link)
    expect(new Set(links).size).toBe(2)
    expect(links).not.toContain(before.nodes.shape?.link)
    core.perform('undo')
    expect(deepCopy(core.design())).toEqual(before)
  })
})

describe('Alt-drag states', () => {
  /** The editor over the actions' design with `a` changed as given. */
  async function openWith(a: Record<string, unknown> = {}) {
    const design = { ...DESIGN, nodes: { ...DESIGN.nodes, a: { ...DESIGN.nodes.a, ...a } } } as DesignInput
    const editor = await testEditor(design)
    const at = (x: number, y: number) => editor.core.stagePoint(x, y, 'sq')
    const was = deepCopy(editor.core.design())
    const made = () => Object.keys(editor.core.design().nodes).filter((id) => !(id in was.nodes))
    return { editor, core: editor.core, at, was, made }
  }

  it('copies a hidden layer, which stays hidden', async () => {
    const { editor, core, at, made } = await openWith({ props: { ...DESIGN.nodes.a?.props, visible: false } })
    core.select(['a'])
    core.redraw()
    editor.mouse.drag(at(150, 150), at(300, 300), { alt: true })
    const [copy = ''] = made()
    expect(core.design().nodes[copy]?.props).toMatchObject({ visible: false })
    expect(core.boxOf(copy)).toMatchObject({ x: 250, y: 250 })
    editor.end()
  })

  it('copies a turned layer, turned alike', async () => {
    const { editor, core, at, made } = await openWith({ props: { ...DESIGN.nodes.a?.props, rotation: 30 } })
    editor.mouse.drag(at(150, 150), at(300, 150), { alt: true })
    const [copy = ''] = made()
    expect(core.design().nodes[copy]?.props).toMatchObject({ rotation: 30 })
    expect(core.design().nodes.a?.props).toMatchObject({ x: 100, y: 100, rotation: 30 })
    editor.end()
  })

  it('copies a line, a line alike', async () => {
    const line = {
      height: 0,
      shape: { kind: 'line' },
      strokes: [{ paint: { type: 'solid', color: '#000000FF' }, width: 4 }],
    }
    const { editor, core, at, made } = await openWith({ props: { ...DESIGN.nodes.a?.props, ...line } })
    core.select(['a'])
    core.redraw()
    editor.mouse.drag(at(150, 100), at(300, 250), { alt: true })
    const [copy = ''] = made()
    expect(made()).toHaveLength(1)
    expect(core.design().nodes[copy]?.props).toMatchObject({ shape: { kind: 'line' } })
    expect(core.boxOf(copy)).toMatchObject({ x: 250, y: 250, width: 100, height: 0 })
    expect(core.boxOf('a')).toMatchObject({ x: 100, y: 100, width: 100, height: 0 })
    editor.end()
  })

  it('keeps the copy to one axis with Shift held with Alt', async () => {
    const { editor, core, at, made } = await openWith()
    editor.mouse.drag(at(150, 150), at(400, 170), { alt: true, shift: true })
    expect(core.boxOf(made()[0] ?? '')).toMatchObject({ x: 350, y: 100 })
    expect(core.boxOf('a')).toMatchObject({ x: 100, y: 100 })
    editor.end()
  })

  it('copies by a pen as by a mouse, and by touch on a device a mouse used first', async () => {
    const { editor, core, at, was, made } = await openWith()
    const send = (type: PointerInput['type'], x: number, y: number, pointerType: string) => {
      core.input.pointer({
        ...{ type, at: at(x, y), button: 0, detail: 0, shiftKey: false, altKey: true, ctrlKey: false, metaKey: false },
        pointerType,
      })
      core.redraw()
    }
    send('pointermove', 600, 600, 'mouse')
    for (const pointerType of ['pen', 'touch']) {
      send('pointerdown', 150, 150, pointerType)
      send('pointermove', 200, 160, pointerType)
      send('pointermove', 250, 170, pointerType)
      send('pointerup', 250, 170, pointerType)
      expect(made()).toHaveLength(1)
      expect(core.boxOf(made()[0] ?? '')).toMatchObject({ x: 200, y: 120 })
      expect(core.boxOf('a')).toMatchObject({ x: 100, y: 100 })
      core.perform('undo')
      expect(deepCopy(core.design())).toEqual(was)
      core.select(['a'])
      core.redraw()
    }
    editor.end()
  })
})
