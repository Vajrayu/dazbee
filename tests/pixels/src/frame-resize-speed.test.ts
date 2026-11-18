// The frame resize's speed check: a frame dragged by its east handle, every layer it holds following,
// on a page of 10 more frames of 100 layers. Each pointer move writes only the layers whose box
// changed and rebuilds only the resized frame's scene, every other frame's kept by identity; its
// input and the redraw pass after it, timed and logged, stay under a generous ceiling.
import { describe, expect, it } from 'vitest'

import { type TestEditor, testEditor } from '@dazbee/editor/test-editor'
import type { Scene } from '@dazbee/renderer'
import type { Constraints, Design, DesignInput, Point } from '@dazbee/schema'

import { designWith, MOVES, quantile } from './flow-drag-speed.ts'

/** A value of a layer's box. */
type BoxKey = 'x' | 'y' | 'width' | 'height'

/**
 * A case: its design, how many of its frame's layers each move changes, and the values of their
 * boxes the rule writes (a fitted text's height is the fit's).
 */
interface ResizeCase {
  name: string
  design: DesignInput
  moving: number
  ruled: readonly BoxKey[]
}

/** One drag's times and work, move by move. */
interface ResizeDrag {
  /** Each move's input and the redraw after it, in ms. */
  ms: number[]
  /** Each move's layers written. */
  written: number[]
  /** Each move's layers whose box the rule changed. */
  changed: number[]
  /** Each move's frames whose scene was built again. */
  rebuilt: number[]
}

/** The ceiling for a move, input and redraw, at 200 layers: about 28 ms on the owner's PC (spec G8). */
const CEILING_MS = 50
/** The drags timed a case, after one to warm up. */
const DRAGS = 5
/** How far, in stage pixels, a drag's timed moves take the frame's east handle in: about 330 design pixels at the camera that shows the page. */
const DRAGGED = 30
/** How far, in stage pixels, the drag first goes, untimed, to pass a mouse's click slop. */
const PAST_SLOP = 4
const ALL_SIDES: readonly BoxKey[] = ['x', 'y', 'width', 'height']
const CENTRED: Constraints = { horizontal: 'center', vertical: 'center' }
const LEFT_TOP: Constraints = { horizontal: 'left', vertical: 'top' }

describe('the frame resize', () => {
  it.each(cases().map((c) => [c.name, c] as const))(
    'resizes a frame of %s writing only what changed, rebuilding one scene, each move under 50 ms',
    async (_, c) => {
      const e = await testEditor(c.design)
      try {
        e.core.pickFrame('F')
        dragOnce(e, c)
        const drags = Array.from({ length: DRAGS }, () => dragOnce(e, c))
        // Every move changes the boxes of the layers that follow, writes those and no other, and builds one scene again.
        for (const drag of drags) {
          expect(drag.changed).toEqual(drag.ms.map(() => c.moving))
          expect(drag.written).toEqual(drag.changed)
          expect(drag.rebuilt).toEqual(drag.ms.map(() => 1))
        }
        const p95s = drags.map(({ ms }) => quantile(ms, 0.95))
        const all = drags.flatMap(({ ms }) => ms)
        const said = `${c.name}: each drag's 95th-percentile move ${p95s.map((ms) => ms.toFixed(1)).join(', ')} ms; move p50 ${quantile(all, 0.5).toFixed(2)} ms`
        console.log(said)
        expect(quantile(p95s, 0.5), said).toBeLessThan(CEILING_MS)
      } finally {
        e.end()
      }
    },
    120_000,
  )
})

/**
 * The cases: 50 and 200 rects set to centre both ways, 200 set left and top (which an east handle
 * never moves), and 50 texts set left and right that grow down with their words.
 */
function cases(): ResizeCase[] {
  return [
    { name: '50 rects centred', design: designWith(rects(50, CENTRED)), moving: 50, ruled: ALL_SIDES },
    { name: '200 rects centred', design: designWith(rects(200, CENTRED)), moving: 200, ruled: ALL_SIDES },
    { name: '200 rects left and top', design: designWith(rects(200, LEFT_TOP)), moving: 0, ruled: ALL_SIDES },
    { name: '50 texts left and right', design: designWith(texts(50)), moving: 50, ruled: ['x', 'y', 'width'] },
  ]
}

