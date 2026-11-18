// A design of two frames and placing over it on a real session and selection, for the tests of place.
import { loadCanvasKit } from '@dazbee/renderer/node'
import type { DesignInput } from '@dazbee/schema'

import { type Frame, frameAt, pageFrames } from './canvas/frames.ts'
import type { Remembered } from './clipboard.ts'
import type { NoticeDetail } from './core-interface.ts'
import { sessionOf, testBoxes } from './layers/test-boxes.ts'
import { editorPlace, type PlaceDeps } from './place.ts'
import { editorPlaceImages } from './place-images.ts'
import { editorPlaceSvg, type PlaceSvgDeps } from './place-svg.ts'
import { editorSelection, idsOf } from './selection.ts'
import { editorUploads, type UploadsDeps } from './uploads.ts'

const ck = await loadCanvasKit()

export const RED = { type: 'solid' as const, color: '#FF0000FF' }
const rect = (parentId: string, index: string, box: { x: number; y: number; width: number; height: number }) => ({
  type: 'graphic' as const,
  parentId,
  index,
  name: 'Rect',
  props: { ...box, shape: { kind: 'rect' as const }, fills: [RED] },
})
export const BLUE = { type: 'solid' as const, color: '#0000FFFF' }
/** The square frame's layers: a square, a square whose style is locked, a line, a text and a box holding a square. */
const SQUARE_LAYERS: DesignInput['nodes'] = {
  a: { ...rect('sq', 'a0', { x: 100, y: 100, width: 100, height: 100 }), link: 'a' },
  styled: { ...rect('sq', 'a1', { x: 300, y: 100, width: 100, height: 100 }), link: 'styled', lock: { style: true } },
  line: {
    type: 'graphic',
    parentId: 'sq',
    link: 'line',
    index: 'a2',
    name: 'Line',
    props: { x: 500, y: 100, width: 100, height: 100, shape: { kind: 'line' } },
  },
  words: {
    type: 'text',
    parentId: 'sq',
    link: 'words',
    index: 'a3',
    name: 'Words',
    props: {
      x: 700,
      y: 100,
      width: 200,
      height: 40,
      text: 'Hello',
      boxMode: 'fixed',
      style: { fontFamily: 'Noto Sans', fontSize: 20, color: '#000000FF' },
    },
  },
  box: {
    type: 'box',
    parentId: 'sq',
    link: 'box',
    index: 'a4',
    name: 'Box',
    props: { x: 100, y: 500, width: 300, height: 300 },
  },
  inside: { ...rect('box', 'a0', { x: 0, y: 0, width: 50, height: 50 }), link: 'inside' },
}
/**
 * One page with a square frame holding SQUARE_LAYERS and a wide one holding a copy of each,
 * `wide-<id>`, linked to it, the first square's copy filled blue.
 */
const DESIGN: DesignInput = {
  meta: { designId: 'd', name: 'D' },
  pages: { p1: { name: 'One', order: 'a0' } },
  frames: {
    sq: { pageId: 'p1', name: 'Square', width: 1080, height: 1080, x: 0, y: 0, order: 'a0' },
    wide: { pageId: 'p1', name: 'Wide', width: 1200, height: 628, x: 1280, y: 0, order: 'a1' },
  },
  nodes: {
    ...SQUARE_LAYERS,
    ...Object.fromEntries(
      Object.entries(SQUARE_LAYERS).map(([id, node]) => [
        `wide-${id}`,
        { ...node, parentId: node.parentId === 'sq' ? 'wide' : `wide-${node.parentId}` },
      ]),
    ),
    'wide-a': {
      ...rect('wide', 'a0', { x: 100, y: 100, width: 100, height: 100 }),
      link: 'a',
      props: { x: 100, y: 100, width: 100, height: 100, shape: { kind: 'rect' }, fills: [BLUE] },
    },
  },
}
export const PHOTO = { id: 'photo', name: 'Photo', width: 400, height: 200 }
export const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"><rect width="100" height="50"/></svg>'

/** The values kept on a device, held in a map. */
export function remembering(): Remembered {
  const items = new Map<string, string>()
  return { get: (key) => items.get(key) ?? null, set: (key, value) => void items.set(key, value) }
}

/** A notice as the log says it: its name, then the parts an SVG left out, how many pictures are uploading, or the files not pasted. */
export function said(...[notice, about]: NoticeDetail) {
  if (notice === 'uploading') return `${notice} ${about.names.length}`
  if (notice === 'imagesNotPasted') return [notice, ...about.names].join(' ')
  if (notice !== 'svgLeftOut') return notice
  return [notice, ...about.parts, ...(about.notUploaded ? [`notUploaded ${about.notUploaded}`] : [])].join(' ')
}

