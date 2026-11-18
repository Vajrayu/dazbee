// An Alt-drag in the whole editor, opened in Node with a mouse and keys that send what a browser
// sends: copies made and taken away as Alt changes, its one undo step, the cursor and measure.
import { describe, expect, it } from 'vitest'

import type { DesignInput } from '@dazbee/schema'

import { HALF } from '../../canvas/test-images.ts'
import { DESIGN, FLOW, WORDS } from '../../test-actions.ts'
import { openAltDrag as open } from './test-alt-drag.ts'

const PHOTO_ID = 'alt-drag-photo'
const PHOTO = Promise.resolve(HALF.encodeToBytes() as Uint8Array)

describe('Alt-drag', () => {
  describe('copies', () => {
    it('with Alt down before the press: the original stays, its copy follows and is selected, one undo step named duplicate', async () => {
      const { editor, core, mouse, keys, at, made, unchanged } = await open()
      keys.down('Alt')
      mouse.drag(at(150, 150), at(450, 450))
      keys.up('Alt')
      const [copy = ''] = made()
      expect(made()).toHaveLength(1)
      expect(core.boxOf('a')).toMatchObject({ x: 100, y: 100 })
      expect(core.boxOf(copy)).toMatchObject({ x: 400, y: 400 })
      expect(core.selection()).toEqual([copy])
      expect(core.undoName()).toBe('duplicate')
      core.perform('undo')
      unchanged()
      expect(core.canUndo()).toBe(false)
      core.perform('redo')
      expect(core.boxOf(made()[0] ?? '')).toMatchObject({ x: 400, y: 400 })
      editor.end()
    })

    it('from pointer inputs alone, no key heard, with no redraw between them', async () => {
      const { editor, core, mouse, at, made, unchanged } = await open()
      mouse.drag(at(150, 150), at(450, 450), { alt: true, redraws: false })
      core.redraw()
      expect(core.boxOf('a')).toMatchObject({ x: 100, y: 100 })
      expect(core.boxOf(made()[0] ?? '')).toMatchObject({ x: 400, y: 400 })
      core.perform('undo')
      unchanged()
      editor.end()
    })

    it('Alt pressed and let go with the pointer still makes the copy where the drag is and takes it away; again, then a release: one step named duplicate', async () => {
      const { editor, core, mouse, keys, go, made, unchanged } = await open()
      go(150, 150)
      mouse.down()
      go(300, 150)
      expect(core.boxOf('a')).toMatchObject({ x: 250, y: 100 })
      keys.down('Alt')
      expect(core.boxOf('a')).toMatchObject({ x: 100, y: 100 })
      expect(core.boxOf(made()[0] ?? '')).toMatchObject({ x: 250, y: 100 })
      expect(core.selection()).toEqual(made())
      keys.up('Alt')
      expect(made()).toEqual([])
      expect(core.boxOf('a')).toMatchObject({ x: 250, y: 100 })
      expect(core.selection()).toEqual(['a'])
      keys.down('Alt')
      mouse.up()
      keys.up('Alt')
      expect(made()).toHaveLength(1)
      expect(core.undoName()).toBe('duplicate')
      core.perform('undo')
      unchanged()
      expect(core.canUndo()).toBe(false)
      editor.end()
    })

    it('a key’s Alt before the first move of a press runs no move; after one, Alt down and up with the pointer still makes the copy and takes it away', async () => {
      const { editor, core, keys, send, made, unchanged } = await open()
      send('pointermove', 600, 600)
      send('pointerdown', 150, 150, false, 'touch')
      keys.down('Alt')
      unchanged()
      send('pointermove', 200, 180, true, 'touch')
      const where = core.boxOf(made()[0] ?? '')
      expect(core.boxOf('a')).toMatchObject({ x: 100, y: 100 })
      keys.up('Alt')
      expect(made()).toEqual([])
      expect(core.boxOf('a')).toMatchObject({ x: where?.x, y: where?.y })
      keys.down('Alt')
      expect(core.boxOf(made()[0] ?? '')).toMatchObject({ x: where?.x, y: where?.y })
      expect(core.boxOf('a')).toMatchObject({ x: 100, y: 100 })
      send('pointerup', 200, 180, true, 'touch')
      keys.up('Alt')
      expect(made()).toHaveLength(1)
      editor.end()
    })

    it('by the release alone: let go there with no key heard, a move; pressed only there, a copy', async () => {
      const { editor, core, send, made } = await open()
      send('pointermove', 150, 150, true)
      send('pointerdown', 150, 150, true)
      send('pointermove', 300, 400, true)
      expect(made()).toHaveLength(1)
      send('pointerup', 300, 400, false)
      expect(made()).toEqual([])
      expect(core.boxOf('a')).toMatchObject({ x: 250, y: 350 })
      expect(core.undoName()).toBe('move')
      core.perform('undo')
      send('pointermove', 150, 150)
      send('pointerdown', 150, 150)
      send('pointermove', 300, 400)
      send('pointerup', 300, 400, true)
      expect(made()).toHaveLength(1)
      expect(core.boxOf('a')).toMatchObject({ x: 100, y: 100 })
      expect(core.undoName()).toBe('duplicate')
      editor.end()
    })

    it('Alt let go before the release: a move named move, no layer more; Duplicate after it steps 20', async () => {
      const { editor, core, mouse, keys, go, made, unchanged } = await open()
      keys.down('Alt')
      go(150, 150)
      mouse.down()
      go(300, 150)
      expect(made()).toHaveLength(1)
      keys.up('Alt')
      go(330, 150)
      mouse.up()
      expect(made()).toEqual([])
      expect(core.boxOf('a')).toMatchObject({ x: 280, y: 100 })
      expect(core.undoName()).toBe('move')
      expect(core.selection()).toEqual(['a'])
      core.perform('duplicate')
      expect(core.boxOf(made()[0] ?? '')).toMatchObject({ x: 300, y: 120 })
      core.perform('undo')
      core.perform('undo')
      unchanged()
      editor.end()
    })

    it('Duplicate after an Alt-drag repeats the drag’s step', async () => {
      const { editor, core, mouse, keys, at, made } = await open()
      keys.down('Alt')
      mouse.drag(at(150, 150), at(150, 300))
      keys.up('Alt')
      const [first = ''] = made()
      expect(core.boxOf(first)).toMatchObject({ x: 100, y: 250 })
      core.perform('duplicate')
      const second = made().find((id) => id !== first) ?? ''
      expect(core.boxOf(second)).toMatchObject({ x: 100, y: 400 })
      editor.end()
    })

    it('snaps a copy to its original: 3 off its right edge and its top, it lands on both', async () => {
      const { editor, core, mouse, keys, at, made } = await open()
      keys.down('Alt')
      mouse.drag(at(150, 150), at(253, 153))
      keys.up('Alt')
      expect(core.boxOf(made()[0] ?? '')).toMatchObject({ x: 200, y: 100 })
      editor.end()
    })

    it('snaps the copy of a layer alone in its frame to its original, the one layer there to snap to', async () => {
      const lone = { ...DESIGN, nodes: { a: DESIGN.nodes.a } } as DesignInput
      const { editor, core, mouse, keys, go, made } = await open(lone)
      keys.down('Alt')
      go(150, 150)
      mouse.down()
      go(453, 153)
      expect(core.boxOf(made()[0] ?? '')).toMatchObject({ x: 403, y: 100 })
      mouse.up()
      keys.up('Alt')
      editor.end()
    })

    it('with Alt let go, snaps the layer to what its move snaps to, never to its own place before the drag', async () => {
      const lone = { ...DESIGN, nodes: { a: DESIGN.nodes.a } } as DesignInput
      const { editor, core, mouse, keys, go, made } = await open(lone)
      keys.down('Alt')
      go(150, 150)
      mouse.down()
      go(453, 153)
      keys.up('Alt')
      expect(made()).toEqual([])
      expect(core.boxOf('a')).toMatchObject({ x: 403, y: 103 })
      mouse.up()
      editor.end()
    })

    it('copies a selection across frames in each frame, unlinked, moved alike; one undo', async () => {
      const { editor, core, mouse, keys, at, made, unchanged } = await open()
      core.select(['a', 'wide-a'])
      core.redraw()
      keys.down('Alt')
      mouse.drag(at(150, 150), at(450, 450))
      keys.up('Alt')
      const now = core.design()
      const copies = made()
      expect(copies.map((id) => now.nodes[id]?.parentId).sort()).toEqual(['sq', 'wide'])
      expect(copies.map((id) => core.boxOf(id))).toMatchObject([
        { x: 400, y: 400 },
        { x: 400, y: 400 },
      ])
      expect(new Set(copies.map((id) => now.nodes[id]?.link)).size).toBe(2)
      expect(copies.map((id) => now.nodes[id]?.link)).not.toContain('a')
      expect([...core.selection()].sort()).toEqual([...copies].sort())
      core.perform('undo')
      unchanged()
      editor.end()
    })

    it('drops a free copy over an auto layout box into its flow, the original staying', async () => {
      const { editor, core, mouse, keys, at, made, unchanged } = await open()
      keys.down('Alt')
      mouse.drag(at(150, 150), at(300, 550), { steps: 8 })
      keys.up('Alt')
      expect(core.design().nodes[made()[0] ?? '']?.parentId).toBe('row')
      expect(core.boxOf('a')).toMatchObject({ x: 100, y: 100 })
      core.perform('undo')
      unchanged()
      editor.end()
    })

    it('drops into the flow it is over the copy of a free layer drawn over an auto layout box, dragged out and back', async () => {
      const over = {
        ...DESIGN,
        nodes: {
          ...DESIGN.nodes,
          badge: {
            type: 'graphic',
            parentId: 'sq',
            index: 'a7',
            name: 'Badge',
            link: 'badge',
            props: { x: 150, y: 520, width: 40, height: 40, shape: { kind: 'rect' } },
          },
        },
      } as DesignInput
      const { editor, core, mouse, keys, go, made, unchanged } = await open(over)
      core.select(['badge'])
      core.redraw()
      keys.down('Alt')
      go(170, 540)
      mouse.down()
      go(600, 300)
      go(170, 540)
      mouse.up()
      keys.up('Alt')
      expect(made()).toHaveLength(1)
      expect(core.design().nodes[made()[0] ?? '']?.parentId).toBe('row')
      expect(core.design().nodes.badge?.parentId).toBe('sq')
      expect(core.undoName()).toBe('duplicate')
      core.perform('undo')
      unchanged()
      editor.end()
    })

    it('copies a group not gone into whole, and a layer of a group gone into inside it', async () => {
      const grouped = {
        ...DESIGN,
        nodes: {
          ...DESIGN.nodes,
          g: {
            type: 'group',
            parentId: 'sq',
            index: 'a6',
            name: 'G',
            link: 'g',
            props: { x: 400, y: 400, width: 100, height: 100 },
          },
          inG: {
            type: 'graphic',
            parentId: 'g',
            index: 'a0',
            name: 'In',
            link: 'inG',
            props: { x: 400, y: 400, width: 100, height: 100, shape: { kind: 'rect' } },
          },
        },
      } as DesignInput
      const { editor, core, mouse, keys, at, made, unchanged } = await open(grouped)
      keys.down('Alt')
      mouse.drag(at(450, 450), at(450, 650))
      keys.up('Alt')
      const whole = made().map((id) => core.design().nodes[id])
      expect(whole.map((node) => node?.type).sort()).toEqual(['graphic', 'group'])
      core.perform('undo')
      unchanged()
      core.pickLayer({ id: 'inG', frameId: 'sq' })
      core.redraw()
      keys.down('Alt')
      mouse.drag(at(450, 450), at(450, 650))
      keys.up('Alt')
      const [copy = ''] = made()
      expect(made()).toHaveLength(1)
      expect(core.design().nodes[copy]?.parentId).toBe('g')
      expect(core.boxOf(copy)).toMatchObject({ x: 400, y: 600 })
      // The group fits its layers again at the release.
      expect(core.boxOf('g')).toMatchObject({ x: 400, y: 400, height: 300 })
      core.perform('undo')
      unchanged()
      editor.end()
    })
  })

  describe('the cursor and measure', () => {
    it('shows copy over the selection with Alt and from the press to the release; a handle’s own over a handle; none elsewhere', async () => {
      const { editor, core, mouse, keys, at, go } = await open()
      const cursor = () => core.input.cursor()
      mouse.click(at(150, 150).x, at(150, 150).y)
      expect(cursor()).toBe('')
      keys.down('Alt')
      expect(cursor()).toBe('copy')
      go(300, 350)
      expect(cursor()).toBe('')
      go(600, 600)
      expect(cursor()).toBe('')
      const corner = editor.at('se') as { x: number; y: number }
      mouse.move(corner.x, corner.y)
      expect(cursor()).toBe('nwse-resize')
      go(300, 350)
      mouse.down()
      expect(cursor()).toBe('copy')
      go(400, 350)
      expect(cursor()).toBe('copy')
      keys.up('Alt')
      expect(cursor()).toBe('')
      keys.down('Alt')
      expect(cursor()).toBe('copy')
      mouse.up()
      expect(cursor()).toBe('copy')
      keys.up('Alt')
      expect(cursor()).toBe('')
      editor.end()
    })

    it('shows another tool’s own: none with the image tool and nothing to place, a cross with a draw tool', async () => {
      const { editor, core, mouse, keys, at, go } = await open()
      mouse.click(at(150, 150).x, at(150, 150).y)
      keys.down('Alt')
      go(160, 150)
      expect(core.input.cursor()).toBe('copy')
      core.setTool('image')
      go(150, 150)
      expect(core.input.cursor()).toBe('')
      core.setTool('rect')
      go(160, 150)
      expect(core.input.cursor()).toBe('crosshair')
      keys.up('Alt')
      editor.end()
    })

    it('while cropping, shows the crop’s own where a press crops', async () => {
      const photo = {
        ...DESIGN,
        nodes: {
          ...DESIGN.nodes,
          a: { ...DESIGN.nodes.a, props: { ...DESIGN.nodes.a?.props, fills: [{ type: 'image', assetId: PHOTO_ID }] } },
        },
      } as DesignInput
      const { editor, core, mouse, keys, at, go } = await open(photo, { sources: { assetBytes: () => PHOTO } })
      // The photo's left half shows: a press there picks it.
      mouse.dblclick(at(120, 150).x, at(120, 150).y)
      expect(editor.modules.selection.cropping()).not.toBeNull()
      keys.down('Alt')
      go(150, 150)
      expect(core.input.cursor()).toBe('move')
      mouse.down()
      expect(editor.modules.pointer.gesture()?.kind).toBe('crop')
      expect(core.input.cursor()).toBe('move')
      mouse.up()
      keys.up('Alt')
      editor.end()
    })

    it('over a path whose points are edited, shows what a press does: none on its points, which it drags; copy off them, where a press leaves them and copies the path', async () => {
      const pathed = {
        ...DESIGN,
        nodes: {
          ...DESIGN.nodes,
          zig: {
            type: 'graphic',
            parentId: 'sq',
            index: 'a6',
            name: 'Zig',
            link: 'zig',
            props: { x: 400, y: 400, width: 200, height: 200, shape: { kind: 'path', d: 'M0 0 L200 0 L200 200' } },
          },
        },
      } as DesignInput
      const { editor, core, mouse, keys, go, made } = await open(pathed)
      const { selection, pointer } = editor.modules
      core.select(['zig'])
      core.redraw()
      selection.editPath({ id: 'zig', frameId: 'sq' })
      core.redraw()
      keys.down('Alt')
      go(500, 400)
      expect(core.input.cursor()).toBe('')
      go(450, 550)
      expect(core.input.cursor()).toBe('copy')
      mouse.down()
      expect(selection.pathEditing()).toBeNull()
      expect(pointer.gesture()?.kind).toBe('move')
      go(650, 750)
      mouse.up()
      keys.up('Alt')
      expect(made()).toHaveLength(1)
      expect(core.boxOf('zig')).toMatchObject({ x: 400, y: 400 })
      editor.end()
    })

    it('shows no copy over two layers of two flows, which a move leaves where they are, hovering or dragging', async () => {
      const { editor, core, mouse, keys, go, made } = await open(FLOW)
      core.pickLayer({ id: 'inRow', frameId: 'sq' })
      core.redraw()
      core.toggleSelected('fixed')
      core.redraw()
      keys.down('Alt')
      go(125, 525)
      expect(core.input.cursor()).toBe('')
      mouse.down()
      expect(core.input.cursor()).toBe('')
      go(400, 300)
      expect(editor.modules.pointer.gesture()?.kind).toBe('move')
      expect(core.input.cursor()).toBe('')
      mouse.up()
      keys.up('Alt')
      expect(made()).toEqual([])
      editor.end()
    })

    it('asks once per hover move with Alt held for the handle under the pointer, the selection’s boxes and its layers by frame', async () => {
      const { editor, mouse, keys, at, go } = await open()
      const { boxes, transformDrag } = editor.modules
      mouse.click(at(150, 150).x, at(150, 150).y)
      keys.down('Alt')
      const asked = { handleUnder: 0, selectionBoxes: 0, rootsByFrame: 0 }
      const count = <T extends object>(module: T, name: keyof T & keyof typeof asked) => {
        const real = module[name] as (...args: unknown[]) => unknown
        Object.assign(module, {
          [name]: (...args: unknown[]) => {
            asked[name] += 1
            return real(...args)
          },
        })
      }
      count(transformDrag, 'handleUnder')
      count(boxes, 'selectionBoxes')
      count(boxes, 'rootsByFrame')
      for (let i = 0; i < 10; i++) go(120 + i * 6, 150)
      expect(editor.core.input.cursor()).toBe('copy')
      expect(asked).toEqual({ handleUnder: 10, selectionBoxes: 10, rootsByFrame: 10 })
      keys.up('Alt')
      editor.end()
    })

    it('shows no copy over the text being typed in', async () => {
      const { editor, core, mouse, keys, at } = await open(WORDS)
      mouse.dblclick(at(300, 850).x, at(300, 850).y)
      expect(editor.modules.typing.editing()).not.toBeNull()
      keys.down('Alt')
      mouse.move(at(320, 850).x, at(320, 850).y)
      expect(core.input.cursor()).not.toBe('copy')
      keys.up('Alt')
      editor.end()
    })

    it('measures with Alt and no press, nothing from the press to the release', async () => {
      const { editor, mouse, keys, at, go, made } = await open()
      const measured = () => editor.modules.pointer.measured()
      mouse.click(at(150, 150).x, at(150, 150).y)
      keys.down('Alt')
      go(300, 350)
      expect(measured()).not.toBeNull()
      go(150, 150)
      mouse.down()
      expect(measured()).toBeNull()
      go(400, 450)
      expect(made()).toHaveLength(1)
      expect(measured()).toBeNull()
      mouse.up()
      go(300, 350)
      expect(measured()).not.toBeNull()
      keys.up('Alt')
      editor.end()
    })
  })
})
