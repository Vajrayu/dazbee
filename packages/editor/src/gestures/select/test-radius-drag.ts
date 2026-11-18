// The radius dots' tests' design, a layer of each kind the step's grid names, and what they read
// and do through the test editor: the dots shown, where each is on the stage, and presses by a
// mouse, a pen and a finger.
import type { Point } from '@dazbee/schema'

import { HALF } from '../../canvas/test-images.ts'
import { radiiOf, radiusCorners } from '../../layers/radius.ts'
import { type DragOptions, type TestEditor, testEditor } from '../../test-editor.ts'
import { frameDesign, linkedFrames, type Seeded } from '../../test-matrix/index.ts'
import type { PointerInput } from '../inputs.ts'

const FILL = [{ type: 'solid', color: '#2F6BFFFF' }]
const LOCK = { move: false, resize: false, content: false, style: false, delete: false }
/** A graphic in a parent, filled blue, with its props and anything else a layer has. */
const graphic = (parentId: string, index: string, props: object, more: object = {}) =>
  ({ type: 'graphic', parentId, index, name: index, props: { fills: FILL, ...props }, ...more }) as unknown as Seeded
/** A rectangle's props at a box, with its shape's own and any others. */
const rect = (x: number, y: number, width: number, height: number, shape: object = {}, more: object = {}) => ({
  x,
  y,
  width,
  height,
  shape: { kind: 'rect', ...shape },
  ...more,
})
/** A box in the frame, filled blue. */
const box = (index: string, props: object, more: object = {}) =>
  ({ type: 'box', parentId: 'sq', index, name: index, props: { fills: FILL, ...props }, ...more }) as unknown as Seeded
const ROW = { direction: 'row', gap: 20, padding: { top: 20, right: 20, bottom: 20, left: 20 } }
/**
 * A square frame with a layer of each kind the grid names, 200 × 120 unless told, and a linked
 * frame, Wide, holding a copy of each.
 */
export const DESIGN = linkedFrames(
  frameDesign({
    name: 'Radius dots',
    nodes: {
      plain: graphic('sq', 'a0', rect(100, 100, 200, 120)),
      over: box('a1', { x: 400, y: 100, width: 200, height: 120, cornerRadius: 300 }),
      four: graphic('sq', 'a2', rect(700, 100, 200, 120, { corners: [10, 40, 0, 20] })),
      turned: graphic('sq', 'a3', rect(100, 300, 200, 120, { cornerRadius: 20 }, { rotation: 30 })),
      group: {
        type: 'group',
        parentId: 'sq',
        index: 'a4',
        name: 'group',
        props: { x: 400, y: 300, width: 200, height: 120, rotation: 45 },
      } as unknown as Seeded,
      inGroup: graphic('group', 'a0', rect(400, 300, 200, 120, { cornerRadius: 20 })),
      auto: box('a5', { x: 100, y: 520, width: 500, height: 200, layout: ROW }),
      inFlow: graphic(
        'auto',
        'a0',
        rect(0, 0, 100, 100, { cornerRadius: 10 }, { sizing: { width: 'fill', height: 'fill' } }),
      ),
      kept: graphic('auto', 'a1', rect(450, 560, 100, 100, { cornerRadius: 10 }, { absolute: true })),
      masks: {
        type: 'group',
        parentId: 'sq',
        index: 'b8',
        name: 'masks',
        props: { x: 920, y: 640, width: 140, height: 140 },
      } as unknown as Seeded,
      mask: graphic('masks', 'a0', rect(920, 640, 140, 140, { cornerRadius: 10 }, { mask: 'alpha' })),
      masked: graphic('masks', 'a1', rect(920, 640, 140, 140, { cornerRadius: 10 })),
      tri: graphic('sq', 'a6', { x: 700, y: 300, width: 200, height: 100, shape: { kind: 'polygon', sides: 3 } }),
      // Two layers whose top radius is not a hundredth: 45.375, and 25.769… at the triangle's top point.
      odd: graphic('sq', 'c0', rect(700, 420, 150.25, 90.75)),
      narrow: graphic('sq', 'c1', { x: 950, y: 40, width: 100, height: 200, shape: { kind: 'polygon', sides: 3 } }),
      star: graphic('sq', 'a7', {
        x: 700,
        y: 520,
        width: 200,
        height: 200,
        shape: { kind: 'star', points: 5, innerRadius: 0.382, cornerRadius: 40 },
      }),
      square: graphic('sq', 'a8', rect(100, 800, 120, 120, { cornerRadius: 60 })),
      small: graphic('sq', 'a9', rect(300, 800, 40, 40)),
      oval: graphic('sq', 'b0', { x: 400, y: 800, width: 120, height: 120, shape: { kind: 'ellipse' } }),
      styled: graphic('sq', 'b1', rect(600, 800, 120, 120), { lock: { ...LOCK, style: true } }),
      pinned: graphic('sq', 'b2', rect(800, 800, 120, 120), { lock: { ...LOCK, move: true, resize: true } }),
      holder: box('b3', { x: 100, y: 940, width: 200, height: 120, clip: true }),
      inner: graphic('holder', 'a0', rect(100, 940, 200, 120)),
      stroked: graphic(
        'sq',
        'b4',
        rect(400, 940, 200, 120, {}, { strokes: [{ paint: { type: 'solid', color: '#000000FF' }, width: 20 }] }),
      ),
      photo: graphic('sq', 'b5', rect(700, 940, 200, 120, {}, { fills: [{ type: 'image', assetId: 'p' }] })),
      hiddenGroup: {
        type: 'group',
        parentId: 'sq',
        index: 'b6',
        name: 'hidden group',
        props: { x: 900, y: 300, width: 160, height: 160, visible: false },
      } as unknown as Seeded,
      inHidden: graphic('hiddenGroup', 'a0', rect(900, 300, 160, 160)),
      words: {
        type: 'text',
        parentId: 'sq',
        index: 'b7',
        name: 'words',
        props: {
          x: 900,
          y: 520,
          width: 160,
          height: 100,
          text: 'Words',
          boxMode: 'fixed',
          style: { fontFamily: 'Noto Sans', fontSize: 40, color: '#000000FF' },
        },
      } as unknown as Seeded,
    },
  }),
  [{ id: 'wide', name: 'Wide', width: 1920, height: 1080 }],
)

