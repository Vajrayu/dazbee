import { describe, expect, it } from 'vitest'

import { fieldStops } from '@/lib/editor/limits.ts'

import { spokenStops } from './number-field.tsx'

describe('spokenStops', () => {
  it('tells a screen reader the stops as shown, and none that is infinite, as a turn’s', () => {
    expect(spokenStops({ min: 0, max: 1 }, 100)).toEqual({ 'aria-valuemin': 0, 'aria-valuemax': 100 })
    expect(spokenStops(fieldStops(undefined, undefined), 1)).toEqual({
      'aria-valuemin': -100_000,
      'aria-valuemax': 100_000,
    })
    expect(spokenStops(fieldStops(Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY), 1)).toEqual({})
  })
})
