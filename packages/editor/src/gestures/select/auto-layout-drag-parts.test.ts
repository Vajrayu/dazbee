import { describe, expect, it } from 'vitest'

import type { Frame } from '../../canvas/frames.ts'
import { flowParts } from './auto-layout-drag-parts.ts'

const SQUARE: Frame = { id: 'sq', pageId: 'p1', name: 'Square', x: 0, y: 0, width: 1080, height: 1080 }
const BOX = { x: 100, y: 100, width: 50, height: 50, rotation: 0 }

describe('flowParts', () => {
  it('outlines each part at its box in its frame, with the class of its kind, in order', () => {
    const outlined = flowParts(
      [
        { kind: 'ghost', frame: SQUARE, box: BOX },
        { kind: 'leave', frame: SQUARE, box: { ...BOX, width: 300 } },
        { kind: 'line', frame: SQUARE, box: { ...BOX, width: 2 } },
      ],
      (className, frame, box) => ({ className, frame: frame.id, width: box.width }) as unknown as HTMLElement,
    )
    expect(outlined).toEqual([
      { className: 'reorder-ghost', frame: 'sq', width: 50 },
      { className: 'reorder-leave', frame: 'sq', width: 300 },
      { className: 'reorder-line', frame: 'sq', width: 2 },
    ])
  })

  it('builds nothing with no part', () => {
    expect(flowParts([], () => ({}) as HTMLElement)).toEqual([])
  })
})
