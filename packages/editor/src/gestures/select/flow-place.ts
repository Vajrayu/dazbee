// Where in a laid-out box's flow a point puts layers being dragged: the place, and the layer the
// line is drawn beside; in a grid by its cells, and in a wrapping flow by its lines, as FigCraft's
// `wrap_slot` finds it.
import { wrapLines } from '@dazbee/doc'
import type { Point, Rect } from '@dazbee/schema'

/** Where in a flow layers would go: the place, the index of the layer they go before, and the layer the line is beside. */
export interface FlowPlace {
  slot: number
  near: { id: string; after: boolean } | null
}

/**
 * Where in a grid a point, as its layers see it, puts layers being moved: in the cell under it, or
 * the nearest, counted on to the end of the last row; before the layer in it or after it as the
 * point is before or past the cell's middle; in a cell past the last layer, after that one. The
 * slot counts the layers before that place that aren't moving.
 */
export function cellPlace(cells: readonly Rect[], flow: string[], roots: string[], p: Point): FlowPlace {
  const k = cells.reduce((best, cell, i) => (distanceTo(cell, p) < distanceTo(cells[best] as Rect, p) ? i : best), 0)
  const at = Math.min(k, flow.length - 1)
  const cell = cells[k] as Rect
  const after = k > at || p.x > cell.x + cell.width / 2
  const slot = flow.slice(0, at + (after ? 1 : 0)).filter((id) => !roots.includes(id)).length
  return { slot, near: { id: flow[at] as string, after } }
}

/** How far a point is from a box: 0 inside it. */
export function distanceTo(b: Rect, p: Point) {
  return Math.hypot(Math.max(b.x - p.x, 0, p.x - (b.x + b.width)), Math.max(b.y - p.y, 0, p.y - (b.y + b.height)))
}

/**
 * Where in a wrapping flow a point puts layers being moved: among the lines its layers are drawn on,
 * read with the moving ones (`i` null) so a line they start stays a line, the one under the point
 * across the flow, or the nearest; in it, before the first layer that isn't moving whose middle is
 * past the point along the flow, or after its last. `row` says the flow runs along x. Each layer
 * that isn't moving carries its index among those, which the slot counts in.
 */
export function linePlace(placed: { id: string; i: number | null; room: Rect }[], p: Point, row: boolean): FlowPlace {
  const at = row ? p.y : p.x
  const lines = wrapLines(
    placed.map(({ room }) => room),
    row,
  ).flatMap((line) => {
    const all = line.flatMap((k) => placed[k] ?? [])
    const staying = all.flatMap((one) => (one.i === null ? [] : [{ ...one, i: one.i }]))
    if (staying.length === 0) return []
    const lo = Math.min(...all.map(({ room }) => (row ? room.y : room.x)))
    const hi = Math.max(...all.map(({ room }) => (row ? room.y + room.height : room.x + room.width)))
    return [{ staying, away: Math.max(lo - at, 0, at - hi) }]
  })
  const line = lines.reduce<(typeof lines)[number] | undefined>(
    (best, one) => (!best || one.away < best.away ? one : best),
    undefined,
  )?.staying
  const last = line?.at(-1)
  if (!line || !last) return { slot: 0, near: null }
  const middle = (r: Rect) => (row ? r.x + r.width / 2 : r.y + r.height / 2)
  const before = line.find(({ room }) => (row ? p.x : p.y) < middle(room))
  if (before) return { slot: before.i, near: { id: before.id, after: false } }
  return { slot: last.i + 1, near: { id: last.id, after: true } }
}
