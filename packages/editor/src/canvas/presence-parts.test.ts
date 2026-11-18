import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ShownPerson } from '../presence.ts'
import { presenceParts, textOn } from './presence-parts.ts'
import { type Fake, fake, SQUARE, STORY } from './test-overlay.ts'

const BOB: ShownPerson = {
  tabId: 7,
  name: 'Bob',
  colour: '#9747FF',
  cursor: { x: 120.5, y: 40 },
  layers: [
    { frame: SQUARE, id: 'a' },
    { frame: STORY, id: 'b' },
  ],
  frame: null,
}
const CAT: ShownPerson = { tabId: 9, name: 'Cat', colour: '#14AE5C', cursor: null, layers: [], frame: STORY }

/** A layer's outline as the overlay builds one, named by its frame and layer. */
const layerOutline = (frame: { id: string }, id: string) => fake(`layer ${frame.id} ${id}`) as unknown as HTMLElement
const frameOutline = (frame: { id: string }) => fake(`frame ${frame.id}`) as unknown as HTMLElement

beforeEach(() => {
  vi.stubGlobal('document', { createElement: () => fake(), createElementNS: (_ns: string, name: string) => fake(name) })
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('presenceParts', () => {
  it("outlines each person's layers and picked frame in their colour, and draws a cursor only where their pointer is", () => {
    const { outlines, cursors } = presenceParts([BOB, CAT], layerOutline, frameOutline) as unknown as {
      outlines: Fake[]
      cursors: Fake[]
    }
    expect(outlines.map((o) => [o.className, o.style.color, o.dataset.tab])).toEqual([
      ['layer one-sq a', '#9747FF', '7'],
      ['layer one-story b', '#9747FF', '7'],
      ['frame one-story', '#14AE5C', '9'],
    ])
    expect(cursors).toHaveLength(1)
    const [cursor] = cursors
    expect([cursor?.className, cursor?.dataset.tab, cursor?.style]).toEqual([
      'presence-cursor',
      '7',
      { left: '120.5px', top: '40px', color: '#9747FF' },
    ])
    const [dart, name] = cursor?.children ?? []
    expect(dart?.attributes.class).toBe('presence-dart')
    expect(dart?.children[0]?.attributes.d).toBe('M0 0 L3.5 15.5 L7.5 8.5 L15.5 4 Z')
    expect([name?.className, name?.textContent, name?.style]).toEqual([
      'presence-name',
      'Bob',
      { background: '#9747FF', color: '#FFFFFF' },
    ])
  })

  it('leaves out a layer the overlay has no box for', () => {
    const { outlines } = presenceParts(
      [BOB],
      (frame, id) => (id === 'a' ? layerOutline(frame, id) : null),
      frameOutline,
    )
    expect(outlines).toHaveLength(1)
  })
})

describe('textOn', () => {
  it('reads dark on a light colour and white on a dark one, by its weighted lightness', () => {
    expect([textOn('#FFE066'), textOn('#0D99FF'), textOn('#665CE0'), textOn('#FFFFFF')]).toEqual([
      '#1E1E1E',
      '#FFFFFF',
      '#FFFFFF',
      '#1E1E1E',
    ])
  })
})
