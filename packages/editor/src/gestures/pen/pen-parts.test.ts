import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Frame } from '../../canvas/frames.ts'
import type { ShownPath } from './pen.ts'
import { pathParts } from './pen-parts.ts'

/** An element as the parts build one: its class or tag, attributes, data, style and what it holds. */
interface Fake {
  className: string
  attributes: Record<string, string>
  dataset: Record<string, string>
  style: Record<string, string>
  children: Fake[]
}
const fake = (name = ''): Fake =>
  ({
    className: name,
    attributes: {},
    dataset: {},
    style: {},
    children: [],
    setAttribute(key: string, value: string) {
      this.attributes[key] = value
    },
    append(...more: Fake[]) {
      this.children.push(...more)
    },
  }) as Fake
const WIDE: Frame = { id: 'wide', pageId: 'p1', name: 'Wide', x: 1000, y: 0, width: 1200, height: 628 }
const CAMERA = { x: 10, y: 20, zoom: 2 }
/** A corner, then a smooth anchor with both handles, drawn by the pen in the wide frame. */
const PATH: ShownPath = {
  frame: WIDE,
  around: [],
  path: [
    {
      anchors: [
        { x: 0, y: 0 },
        { x: 100, y: 0, in: { x: 80, y: 0 }, out: { x: 120, y: 0 } },
      ],
      closed: false,
    },
  ],
  handles: [{ contour: 0, index: 1 }],
  picked: false,
  preview: null,
  closing: false,
}
const draw = (shown: ShownPath | null) => pathParts(shown, CAMERA) as unknown as Fake[]

beforeEach(() => {
  vi.stubGlobal('document', { createElement: () => fake(), createElementNS: (_ns: string, name: string) => fake(name) })
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('pathParts', () => {
  it('builds nothing with no path shown', () => {
    expect(draw(null)).toEqual([])
  })

  it('draws the outline at the camera, the handles of the anchors in play with their lines, then every anchor', () => {
    const [svg, ...dots] = draw(PATH)
    expect(svg?.attributes.class).toBe('path-edit')
    expect(svg?.children.map((line) => [line.attributes.class, line.attributes.d])).toEqual([
      ['path-outline', 'M2010 20 C2010 20 2170 20 2210 20'],
      ['path-handle-line', 'M2210 20 L2170 20'],
      ['path-handle-line', 'M2210 20 L2250 20'],
    ])
    expect(dots.map((dot) => [dot.className, dot.dataset, dot.style])).toEqual([
      ['path-control', { control: '0:1:in' }, { left: '2170px', top: '20px' }],
      ['path-control', { control: '0:1:out' }, { left: '2250px', top: '20px' }],
      ['path-anchor', { anchor: '0:0' }, { left: '2010px', top: '20px' }],
      ['path-anchor', { anchor: '0:1' }, { left: '2210px', top: '20px' }],
    ])
  })

  it("draws the pen's next segment, and marks its first anchor as closing", () => {
    const [svg, ...dots] = draw({
      ...PATH,
      handles: [],
      preview: [PATH.path[0]?.anchors[1] ?? { x: 0, y: 0 }, { x: 150, y: 50 }],
      closing: true,
    })
    expect(svg?.children.at(-1)?.attributes).toEqual({
      class: 'pen-preview',
      d: 'M2210 20 C2250 20 2310 120 2310 120',
    })
    expect(dots.map((dot) => dot.dataset)).toEqual([{ anchor: '0:0', closing: '' }, { anchor: '0:1' }])
  })

  it('marks the anchors in play as selected only while the points are edited', () => {
    expect(draw({ ...PATH, picked: true }).at(-1)?.dataset).toEqual({ anchor: '0:1', selected: '' })
    expect(draw(PATH).at(-1)?.dataset).toEqual({ anchor: '0:1' })
  })
})
