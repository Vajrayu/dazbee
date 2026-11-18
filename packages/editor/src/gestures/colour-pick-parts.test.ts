import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { PickShown, PickWindow } from './colour-pick.ts'
import { loupeParts } from './colour-pick-parts.ts'

/** An element as the parts build one: its tag, class, data, style, attributes, text and children. */
interface Fake {
  tagName: string
  className: string
  dataset: Record<string, string>
  style: Record<string, string>
  attributes: Record<string, string>
  textContent: string
  children: Fake[]
  width: number
  height: number
  put: { data: Uint8ClampedArray; width: number; height: number } | null
}
function fake(tagName: string): Fake {
  const el: Fake = {
    tagName,
    className: '',
    dataset: {},
    style: {},
    attributes: {},
    textContent: '',
    children: [],
    width: 300,
    height: 150,
    put: null,
  }
  return Object.assign(el, {
    append: (...children: Fake[]) => el.children.push(...children),
    setAttribute: (name: string, value: string) => {
      el.attributes[name] = value
    },
    getContext: () => ({
      createImageData: (width: number, height: number) => ({
        width,
        height,
        data: new Uint8ClampedArray(width * height * 4),
      }),
      putImageData: (image: Fake['put']) => {
        el.put = image
      },
    }),
  })
}
/** The part of a 1280 × 760 stage its chrome leaves clear: 8 px in from each side. */
const ROOM = { x: 8, y: 8, width: 1264, height: 744 }
/** A window of 11 cells a side round the pixel (x, y) of a frame `width` × `height`, each cell its index's grey. */
function windowOf(x: number, y: number, width = 400, height = 300, size = 11): PickWindow {
  const pixels = new Uint8Array(size * size * 4).map((_, i) => (i % 4 === 3 ? 255 : Math.floor(i / 4) % 256))
  return { frameId: 'sq', x, y, width, height, size, pixels }
}
const shown = (extra: Partial<PickShown> = {}): PickShown => ({
  at: { x: 400, y: 300 },
  pointerType: 'mouse',
  state: 'colour',
  hex: '#E0301E',
  window: windowOf(60, 50),
  ...extra,
})
/** The parts of the loupe, its lens and pill, by their classes. */
function parts(s: PickShown | null, zoom = 1, room = ROOM) {
  const [loupe, ...rest] = loupeParts(s, zoom, room) as unknown as Fake[]
  const all: Fake[] = []
  const walk = (el: Fake) => {
    all.push(el)
    el.children.forEach(walk)
  }
  if (loupe) walk(loupe)
  const find = (name: string) => all.find((el) => el.className.split(' ').includes(name))
  return { loupe, rest, find }
}

