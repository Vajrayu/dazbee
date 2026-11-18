import { describe, expect, it, vi } from 'vitest'

import { readImageHeader } from '@dazbee/schema'

import type { ClipboardFile } from './clipboard.ts'
import { idsOf } from './selection.ts'
import { DESIGN } from './test-actions.ts'
import { testEditor } from './test-editor.ts'
import { harness } from './test-place.ts'
import type { PlacedAsset } from './tools.ts'

/** The first bytes of a PNG of this size: its signature and the IHDR that says the size. */
function png(width: number, height: number) {
  const bytes = new Uint8Array(33)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, 0x89504e47)
  view.setUint32(4, 0x0d0a1a0a)
  view.setUint32(8, 13)
  bytes.set([73, 72, 68, 82], 12)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return bytes
}
/** The first bytes of a JPEG of this size: its start, then a start-of-frame that says the size. */
function jpeg(width: number, height: number) {
  return new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0, 11, 8, height >> 8, height & 255, width >> 8, width & 255, 3, 0])
}
/** A file on the clipboard with these bytes, which logs each time its bytes are read. */
function fileOf(log: string[], name: string, type: string, bytes: Uint8Array): ClipboardFile {
  return {
    name,
    type,
    text: () => Promise.resolve(''),
    bytes: () => {
      log.push(`bytes of ${name}`)
      return Promise.resolve(bytes)
    },
  }
}
/**
 * An uploader that records each picture it is sent and answers with an asset of the size its header
 * says, named as sent, `asset-<name>` with dashes for spaces; the names in `fail` don't upload.
 */
function uploader(fail: string[] = []) {
  const calls: { type: string; name: string }[] = []
  const upload = async (bytes: Uint8Array, type: string, name: string): Promise<PlacedAsset> => {
    calls.push({ type, name })
    if (fail.includes(name)) throw new Error('no connection')
    const header = readImageHeader(bytes)
    return { id: `asset-${name.replaceAll(' ', '-')}`, name, width: header?.width ?? 0, height: header?.height ?? 0 }
  }
  return { calls, upload }
}
/** A layer's box. */
const boxOf = (props: unknown) => {
  const { x, y, width, height } = props as { x: number; y: number; width: number; height: number }
  return { x, y, width, height }
}

