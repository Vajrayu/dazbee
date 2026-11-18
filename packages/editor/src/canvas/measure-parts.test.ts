import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Measured } from '../layers/measure.ts'
import type { Box } from '../layers/transform.ts'
import type { Frame } from './frames.ts'
import { measureParts } from './measure-parts.ts'

/** An element as the parts build one: its class, data, style and text, laid out 30 × 14 px. */
interface Fake {
  className: string
  dataset: Record<string, string>
  style: Record<string, string>
  textContent: string
  offsetWidth: number
  offsetHeight: number
}
const fake = (): Fake => ({ className: '', dataset: {}, style: {}, textContent: '', offsetWidth: 30, offsetHeight: 14 })
const SQUARE: Frame = { id: 'one-sq', pageId: 'one', name: 'Sale', x: 0, y: 0, width: 1080, height: 1080 }
/** From a box in the square to one round it, 200 × 150: a line to each side of it. */
const MEASURED: Measured = {
  frame: SQUARE,
  from: { x: 10, y: 10, width: 100, height: 100 },
  to: { x: 0, y: 0, width: 200, height: 150 },
}
/** An outline as the overlay places one, its box kept in its data. */
const outline = (className: string, frame: Frame, box: Box) =>
  ({ ...fake(), className, dataset: { frame: frame.id, box: JSON.stringify(box) } }) as unknown as HTMLElement

beforeEach(() => {
  vi.stubGlobal('document', { createElement: () => fake() })
})
afterEach(() => {
  vi.unstubAllGlobals()
})

/** The parts at a camera, each as the fake it is. */
function drawn(measured: Measured | null, camera = { x: 0, y: 100, zoom: 1 }) {
  const shown = measureParts(measured, camera, outline)
  return { ...shown, fakes: [...shown.lines, ...shown.pills] as unknown as Fake[] }
}

describe('measureParts', () => {
  it('draws nothing when nothing is measured', () => {
    expect(drawn(null).fakes).toEqual([])
  })

  it('outlines the box measured to, unturned, in its frame', () => {
    const [box] = drawn(MEASURED).fakes
    expect(box?.className).toBe('measure-box')
    expect(box?.dataset).toEqual({
      frame: 'one-sq',
      box: JSON.stringify({ x: 0, y: 0, width: 200, height: 150, rotation: 0 }),
    })
  })

  it('draws each line 1px across on the stage at the camera, and its value in the gap’s pill', () => {
    const { fakes } = drawn(MEASURED, { x: 10, y: 100, zoom: 2 })
    const lines = fakes.filter((p) => p.className === 'measure-line')
    expect(lines.map((l) => [l.dataset.axis, l.style.left, l.style.top, l.style.width, l.style.height])).toEqual([
      ['x', '10px', '220px', '20px', '1px'],
      ['x', '230px', '220px', '180px', '1px'],
      ['y', '130px', '100px', '1px', '20px'],
      ['y', '130px', '320px', '1px', '80px'],
    ])
    // Values are design pixels, whatever the zoom.
    expect(fakes.filter((p) => p.className === 'gap-size measure-value').map((p) => p.textContent)).toEqual([
      '10',
      '90',
      '10',
      '40',
    ])
  })

  it('dashes an extension, which has no value', () => {
    const { fakes } = drawn({ ...MEASURED, to: { x: 300, y: 300, width: 50, height: 50 } })
    const lines = fakes.filter((p) => p.className === 'measure-line')
    expect(lines.map((l) => [l.dataset.axis, l.dataset.dashed])).toEqual([
      ['x', undefined],
      ['y', ''],
      ['y', undefined],
      ['x', ''],
    ])
    expect(fakes.filter((p) => p.className === 'gap-size measure-value')).toHaveLength(2)
  })

  it('places each pill at its line’s middle once drawn, off what it is told to avoid', () => {
    const { fakes, place } = drawn(MEASURED)
    place([{ x: 40, y: 220, width: 40, height: 20 }])
    const pills = fakes.filter((p) => p.className === 'gap-size measure-value')
    expect(pills.map((p) => [p.style.left, p.style.top])).toEqual([
      ['-10px', '153px'],
      ['140px', '153px'],
      ['45px', '98px'],
      ['45px', '242px'],
    ])
  })
})