/** The design open with Square fitted, at a zoom, the mouse seen once over the stage. */
export async function open(zoom = 1) {
  const editor = await unseen()
  editor.core.zoomTo(zoom)
  editor.mouse.move(2, 2)
  return editor
}
/** The design open with Square fitted at 100%, no pointer seen over the stage yet. */
export async function unseen() {
  const bytes = HALF.encodeToBytes()
  if (!bytes) throw new Error('no image')
  const editor = await testEditor(DESIGN, { sources: { assetBytes: () => Promise.resolve(bytes) } })
  editor.core.fitFrame('sq')
  editor.core.zoomTo(1)
  return editor
}
export const props = (editor: TestEditor, id: string) =>
  editor.core.design().nodes[id]?.props as Record<string, unknown>
export const shapeOf = (editor: TestEditor, id: string) => props(editor, id).shape as Record<string, unknown>
/** The dots the overlay draws now. */
export const shown = ({ modules }: TestEditor) => modules.transformDrag.shownDots(modules.pointer.gesture()).dots
/** The words the radius pill reads now; null with no pill. */
export const pill = ({ modules }: TestEditor) => modules.transformDrag.shownDots(modules.pointer.gesture()).label
/** Selects one layer and gives where each of its dots is on the stage, by its corner, with whether it is big. */
export function dots(editor: TestEditor, id: string) {
  editor.core.select([id])
  editor.core.redraw()
  return dotsNow(editor)
}
/** Where each dot of the selection is on the stage, as the overlay places it in the selection's turned box. */
export function dotsNow(editor: TestEditor) {
  const outer = editor.modules.boxes.selectionBox()
  if (!outer) return []
  const { drawn, frame } = outer
  const zoom = editor.core.camera().zoom
  const a = (drawn.rotation * Math.PI) / 180
  const centre = { x: drawn.x + drawn.width / 2, y: drawn.y + drawn.height / 2 }
  return shown(editor).map((dot) => {
    const dx = drawn.x + dot.x / zoom - centre.x
    const dy = drawn.y + dot.y / zoom - centre.y
    const x = centre.x + dx * Math.cos(a) - dy * Math.sin(a)
    const y = centre.y + dx * Math.sin(a) + dy * Math.cos(a)
    return { ...dot, at: editor.core.stagePoint(x, y, frame.id) }
  })
}
export function dotOf(editor: TestEditor, id: string, corner = 0) {
  const dot = dots(editor, id)[corner]
  if (!dot) throw new Error(`no dot ${corner} on ${id}`)
  return dot
}
/** What a press by a mouse grabs at a stage point, the dots shown. */
export const grabAt = (editor: TestEditor, p: Point) => editor.modules.transformDrag.handleUnder(p, false, true)
export const r2 = (n: number) => Math.round(n * 100) / 100
/** Presses at a point, moves through `path` from it in steps of the stage, each with what the radius reads then, and lets go. */
export function dragThrough(editor: TestEditor, from: Point, path: Point[], read: () => unknown) {
  editor.mouse.move(from.x, from.y)
  editor.mouse.down()
  const seen = path.map((by) => {
    editor.mouse.move(from.x + by.x, from.y + by.y)
    return read()
  })
  editor.mouse.up()
  return seen
}
/** Sends one pointer input by a pointer type at a stage point, as a browser would, and draws. */
export function send(editor: TestEditor, type: PointerInput['type'], pointerType: string, at: Point) {
  editor.core.input.pointer({
    type,
    at,
    button: 0,
    detail: type === 'click' ? 1 : 0,
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    pointerType,
  })
  editor.core.redraw()
}
/** A tap or a press with no move by a finger or a pen at a point: what drag it started. */
export function tap(editor: TestEditor, pointerType: string, at: Point) {
  send(editor, 'pointerdown', pointerType, at)
  const kind = editor.modules.pointer.gesture()?.kind ?? null
  send(editor, 'pointerup', pointerType, at)
  send(editor, 'click', pointerType, at)
  return kind
}
/**
 * Drags the radius dot a press at `from` grabs to `to`, as `mouse.drag` does, and checks the
 * drag's invariants, throwing when one fails: it changed nothing but the layer's radius, and after
 * it wrote, the radius stored at the dragged corner is the radius drawn there.
 */
