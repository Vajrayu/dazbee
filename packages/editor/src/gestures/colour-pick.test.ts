// Picking a colour: a click while picking picks the 1x export's pixel under it,
// whatever the zoom or the copy the screen draws, writing nothing; what picks nothing, and what
// ends picking; touch; a click on pixels of a design that changed; the time limit, a sampler that
// fails, the memory held and a Reviewer's tab.
import { afterEach, describe, expect, it, vi } from 'vitest'

import { FALLBACK_FAMILIES } from '@dazbee/fonts'
import { loadFontFiles } from '@dazbee/fonts/node'
import { renderPixels } from '@dazbee/renderer'
import { loadCanvasKit } from '@dazbee/renderer/node'
import type { DesignInput } from '@dazbee/schema'

import type { TabAccess } from '../core-interface.ts'
import { type TestEditor, testEditor, type TestEditorOptions } from '../test-editor.ts'
import { ALPHA_CUT, type FrameSampler, PICK_WAIT_MS, windowSide } from './colour-pick.ts'
import {
  DESIGN,
  edgeOf,
  escape,
  exported,
  finger,
  heldSampler,
  middle,
  onePhoto,
  photoBytes,
  solid,
  twoPages,
  wheel,
} from './test-colour-pick.ts'

const ck = await loadCanvasKit()

let editor: TestEditor | undefined
afterEach(() => {
  editor?.end()
  editor = undefined
  vi.useRealTimers()
})

async function open(design: DesignInput = DESIGN, options: TestEditorOptions = {}) {
  editor = await testEditor(design, options)
  return editor
}

/** Waits until what picking shows is in a state. */
async function shows(e: TestEditor, state: string) {
  await vi.waitFor(() => expect(e.modules.colourPick.shown()?.state).toBe(state))
}

