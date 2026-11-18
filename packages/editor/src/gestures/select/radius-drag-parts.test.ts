import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { radiusDotParts, radiusPillParts } from './radius-drag-parts.ts'

/** An element as the parts file builds one: its class, data, style and text, laid out 64 × 14 px. */
const fake = () => ({
  className: '',
  dataset: {} as Record<string, string>,
  style: {} as Record<string, string>,
  textContent: '',
  offsetWidth: 64,
  offsetHeight: 14,
})
const STAGE = { x: 0, y: 0, width: 1280, height: 760 }

beforeEach(() => {
  vi.stubGlobal('document', { createElement: fake })
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('radiusDotParts', () => {
  it('places each dot in its layer’s box by its corner, the big one marked', () => {
    const parts = radiusDotParts([
      { corner: 0, x: 12, y: 12, big: false },
      { corner: 1, x: 188.5, y: 12, big: true },
    ]) as unknown as ReturnType<typeof fake>[]
    expect(parts).toEqual([
      expect.objectContaining({
        className: 'radius-dot',
        dataset: { corner: '0' },
        style: { left: '12px', top: '12px' },
      }),
      expect.objectContaining({
        className: 'radius-dot',
        dataset: { corner: '1', big: '' },
        style: { left: '188.5px', top: '12px' },
      }),
    ])
  })

  it('builds nothing with no dot', () => {
    expect(radiusDotParts([])).toEqual([])
  })
})

describe('radiusPillParts', () => {
  it('builds the gap’s pill with the radius’s words', () => {
    const { pills } = radiusPillParts('Radius 12')
    expect(pills).toEqual([expect.objectContaining({ className: 'gap-size radius-value', textContent: 'Radius 12' })])
  })

  it('places the pill once drawn, by its size, beside the pointer and off the size label', () => {
    const shown = radiusPillParts('Radius 12')
    const [pill] = shown.pills as unknown as ReturnType<typeof fake>[]
    shown.place({ x: 400, y: 300 }, [], STAGE)
    expect(pill?.style).toEqual({ left: '412px', top: '312px' })
    shown.place({ x: 400, y: 300 }, [{ x: 380, y: 310, width: 90, height: 20 }], STAGE)
    expect(pill?.style).toEqual({ left: '412px', top: '274px' })
  })

  it('builds nothing with no drag, and places nothing', () => {
    const shown = radiusPillParts(null)
    expect(shown.pills).toEqual([])
    shown.place({ x: 400, y: 300 }, [], STAGE)
  })
})