/**
 * One drag of the frame's east handle, past the click slop and then in by DRAGGED stage pixels,
 * undone after: each timed move's time, the layers it wrote and those whose box changed, and the
 * frames whose scene was built again.
 */
function dragOnce(e: TestEditor, c: ResizeCase): ResizeDrag {
  e.core.redraw()
  const press = e.core.stagePoint(1080, 540, 'F')
  pointer(e, 'pointermove', press)
  pointer(e, 'pointerdown', press)
  const from = { x: press.x - PAST_SLOP, y: press.y }
  pointer(e, 'pointermove', from)
  e.core.redraw()
  const drag: ResizeDrag = { ms: [], written: [], changed: [], rebuilt: [] }
  for (let k = 1; k <= MOVES; k++) {
    const at = { x: from.x - (DRAGGED * k) / MOVES, y: from.y }
    const before = boxesOf(e.core.session.design(), c.ruled)
    const scenes = scenesNow(e)
    const work = e.modules.frameResize.work()
    const t0 = performance.now()
    pointer(e, 'pointermove', at)
    e.core.redraw()
    drag.ms.push(performance.now() - t0)
    drag.written.push(e.modules.frameResize.work().written - work.written)
    const now = boxesOf(e.core.session.design(), c.ruled)
    drag.changed.push([...now].filter(([id, box]) => before.get(id) !== box).length)
    const after = scenesNow(e)
    drag.rebuilt.push([...after].filter(([id, scene]) => scenes.get(id) !== scene).length)
  }
  pointer(e, 'pointerup', { x: from.x - DRAGGED, y: from.y })
  e.core.redraw()
  e.press('undo')
  e.core.redraw()
  return drag
}

/** Each frame's scene on the shown page, by its id. */
function scenesNow(e: TestEditor): Map<string, Scene> {
  return new Map(e.modules.view.frames().map((frame) => [frame.id, e.modules.scenes.scene(frame)]))
}

/**
 * The frame F's layers' boxes in the values given, each as one string, by id. The design is live
 * while a gesture is open, so a move's before is read as values.
 */
function boxesOf(design: Design, keys: readonly BoxKey[]): Map<string, string> {
  const boxes = new Map<string, string>()
  for (const [id, layer] of Object.entries(design.nodes))
    if (layer.parentId === 'F') boxes.set(id, keys.map((key) => layer.props[key]).join(' '))
  return boxes
}

/** `n` rects set to the constraints given, in rows across the frame. */
function rects(n: number, constraints: Constraints): Record<string, object> {
  const nodes: Record<string, object> = {}
  for (let i = 0; i < n; i++)
    nodes[`i${i}`] = {
      type: 'graphic',
      parentId: 'F',
      index: `a${String(i).padStart(4, '0')}`,
      link: `i${i}`,
      name: `Rect ${i}`,
      props: {
        ...placeOf(i),
        width: 40,
        height: 40,
        shape: { kind: 'rect' },
        fills: [{ type: 'solid', color: '#3366FFFF' }],
        constraints,
      },
    }
  return nodes
}

/** `n` texts set left and right and top, growing down with their words, in rows down the frame. */
function texts(n: number): Record<string, object> {
  const nodes: Record<string, object> = {}
  for (let i = 0; i < n; i++)
    nodes[`t${i}`] = {
      type: 'text',
      parentId: 'F',
      index: `a${String(i).padStart(4, '0')}`,
      link: `t${i}`,
      name: `Text ${i}`,
      props: {
        x: 40,
        y: 20 * i,
        width: 1000,
        height: 18,
        boxMode: 'autoHeight',
        text: `Line ${i}: every hat and every scarf in the summer sale, half price until Sunday`,
        style: { fontFamily: 'Noto Sans', fontSize: 14, color: '#000000FF' },
        constraints: { horizontal: 'leftRight', vertical: 'top' },
      },
    }
  return nodes
}

/** Where the `i`th rect sits: 20 to a row, 50 px apart. */
function placeOf(i: number): Point {
  return { x: 40 + (i % 20) * 50, y: 40 + Math.floor(i / 20) * 50 }
}

function pointer(e: TestEditor, type: 'pointermove' | 'pointerdown' | 'pointerup', at: Point) {
  e.core.input.pointer({
    type,
    at,
    button: 0,
    detail: 0,
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    pointerType: 'mouse',
  })
}