export function dragDot(editor: TestEditor, from: Point, to: Point, options: DragOptions = {}) {
  const grab = grabAt(editor, from)
  const id = editor.core.selection()[0]
  if (grab?.kind !== 'radius' || !id) throw new Error(`no radius dot at ${from.x}, ${from.y}`)
  // The design read is the live one: what it was before the drag is a copy.
  const before = JSON.parse(JSON.stringify(editor.core.design())) as ReturnType<TestEditor['core']['design']>
  editor.mouse.drag(from, to, options)
  const after = editor.core.design()
  const others = (nodes: typeof before.nodes) => JSON.stringify({ ...nodes, [id]: unrounded(nodes[id]) })
  if (others(before.nodes) !== others(after.nodes))
    throw new Error(`a radius drag of ${id} changed more than its radius`)
  const node = after.nodes[id]
  const box = editor.core.boxOf(id)
  if (!node || !box || JSON.stringify(before.nodes[id]) === JSON.stringify(node)) return
  const stored = radiiOf(node.type, node.props)
  const at = typeof stored === 'number' ? stored : stored?.[grab.corner]
  const drawn = radiusCorners(node.type, node.props, box.width, box.height)[grab.corner]?.drawn
  if (at !== drawn) throw new Error(`${id}'s corner ${grab.corner} stores ${at} and is drawn ${drawn}`)
}

/** A layer with its radius left out, wherever its type keeps it. */
function unrounded(node: { props: Record<string, unknown> } | undefined) {
  if (!node) return node
  const props: Record<string, unknown> = { ...node.props }
  delete props.cornerRadius
  if (props.shape) {
    const shape: Record<string, unknown> = { ...(props.shape as Record<string, unknown>) }
    delete shape.cornerRadius
    delete shape.corners
    props.shape = shape
  }
  return { ...node, props }
}
