// The flow drag's speed check: a pointer move of a drag in a long flow, or of a free layer over one
// it would drop into, its input and the redraw pass after it, stays under 16 ms at 200 layers, so
// the browser keeps the rest of a 60 Hz frame for drawing.
import { describe, expect, it } from 'vitest'

import { testEditor } from '@dazbee/editor/test-editor'

import { dragOnce, quantile, speedCases } from './flow-drag-speed.ts'

/** The budget for a move, input and redraw: under a 60 Hz frame's 16.7 ms. */
const BUDGET_MS = 16
/** The drags timed a case, after one to warm up. */
const DRAGS = 5

describe('the flow drag', () => {
  it.each(speedCases().map((c) => [c.name, c] as const))(
    'moves in %s in under 16 ms: the median of 5 drags’ 95th-percentile move',
    async (_, c) => {
      const e = await testEditor(c.design)
      try {
        dragOnce(e, c)
        const drags = Array.from({ length: DRAGS }, () => dragOnce(e, c))
        const p95s = drags.map(({ input, redraw }) =>
          quantile(
            input.map((ms, i) => ms + (redraw[i] ?? 0)),
            0.95,
          ),
        )
        const inputs = drags.flatMap(({ input }) => input)
        const said = `${c.name}: each drag's 95th-percentile move ${p95s.map((ms) => ms.toFixed(1)).join(', ')} ms; input p50 ${quantile(inputs, 0.5).toFixed(2)} ms`
        expect(quantile(p95s, 0.5), said).toBeLessThan(BUDGET_MS)
      } finally {
        e.end()
      }
    },
    120_000,
  )
})