/**
 * Placing on a real session and selection over the two frames, a stage point being a world point
 * (zoom 1, nothing panned), logging what it asks of the tools, typing and the page.
 * With `emptyPage`, the page shown has no frames; `remembered` is the device it keeps a copy on,
 * its own unless given; `upload` uploads an SVG's pictures and pasted images, which are left out
 * without it; `open` is what is open on the stage, nothing unless given, and `after` the clock
 * placing waits by; `zoom` is the camera's; `readOnly` says whether the tab may only view.
 */
export function harness(
  typed = false,
  {
    emptyPage = false,
    remembered = remembering(),
    upload,
    open = { gesturing: () => false, dragging: () => false, stopEditing: () => {}, settle: () => {} },
    after,
    zoom = 1,
    readOnly = () => false,
  }: {
    emptyPage?: boolean
    remembered?: Remembered
    upload?: UploadsDeps['upload']
    open?: PlaceSvgDeps['open']
    after?: PlaceSvgDeps['after']
    zoom?: number
    readOnly?: () => boolean
  } = {},
) {
  const session = sessionOf(DESIGN)
  const all = pageFrames(session.design(), 'p1').frames
  const [square, wide] = all as [Frame, Frame]
  const frames = emptyPage ? [] : all
  const log: string[] = []
  const selection = editorSelection({ drawn: () => session.design(), frames: () => frames, changed: () => {} })
  const boxes = testBoxes(session, selection, frames)
  const frameOf = (id: string | undefined) => frames.find((f) => f.id === id)
  const pointOn = (stage: { x: number; y: number }) => {
    const frame = frameAt(frames, stage)
    return frame ? { frame, p: { x: stage.x - frame.x, y: stage.y - frame.y } } : null
  }
  const typing: PlaceDeps['typing'] & PlaceSvgDeps['typing'] = {
    editing: () => (typed ? { id: 'words', frameId: square.id } : null),
    selectedText: () => (typed ? { id: 'words', range: { start: 0, end: 5 } } : null),
    stop: () => log.push('typing stop'),
    fitText: (id) => log.push(`fit ${id}`),
    copy: () => {
      log.push('typing copy')
      return { text: 'typed' }
    },
    cut: () => {
      log.push('typing cut')
      return { text: 'typed' }
    },
    paste: (payload) => {
      log.push(`typing paste ${payload.text ?? ''}`)
      return true
    },
  }
  const tools: PlaceDeps['tools'] = { setTool: (tool) => log.push(`tool ${tool}`) }
  const notify = (...told: NoticeDetail) => void log.push(said(...told))
  const signal = new AbortController().signal
  const view = {
    design: () => session.design(),
    frames: () => frames,
    frameOf,
    inView: () => (emptyPage ? [] : [wide]),
    middleFrame: () => (emptyPage ? undefined : wide),
    nearestFrame: () => (emptyPage ? undefined : wide),
    camera: () => ({ x: 0, y: 0, zoom }),
    pointOn,
    spotOn: (stage: { x: number; y: number }) => {
      const at = pointOn(stage)
      return at ? { frameId: at.frame.id, x: at.p.x, y: at.p.y } : null
    },
  }
  const uploads = editorUploads({ ...(upload ? { upload } : {}), readOnly, notify, signal })
  // Nothing is open on the stage unless told: a placing never waits.
  const svg = editorPlaceSvg({
    ck,
    session,
    view,
    tools,
    selection,
    typing,
    notify,
    uploads,
    open,
    signal,
    ...(after ? { after } : {}),
  })
  const images = editorPlaceImages({
    session,
    view,
    tools,
    selection,
    svg,
    uploads,
    canUpload: upload !== undefined,
    readOnly,
    tellViewOnly: () => log.push('viewOnly'),
    notify,
    signal,
  })
  const deps: PlaceDeps = {
    session,
    designId: 'd',
    remembered,
    view,
    tools,
    selection,
    boxes,
    typing,
    actions: {
      perform: (action) => {
        log.push(action)
        // Delete, as the actions do it, so a cut writes what a cut writes.
        if (action === 'delete') session.run('node.delete', { ids: idsOf(selection.current()) })
        return true
      },
    },
    svg,
    images,
    notify,
    signal,
    shownChanged: () => log.push('overlay'),
  }
  const place = editorPlace(deps)
  /** A layer's box. */
  const boxOf = (id: string) => {
    const p = session.design().nodes[id]?.props as unknown as Record<string, number>
    return { x: p.x, y: p.y, width: p.width, height: p.height }
  }
  /** A layer's fills. */
  const fillsOf = (id: string) => (session.design().nodes[id]?.props as { fills?: unknown }).fills
  /** The stage point over a point of a frame. */
  const stage = (frame: Frame, x: number, y: number) => ({ x: frame.x + x, y: frame.y + y })
  return { place, svg, images, session, selection, boxes, square, wide, log, boxOf, fillsOf, stage }
}