beforeEach(() => {
  vi.stubGlobal('document', { createElement: fake })
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('loupeParts', () => {
  it('draws nothing while nothing is picked or the pointer is off the stage', () => {
    expect(loupeParts(null, 1, ROOM)).toEqual([])
  })

  it('centres a 110 px circle on a mouse’s hot spot, of the window’s cells 10 px each at 100 %, the middle boxed', () => {
    const { loupe, rest, find } = parts(shown())
    expect(rest).toEqual([])
    expect(loupe?.dataset.state).toBe('colour')
    expect(loupe?.attributes['aria-hidden']).toBe('true')
    expect(loupe?.style).toMatchObject({ left: '345px', top: '245px', width: '110px', height: '110px' })
    const cells = find('loupe-cells')
    expect(cells).toMatchObject({ tagName: 'canvas', width: 11, height: 11 })
    expect(find('loupe-grid')?.style).toMatchObject({ left: '0px', top: '0px', width: '110px', height: '110px' })
    // The window's pixels, cell for cell.
    expect([...(cells?.put?.data ?? [])]).toEqual([...windowOf(60, 50).pixels])
    expect(find('loupe-centre')?.style).toMatchObject({ left: '50px', top: '50px', width: '10px', height: '10px' })
    // The ring is drawn in the lens's colour.
    expect(find('loupe-lens')?.style.color).toBe('#E0301E')
    const pill = find('loupe-hex')
    expect(pill?.textContent).toBe('#E0301E')
    expect(pill?.attributes.dir).toBe('ltr')
  })

  it('takes the zoom’s own cells past 10 px, fewer of them, the grid centred in the circle', () => {
    const { find } = parts(shown({ window: windowOf(60, 50, 400, 300, 5) }), 20)
    expect(find('loupe-cells')).toMatchObject({ width: 5, height: 5 })
    expect(find('loupe-grid')?.style).toMatchObject({ left: '5px', top: '5px', width: '100px', height: '100px' })
    expect(find('loupe-centre')?.style).toMatchObject({ left: '40px', top: '40px', width: '20px', height: '20px' })
  })

  it('lays the checker under the cells on the frame alone, the pasteboard round them', () => {
    // The pixel (1, 0) of a frame 3 × 2: the frame's cells are columns 4 to 6 and rows 5 and 6.
    const { find } = parts(shown({ window: windowOf(1, 0, 3, 2) }))
    expect(find('loupe-checker')?.style).toMatchObject({ left: '40px', top: '50px', width: '30px', height: '20px' })
  })

  it('stands 72 px over a finger, under it where there is no room over it', () => {
    const over = parts(shown({ pointerType: 'touch' })).loupe
    // Its bottom 72 px over the touch.
    expect(over?.style).toMatchObject({ left: '345px', top: `${300 - 72 - 110}px` })
    const under = parts(shown({ pointerType: 'touch', at: { x: 400, y: 100 } })).loupe
    expect(under?.style).toMatchObject({ left: '345px', top: `${100 + 72}px` })
  })

  it('stays inside the stage, its pill too', () => {
    expect(parts(shown({ at: { x: 4, y: 3 } })).loupe?.style).toMatchObject({ left: '8px', top: '8px' })
    const corner = parts(shown({ at: { x: 1279, y: 759 } })).loupe
    expect(corner?.style.left).toBe(`${1280 - 8 - 110}px`)
    expect(Number.parseFloat(corner?.style.top ?? '')).toBeLessThanOrEqual(760 - 8 - 110 - 30)
  })

  it('stays clear of the chrome along the stage: under the islands, a finger’s stands under the touch', () => {
    const room = { x: 8, y: 120, width: 1264, height: 560 }
    expect(parts(shown({ at: { x: 4, y: 3 } }), 1, room).loupe?.style).toMatchObject({ left: '8px', top: '120px' })
    const finger = parts(shown({ pointerType: 'touch', at: { x: 400, y: 200 } }), 1, room).loupe
    expect(finger?.style.top).toBe(`${200 + 72}px`)
  })

  it('shows an empty grid and “…” while the frame is drawn', () => {
    const { loupe, find } = parts(shown({ state: 'drawing', hex: null, window: null }))
    expect(loupe?.dataset.state).toBe('drawing')
    expect(find('loupe-grid')?.dataset.empty).toBe('')
    expect(find('loupe-cells')).toBeUndefined()
    expect(find('loupe-hex')?.textContent).toBe('…')
    expect(find('loupe-lens')?.style.color).toBeUndefined()
  })

  it('shows the pasteboard and “—” off every frame and over a frame too big, and “—” over a pixel too clear', () => {
    for (const state of ['outside', 'tooBig'] as const) {
      const { find } = parts(shown({ state, hex: null, window: null }))
      expect(find('loupe-cells')).toBeUndefined()
      expect(find('loupe-grid')).toBeUndefined()
      expect(find('loupe-hex')?.textContent).toBe('—')
    }
    const clear = parts(shown({ state: 'clear', hex: null }))
    expect(clear.find('loupe-cells')).toBeDefined()
    expect(clear.find('loupe-hex')?.textContent).toBe('—')
    expect(clear.find('loupe-lens')?.style.color).toBeUndefined()
  })
})
