import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Frame } from '../../canvas/frames.ts'
import type { Box } from '../../layers/transform.ts'
import { dragParts } from './drag-parts.ts'

/** An element as the parts build one: its class, data, style and what it holds. */
interface Fake {
  className: string
  dataset: Record<string, string>
  style: Record<string, string>
  textContent: string
  children: Fake[]
  append(...more: Fake[]): void
}
const fake = (): Fake => ({
  className: '',
  dataset: {},
  style: {},
  textContent: '',
  children: [],
  append(...more) {
    this.children.push(...more)
  },
})
const FRAME: Frame = { id: 'f', pageId: 'p', name: 'F', x: 0, y: 0, width: 1080, height: 1080 }
const CAMERA = { x: 0, y: 0, zoom: 2 }
/** A group turned a quarter about its middle, (400, 300). */
const QUARTER: Box = { x: 300, y: 200, width: 200, height: 200, rotation: 90 }
/** A group turned 30° about its middle, (500, 450). */
const TURNED: Box = { x: 300, y: 300, width: 400, height: 300, rotation: 30 }

beforeEach(() => {
  vi.stubGlobal('document', { createElement: () => fake() })
})
afterEach(() => {
  vi.unstubAllGlobals()
})

/** The parts of a drag that snapped, each outlined at its box in design pixels with its turn, as `outline` would. */
function draw(snapped: Parameters<typeof dragParts>[1]) {
  const outlined = (className: string, _frame: Frame, box: Box) => {
    const el = fake()
    el.className = className
    el.dataset.box = [box.x, box.y, box.width, box.height].map((n) => Math.round(n * 100) / 100).join(' ')
    el.dataset.turn = String(box.rotation)
    return el as unknown as HTMLElement
  }
  return dragParts(null, snapped, CAMERA, outlined) as unknown as Fake[]
}

describe('dragParts', () => {
  it('draws each snap line across what lined up, and a cross on each point that lined up', () => {
    const parts = draw({
      frame: FRAME,
      around: [],
      snapLines: [{ axis: 'x', at: 100, from: 100, to: 380, points: [100, 200, 300, 380] }],
      gaps: [],
    })
    expect(parts.map((p) => p.className)).toEqual(['snap-line', 'snap-cross', 'snap-cross', 'snap-cross', 'snap-cross'])
    expect(parts[0]?.dataset).toMatchObject({ axis: 'x', box: '100 100 0 280', turn: '0' })
    // Each cross a point on the snap line, on screen at twice the zoom.
    expect(parts.slice(1).map((p) => p.style)).toEqual(
      [100, 200, 300, 380].map((y) => ({ left: '200px', top: `${2 * y}px` })),
    )
  })

  it('draws an equal gap as a solid line across it, with its size in a pill', () => {
    const [gap] = draw({ frame: FRAME, around: [], snapLines: [], gaps: [{ axis: 'x', from: 300, to: 340, at: 150 }] })
    expect(gap?.className).toBe('gap')
    expect(gap?.dataset).toMatchObject({ axis: 'x', box: '300 150 40 0', turn: '0' })
    expect(gap?.children.map((c) => [c.className, c.textContent, c.style])).toEqual([['gap-size', '40', {}]])
  })

  it('draws a snap line turned with the containers around the drag, its crosses upright on the points as turned', () => {
    // A line down the group's space at x = 350, from y = 250 to 350: turned a quarter about
    // (400, 300), it runs across the page at y = 250, from x = 450 to 350.
    const parts = draw({
      frame: FRAME,
      around: [QUARTER],
      snapLines: [{ axis: 'x', at: 350, from: 250, to: 350, points: [250, 350] }],
      gaps: [],
    })
    // The line's box keeps its size about its middle, (400, 250), turned a quarter there.
    expect(parts[0]?.dataset).toMatchObject({ axis: 'x', box: '400 200 0 100', turn: '90' })
    expect(parts.slice(1).map((p) => [p.className, p.style])).toEqual([
      ['snap-cross', { left: '900px', top: '500px' }],
      ['snap-cross', { left: '700px', top: '500px' }],
    ])
  })

  it('draws an equal gap turned with the containers, its size turned back upright', () => {
    const [gap] = draw({
      frame: FRAME,
      around: [TURNED],
      snapLines: [],
      gaps: [{ axis: 'x', from: 400, to: 440, at: 450 }],
    })
    // Its middle, (420, 450) in the group, is 80 before the group's along its turned x axis.
    expect(gap?.dataset).toMatchObject({ axis: 'x', box: '410.72 410 40 0', turn: '30' })
    expect(gap?.children.map((c) => [c.textContent, c.style])).toEqual([['40', { transform: 'rotate(-30deg)' }]])
  })

  it('turns a snap line by every container around the drag, the innermost first', () => {
    const inner: Box = { x: 350, y: 350, width: 100, height: 100, rotation: 60 }
    const [line] = draw({
      frame: FRAME,
      around: [QUARTER, inner],
      snapLines: [{ axis: 'y', at: 400, from: 350, to: 450, points: [] }],
      gaps: [],
    })
    // Through the inner one's middle, (400, 400), which the outer one turns to (300, 300).
    expect(line?.dataset).toMatchObject({ axis: 'y', box: '250 300 100 0', turn: '150' })
  })
})
