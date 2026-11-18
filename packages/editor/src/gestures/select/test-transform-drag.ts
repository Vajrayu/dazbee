// The transform drags over a design of two frames on a real session and selection, for the tests.
import { render } from '@dazbee/renderer'
import type { DesignInput, Point } from '@dazbee/schema'

import { type Frame, pageFrames } from '../../canvas/frames.ts'
import { editorDuplicate } from '../../layers/duplicate.ts'
import { hug } from '../../layers/hug.ts'
import { measure, sessionOf, testBoxes, testLaidOut } from '../../layers/test-boxes.ts'
import type { Box } from '../../layers/transform.ts'
import { editorSelection } from '../../selection.ts'
import { pointerInput } from '../test-inputs.ts'
import { editorAutoLayoutDrag } from './auto-layout-drag.ts'
import { editorTransformDrag, type TransformDragDeps } from './transform-drag.ts'

/** The keys held through a drag, and whether it snaps. */
export interface Held {
  shift?: boolean
  alt?: boolean
  snap?: boolean
}

const rect = (
  parentId: string,
  index: string,
  box: { x: number; y: number; width: number; height: number; rotation?: number },
  extra: Record<string, unknown> = {},
) => ({
  type: 'graphic' as const,
  parentId,
  index,
  name: 'Rect',
  props: { ...box, shape: { kind: 'rect' as const }, ...extra },
})
/** A line's props, 0 high with a stroke, from (x, y) to (x + width, y). */
export const lineProps = (x: number, y: number, width: number) => ({
  x,
  y,
  width,
  height: 0,
  shape: { kind: 'line' as const },
  strokes: [{ paint: { type: 'solid' as const, color: '#000000FF' }, width: 2 }],
})

const words = (parentId: string) => ({
  type: 'text' as const,
  parentId,
  index: 'a4',
  name: 'Words',
  props: {
    x: 700,
    y: 100,
    width: 200,
    height: 48,
    text: 'Hello',
    boxMode: 'fixed' as const,
    style: { fontFamily: 'Noto Sans', fontSize: 20, color: '#000000FF' },
    runs: [{ start: 0, end: 2, style: { fontSize: 40 } }],
  },
})
/**
 * One page with a square frame and a wide one. The square holds two squares side by side, a layer
 * locked in place, a row laid out by auto layout holding one square, and a text with a run of its
 * own size; the wide frame holds copies of the first square and the text.
 */
const DESIGN: DesignInput = {
  meta: { designId: 'd', name: 'D' },
  pages: { p1: { name: 'One', order: 'a0' } },
  frames: {
    sq: { pageId: 'p1', name: 'Square', width: 1080, height: 1080, x: 0, y: 0, order: 'a0' },
    wide: { pageId: 'p1', name: 'Wide', width: 1200, height: 628, x: 1280, y: 0, order: 'a1' },
  },
  nodes: {
    a: { ...rect('sq', 'a0', { x: 100, y: 100, width: 100, height: 100 }), link: 'a' },
    b: { ...rect('sq', 'a1', { x: 400, y: 100, width: 100, height: 100 }), link: 'b' },
    pin: { ...rect('sq', 'a2', { x: 700, y: 700, width: 50, height: 50 }), link: 'pin', lock: { move: true } },
    row: {
      type: 'box',
      parentId: 'sq',
      link: 'row',
      index: 'a3',
      name: 'Row',
      props: { x: 100, y: 500, width: 300, height: 100, layout: { direction: 'row' } },
    },
    c: { ...rect('row', 'a0', { x: 0, y: 0, width: 50, height: 50 }), link: 'c' },
    words: { ...words('sq'), link: 'words' },
    line: {
      ...rect('sq', 'a5', { x: 100, y: 900, width: 200, height: 0 }),
      props: {
        x: 100,
        y: 900,
        width: 200,
        height: 0,
        shape: { kind: 'line' as const, end: 'arrow' as const },
        strokes: [{ paint: { type: 'solid' as const, color: '#000000FF' }, width: 4 }],
      },
      link: 'line',
    },
    'wide-a': { ...rect('wide', 'a0', { x: 100, y: 100, width: 100, height: 100 }), link: 'a' },
    'wide-line': {
      ...rect('wide', 'a2', { x: 100, y: 500, width: 200, height: 0 }),
      props: lineProps(100, 500, 200),
      link: 'line',
    },
    'wide-words': { ...words('wide'), link: 'words' },
  },
}
const pointer = pointerInput()

