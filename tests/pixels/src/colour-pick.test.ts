// Picking a colour reads the 1x export's pixels: on every frame of every pixel fixture,
// at 64 seeded points reached by stage points at 37% and at 400%, each after a scroll, what the
// loupe shows is the pixels `renderPixels` draws at 1x around the point, with no tolerance, and a
// click there picks that pixel's colour.
import { describe, expect, it, vi } from 'vitest'

import { type TestEditor, testEditor } from '@dazbee/editor/test-editor'
import { renderPixels } from '@dazbee/renderer'
import { loadCanvasKit } from '@dazbee/renderer/node'
import { framesOf, inOrder, parseDesign, type Point } from '@dazbee/schema'

import { loadFixtures } from './fixtures.ts'
import { fixtureResources, type Pixels } from './pixels.ts'

const ck = await loadCanvasKit()
const bytes = fixtureResources()
const POINTS = 64
const ZOOMS = [0.37, 4] as const
/** The stage's size, and how near its edges a point may be before the view is scrolled to it. */
const STAGE = { width: 1280, height: 760 }
const MARGIN = 80
/** A pixel with less alpha is too clear to pick. */
const ALPHA_CUT = 6

/** Seeded points in a frame, the same on every run. */
function seeded(name: string, width: number, height: number): [number, number][] {
  let state = [...name].reduce((hash, c) => (hash * 31 + c.charCodeAt(0)) >>> 0, 7)
  const next = () => {
    // mulberry32
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
  return Array.from({ length: POINTS }, () => [Math.floor(next() * width), Math.floor(next() * height)])
}

/** The cell of a frame's pixels at a point, as RGBA; clear off the frame. */
function cell({ width, height, pixels }: Pixels, x: number, y: number): number[] {
  if (x < 0 || y < 0 || x >= width || y >= height) return [0, 0, 0, 0]
  return [...pixels.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)]
}
const hexOf = ([r = 0, g = 0, b = 0]: number[]) =>
  `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`.toUpperCase()

/**
 * The stage point in the middle of a design pixel of a frame, the view scrolled with the wheel
 * first, as a trackpad does, when it is not well inside the stage.
 */
function reach(e: TestEditor, frameId: string, x: number, y: number): Point {
  const at = e.core.stagePoint(x + 0.5, y + 0.5, frameId)
  const inside = at.x >= MARGIN && at.y >= MARGIN && at.x <= STAGE.width - MARGIN && at.y <= STAGE.height - MARGIN
  if (inside) return at
  e.core.input.pointer({
    type: 'wheel',
    at: { x: STAGE.width / 2, y: STAGE.height / 2 },
    button: 0,
    detail: 0,
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    pointerType: 'mouse',
    deltaX: at.x - STAGE.width / 2,
    deltaY: at.y - STAGE.height / 2,
    deltaMode: 0,
  })
  e.core.redraw()
  return e.core.stagePoint(x + 0.5, y + 0.5, frameId)
}

describe('picking a colour', () => {
  it.each(loadFixtures().map(({ name, json }) => [name, json] as const))(
    'shows and picks the 1x export’s pixels on every frame of %s',
    async (name, json) => {
      const parsed = parseDesign(json)
      if (!parsed.success) throw new Error(parsed.errors.join('\n'))
      const design = parsed.design
      const e = await testEditor(design, {
        viewport: STAGE,
        sources: { assetBytes: (id) => Promise.resolve(bytes.images[id] ?? new Uint8Array()) },
      })
      try {
        for (const [pageId] of inOrder(design.pages)) {
          e.core.showPage(pageId)
          for (const [frameId, frame] of framesOf(design, pageId)) {
            const expected = renderPixels(ck, json, frameId, bytes)
            const points = seeded(`${name}/${frameId}`, frame.width, frame.height)
            for (const zoom of ZOOMS) {
              const picked = e.core.pickColour()
              e.core.zoomTo(zoom)
              let checked = 0
              for (const [x, y] of points) {
                const stage = reach(e, frameId, x, y)
                e.mouse.move(stage.x, stage.y)
                await vi.waitFor(() => expect(e.modules.colourPick.shown()?.state).not.toBe('drawing'), {
                  timeout: 20_000,
                })
                const shown = e.modules.colourPick.shown()
                const at = cell(expected, x, y)
                const opaque = (at[3] ?? 0) >= ALPHA_CUT
                expect(shown?.state, `${frameId} at ${x}, ${y}`).toBe(opaque ? 'colour' : 'clear')
                expect(shown?.hex ?? null).toBe(opaque ? hexOf(at) : null)
                const window = shown?.window
                expect(window).toMatchObject({ frameId, x, y })
                const side = window?.size ?? 0
                const half = (side - 1) / 2
                for (let row = 0; row < side; row++)
                  for (let column = 0; column < side; column++) {
                    const i = (row * side + column) * 4
                    const got = [...(window?.pixels.subarray(i, i + 4) ?? [])]
                    expect(got, `${frameId} at ${x}, ${y}, cell ${column}, ${row}`).toEqual(
                      cell(expected, x - half + column, y - half + row),
                    )
                  }
                checked += 1
              }
              expect(checked).toBe(POINTS)
              // A click on the first point a colour can be picked at picks it.
              const [x, y] = points.find(([px, py]) => (cell(expected, px, py)[3] ?? 0) >= ALPHA_CUT) ?? [0, 0]
              const stage = reach(e, frameId, x, y)
              e.mouse.click(stage.x, stage.y)
              expect(await picked, `${frameId} at ${x}, ${y}`).toBe(hexOf(cell(expected, x, y)))
            }
          }
        }
      } finally {
        e.end()
      }
    },
  )
})