describe('editorPlaceImages', () => {
  describe('takes', () => {
    it('takes files where one claims to be an image other than SVG, with an uploader only', () => {
      const log: string[] = []
      const photo = fileOf(log, 'photo.png', 'image/png', png(10, 10))
      const notes = fileOf(log, 'notes.pdf', 'application/pdf', new Uint8Array())
      const logo = fileOf(log, 'logo.svg', 'image/svg+xml', new Uint8Array())
      const { images } = harness(false, { upload: uploader().upload })
      expect(images.takes([notes, photo])).toBe(true)
      expect(images.takes([notes, logo])).toBe(false)
      expect(harness().images.takes([photo])).toBe(false)
      expect(log).toEqual([])
    })
  })

  describe('paste', () => {
    it('reads a pasted PNG by its header, uploads it once named after its file and places it at its own size, centred in the frame in view, selected, as one undo step called paste', async () => {
      const uploads = uploader()
      const { place, session, selection, wide, log } = harness(false, { upload: uploads.upload })
      expect(
        place.paste({ text: 'photo.png', files: [fileOf(log, 'photo.png', 'image/png', png(400, 200))] }, () => null),
      ).toBe(true)
      await vi.waitFor(() => expect(idsOf(selection.current())).toHaveLength(1))
      const [id = ''] = idsOf(selection.current())
      expect(uploads.calls).toEqual([{ type: 'image/png', name: 'photo' }])
      expect(session.design().nodes[id]).toMatchObject({
        type: 'graphic',
        parentId: wide.id,
        name: 'photo',
        props: { fills: [{ type: 'image', assetId: 'asset-photo' }] },
      })
      expect(boxOf(session.design().nodes[id]?.props)).toEqual({ x: 400, y: 214, width: 400, height: 200 })
      expect(log).toEqual(['bytes of photo.png', 'uploading 1', 'uploading 0', 'tool select'])
      expect(session.undoName()).toBe('paste')
      session.undo()
      expect(session.design().nodes[id]).toBeUndefined()
      expect(session.canUndo()).toBe(false)
    })

    it('scales a picture larger than half the frame down to that, and uploads by the type its header says, a browser’s copied picture named Pasted image', async () => {
      const uploads = uploader()
      const { place, session, selection, log } = harness(false, { upload: uploads.upload })
      place.paste({ files: [fileOf(log, 'image.png', 'image/png', jpeg(2400, 1200))] }, () => null)
      await vi.waitFor(() => expect(idsOf(selection.current())).toHaveLength(1))
      const [id = ''] = idsOf(selection.current())
      expect(uploads.calls).toEqual([{ type: 'image/jpeg', name: 'Pasted image' }])
      expect(boxOf(session.design().nodes[id]?.props)).toEqual({ x: 300, y: 164, width: 600, height: 300 })
    })

    it('fills the one selected layer that takes an image, as one undo step, and places a new layer centred on the pointer after Mod+Shift+V', async () => {
      const { place, session, selection, square, stage, fillsOf, log } = harness(false, { upload: uploader().upload })
      selection.select(['a'], square.id)
      place.paste({ files: [fileOf(log, 'photo.png', 'image/png', png(40, 20))] }, () => null)
      await vi.waitFor(() => expect(fillsOf('a')).toHaveLength(2))
      expect(fillsOf('a')).toMatchObject([{ type: 'solid' }, { type: 'image', assetId: 'asset-photo' }])
      // Selected in its own frame, though the frame in view, where a new layer would go, is the wide one.
      expect(selection.current()).toEqual([{ id: 'a', frameId: square.id }])
      expect(session.undoName()).toBe('paste')
      place.aimPaste(true)
      place.paste({ files: [fileOf(log, 'photo.png', 'image/png', png(40, 20))] }, () => stage(square, 600, 600))
      await vi.waitFor(() => expect(idsOf(selection.current())).not.toEqual(['a']))
      const [id = ''] = idsOf(selection.current())
      expect(boxOf(session.design().nodes[id]?.props)).toEqual({ x: 580, y: 590, width: 40, height: 20 })
    })

    it('fills the layer though the frame the image would have gone in has gone', async () => {
      const { images, fillsOf, log } = harness(false, { upload: uploader().upload })
      const file = fileOf(log, 'photo.png', 'image/png', png(40, 20))
      expect(await images.paste([file], { spot: { frameId: 'gone', x: 0, y: 0 }, into: 'a' })).toEqual(['a'])
      expect(fillsOf('a')).toHaveLength(2)
    })

    it('places a new layer after Mod+Shift+V with the pointer off the stage, and for two image files of which one didn’t upload', async () => {
      const { place, session, selection, square, fillsOf, log } = harness(false, { upload: uploader(['fail']).upload })
      selection.select(['a'], square.id)
      place.aimPaste(true)
      place.paste({ files: [fileOf(log, 'photo.png', 'image/png', png(40, 20))] }, () => null)
      await vi.waitFor(() => expect(idsOf(selection.current())).not.toEqual(['a']))
      selection.select(['a'], square.id)
      const files = ['photo.png', 'fail.png'].map((name) => fileOf(log, name, 'image/png', png(40, 20)))
      place.paste({ files }, () => null)
      await vi.waitFor(() => expect(idsOf(selection.current())).not.toEqual(['a']))
      expect(fillsOf('a')).toHaveLength(1)
      expect(session.design().nodes[idsOf(selection.current())[0] ?? '']?.type).toBe('graphic')
    })

    it('places a new layer with a line, a layer whose style is locked or two layers selected', async () => {
      const { place, session, selection, square, log } = harness(false, { upload: uploader().upload })
      for (const ids of [['line'], ['styled'], ['a', 'styled']]) {
        selection.select(ids, square.id)
        const before = Object.keys(session.design().nodes).length
        place.paste({ files: [fileOf(log, 'photo.png', 'image/png', png(40, 20))] }, () => null)
        await vi.waitFor(() => expect(Object.keys(session.design().nodes)).toHaveLength(before + 1))
      }
    })

    it('cascades several images CASCADE screen pixels apart at the zoom of the paste, all selected, as one undo step', async () => {
      const { place, session, selection, log } = harness(false, { upload: uploader().upload, zoom: 2 })
      const files = ['one.png', 'two.png'].map((name) => fileOf(log, name, 'image/png', png(100, 100)))
      place.paste({ files }, () => null)
      await vi.waitFor(() => expect(idsOf(selection.current())).toHaveLength(2))
      const ids = idsOf(selection.current())
      expect(ids.map((id) => boxOf(session.design().nodes[id]?.props))).toEqual([
        { x: 550, y: 264, width: 100, height: 100 },
        { x: 562, y: 276, width: 100, height: 100 },
      ])
      session.undo()
      expect(ids.map((id) => session.design().nodes[id])).toEqual([undefined, undefined])
      expect(session.canUndo()).toBe(false)
    })

    it('tells the files whose header is no image it draws, or that didn’t upload, and places the rest', async () => {
      const uploads = uploader(['fail'])
      const { place, session, selection, log } = harness(false, { upload: uploads.upload })
      const files = [
        fileOf(log, 'notes.png', 'image/png', new TextEncoder().encode('not a picture at all, only words')),
        fileOf(log, 'moving.gif', 'image/gif', new TextEncoder().encode('GIF89a and the rest of it')),
        fileOf(log, 'huge.png', 'image/png', png(20_000, 20)),
        fileOf(log, 'fail.png', 'image/png', png(10, 10)),
        fileOf(log, 'fine.png', 'image/png', png(10, 10)),
      ]
      place.paste({ files }, () => null)
      await vi.waitFor(() => expect(idsOf(selection.current())).toHaveLength(1))
      expect(uploads.calls.map((call) => call.name)).toEqual(['fail', 'fine'])
      expect(log).toContain('imagesNotPasted notes.png moving.gif huge.png fail.png')
      expect(session.design().nodes[idsOf(selection.current())[0] ?? '']?.name).toBe('fine')
    })

    it('tells a paste none of whose files placed, and places nothing', async () => {
      const { images, session, square, log } = harness(false, { upload: uploader().upload })
      const placed = await images.paste([fileOf(log, 'notes.png', 'image/png', new Uint8Array(4))], {
        spot: { frameId: square.id, x: 10, y: 10 },
        into: null,
      })
      expect(placed).toEqual([])
      expect(log).toEqual(['bytes of notes.png', 'imagesNotPasted notes.png'])
      expect(session.canUndo()).toBe(false)
    })

    it('waits for a drag to end before placing, as its own undo step', async () => {
      let dragging = true
      const open = { gesturing: () => dragging, dragging: () => dragging, stopEditing: () => {}, settle: () => {} }
      const after = (ms: number, then: () => void) => {
        const timer = setTimeout(then, ms)
        return () => clearTimeout(timer)
      }
      const { place, session, selection, log } = harness(false, { upload: uploader().upload, open, after })
      place.paste({ files: [fileOf(log, 'photo.png', 'image/png', png(40, 20))] }, () => null)
      await vi.waitFor(() => expect(log).toContain('uploading 0'))
      await new Promise((resolve) => setTimeout(resolve, 120))
      expect(session.canUndo()).toBe(false)
      dragging = false
      await vi.waitFor(() => expect(idsOf(selection.current())).toHaveLength(1))
      expect(session.undoName()).toBe('paste')
    })

    it('reads and uploads nothing in a tab that may only view the design, and says View only', async () => {
      const uploads = uploader()
      const { place, session, log } = harness(false, { upload: uploads.upload, readOnly: () => true })
      expect(place.paste({ files: [fileOf(log, 'photo.png', 'image/png', png(40, 20))] }, () => null)).toBe(true)
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(log).toEqual(['viewOnly'])
      expect(uploads.calls).toEqual([])
      expect(session.canUndo()).toBe(false)
    })

    it('says to add a frame first, and reads and uploads nothing, on a page with no frames', () => {
      const uploads = uploader()
      const { place, log } = harness(false, { upload: uploads.upload, emptyPage: true })
      expect(place.paste({ files: [fileOf(log, 'photo.png', 'image/png', png(40, 20))] }, () => null)).toBe(true)
      expect(log).toEqual(['pasteNeedsFrame'])
      expect(uploads.calls).toEqual([])
    })

    it('takes image files before an SVG file or text beside them, reading neither', async () => {
      const { place, selection, log } = harness(false, { upload: uploader().upload })
      const logo = fileOf(log, 'logo.svg', 'image/svg+xml', new Uint8Array())
      place.paste({ text: 'Hello', files: [logo, fileOf(log, 'photo.png', 'image/png', png(40, 20))] }, () => null)
      await vi.waitFor(() => expect(idsOf(selection.current())).toHaveLength(1))
      expect(log.filter((line) => line.includes(' of '))).toEqual(['bytes of photo.png'])
    })

    it('pastes through the editor’s clipboard with its uploader, the page told while it uploads', async () => {
      const editor = await testEditor(DESIGN, { uploadImage: uploader().upload })
      const { core, clipboard } = editor
      const log: string[] = []
      expect(clipboard.paste({ files: [fileOf(log, 'photo.png', 'image/png', png(40, 20))] })).toBe(true)
      await vi.waitFor(() => expect(core.selection()).toHaveLength(1))
      const [id = ''] = core.selection()
      expect(core.design().nodes[id]).toMatchObject({ props: { fills: [{ assetId: 'asset-photo' }] } })
      expect(editor.told).toEqual([
        ['uploading', { names: ['photo'] }],
        ['uploading', { names: [] }],
      ])
      editor.end()
    })
  })
})
