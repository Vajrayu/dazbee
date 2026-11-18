import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Frame } from '../../canvas/frames.ts'
import type { Box } from '../../layers/transform.ts'
import type { ShownCrop } from './cropping.ts'
import { cropParts } from './cropping-parts.ts'

/** An element as the parts build one: its class, the box it outlines, its data, style and what it holds. */
interface Fake {
  className: string
  box?: Box
  dataset: Record<string, string>
  style: Record<string, string>
  children: Fake[]
}
const fake = (className = '', box?: Box): Fake =>
  ({
    className,
    ...(box ? { box } : {}),
    dataset: {},
    style: {},
    children: [],
    append(...more: Fake[]) {
      this.children.push(...more)
    },
  }) as Fake
const SQUARE: Frame = { id: 'sq', pageId: 'p1', name: 'Square', x: 0, y: 0, width: 1080, height: 1080 }
/** A 200 × 100 window over the middle of a 400 × 200 image, both turned 10° as drawn. */
const CROP: ShownCrop = {
  frame: SQUARE,
  id: 'photo',
  window: { x: 200, y: 150, width: 200, height: 100, rotation: 10 },
  whole: { x: 100, y: 100, width: 400, height: 200, rotation: 10 },
  box: { x: 200, y: 150, width: 200, height: 100 },
  rect: { x: 100, y: 100, width: 400, height: 200 },
  ghost: 'faint.png',
}
const draw = (crop: ShownCrop | null) =>
  cropParts(crop, (className, _frame, box) => fake(className, box) as unknown as HTMLElement) as unknown as Fake[]

beforeEach(() => {
  vi.stubGlobal('document', { createElement: () => fake() })
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('cropParts', () => {
  it('builds nothing with no crop', () => {
    expect(draw(null)).toEqual([])
  })

  it('outlines the window as drawn, marked with the layer, with a bracket on each corner and a bar on each side', () => {
    const [pane] = draw(CROP)
    expect(pane).toMatchObject({ className: 'selection', box: CROP.window, dataset: { cropping: 'photo' } })
    expect(pane?.children.map((el) => [el.className, el.dataset.cropWindow, el.style.left, el.style.top])).toEqual([
      ['crop-bracket', 'nw', '0%', '0%'],
      ['crop-bar', 'n', '50%', '0%'],
      ['crop-bracket', 'ne', '100%', '0%'],
      ['crop-bar', 'e', '100%', '50%'],
      ['crop-bracket', 'se', '100%', '100%'],
      ['crop-bar', 's', '50%', '100%'],
      ['crop-bracket', 'sw', '0%', '100%'],
      ['crop-bar', 'w', '0%', '50%'],
    ])
  })

  it('outlines the whole image as drawn, its faint picture clear over the window, with a round handle on each corner', () => {
    const [, whole] = draw(CROP)
    expect(whole).toMatchObject({ className: 'crop-image', box: CROP.whole })
    const [ghost, ...corners] = whole?.children ?? []
    expect(ghost).toMatchObject({
      className: 'crop-ghost',
      style: {
        backgroundImage: 'url("faint.png")',
        clipPath: 'polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, 25% 25%, 25% 75%, 75% 75%, 75% 25%, 25% 25%)',
      },
    })
    expect(corners.map((el) => [el.className, el.dataset.cropCorner, el.style.left, el.style.top])).toEqual([
      ['crop-zoom', '0', '0%', '0%'],
      ['crop-zoom', '1', '100%', '0%'],
      ['crop-zoom', '2', '100%', '100%'],
      ['crop-zoom', '3', '0%', '100%'],
    ])
  })

  it("mirrors a flipped layer's faint picture, clear where the window lies over it before the mirror", () => {
    // The window over the image's left half and its middle band, as drawn: the picture's right half once mirrored.
    const [, whole] = draw({ ...CROP, box: { ...CROP.box, x: 100 }, flipX: true })
    expect(whole?.children[0]?.style).toMatchObject({
      transform: 'scale(-1, 1)',
      clipPath: 'polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, 50% 25%, 50% 75%, 100% 75%, 100% 25%, 50% 25%)',
    })
  })
})
