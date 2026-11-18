// The lines a wrapping flow's layers are drawn on, read from where they are drawn: what a flip
// mirrors line by line and what a drag finds its place in. Ported from FigCraft's `wrap_rows`
// (`crates/engine/src/canvas/drop.rs`).
import type { Rect } from '@dazbee/schema'

/** How far apart two edges may be and still count as one, so rounding never starts a line. */
const SLACK = 0.5

/**
 * The lines of a wrapping flow's layers, given in flow order with the rooms they are drawn in:
 * each line the indexes of its layers, in order. `row` says the flow runs along x, else along y.
 * A layer starts a new line where it starts before the one before it along the flow, or where it
 * doesn't follow it along the flow but sits past it across.
 */
export function wrapLines(rooms: readonly Rect[], row: boolean): number[][] {
  const lines: number[][] = []
  let prev: Rect | undefined
  rooms.forEach((room, i) => {
    const b = row ? room : turned(room)
    const line = lines.at(-1)
    const follows =
      prev !== undefined &&
      b.x >= prev.x - SLACK &&
      !(b.x < prev.x + prev.width - SLACK && b.y >= prev.y + prev.height - SLACK)
    if (line && follows) line.push(i)
    else lines.push([i])
    prev = b
  })
  return lines
}

/** A rect with its axes swapped, so a column's lines read as a row's. */
function turned({ x, y, width, height }: Rect): Rect {
  return { x: y, y: x, width: height, height: width }
}
