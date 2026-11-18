import { describe, expect, it, vi } from 'vitest'

import { type DesignInput, LAYER_CLIPBOARD_TYPE } from '@dazbee/schema'
import { SVG_TYPE } from '@dazbee/svg'

import type { ClipboardFile } from './clipboard.ts'
import { keyInput, pointerInput } from './gestures/test-inputs.ts'
import { harness as pointerHarness } from './gestures/test-pointer.ts'
import { editorKeys } from './keys.ts'
import { groupMovedByRow } from './layers/test-boxes.ts'
import { firstFrameOf, idsOf } from './selection.ts'
import { DESIGN } from './test-actions.ts'
import { testEditor } from './test-editor.ts'
import { BLUE, harness, remembering, SVG } from './test-place.ts'

/** The actions' design with its wide frame far to the right of the square, so a pan can leave only one in view. */
const FAR_APART: DesignInput = {
  ...DESIGN,
  frames: {
    ...DESIGN.frames,
    wide: { pageId: 'p1', name: 'Wide', width: 1200, height: 628, x: 4000, y: 0, order: 'a1' },
  },
}

/** A file on the clipboard with its text, which logs each time its contents are asked for. */
function fileOf(log: string[], name: string, type: string, text = ''): ClipboardFile {
  return {
    name,
    type,
    text: () => {
      log.push(`text of ${name}`)
      return Promise.resolve(text)
    },
    bytes: () => {
      log.push(`bytes of ${name}`)
      return Promise.resolve(new TextEncoder().encode(text))
    },
  }
}

