// The hit test on flipped layers: each is picked where it draws, mirrored, never where it would
// draw unflipped.
import { describe, expect, it } from 'vitest'

import type { SceneLayer } from '@dazbee/renderer'

import { hitTest } from './hit-test.ts'
import { HALF } from './test-images.ts'
import { layer, photo, rect, RED, text } from './test-layers.ts'
import { testLooks } from './test-looks.ts'

const looks = testLooks({ half: HALF })

/** A 100 × 100 box at the page's corner. */
const SQUARE = { x: 0, y: 0, width: 100, height: 100 } as const
/** Opaque red at the left, clear at the right. */
const FADE = {
  type: 'linear',
  from: { x: 0, y: 0.5 },
  to: { x: 1, y: 0.5 },
  stops: [
    { offset: 0, color: '#FF0000FF' },
    { offset: 1, color: '#FF000000' },
  ],
} as const
/** Black at the left, white at the right. */
const DARK_TO_LIGHT = {
  ...FADE,
  stops: [
    { offset: 0, color: '#000000FF' },
    { offset: 1, color: '#FFFFFFFF' },
  ],
} as const
/** Layers over a larger square, `under`. */
const over = (...layers: SceneLayer[]) => [rect('under', 0, 0, 600, 300), ...layers]
/** The layer under a point, by id. */
const idAt = (layers: SceneLayer[], x: number, y: number) => hitTest(layers, { x, y }, looks)?.id

describe('hitTest', () => {
  it("picks a flipped photo by its mirrored pixels: the half-opaque image's opaque half is on the right", () => {
    const flipped = over(photo('p', 'half', { x: 0, y: 0, width: 200, height: 100, flipX: true }))
    expect(idAt(flipped, 150, 50)).toBe('p')
    expect(idAt(flipped, 50, 50)).toBe('under')
  })

  it('reads a flipped gradient where it is drawn: the fade is opaque at the right', () => {
    const flipped = over(layer('fade', 'graphic', { ...SQUARE, shape: { kind: 'rect' }, fills: [FADE], flipX: true }))
    expect(idAt(flipped, 95, 50)).toBe('fade')
    expect(idAt(flipped, 5, 50)).toBe('under')
  })

  it('picks a flipped text on its mirrored lines: a short line at the top left is drawn at the top right, or bottom left', () => {
    const box = { x: 0, y: 0, width: 600, height: 300 }
    const across = over(text('words', 'Hi', { ...box, flipX: true }))
    expect(idAt(across, 585, 25)).toBe('words')
    expect(idAt(across, 15, 25)).toBe('under')
    const down = over(text('words', 'Hi', { ...box, flipY: true }))
    expect(idAt(down, 15, 275)).toBe('words')
    expect(idAt(down, 15, 25)).toBe('under')
  })

  it('lets what a flipped text masks show on its mirrored lines alone', () => {
    const masked = over(
      text('mask', 'Hi', { x: 0, y: 0, width: 600, height: 300, mask: 'alpha', flipX: true }),
      layer('masked', 'graphic', { x: 0, y: 0, width: 600, height: 300, shape: { kind: 'rect' }, fills: [RED] }),
    )
    expect(idAt(masked, 585, 25)).toBe('masked')
    expect(idAt(masked, 15, 25)).toBe('under')
  })

  it('weighs a flipped luminance mask by its mirrored brightness: dark at the right lets nothing through', () => {
    const masked = over(
      layer('mask', 'graphic', {
        ...SQUARE,
        shape: { kind: 'rect' },
        fills: [DARK_TO_LIGHT],
        mask: 'luminance',
        flipX: true,
      }),
      layer('masked', 'graphic', { ...SQUARE, shape: { kind: 'rect' }, fills: [RED] }),
    )
    expect(idAt(masked, 5, 50)).toBe('masked')
    expect(idAt(masked, 95, 50)).toBe('under')
  })

  it("passes a flipped container's point to the layers inside it unmirrored", () => {
    const box = layer('box', 'box', { ...SQUARE, width: 200, clip: false, flipX: true }, [
      photo('p', 'half', { x: 0, y: 0, width: 200, height: 100 }),
    ])
    expect(idAt(over(box), 50, 50)).toBe('p')
  })
})