/** The drags over the design on a real session and selection, at zoom 1 over the square frame, logging what they ask for. */
export function harness() {
  const session = sessionOf(DESIGN)
  const frames = pageFrames(session.design(), 'p1').frames
  const frame = frames[0] as Frame
  const log: string[] = []
  /** How many times the pointer was held. */
  let holds = 0
  const selection = editorSelection({ drawn: () => session.design(), frames: () => frames, changed: () => {} })
  const boxes = testBoxes(session, selection, frames)
  const hugging = (ids: string[]) => {
    log.push(`hug ${ids.join(',')}`)
    hug(session, ids)
  }
  const duplicate = editorDuplicate({ session, selection, boxes, hug: (ids) => hug(session, ids) })
  const autoLayoutDrag = editorAutoLayoutDrag({
    session,
    scenes: testLaidOut(session),
    boxes,
    duplicate,
    selection,
    camera: () => ({ x: 0, y: 0, zoom: 1 }),
    hug: hugging,
    notify: (...[notice]) => {
      log.push(notice)
    },
    frames: () => frames,
  })
  const deps: TransformDragDeps = {
    hold: () => (holds += 1),
    session,
    scenes: { shownScene: (f) => render(session.design(), f.id, undefined, measure) },
    selection,
    duplicate,
    typing: { editing: () => null, fitText: (id) => log.push(`fit ${id}`) },
    tools: { tool: () => 'select' },
    boxes,
    camera: () => ({ x: 0, y: 0, zoom: 1 }),
    frames: () => frames,
    autoLayoutDrag,
    hug: hugging,
    notify: (...[notice]) => {
      log.push(notice)
    },
    radiusLabel: String,
    shownChanged: () => {},
  }
  const drag = editorTransformDrag(deps)
  /** A layer's box. */
  const boxOf = (id: string) => {
    const p = session.design().nodes[id]?.props as Omit<Box, 'rotation'> & { rotation?: number }
    return { x: p.x, y: p.y, width: p.width, height: p.height, rotation: p.rotation ?? 0 }
  }
  /** The wide frame's copies as they are now. */
  const copies = () => [session.design().nodes['wide-a'], session.design().nodes['wide-words']]
  /** Presses on the selection, as the editor does with the box it is drawn in. */
  const pressSelection = (screen: { x: number; y: number }) => {
    const outer = deps.boxes.selectionBox()
    const grabbed = drag.handleUnder(screen)
    if (!outer || !grabbed) throw new Error('no handle there')
    return drag.pressHandle(pointer, screen, grabbed, outer)
  }
  return { drag, session, selection, log, frame, boxOf, copies, pressSelection, boxes, holds: () => holds }
}

/**
 * Presses 1.3 right of and 0.4 above a handle at a point in the frame, then moves the pointer on
 * by `by`, its keys held and snapping as asked; `local` turns a point in the frame into the space
 * of the containers around the drag, as the pointer does.
 */
export function resizeFrom(
  { drag, pressSelection }: ReturnType<typeof harness>,
  at: Point,
  by: Point,
  { shift = false, alt = false, snap = false }: Held = {},
  local: (p: Point) => Point = (p) => p,
) {
  const press = { x: at.x + 1.3, y: at.y - 0.4 }
  const g = pressSelection(press)
  drag.drag(g, local({ x: press.x + by.x, y: press.y + by.y }), shift, alt, snap)
  return g
}
