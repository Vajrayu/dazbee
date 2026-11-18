// The designs and the drags of the flow drag's speed check: a box's frame, holding a long flow, beside
// 10 frames of 100 layers, so the design is the size of a real one; and one drag along the flow on
// the editor core in Node, timing each pointer move's input and the redraw pass after it (pictures
// recorded, not rastered: the browser rasters them on the GPU).
import type { TestEditor } from '@dazbee/editor/test-editor'
import type { DesignInput, Point } from '@dazbee/schema'

/**
 * A case: its design, the layer pressed and where, and the line the pointer then walks along, in the
 * box's frame `F`: from the press unless `along` starts it elsewhere.
 */
export interface SpeedCase {
  name: string
  design: DesignInput
  pressed: string
  from: Point
  to: Point
  along?: Point
}

/** One drag's times: each move's input and the redraw after it, in ms. */
export interface DragTimes {
  input: number[]
  redraw: number[]
}

/** The pointer moves a drag makes. */
export const MOVES = 60

type Kind = 'graphic' | 'text'

/** The flow drag's speed cases: each a long flow on its frame beside 10 frames of 100 layers. */
export function speedCases(): SpeedCase[] {
  return [
    rowCase(200),
    gridCase(200, 'graphic'),
    gridCase(200, 'text'),
    nestedCase(),
    nestedOuterCase(),
    freeAlongRowCase(200),
  ]
}

/** One drag of a case on an editor showing its design, undone after: each move's input and redraw times. */
export function dragOnce(e: TestEditor, c: SpeedCase): DragTimes {
  e.core.select([c.pressed])
  e.core.redraw()
  const press = e.core.stagePoint(c.from.x, c.from.y, 'F')
  const from = c.along ? e.core.stagePoint(c.along.x, c.along.y, 'F') : press
  const to = e.core.stagePoint(c.to.x, c.to.y, 'F')
  pointer(e, 'pointermove', press)
  pointer(e, 'pointerdown', press)
  e.core.redraw()
  const input: number[] = []
  const redraw: number[] = []
  for (let k = 1; k <= MOVES; k++) {
    const at = { x: from.x + ((to.x - from.x) * k) / MOVES, y: from.y + ((to.y - from.y) * k) / MOVES }
    const t0 = performance.now()
    pointer(e, 'pointermove', at)
    const t1 = performance.now()
    e.core.redraw()
    input.push(t1 - t0)
    redraw.push(performance.now() - t1)
  }
  pointer(e, 'pointerup', to)
  e.core.redraw()
  e.press('undo')
  e.core.redraw()
  return { input, redraw }
}

/** The `q` quantile of some numbers, the nearest rank below. */
export function quantile(xs: readonly number[], q: number) {
  const sorted = [...xs].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0
}

/** The frame `F` holding `nodes`, beside 10 frames of 100 layers, a third of them texts. */
export function designWith(nodes: Record<string, object>): DesignInput {
  const frames: Record<string, object> = {
    F: { pageId: 'p1', name: 'F', width: 1080, height: 1080, x: 0, y: 0, order: 'a0' },
  }
  const all: Record<string, object> = { ...nodes }
  for (let f = 0; f < 10; f++) {
    const id = `other${f}`
    frames[id] = { pageId: 'p1', name: id, width: 1080, height: 1080, x: 1200 * (f + 1), y: 0, order: `b${f}` }
    for (let i = 0; i < 100; i++) {
      const layer = item(i % 3 === 0 ? 'text' : 'graphic', id, i, { width: 100, height: 40 })
      all[`${id}-${i}`] = { ...layer, props: { ...layer.props, x: (i % 10) * 105, y: Math.floor(i / 10) * 45 } }
    }
  }
  return {
    meta: { designId: 'd', name: 'D' },
    pages: { p1: { name: 'One', order: 'a0' } },
    frames,
    nodes: all,
  } as unknown as DesignInput
}

function item(kind: Kind, parentId: string, i: number, size: { width: number; height: number }) {
  const common = { parentId, index: `a${String(i).padStart(4, '0')}`, link: `${parentId}-${i}`, name: `Item ${i}` }
  return kind === 'graphic'
    ? {
        ...common,
        type: 'graphic' as const,
        props: {
          x: 0,
          y: 0,
          ...size,
          shape: { kind: 'rect' as const },
          fills: [{ type: 'solid', color: '#3366FFFF' }],
        },
      }
    : {
        ...common,
        type: 'text' as const,
        props: {
          x: 0,
          y: 0,
          ...size,
          text: `Item number ${i}`,
          boxMode: 'fixed',
          style: {
            fontFamily: 'Noto Sans',
            fontSize: Math.max(4, Math.min(16, size.height * 0.7)),
            color: '#000000FF',
          },
        },
      }
}

