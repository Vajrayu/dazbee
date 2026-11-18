// Another tab's open step on this tab's canvas (D7): the view puts its preview into the design the
// frames' pictures show, and only the frames it touches are recorded again; hit tests and the
// design the panels read stay as the working design has them.
import { describe, expect, it } from 'vitest'

import { twoTabs } from '@dazbee/doc/test-store'
import { makeResources } from '@dazbee/renderer'
import { loadCanvasKit } from '@dazbee/renderer/node'

import type { EditorResources } from '../resources.ts'
import { frameScenes } from './scenes.ts'
import { editorView } from './view.ts'

const ck = await loadCanvasKit()
const decoded = makeResources(ck, { fonts: [], fallbackFamilies: [], images: {} })
const NO_VARIABLES = {}
const resources = {
  resources: () => decoded,
  bytes: () => ({ variables: NO_VARIABLES }),
  alpha: () => undefined,
  onArrive: () => () => true,
} as unknown as EditorResources

/** Tab A's view and scenes on two tabs of one design, and a redraw of every frame of A's page. */
function opened() {
  const tabs = twoTabs()
  const { a, tabA } = tabs
  const view = editorView({ session: tabA, previews: a.previews, onZoom: () => {} })
  const scenes = frameScenes({
    ck,
    resources,
    drawn: view.design,
    changes: tabA.changes,
    previewed: () => ({ design: view.previewed(), frames: view.previewedFrames() }),
  })
  const redraw = () => {
    view.update()
    const all = view.frames()
    return scenes.pictures(all, all, decoded).recorded
  }
  return { ...tabs, view, scenes, redraw }
}

describe("another tab's preview on the canvas", () => {
  it('records again only the frame it touches, at each step of the drag, and the design stays as it was', () => {
    const { b, tabA, tabB, sync, view, scenes, redraw } = opened()
    expect(redraw()).toBe(2)
    const drag = tabB.beginGesture()
    tabB.run('node.update', { ids: ['box'], patch: { x: 300 } })
    b.preview()
    expect(redraw()).toBe(1)
    expect(view.previewedFrames()).toEqual(new Set(['sq']))
    expect(view.previewed().nodes.box?.props.x).toBe(300)
    expect(view.design().nodes.box?.props.x).toBe(100)
    // Hit tests read the working design: the box is still where it was for clicks and outlines.
    const sq = view.frameOf('sq')
    if (!sq) throw new Error('no square frame')
    expect(scenes.hit(sq, { x: 110, y: 110 })?.id).toBe('box')
    // The drag moves on with no change to the design: the frame is recorded again.
    tabB.run('node.update', { ids: ['box'], patch: { x: 320 } })
    b.preview()
    expect(redraw()).toBe(1)
    expect(view.previewed().nodes.box?.props.x).toBe(320)
    expect(redraw()).toBe(0)
    // This tab's own edit in the other frame records that frame alone: the preview's is kept.
    tabA.run('node.update', { ids: ['banner-headline'], patch: { x: 12 } })
    expect(redraw()).toBe(1)
    drag.end()
    sync()
    expect(redraw()).toBe(1)
    expect(view.previewedFrames().size).toBe(0)
    expect(view.previewed()).toBe(view.design())
  })
})
