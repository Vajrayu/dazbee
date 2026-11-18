import { describe, expect, it } from 'vitest'

import { matrixParts, matrixRows } from './run-matrix.ts'

const keys = (parts: ReturnType<typeof matrixParts>) =>
  parts.flatMap(({ frameId, subjects }) =>
    matrixRows(frameId, subjects).map((r) => `${r.subject} ${r.gesture} ${r.frameId}`),
  )

describe('matrixParts', () => {
  it('shares out all 1050 rows, each once', () => {
    const all = keys(matrixParts())
    expect(all).toHaveLength(1050)
    expect(new Set(all).size).toBe(1050)
  })

  it('names six parts a frame, each with the title and the report file the suites and CI know it by', () => {
    const parts = matrixParts()
    expect(parts.map((p) => p.file)).toEqual(
      ['sq', 'wide'].flatMap((frameId) => [1, 2, 3, 4, 5, 6].map((part) => `gesture-matrix-${frameId}-${part}.md`)),
    )
    expect(parts[0]?.title).toMatch(/^every canvas gesture in the square frame, part 1 of 6: shape, /)
    expect(parts[6]?.title).toMatch(/^every canvas gesture in the wide frame, part 1 of 6: shape, /)
  })
})