/** Lets the asks the core made reach the sampler. */
const turn = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('pickColour', () => {
  it('picks the 1x export’s pixel under a click, flat or on an edge, at any zoom, and ends picking with no step', async () => {
    const e = await open()
    const told: boolean[] = []
    e.core.onPicking((on) => told.push(on))
    const edge = edgeOf(e.core.exportPixels('sq'), 400, 300)
    for (const [zoom, x, y] of [
      [1, 60, 50],
      [0.37, 60, 50],
      [4, ...edge],
      [0.37, ...edge],
    ] as const) {
      e.core.zoomTo(zoom)
      const at = middle(e, 'sq', x, y)
      const picked = e.core.pickColour()
      expect(e.core.picking()).toBe(true)
      e.mouse.click(at.x, at.y)
      expect(await picked).toBe(exported(e, 'sq', x, y).hex)
      expect(e.core.picking()).toBe(false)
    }
    // The edge's pixel is neither the blue nor the white either side of it.
    expect(['#FFFFFF', '#1E50E0']).not.toContain(exported(e, 'sq', ...edge).hex)
    expect(told).toEqual([true, false, true, false, true, false, true, false])
    expect(e.core.canUndo()).toBe(false)
    expect(e.core.selection()).toEqual([])
  })

  it('shows the colour and the window of pixels around the hot spot, and the old pixels while the frame draws again', async () => {
    const { sampler, asks } = heldSampler()
    const e = await open(DESIGN, { sampler })
    e.core.zoomTo(1)
    void e.core.pickColour()
    const at = middle(e, 'sq', 20, 20)
    e.mouse.move(at.x, at.y)
    await turn()
    expect(e.modules.colourPick.shown()).toMatchObject({ state: 'drawing', hex: null, window: null })
    asks[0]?.draw()
    await shows(e, 'colour')
    const shown = e.modules.colourPick.shown()
    expect(shown?.hex).toBe('#E0301E')
    expect(shown?.at).toEqual(at)
    const side = windowSide(1)
    expect(side).toBe(11)
    expect(shown?.window).toMatchObject({ frameId: 'sq', x: 20, y: 20, width: 400, height: 300, size: side })
    const pixels = e.core.exportPixels('sq')
    // Each cell is the export's pixel: the red's corner at the middle, white above and left of it.
    for (const [row, column] of [
      [5, 5],
      [0, 0],
      [10, 10],
      [5, 0],
    ] as const) {
      const from = ((15 + row) * 400 + 15 + column) * 4
      expect([
        ...(shown?.window?.pixels.subarray((row * side + column) * 4, (row * side + column) * 4 + 4) ?? []),
      ]).toEqual([...pixels.subarray(from, from + 4)])
    }
    // The design changes: the frame is asked for again, and its old pixels show meanwhile.
    expect(e.core.setProps(['red'], () => ({ fills: solid('#00AA00FF') }))).toBe(true)
    await turn()
    expect(asks).toHaveLength(2)
    expect(e.modules.colourPick.shown()?.hex).toBe('#E0301E')
    asks[1]?.draw()
    await vi.waitFor(() => expect(e.modules.colourPick.shown()?.hex).toBe('#00AA00'))
    // At 2000% a cell is 20 pixels wide: five fit the loupe.
    expect(windowSide(20)).toBe(5)
    expect(windowSide(64)).toBe(3)
    expect(windowSide(0.37)).toBe(11)
  })

  it('picks nothing off every frame, on a pixel too clear, or on a frame too big to draw, and picking stays on', async () => {
    const { sampler, asks } = heldSampler()
    const e = await open(DESIGN, { sampler })
    e.core.zoomTo(0.5)
    const picked = e.core.pickColour()
    let outcome: string | null | undefined
    void picked.then((hex) => (outcome = hex))
    // Between the frames.
    const between = middle(e, 'sq', 450, 50)
    e.mouse.click(between.x, between.y)
    expect(e.modules.colourPick.shown()?.state).toBe('outside')
    // The clear frame, on its faint square and off it.
    for (const [x, y] of [
      [100, 100],
      [10, 10],
    ] as const) {
      const at = middle(e, 'clear', x, y)
      e.mouse.click(at.x, at.y)
      await turn()
      asks.at(-1)?.draw()
      await shows(e, 'clear')
      expect(exported(e, 'clear', x, y).alpha).toBeLessThan(ALPHA_CUT)
    }
    expect(exported(e, 'clear', 100, 100).alpha).toBeGreaterThan(0)
    // The frame past the export's limits is never drawn.
    const wide = middle(e, 'wide', 100, 50)
    e.mouse.click(wide.x, wide.y)
    await turn()
    expect(e.modules.colourPick.shown()?.state).toBe('tooBig')
    expect(asks.map((ask) => ask.frameId)).toEqual(['clear'])
    expect(e.told).toEqual([['pickTooBig']])
    expect(e.core.picking()).toBe(true)
    expect(outcome).toBeUndefined()
    const sq = middle(e, 'sq', 60, 50)
    e.mouse.click(sq.x, sq.y)
    await turn()
    asks.at(-1)?.draw()
    expect(await picked).toBe('#E0301E')
  })

  it('ends with none on Esc, stopPicking, or a second start, leaving the open pop-up’s keys alone and no step', async () => {
    const e = await open()
    const first = e.core.pickColour()
    expect(e.keys.down('Escape')).toEqual({ handled: true })
    e.keys.up('Escape')
    expect(await first).toBeNull()
    expect(e.core.picking()).toBe(false)
    // Esc with nothing picking is the stage's as before: it is not taken here.
    expect(e.core.input.cancelOnEscape({ ...escape(), type: 'keydown' })).toBe(false)

    const second = e.core.pickColour()
    e.core.stopPicking()
    expect(await second).toBeNull()

    const third = e.core.pickColour()
    const fourth = e.core.pickColour()
    expect(await third).toBeNull()
    expect(e.core.picking()).toBe(true)
    const at = middle(e, 'other', 10, 10)
    e.mouse.click(at.x, at.y)
    expect(await fourth).toBe('#FFCC00')
    expect(e.core.canUndo()).toBe(false)
  })

  it('takes a press while picking: nothing is selected or dragged; the wheel and Space still move the view', async () => {
    const e = await open()
    e.core.zoomTo(1)
    e.core.select(['red'])
    const picked = e.core.pickColour()
    const camera = e.core.camera()
    e.core.input.pointer({ ...wheel(), deltaY: 40 })
    expect(e.core.camera().y).toBe(camera.y - 40)
    // A drag with Space held pans, and picks nothing.
    e.keys.down('Space')
    const from = middle(e, 'sq', 300, 250)
    e.mouse.drag(from, { x: from.x + 30, y: from.y + 20 })
    e.keys.up('Space')
    expect(e.core.camera()).toMatchObject({ x: camera.x + 30, y: camera.y - 40 + 20 })
    expect(e.core.picking()).toBe(true)
    // A drag from the red rectangle moves nothing and selects nothing else; its release picks.
    const red = e.core.boxOf('red')
    e.mouse.drag(middle(e, 'sq', 60, 50), middle(e, 'sq', 300, 250))
    expect(await picked).toBe('#FFFFFF')
    expect(e.core.boxOf('red')).toEqual(red)
    expect(e.core.selection()).toEqual(['red'])
    expect(e.core.canUndo()).toBe(false)
    // The click that ends that press, which comes after the pick, selects nothing either.
    expect(e.core.gesturing()).toBe(false)
  })

  it('picks where a finger lifts, after a tap or a drag, but not after a second finger or a cancelled touch', async () => {
    const e = await open()
    e.core.zoomTo(1)
    const tapped = e.core.pickColour()
    const red = middle(e, 'sq', 60, 50)
    finger(e, 'pointerdown', red)
    finger(e, 'pointerup', red)
    finger(e, 'click', red)
    expect(await tapped).toBe('#E0301E')

    const dragged = e.core.pickColour()
    let outcome: string | null | undefined
    void dragged.then((hex) => (outcome = hex))
    // A second finger down: the press picks nothing as either lifts.
    finger(e, 'pointerdown', red)
    finger(e, 'pointerdown', middle(e, 'sq', 300, 250))
    finger(e, 'pointerup', red)
    finger(e, 'pointerup', red)
    // A cancelled touch picks nothing.
    finger(e, 'pointerdown', red)
    finger(e, 'pointercancel', red)
    await turn()
    await turn()
    expect(outcome).toBeUndefined()
    expect(e.core.picking()).toBe(true)
    // A drag from the red to the white, lifted there.
    finger(e, 'pointerdown', red)
    finger(e, 'pointermove', middle(e, 'sq', 150, 50))
    expect(e.modules.colourPick.shown()).toMatchObject({ pointerType: 'touch' })
    const white = middle(e, 'sq', 160, 20)
    finger(e, 'pointermove', white)
    finger(e, 'pointerup', white)
    expect(await dragged).toBe('#FFFFFF')
    expect(e.core.selection()).toEqual([])
  })

  it('picks from the first draw after a click on pixels of a design that changed since they were drawn', async () => {
    const { sampler, asks } = heldSampler()
    const e = await open(DESIGN, { sampler })
    e.core.zoomTo(1)
    const picked = e.core.pickColour()
    const at = middle(e, 'sq', 60, 50)
    e.mouse.move(at.x, at.y)
    await turn()
    asks[0]?.draw()
    await shows(e, 'colour')
    // Another change arrives before the click: the pixels held are of the design as it was.
    e.core.setProps(['red'], () => ({ fills: solid('#00AA00FF') }))
    e.mouse.click(at.x, at.y)
    await turn()
    expect(e.core.picking()).toBe(true)
    expect(asks).toHaveLength(2)
    // Moving to another frame meanwhile asks for nothing: the click waits on its frame.
    const other = middle(e, 'other', 10, 10)
    e.mouse.move(other.x, other.y)
    await turn()
    expect(asks).toHaveLength(2)
    asks[1]?.draw()
    expect(await picked).toBe('#00AA00')
  })

  it('picks nothing once a click has waited PICK_WAIT_MS for its frame, and tells the page', async () => {
    const { sampler } = heldSampler()
    const e = await open(DESIGN, { sampler })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const picked = e.core.pickColour()
    const at = middle(e, 'sq', 60, 50)
    e.mouse.click(at.x, at.y)
    await vi.advanceTimersByTimeAsync(PICK_WAIT_MS - 1)
    expect(e.core.picking()).toBe(true)
    await vi.advanceTimersByTimeAsync(1)
    expect(await picked).toBeNull()
    expect(e.told).toEqual([['pickFailed']])
  })

  it('ends with none when what draws the frames fails, and tells the page', async () => {
    const { sampler, asks } = heldSampler()
    const e = await open(DESIGN, { sampler })
    const picked = e.core.pickColour()
    const at = middle(e, 'sq', 60, 50)
    e.mouse.move(at.x, at.y)
    await turn()
    asks[0]?.fail()
    expect(await picked).toBeNull()
    expect(e.told).toEqual([['pickFailed']])
    expect(e.core.picking()).toBe(false)
  })

  it('holds a second frame’s pixels only while both fit 32 MB, and frees them all when picking ends', async () => {
    const asked: string[] = []
    /** Frames as big as they are, their pixels all one colour. */
    const sampler: FrameSampler = {
      sample: (design, frameId) => {
        asked.push(frameId)
        const { width, height } = design.frames[frameId] ?? { width: 0, height: 0 }
        return Promise.resolve({ width, height, pixels: new Uint8Array(width * height * 4).fill(255) })
      },
      cancel: () => {},
    }
    const big = { pageId: 'p', name: 'Big', width: 3000, height: 3000, x: 1100, y: 0, order: 'a4' }
    const e = await open({ ...DESIGN, frames: { ...DESIGN.frames, big } }, { sampler })
    e.core.zoomTo(0.05)
    void e.core.pickColour()
    const visit = async (frameId: string) => {
      const at = middle(e, frameId, 10, 10)
      e.mouse.move(at.x, at.y)
      await shows(e, 'colour')
    }
    await visit('sq')
    await visit('other')
    // Both fit: going back to the first draws nothing.
    await visit('sq')
    expect(asked).toEqual(['sq', 'other'])
    // 36 MB alone: it is held alone, and each frame after it alone with it only while both fit.
    await visit('big')
    await visit('sq')
    expect(asked).toEqual(['sq', 'other', 'big', 'sq'])
    await visit('other')
    await visit('sq')
    expect(asked).toEqual(['sq', 'other', 'big', 'sq', 'other'])
    // Picking ended frees them: the next picking draws again.
    e.core.stopPicking()
    void e.core.pickColour()
    await visit('sq')
    expect(asked).toEqual(['sq', 'other', 'big', 'sq', 'other', 'sq'])
  })

  it('draws the frame of the selection when picking starts off the stage', async () => {
    const asked: string[] = []
    const sampler: FrameSampler = {
      sample: (design, frameId, bytes) => {
        asked.push(frameId)
        return Promise.resolve(renderPixels(ck, design, frameId, bytes))
      },
      cancel: () => {},
    }
    const e = await open(DESIGN, { sampler })
    e.core.select(['faint'])
    void e.core.pickColour()
    await turn()
    expect(asked).toEqual(['clear'])
    e.core.stopPicking()
    e.core.select([])
    e.core.pickFrame('other')
    void e.core.pickColour()
    await turn()
    expect(asked).toEqual(['clear', 'other'])
  })

  it('picks from a frame of a page shown later, its images loaded first', async () => {
    const png = photoBytes(300, 200, 25, 1)
    const e = await open(twoPages(), { sources: { assetBytes: () => Promise.resolve(png) } })
    e.core.showPage('q')
    e.core.zoomTo(1)
    const picked = e.core.pickColour()
    const at = middle(e, 'g', 40, 30)
    e.mouse.click(at.x, at.y)
    const hex = await picked
    expect(hex).toBe(exported(e, 'g', 40, 30).hex)
    expect(hex).not.toBe('#000000')
  })

  // Each pick draws the frame once, decoding the 24-million-pixel photo: seconds while every file runs at once.
  it('picks the original’s export pixel over a 6000 × 4000 photo the screen draws from a 1024 copy', async () => {
    const jpeg = photoBytes(6000, 4000, 50, 2)
    const design = onePhoto(1080, 720)
    const e = await open(design, {
      viewport: { width: 800, height: 600 },
      sources: { assetBytes: () => Promise.resolve(jpeg) },
    })
    expect(e.modules.resources.resources().images.get('photo')?.width()).toBe(1024)
    const fonts = loadFontFiles().map(({ family, bytes }) => ({ family, bytes }))
    const original = renderPixels(ck, design, 'f', {
      fonts,
      fallbackFamilies: [...FALLBACK_FAMILIES],
      images: { photo: jpeg },
    })
    for (const [x, y] of [
      [4, 4],
      [9, 9],
      [500, 333],
      [811, 207],
    ] as const) {
      const picked = e.core.pickColour()
      const at = middle(e, 'f', x, y)
      e.mouse.click(at.x, at.y)
      const i = (y * 1080 + x) * 4
      const hex = [0, 1, 2].map((c) => (original.pixels[i + c] ?? 0).toString(16).padStart(2, '0')).join('')
      expect(await picked).toBe(`#${hex.toUpperCase()}`)
    }
  }, 30_000)

  it('refuses a Reviewer’s start, saying View only', async () => {
    const access: TabAccess = { readOnly: () => true, onChange: () => () => {} }
    const e = await open(DESIGN, { access })
    expect(await e.core.pickColour()).toBeNull()
    expect(e.core.picking()).toBe(false)
    expect(e.told).toEqual([['viewOnly']])
  })
})