describe('editorPlace', () => {
  describe('copy, cut and paste', () => {
    it('copies the selected layers as a payload, as they are, with their link ids and the page and frame they came from', () => {
      const { place, selection, wide } = harness()
      selection.select(['wide-a'], wide.id)
      const payload = place.copy()
      const copied = JSON.parse(payload?.data?.[LAYER_CLIPBOARD_TYPE] ?? '')
      expect(copied).toMatchObject({
        kind: 'dazbee.layers',
        designId: 'd',
        pageId: 'p1',
        frameId: 'wide',
        tree: { roots: ['wide-a'] },
      })
      expect(copied.tree.nodes['wide-a']).toMatchObject({ link: 'a', props: { fills: [BLUE] } })
      expect(payload?.text).toBe('Rect')
    })

    it('copies and cuts nothing with no layer selected', () => {
      const { place, session, log } = harness()
      expect(place.copy()).toBeNull()
      expect(place.cut()).toBeNull()
      expect(log).toEqual([])
      expect(session.canUndo()).toBe(false)
    })

    it('leaves the copy and the cut to the text being typed into, and gives what it gives', () => {
      const { place, session, selection, square, log } = harness(true)
      selection.select(['words'], square.id)
      expect(place.copy()).toEqual({ text: 'typed' })
      expect(place.cut()).toEqual({ text: 'typed' })
      expect(log).toEqual(['typing copy', 'typing cut'])
      expect(session.design().nodes.words).toBeDefined()
    })

    it('cuts the selected layers: given as a copy gives them, then deleted, as one undo step called cut', () => {
      const { place, session, selection, square, log } = harness()
      selection.select(['a'], square.id)
      const copied = place.copy()
      expect(place.cut()).toEqual(copied)
      expect(copied?.text).toBe('Rect')
      expect(log).toEqual(['delete'])
      expect(session.design().nodes.a).toBeUndefined()
      expect(session.undoName()).toBe('cut')
    })

    it('pastes copied layers where they were, in the selection’s frame, selected, as one undo step called paste', () => {
      const { place, session, selection, square, boxOf } = harness()
      selection.select(['a'], square.id)
      const copied = place.copy() ?? {}
      expect(place.paste(copied, () => null)).toBe(true)
      const [pasted] = idsOf(selection.current())
      expect(pasted).toBeDefined()
      expect(pasted).not.toBe('a')
      expect(boxOf(pasted ?? '')).toEqual(boxOf('a'))
      // A new layer in the frame, with a link id of its own.
      expect(session.design().nodes[pasted ?? '']?.parentId).toBe('sq')
      expect(session.design().nodes[pasted ?? '']?.link).not.toBe('a')
      expect(session.undoName()).toBe('paste')
      session.undo()
      expect(session.design().nodes[pasted ?? '']).toBeUndefined()
    })

    it('pastes the layers a copy kept on this device when the payload brings only the plain text that copy wrote, in another design open on it too', () => {
      const remembered = remembering()
      const { place, session, selection, square, boxOf } = harness(false, { remembered })
      selection.select(['a'], square.id)
      const copied = place.copy()
      expect(place.paste({ text: copied?.text ?? '' }, () => null)).toBe(true)
      const [pasted = ''] = idsOf(selection.current())
      expect(pasted).not.toBe('a')
      expect(boxOf(pasted)).toEqual(boxOf('a'))
      expect(session.undoName()).toBe('paste')
      // Other text is text from outside.
      expect(place.paste({ text: 'Rects' }, () => null)).toBe(true)
      const [typed = ''] = idsOf(selection.current())
      expect(session.design().nodes[typed]).toMatchObject({ type: 'text', props: { text: 'Rects' } })
      const other = harness(false, { remembered })
      expect(other.place.canPasteLayers()).toBe(true)
      expect(other.place.paste({ text: copied?.text ?? '' }, () => null)).toBe(true)
      expect(other.session.design().nodes[idsOf(other.selection.current())[0] ?? '']?.type).toBe('graphic')
      // A device that kept no copy pastes the plain text as text.
      const fresh = harness()
      expect(fresh.place.paste({ text: copied?.text ?? '' }, () => null)).toBe(true)
      expect(fresh.session.design().nodes[idsOf(fresh.selection.current())[0] ?? '']?.type).toBe('text')
    })

    it('pastes onto another frame of the page as linked copies, keeping link ids the frame doesn’t hold', () => {
      const { place, session, selection, square, wide } = harness()
      session.run('node.delete', { ids: ['wide-a'] })
      selection.select(['a', 'line'], square.id)
      const copied = place.copy() ?? {}
      selection.select(['wide-words'], wide.id)
      place.paste(copied, () => null)
      const pasted = idsOf(selection.current())
      const links = pasted.map((id) => session.design().nodes[id]?.link)
      // The wide frame lacks the square's first square, so its copy is linked; it holds the line already.
      expect(links[0]).toBe('a')
      expect(links[1]).not.toBe('line')
      expect(pasted.map((id) => session.design().nodes[id]?.parentId)).toEqual(['wide', 'wide'])
      session.undo()
      expect(session.design().nodes[pasted[0] ?? '']).toBeUndefined()
    })

    it('pastes into another frame moved the least that puts the layers inside it, centred along a side they are longer than', () => {
      const { place, session, selection, square, wide, boxOf } = harness()
      // The box sits at 100, 500, 300 by 300: below the wide frame's 628 bottom where it was.
      selection.select(['box'], square.id)
      const box = place.copy() ?? {}
      selection.select(['wide-words'], wide.id)
      place.paste(box, () => null)
      const [moved = ''] = idsOf(selection.current())
      expect(boxOf(moved)).toMatchObject({ x: 100, y: 328, width: 300, height: 300 })
      // What it holds moves with it, by the same step, in the frame's space.
      const [inside = ''] = Object.keys(session.design().nodes).filter(
        (id) => session.design().nodes[id]?.parentId === moved,
      )
      expect(boxOf(inside)).toMatchObject({ x: 0, y: -172 })
      // Taller than the wide frame and off its left: centred top to bottom, and pulled in at the left.
      session.run('node.update', { ids: ['a'], patch: { x: -40, y: 0, height: 700 } })
      selection.select(['a'], square.id)
      const tall = place.copy() ?? {}
      selection.select(['wide-words'], wide.id)
      place.paste(tall, () => null)
      const [fitted = ''] = idsOf(selection.current())
      expect(boxOf(fitted)).toMatchObject({ x: 0, y: -36, width: 100, height: 700 })
    })

    it('pastes into the frame the layers came from where they were, though that is partly off it', () => {
      const { place, session, selection, square, boxOf } = harness()
      session.run('node.update', { ids: ['a'], patch: { x: -40, y: 1000 } })
      selection.select(['a'], square.id)
      const copied = place.copy() ?? {}
      place.paste(copied, () => null)
      const [pasted = ''] = idsOf(selection.current())
      expect(boxOf(pasted)).toMatchObject({ x: -40, y: 1000 })
    })

    it('pastes as new layers into the frame the layers came from, and from another design', () => {
      const { place, session, selection, square, wide } = harness()
      session.run('node.delete', { ids: ['wide-a'] })
      selection.select(['a'], square.id)
      const copied = place.copy() ?? {}
      session.run('node.delete', { ids: ['a'] })
      selection.select(['words'], square.id)
      place.paste(copied, () => null)
      const [own] = idsOf(selection.current())
      expect(session.design().nodes[own ?? '']?.link).not.toBe('a')
      const other = JSON.stringify({ ...JSON.parse(copied.data?.[LAYER_CLIPBOARD_TYPE] ?? ''), designId: 'other' })
      selection.select(['wide-words'], wide.id)
      place.paste({ data: { [LAYER_CLIPBOARD_TYPE]: other } }, () => null)
      const [fromOther] = idsOf(selection.current())
      expect(session.design().nodes[fromOther ?? '']?.link).not.toBe('a')
    })

    it('pastes onto a frame of another page as new layers, though that frame holds no layer with their link ids', async () => {
      const editor = await testEditor({
        ...DESIGN,
        pages: { ...DESIGN.pages, p2: { name: 'Two', order: 'a1' } },
        frames: {
          ...DESIGN.frames,
          poster: { pageId: 'p2', name: 'Poster', width: 800, height: 1000, x: 0, y: 0, order: 'a2' },
        },
      })
      const { core, clipboard } = editor
      core.select(['a'])
      const copied = clipboard.copy() ?? {}
      core.showPage('p2')
      core.redraw()
      expect(core.selection()).toEqual([])
      clipboard.paste(copied)
      const [pasted = ''] = core.selection()
      expect(core.design().nodes[pasted]).toMatchObject({ parentId: 'poster' })
      expect(core.design().nodes[pasted]?.link).not.toBe('a')
      editor.end()
    })

    it('pastes into the first frame in view with nothing selected and the pointer off every frame, selected', () => {
      const { place, session, selection, square } = harness()
      selection.select(['a'], square.id)
      const copied = place.copy() ?? {}
      selection.select([], null)
      expect(place.paste(copied, () => null)).toBe(true)
      const [pasted = ''] = idsOf(selection.current())
      expect(session.design().nodes[pasted]?.parentId).toBe('wide')
      expect(firstFrameOf(selection.current())).toBe('wide')
    })

    it('pastes, with nothing selected and the pointer off every frame, into the first frame the last redraw drew, and after a pan into the one then in view', async () => {
      const editor = await testEditor(FAR_APART)
      const { core } = editor
      core.select(['a'])
      const copied = editor.clipboard.copy() ?? {}
      /** Deselects, pastes with the pointer on the canvas beside a frame, and gives the frame the pasted layer went into. */
      const pasteBeside = (x: number, frameId: string) => {
        editor.keys.press('Escape')
        expect(core.selection()).toEqual([])
        const beside = core.stagePoint(x, 540, frameId)
        editor.mouse.move(beside.x, beside.y)
        expect(core.spotAt(beside)).toBeNull()
        editor.clipboard.paste(copied)
        core.redraw()
        const [pasted = ''] = core.selection()
        return core.design().nodes[pasted]?.parentId
      }
      // Both frames in view: the first of them takes it.
      expect(pasteBeside(1500, 'sq')).toBe('sq')
      // Panned until only the wide frame is in view: that one takes it.
      core.setCamera({ x: 100 - 4000 * 0.5, y: 60, zoom: 0.5 })
      core.redraw()
      expect(pasteBeside(-200, 'wide')).toBe('wide')
      editor.end()
    })

    it('pastes centred on the pointer after Mod+Shift+V, and where the layers were after Mod+V', () => {
      const { place, selection, square, boxOf, stage } = harness()
      selection.select(['a'], square.id)
      const copied = place.copy() ?? {}
      place.aimPaste(true)
      place.paste(copied, () => stage(square, 600, 600))
      const [centred] = idsOf(selection.current())
      expect(boxOf(centred ?? '')).toMatchObject({ x: 550, y: 550 })
      place.aimPaste(false)
      place.paste(copied, () => stage(square, 600, 600))
      const [inPlace] = idsOf(selection.current())
      expect(boxOf(inPlace ?? '')).toMatchObject({ x: 100, y: 100 })
    })

    it('pastes centred on where the last pointer input was when Shift was down with Mod+V, and where the layers were without it', () => {
      const { place, selection, square, boxOf } = harness()
      const { pointer } = pointerHarness()
      const keys = editorKeys({
        place,
        typing: { editing: () => null, key: () => false },
        guideDrag: { key: () => false },
        pointer,
        perform: () => false,
      })
      selection.select(['a'], square.id)
      const copied = place.copy() ?? {}
      pointer.route(pointerInput({ at: { x: square.x + 600, y: square.y + 600 } }))
      pointer.route(pointerInput({ at: { x: square.x + 620, y: square.y + 640 } }))
      keys.key(keyInput('KeyV', { key: 'V', ctrlKey: true, shiftKey: true }))
      place.paste(copied, pointer.pointerAt)
      const [centred = ''] = idsOf(selection.current())
      expect(boxOf(centred)).toMatchObject({ x: 570, y: 590 })
      keys.key(keyInput('KeyV', { key: 'v', ctrlKey: true }))
      place.paste(copied, pointer.pointerAt)
      const [inPlace = ''] = idsOf(selection.current())
      expect(boxOf(inPlace)).toMatchObject({ x: 100, y: 100 })
    })

    it('pastes into a group a row moved where the layers were, or centred on the pointer, through undo and redo', () => {
      const { place, session, selection, boxes, square, stage } = harness()
      selection.enter(groupMovedByRow(session, 'a', 'sq'))
      selection.select(['a'], square.id)
      const copied = place.copy() ?? {}
      place.paste(copied, () => null)
      const [inPlace = ''] = idsOf(selection.current())
      place.aimPaste(true)
      place.paste(copied, () => stage(square, 700, 650))
      const [centred = ''] = idsOf(selection.current())
      const drawnAt = () => [inPlace, centred].map((id) => boxes.drawnBoxOf(square, id))
      const want = [
        { x: 600, y: 600, width: 100, height: 100 },
        { x: 650, y: 600, width: 100, height: 100 },
      ]
      expect([inPlace, centred].map((id) => session.design().nodes[id]?.parentId)).toEqual(['moved', 'moved'])
      expect(drawnAt()).toMatchObject(want)
      session.undo()
      session.undo()
      session.redo()
      session.redo()
      expect(drawnAt()).toMatchObject(want)
    })

    it('pastes SVG markup as layers, brought as plain text or in its own type, centred on the pointer after Mod+Shift+V', async () => {
      const { place, session, selection, square, wide, boxOf, stage } = harness()
      expect(place.paste({ text: SVG }, () => null)).toBe(true)
      await vi.waitFor(() => expect(firstFrameOf(selection.current())).toBe(wide.id))
      const [group] = idsOf(selection.current())
      expect(session.design().nodes[group ?? '']).toMatchObject({ type: 'group', name: 'SVG' })
      selection.select(['a'], square.id)
      place.aimPaste(true)
      expect(place.paste({ data: { [SVG_TYPE]: SVG } }, () => stage(square, 600, 600))).toBe(true)
      await vi.waitFor(() => expect(idsOf(selection.current())).not.toEqual(['a']))
      const [atPointer = ''] = idsOf(selection.current())
      expect(boxOf(atPointer)).toEqual({ x: 550, y: 575, width: 100, height: 50 })
    })

    it('says at once that it took an SVG file, reads its text and then places it named after the file, never reading its bytes', async () => {
      const { place, session, selection, wide, log } = harness()
      const logo = fileOf(log, 'logo.svg', SVG_TYPE, SVG)
      expect(place.paste({ files: [fileOf(log, 'photo.png', 'image/png'), logo] }, () => null)).toBe(true)
      expect(log).toEqual(['text of logo.svg'])
      expect(session.canUndo()).toBe(false)
      await vi.waitFor(() => expect(firstFrameOf(selection.current())).toBe(wide.id))
      const [group] = idsOf(selection.current())
      expect(session.design().nodes[group ?? '']).toMatchObject({ type: 'group', name: 'logo' })
      expect(log.filter((line) => line.includes(' of '))).toEqual(['text of logo.svg'])
    })

    it('leaves image files without an uploader, text that is only spaces and an empty paste be, reading none of them', () => {
      const { place, session, log } = harness()
      const photo = fileOf(log, 'photo.png', 'image/png')
      expect(place.paste({ files: [photo] }, () => null)).toBe(false)
      expect(place.paste({ files: [photo, fileOf(log, 'second.jpg', 'image/jpeg')] }, () => null)).toBe(false)
      expect(place.paste({ text: ' \n\t \r\n' }, () => null)).toBe(false)
      expect(place.paste({}, () => null)).toBe(false)
      expect(log).toEqual([])
      expect(session.canUndo()).toBe(false)
    })

    it('says to add a frame first, and pastes nothing, on a page with no frames', () => {
      const remembered = remembering()
      const copied = harness(false, { remembered })
      copied.selection.select(['a'], copied.square.id)
      const payload = copied.place.copy() ?? {}
      const { place, session, log } = harness(false, { emptyPage: true, remembered })
      expect(place.paste(payload, () => null)).toBe(true)
      expect(log).toEqual(['pasteNeedsFrame'])
      expect(place.paste({ text: SVG }, () => null)).toBe(true)
      expect(place.paste({ text: 'From outside' }, () => null)).toBe(true)
      expect(log).toEqual(['pasteNeedsFrame', 'pasteNeedsFrame', 'pasteNeedsFrame'])
      // Paste in a menu, with the copy kept on this device.
      expect(copied.place.copyLayers()).not.toBeNull()
      expect(place.pasteLayers(() => null)).toBe(false)
      expect(log).toEqual(['pasteNeedsFrame', 'pasteNeedsFrame', 'pasteNeedsFrame', 'pasteNeedsFrame'])
      expect(session.canUndo()).toBe(false)
    })

    it('leaves the paste to the text being typed into, whatever the payload brings', () => {
      const { place, log } = harness(true)
      expect(place.paste({ text: 'Hi' }, () => null)).toBe(true)
      expect(place.paste({ text: SVG }, () => null)).toBe(true)
      expect(log).toEqual(['typing paste Hi', `typing paste ${SVG}`])
    })
  })

  describe('copyLayers, canPasteLayers and pasteLayers', () => {
    it('gives the payload of the selected layers, kept on this device for Paste in a menu', () => {
      const { place, selection, square, boxOf } = harness()
      expect(place.canPasteLayers()).toBe(false)
      expect(place.pasteLayers(() => null)).toBe(false)
      expect(place.copyLayers()).toBeNull()
      selection.select(['a'], square.id)
      expect(place.copyLayers()).toEqual(place.copy())
      expect(place.copyLayers()?.text).toBe('Rect')
      expect(place.canPasteLayers()).toBe(true)
      expect(place.pasteLayers(() => null)).toBe(true)
      const [pasted] = idsOf(selection.current())
      expect(pasted).not.toBe('a')
      expect(boxOf(pasted ?? '')).toEqual(boxOf('a'))
    })

    it('gives none when the device keeps nothing, so a menu’s Copy says it copied nothing', () => {
      const off = {
        get: () => null,
        set: () => {
          throw new Error('storage is off')
        },
      }
      const { place, selection, square } = harness(false, { remembered: off })
      selection.select(['a'], square.id)
      expect(place.copyLayers()).toBeNull()
      expect(place.copy()?.text).toBe('Rect')
    })
  })
})
