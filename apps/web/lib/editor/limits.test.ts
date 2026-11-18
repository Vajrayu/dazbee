import { describe, expect, it } from 'vitest'

import { fieldStops } from './limits.ts'

describe('fieldStops', () => {
  it('stops a field with no limits of its own at 100000 either way, so a screen reader never hears a top of 0', () => {
    expect(fieldStops(undefined, undefined)).toEqual({ min: -100_000, max: 100_000 })
  })

  it('keeps a field’s own limits, and the other side at 100000', () => {
    expect(fieldStops(0, undefined)).toEqual({ min: 0, max: 100_000 })
    expect(fieldStops(undefined, 2_000)).toEqual({ min: -100_000, max: 2_000 })
    expect(fieldStops(1, 24)).toEqual({ min: 1, max: 24 })
  })
})
