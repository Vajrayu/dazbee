// The auto layout drag's test fixture: a square and a wide frame of linked copies, each holding a
// row of three squares and a square beside it, dragged in on a real session and selection, with
// the grid, the boxes and the drop targets the tests add to it.
import { childrenOf, type DesignStore, openSession } from '@dazbee/doc'
import { openTestStore } from '@dazbee/doc/test-store'
import { type DesignInput, parseDesign } from '@dazbee/schema'

import { type Frame, pageFrames } from '../../canvas/frames.ts'
import { editorDuplicate } from '../../layers/duplicate.ts'
import { hug } from '../../layers/hug.ts'
import { testBoxes, testLaidOut } from '../../layers/test-boxes.ts'
import { editorSelection } from '../../selection.ts'
import { type AutoLayoutDragDeps, editorAutoLayoutDrag } from './auto-layout-drag.ts'

const square = (parentId: string, index: string) => ({
  type: 'graphic' as const,
  parentId,
  index,
  name: 'Square',
  props: { x: 0, y: 0, width: 50, height: 50, shape: { kind: 'rect' as const } },
})
const row = (parentId: string) => ({
  type: 'box' as const,
  parentId,
  index: 'a0',
  name: 'Row',
  props: { x: 100, y: 100, width: 300, height: 100, layout: { direction: 'row' as const } },
})
export const FREE = { x: 600, y: 600, width: 50, height: 50, shape: { kind: 'rect' as const } }
/**
 * One page with a square and a wide frame, each holding its copy of a row laid out by auto layout
 * with three squares in it, and of one square beside it.
 */
const DESIGN: DesignInput = {
  meta: { designId: 'd', name: 'D' },
  pages: { p1: { name: 'One', order: 'a0' } },
  frames: {
    sq: { pageId: 'p1', name: 'Square', width: 1080, height: 1080, x: 0, y: 0, order: 'a0' },
    wide: { pageId: 'p1', name: 'Wide', width: 1200, height: 628, x: 1280, y: 0, order: 'a1' },
  },
  nodes: {
    row: { ...row('sq'), link: 'row' },
    one: { ...square('row', 'a0'), link: 'one' },
    two: { ...square('row', 'a1'), link: 'two' },
    three: { ...square('row', 'a2'), link: 'three' },
    free: { ...square('sq', 'a1'), link: 'free', props: FREE },
    'wide-row': { ...row('wide'), link: 'row' },
    'wide-one': { ...square('wide-row', 'a0'), link: 'one' },
    'wide-two': { ...square('wide-row', 'a1'), link: 'two' },
    'wide-three': { ...square('wide-row', 'a2'), link: 'three' },
    'wide-free': { ...square('wide', 'a1'), link: 'free', props: FREE },
  },
}

/**
 * Drags in the row on a real session and selection, at zoom 1 over the square frame, logging what
 * they tell, and keeping each notice told with its details; on a store of its own unless given one.
 */
export function harness(store: DesignStore = designStore()) {
  const session = openSession(store)
  const frames = pageFrames(session.design(), 'p1').frames
  const frame = frames[0] as Frame
  const log: string[] = []
  const told: unknown[][] = []
  const selection = editorSelection({ drawn: () => session.design(), frames: () => frames, changed: () => {} })
  const boxes = testBoxes(session, selection, frames)
  const hugging = (ids: string[]) => {
    log.push(`hug ${ids.join(',')}`)
    hug(session, ids)
  }
  const deps: AutoLayoutDragDeps = {
    session,
    scenes: testLaidOut(session),
    boxes,
    duplicate: editorDuplicate({ session, selection, boxes, hug: hugging }),
    selection,
    camera: () => ({ x: 0, y: 0, zoom: 1 }),
    hug: hugging,
    notify: (...notice) => {
      told.push(notice)
      log.push(notice[0] === 'refused' ? `refused ${notice[1].why}` : notice[0])
    },
    frames: () => frames,
  }
  const reorder = editorAutoLayoutDrag(deps)
  const order = () => childrenOf(session.design(), 'row').map(([id]) => id)
  /** The wide frame's layers as they are now. */
  const wideCopies = () => Object.entries(session.design().nodes).filter(([id]) => id.startsWith('wide-'))
  return { reorder, session, selection, log, told, frame, frames, boxes, order, wideCopies }
}

/** A store holding the harness's design, for a test that joins another tab to it. */
export function designStore(): DesignStore {
  const parsed = parseDesign(DESIGN)
  if (!parsed.success) throw new Error(parsed.errors.join('\n'))
  return openTestStore(parsed.design)
}

/** The harness with the square frame's row a grid of 2 columns: One and Two on the first line, Three under One. */
export function gridHarness() {
  const h = harness()
  h.session.run('node.update', { ids: ['row'], patch: { layout: { direction: 'grid', columns: 2 } } })
  return h
}

/** A box in the square frame, laid out when given a layout, with squares in it. */
export function addBox(
  h: ReturnType<typeof harness>,
  id: string,
  parentId: string,
  props: Record<string, unknown>,
  squares: string[] = [],
) {
  h.session.run('node.create', {
    id,
    parentId,
    layer: { type: 'box', name: id, props: { x: 0, y: 0, width: 100, height: 100, ...props } },
  })
  for (const square of squares)
    h.session.run('node.create', {
      id: square,
      parentId: id,
      layer: { type: 'graphic', name: square, props: { x: 0, y: 0, width: 50, height: 50, shape: { kind: 'rect' } } },
    })
}

/**
 * The harness with a column at 600,100 holding x1 and x2 one under the other, a Free box at
 * 100,400 and a row at 400,400 turned a quarter round its middle, holding t1 and t2.
 */
export function dropHarness() {
  const h = harness()
  addBox(h, 'col', 'sq', { x: 600, y: 100, width: 200, height: 300, layout: { direction: 'column' } }, ['x1', 'x2'])
  addBox(h, 'plain', 'sq', { x: 100, y: 400, width: 200, height: 200 })
  addBox(h, 'turned', 'sq', { x: 400, y: 400, width: 200, height: 50, rotation: 90, layout: { direction: 'row' } }, [
    't1',
    't2',
  ])
  return h
}
