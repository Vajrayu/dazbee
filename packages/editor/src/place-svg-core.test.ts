// Placing an SVG file with pictures on the open core while other things go on as its pictures
// upload: a drag held, another page shown, the frame deleted, the view moved, the editor ended.
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { DesignInput } from '@dazbee/schema'

import type { TabAccess } from './core-interface.ts'
import { DESIGN } from './test-actions.ts'
import { type TestEditor, testEditor } from './test-editor.ts'
import { photoSvg, uploader } from './test-place-svg.ts'

/** The actions' design with a second page, `p2`, holding a square frame of its own. */
const PAGES: DesignInput = {
  ...DESIGN,
  pages: { ...DESIGN.pages, p2: { name: 'Two', order: 'a1' } },
  frames: {
    ...DESIGN.frames,
    'p2-sq': { pageId: 'p2', name: 'Square', width: 1080, height: 1080, x: 0, y: 0, order: 'a0' },
  },
}
/** Where the file goes in the square: its middle. */
const SPOT = { frameId: 'sq', x: 540, y: 540 }

let opened: TestEditor[] = []
afterEach(() => {
  vi.useRealTimers()
  for (const t of opened) t.end()
  opened = []
})

/** Opens the two pages in the test editor with an uploader, ended after the test. */
async function open(uploads: ReturnType<typeof uploader>, access?: TabAccess) {
  const t = await testEditor(PAGES, { uploadImage: uploads.upload, ...(access ? { access } : {}) })
  opened.push(t)
  return t
}

/** The groups the design holds, each with its frame and its box's middle. */
function groups(t: TestEditor) {
  return Object.entries(t.core.design().nodes).flatMap(([id, node]) => {
    if (node.type !== 'group') return []
    const box = t.core.boxOf(id)
    return [
      {
        id,
        parentId: node.parentId,
        x: (box?.x ?? 0) + (box?.width ?? 0) / 2,
        y: (box?.y ?? 0) + (box?.height ?? 0) / 2,
      },
    ]
  })
}

/** The square `a`'s left edge. */
const xOfA = (t: TestEditor) => (t.core.design().nodes.a?.props as { x: number }).x

describe('placing an SVG file with pictures on the core', () => {
  it('refuses to place while a drag is held, waits for it to be let go, then places the file: the drag and the file one undo step each', async () => {
    const t = await open(uploader())
    const read = await t.core.readSvg(photoSvg(2), 'Card', SPOT)
    if (!read) throw new Error('not read')
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    // The square `a` is pressed and dragged, and still held past the time a pen path is given.
    const from = t.core.stagePoint(150, 150)
    t.mouse.move(from.x, from.y)
    t.mouse.down()
    t.mouse.move(from.x + 60, from.y + 30, { steps: 5 })
    // Placed now, the file would join the drag's undo step.
    expect(t.core.placeSvg(read)).toBeNull()
    const placing = t.core.placeWhenSettled(read)
    await vi.advanceTimersByTimeAsync(4_500)
    expect(groups(t)).toEqual([])
    t.mouse.move(from.x + 120, from.y + 60, { steps: 5 })
    t.mouse.up()
    await vi.advanceTimersByTimeAsync(100)
    const id = await placing
    const moved = xOfA(t)
    expect([groups(t).map((g) => g.id), moved]).toEqual([[id], expect.not.closeTo(100, 0)])
    t.core.perform('undo')
    expect([groups(t), xOfA(t)]).toEqual([[], moved])
    t.core.perform('undo')
    expect(xOfA(t)).toBe(100)
  })

  it('places nothing once another page is shown, or once the frame is deleted, while its pictures upload', async () => {
    const uploads = uploader({ hold: true })
    const t = await open(uploads)
    const onOtherPage = t.core.readSvg(photoSvg(2), 'Card', SPOT)
    const deleted = t.core.readSvg(photoSvg(3), 'Card', SPOT)
    t.core.showPage('p2')
    t.core.redraw()
    uploads.release()
    const read = await onOtherPage
    expect(read && t.core.placeSvg(read)).toBeNull()
    expect(groups(t)).toEqual([])

    t.core.showPage('p1')
    t.core.redraw()
    t.core.session.run('frame.delete', { frameId: 'sq' })
    t.core.redraw()
    const gone = await deleted
    expect(gone && t.core.placeSvg(gone)).toBeNull()
    expect(groups(t)).toEqual([])
    t.core.perform('undo')
    expect(Object.keys(t.core.design().frames).sort()).toEqual(['p2-sq', 'sq', 'wide'])
    expect(t.core.canUndo()).toBe(false)
  })

  it('places the file where it was dropped though the view pans and zooms while its pictures upload', async () => {
    const uploads = uploader({ hold: true })
    const t = await open(uploads)
    const reading = t.core.readSvg(photoSvg(2), 'Card', t.core.stagePoint(300, 400))
    t.core.setCamera({ x: -200, y: -150, zoom: 1.7 })
    t.core.redraw()
    uploads.release()
    const read = await reading
    expect(read && t.core.placeSvg(read)).not.toBeNull()
    expect(groups(t)).toEqual([
      { id: expect.any(String), parentId: 'sq', x: expect.closeTo(300, 0), y: expect.closeTo(400, 0) },
    ])
  })

  it('places nothing once the editor has ended, uploads no more of its pictures, and no longer waits', async () => {
    const uploads = uploader({ hold: true })
    const t = await open(uploads)
    // A file without pictures is read at once; the other, of eight pictures, waits for its first four.
    const done = await t.core.readSvg(photoSvg(0), 'Card', SPOT)
    const reading = t.core.readSvg(photoSvg(8), 'Card', SPOT)
    expect(done).not.toBeNull()
    await vi.waitFor(() => expect(uploads.calls).toHaveLength(4))
    t.end()
    opened = []
    uploads.release()
    expect(await reading).toBeNull()
    expect(uploads.calls).toHaveLength(4)
    expect(await t.core.whenSettled()).toBe(false)
    expect(done && t.core.placeSvg(done)).toBeNull()
  })

  it('uploads nothing in a tab that may only view the design', async () => {
    const uploads = uploader()
    const t = await open(uploads, { readOnly: () => true, onChange: () => () => {} })
    const read = await t.core.readSvg(photoSvg(2), 'Card', SPOT)
    expect(uploads.calls).toEqual([])
    expect(read && t.core.placeSvg(read)).toBeNull()
    expect(groups(t)).toEqual([])
  })
})
