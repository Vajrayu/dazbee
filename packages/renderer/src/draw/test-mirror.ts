// How far a render is from another one mirrored, for the flip tests. Test-only.
import type { Pixels } from '../seam.ts'

/**
 * The largest difference of one channel between `a` and `b` mirrored across its vertical (`x`) or
 * horizontal (`y`) centre line. Both are the same size.
 */
export function mirrorGap(a: Pixels, b: Pixels, axis: 'x' | 'y'): number {
  let gap = 0
  for (let y = 0; y < a.height; y++)
    for (let x = 0; x < a.width; x++) {
      const mx = axis === 'x' ? a.width - 1 - x : x
      const my = axis === 'y' ? a.height - 1 - y : y
      for (let c = 0; c < 4; c++) {
        const here = a.pixels[(y * a.width + x) * 4 + c] ?? 0
        const there = b.pixels[(my * b.width + mx) * 4 + c] ?? 0
        gap = Math.max(gap, Math.abs(here - there))
      }
    }
  return gap
}
