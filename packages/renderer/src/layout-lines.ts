// The parts of auto layout that a flow's lines and its layers' limits need: a size held between a
// layer's least and most, a flow broken into lines where the next layer would pass the box's
// length, the room along a line shared by turns among the layers that fill it, and the room left
// across the flow shared among the lines. Ported from FigCraft's `clamp_size`, `flow_lines`,
// `distribute` and `align_flow_lines` (`crates/layout/src/lib.rs`).
import type { Axis } from '@dazbee/doc'
import type { AutoLayout, LayerLimits } from '@dazbee/schema'

/** A side's least and most, as `[least, most]`. */
export type Range = readonly [number | undefined, number | undefined]

/** Below this, two lengths are the same, so rounding never starts a line or freezes a share. */
const NEAR = 1e-6

/** A layer's limits on one side, as `[least, most]`. */
export function rangeOf(limits: LayerLimits, axis: Axis): Range {
  return axis === 'width' ? [limits.minWidth, limits.maxWidth] : [limits.minHeight, limits.maxHeight]
}

/**
 * A length held between a side's least and most, the least winning where they cross; a side with
 * neither keeps its length, as a box its negative padding makes less than nothing does.
 */
export function clampTo(length: number, [min, max]: Range): number {
  let out = Number.isFinite(length) ? length : 0
  if (max !== undefined) out = Math.min(out, max)
  if (min !== undefined) out = Math.max(out, min)
  return out
}

/**
 * A flow broken into lines, in order: a layer starts a new line where it would take the line past
 * `room`, counting `gap` before it (never less than 0), unless it would start the line anyway. So
 * a layer longer than the room has a line of its own, and no line is empty. `length` is how much
 * of a line a layer takes.
 */
export function breakLines<T>(items: readonly T[], room: number, gap: number, length: (item: T) => number): T[][] {
  const lines: T[][] = []
  let line: T[] = []
  let used = 0
  for (const item of items) {
    const size = length(item)
    const added = line.length === 0 ? size : Math.max(0, gap) + size
    if (line.length > 0 && used + added > room + NEAR) {
      lines.push(line)
      line = [item]
      used = size
    } else {
      line.push(item)
      used += added
    }
  }
  if (line.length > 0 || lines.length === 0) lines.push(line)
  return lines
}

/**
 * The room `free` shared among layers that fill it, each share held to its layer's range: by
 * turns, a layer its range holds takes that length and the rest share what is left, until every
 * share is within its range. Shares are never below 0.
 */
export function shareRoom(free: number, ranges: readonly Range[]): number[] {
  const sizes = ranges.map(() => 0)
  let open = ranges.map((_, i) => i)
  let left = Math.max(0, free)
  while (open.length > 0) {
    const want = left / open.length
    const sized = open.map((i) => ({ i, v: clampTo(want, ranges[i] ?? [undefined, undefined]) }))
    const pushed = sized.reduce((sum, s) => sum + s.v - want, 0)
    // The shares its range moved the same way as the sum are settled; with none moved, all are.
    const settled = (v: number) => Math.abs(pushed) < NEAR || (pushed > 0 ? v > want + NEAR : v < want - NEAR)
    const done = sized.filter((s) => settled(s.v))
    // Ranges that each moved a share less than NEAR may add up past it: settle them all.
    for (const s of done.length > 0 ? done : sized) {
      sizes[s.i] = s.v
      left -= s.v
    }
    if (done.length === 0) break
    left = Math.max(0, left)
    open = sized.filter((s) => !settled(s.v)).map((s) => s.i)
  }
  return sizes
}

/**
 * How wrapped lines take the room across the flow, given each line's own length across: where the
 * first line starts past the box's start (`offset`), the room between lines (`gap`), and each
 * line's length across (`rooms`). Spread, the room left goes between them where there is any, and
 * none goes between where there is none. Packed, they sit `gap` apart where `align` puts them, or,
 * when every layer fills across the flow (`allFill`), each line takes an equal part of the room left.
 */
export function spreadLines(
  lines: readonly number[],
  room: number,
  gap: number,
  layout: Pick<AutoLayout, 'align' | 'alignLines'>,
  allFill: boolean,
): { offset: number; gap: number; rooms: number[] } {
  const total = lines.reduce((sum, l) => sum + l, 0)
  const between = Math.max(1, lines.length - 1)
  const spread = layout.alignLines === 'space-between'
  if (spread && room - total > 0) return { offset: 0, gap: (room - total) / between, rooms: [...lines] }
  const shown = spread ? 0 : gap
  const free = room - total - shown * (lines.length - 1)
  if (free > 0 && allFill) return { offset: 0, gap: shown, rooms: lines.map((l) => l + free / lines.length) }
  const offset = layout.align === 'center' ? free / 2 : layout.align === 'end' ? free : 0
  return { offset, gap: shown, rooms: [...lines] }
}