/** A row of `n` graphics across the frame at 20, 100, 1040 by 120, with a gap of 2. */
function rowNodes(n: number) {
  const width = Math.max(2, Math.floor(1000 / n) - 2)
  const nodes: Record<string, object> = {
    box: {
      type: 'box',
      parentId: 'F',
      index: 'a0',
      link: 'box',
      name: 'Row',
      props: { x: 20, y: 100, width: 1040, height: 120, layout: { direction: 'row', gap: 2 } },
    },
  }
  for (let i = 0; i < n; i++) nodes[`i${i}`] = item('graphic', 'box', i, { width, height: 100 })
  return { nodes, width }
}

/** A drag of the row's first graphic along it to its last. */
function rowCase(n: number): SpeedCase {
  const { nodes, width } = rowNodes(n)
  return {
    name: `a row of ${n} graphics`,
    design: designWith(nodes),
    pressed: 'i0',
    from: { x: 20 + width / 2, y: 150 },
    to: { x: 20 + (width + 2) * (n - 1) + width / 2, y: 150 },
  }
}

/** A grid of `n` layers in 10 columns, its first layer dragged down to its last row's last column. */
function gridCase(n: number, kind: Kind): SpeedCase {
  const rows = Math.ceil(n / 10)
  const height = Math.max(2, Math.floor(1000 / rows) - 2)
  const nodes: Record<string, object> = {
    box: {
      type: 'box',
      parentId: 'F',
      index: 'a0',
      link: 'box',
      name: 'Grid',
      props: { x: 20, y: 20, width: 1040, height: 1040, layout: { direction: 'grid', columns: 10, gap: 2 } },
    },
  }
  for (let i = 0; i < n; i++) nodes[`i${i}`] = item(kind, 'box', i, { width: 100, height })
  return {
    name: `a grid of ${n} ${kind === 'graphic' ? 'graphics' : 'texts'}`,
    design: designWith(nodes),
    pressed: 'i0',
    from: { x: 70, y: 20 + height / 2 },
    to: { x: 70 + 103 * 9, y: 20 + (height + 2) * (rows - 1) + height / 2 },
  }
}

/** A column of 10 rows of 20 graphics; a drag along its third row. */
function nestedCase(): SpeedCase {
  const nodes: Record<string, object> = {
    col: {
      type: 'box',
      parentId: 'F',
      index: 'a0',
      link: 'col',
      name: 'Column',
      props: { x: 20, y: 20, width: 1040, height: 1040, layout: { direction: 'column', gap: 4 } },
    },
  }
  for (let r = 0; r < 10; r++) {
    nodes[`r${r}`] = {
      type: 'box',
      parentId: 'col',
      index: `a${r}`,
      link: `r${r}`,
      name: `Row ${r}`,
      props: { x: 0, y: 0, width: 1040, height: 96, layout: { direction: 'row', gap: 2 } },
    }
    for (let i = 0; i < 20; i++) nodes[`r${r}i${i}`] = item('graphic', `r${r}`, i, { width: 48, height: 90 })
  }
  // The third row is laid out at y 220, its first graphic at x 20.
  return {
    name: 'a column of 10 rows of 20 graphics, a drag in a row',
    design: designWith(nodes),
    pressed: 'r2i0',
    from: { x: 44, y: 265 },
    to: { x: 20 + 50 * 19 + 24, y: 265 },
  }
}

/** The same column, its first row dragged down along it. */
function nestedOuterCase(): SpeedCase {
  return {
    ...nestedCase(),
    name: 'a column of 10 rows of 20 graphics, a row dragged along the column',
    pressed: 'r0',
    from: { x: 1000, y: 68 },
    to: { x: 1000, y: 968 },
  }
}

/** A free graphic under a row of `n`, dragged along the row it would drop into. */
function freeAlongRowCase(n: number): SpeedCase {
  const { nodes } = rowNodes(n)
  nodes.free = {
    type: 'graphic',
    parentId: 'F',
    index: 'a1',
    link: 'free',
    name: 'Free',
    props: {
      x: 20,
      y: 400,
      width: 40,
      height: 40,
      shape: { kind: 'rect' },
      fills: [{ type: 'solid', color: '#FF0000FF' }],
    },
  }
  return {
    name: `a free graphic dragged along a row of ${n} it would drop into`,
    design: designWith(nodes),
    pressed: 'free',
    from: { x: 40, y: 420 },
    along: { x: 30, y: 150 },
    to: { x: 1040, y: 150 },
  }
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
