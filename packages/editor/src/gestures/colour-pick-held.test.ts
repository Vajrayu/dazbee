// The frames picking a colour holds: read from the design as it is, never a frame gone
// or grown past the export's limits, even while its images load; drawn again when the fonts,
// images or brand kit's values they were drawn with change; the frame under the pointer kept over
// a late draw; and the frame waiting to be drawn let go of when picking ends. A drag held when
// picking starts is dropped, and the release of a press made before it is the pointer's.
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { DesignInput } from '@dazbee/schema'

import { type TestEditor, testEditor, type TestEditorOptions } from '../test-editor.ts'
import type { FrameSampler } from './colour-pick.ts'
import { DESIGN, flat, heldSampler, middle, photoBytes, solid, twoPages } from './test-colour-pick.ts'

let editor: TestEditor | undefined
afterEach(() => {
  editor?.end()
  editor = undefined
})

async function open(design: DesignInput = DESIGN, options: TestEditorOptions = {}) {
  editor = await testEditor(design, options)
  return editor
}
/** Lets the asks the core made reach the sampler. */
const turn = () => new Promise((resolve) => setTimeout(resolve, 0))
/** Waits until what picking shows is in a state. */
async function shows(e: TestEditor, state: string) {
  await vi.waitFor(() => expect(e.modules.colourPick.shown()?.state).toBe(state))
}
/** Moves the pointer over a design pixel of a frame. */
function hover(e: TestEditor, frameId: string, x = 10, y = 10) {
  const at = middle(e, frameId, x, y)
  e.mouse.move(at.x, at.y)
}
/**
 * `twoPages` opened with its photo layer grey, then filled by the photo, whose bytes come when the
 * test lets them: the editor opens with every image the design has.
 */
async function openLate(sampler: FrameSampler) {
  const png = photoBytes(300, 200, 25, 1)
  let arrive = () => {}
  const bytes = new Promise<Uint8Array>((resolve) => {
    arrive = () => resolve(png)
  })
  const design = twoPages()
  const photo = design.nodes.photo
  if (photo?.type !== 'graphic') throw new Error('no photo layer')
  const fills = photo.props.fills
  const e = await open(
    { ...design, nodes: { photo: { ...photo, props: { ...photo.props, fills: solid('#808080FF') } } } },
    { sampler, sources: { assetBytes: () => bytes } },
  )
  e.core.session.run('node.update', { ids: ['photo'], patch: { fills } })
  return { e, arrive: () => arrive() }
}

describe('colour picking’s frames', () => {
  it('keeps picking when the frame under the pointer is deleted, which it no longer draws', async () => {
    const e = await open()
    e.core.zoomTo(1)
    void e.core.pickColour()
    hover(e, 'other')
    await shows(e, 'colour')
    e.core.pickFrame('other')
    expect(e.core.perform('delete')).toBe(true)
    await turn()
    await turn()
    e.core.redraw()
    expect(e.core.picking()).toBe(true)
    expect(e.told).toEqual([])
    expect(e.modules.colourPick.shown()?.state).toBe('outside')
  })

  it('asks for no draw of a frame another change made too big to draw', async () => {
    const { sampler, asks } = heldSampler()
    const e = await open(DESIGN, { sampler })
    e.core.zoomTo(1)
    void e.core.pickColour()
    hover(e, 'other')
    await turn()
    asks[0]?.draw()
    await shows(e, 'colour')
    // 8000 × 7000: within a frame's sides, but 56 million pixels, past the export's 50.
    e.core.session.run('frame.update', { frameId: 'other', width: 8000, height: 7000 })
    await turn()
    expect(asks).toHaveLength(1)
    e.core.redraw()
    expect(e.modules.colourPick.shown()?.state).toBe('tooBig')
    expect(e.core.picking()).toBe(true)
  })

  it('draws a frame again when the brand kit’s values change, and a click then picks from that draw', async () => {
    const { sampler, asks } = heldSampler()
    const e = await open(DESIGN, { sampler })
    e.core.zoomTo(1)
    const picked = e.core.pickColour()
    hover(e, 'sq', 60, 50)
    await turn()
    asks[0]?.draw()
    await shows(e, 'colour')
    void e.core.setVariables({})
    await turn()
    // Asked again without a move; the old pixels show meanwhile.
    expect(asks).toHaveLength(2)
    expect(e.modules.colourPick.shown()?.hex).toBe('#E0301E')
    const at = middle(e, 'sq', 60, 50)
    e.mouse.click(at.x, at.y)
    await turn()
    expect(e.core.picking()).toBe(true)
    asks[1]?.draw()
    expect(await picked).toBe('#E0301E')
  })

  it('draws a frame again when an image arrives while picking, and a click then picks from that draw', async () => {
    const { sampler, asks } = heldSampler()
    const { e, arrive } = await openLate(sampler)
    e.core.zoomTo(1)
    const picked = e.core.pickColour()
    hover(e, 'w', 40, 30)
    await turn()
    asks[0]?.draw()
    await shows(e, 'colour')
    // The photo of the other page arrives: the bytes the white frame was drawn with are not the editor's now.
    e.modules.resources.load(e.core.design(), ['g'])
    arrive()
    await vi.waitFor(() => expect(asks).toHaveLength(2))
    const at = middle(e, 'w', 40, 30)
    e.mouse.click(at.x, at.y)
    await turn()
    expect(e.core.picking()).toBe(true)
    asks[1]?.draw()
    expect(await picked).toBe('#FFFFFF')
  })

  it.each(['deleted', 'grown too big'])(
    'draws no frame %s while its images load, and keeps picking with nothing told',
    async (change) => {
      const { sampler, asks } = heldSampler()
      const { e, arrive } = await openLate(sampler)
      e.core.showPage('q')
      e.core.zoomTo(1)
      e.core.redraw()
      void e.core.pickColour()
      hover(e, 'g')
      await turn()
      if (change === 'deleted') {
        e.core.pickFrame('g')
        expect(e.core.perform('delete')).toBe(true)
      } else {
        // 8000 × 7000: within a frame's sides, but 56 million pixels, past the export's 50.
        e.core.session.run('frame.update', { frameId: 'g', width: 8000, height: 7000 })
      }
      arrive()
      await vi.waitFor(() => expect(e.modules.resources.bytes().images.photo).toBeDefined())
      await turn()
      await turn()
      expect(asks).toHaveLength(0)
      expect(e.told).toEqual([])
      expect(e.core.picking()).toBe(true)
    },
  )

  it('leaves the release of a press made before picking to the pointer: once picking ends, Alt measures again', async () => {
    const e = await open()
    e.core.zoomTo(1)
    e.core.select(['red'])
    const on = middle(e, 'sq', 60, 50)
    e.mouse.move(on.x, on.y)
    e.mouse.down()
    void e.core.pickColour()
    e.mouse.up()
    expect(e.core.picking()).toBe(true)
    e.core.stopPicking()
    e.keys.down('Alt')
    hover(e, 'sq', 300, 250)
    expect(e.modules.pointer.measured()).not.toBeNull()
    e.keys.up('Alt')
  })

  it('keeps the frame under the pointer when a late draw of another would not fit beside it', async () => {
    const { sampler, asks } = heldSampler()
    const frame = (x: number, order: string) => ({
      pageId: 'p',
      name: 'Big',
      width: 3000,
      height: 2000,
      x,
      y: 0,
      order,
    })
    const e = await open(
      { ...DESIGN, frames: { a: frame(0, 'a0'), b: frame(3500, 'a1') }, nodes: {} },
      { sampler, viewport: { width: 1280, height: 760 } },
    )
    e.core.zoomTo(0.1)
    void e.core.pickColour()
    hover(e, 'a')
    await turn()
    asks[0]?.give(flat(3000, 2000))
    await shows(e, 'colour')
    hover(e, 'b')
    await turn()
    hover(e, 'a')
    await turn()
    expect(asks).toHaveLength(2)
    // 24 MB and 24 MB don't fit together: the late draw of b is let go, not a.
    asks[1]?.give(flat(3000, 2000))
    await turn()
    expect(e.modules.colourPick.shown()?.state).toBe('colour')
    expect(asks).toHaveLength(2)
  })

  it('lets go of the frame waiting to be drawn when picking ends', async () => {
    const { sampler, counted } = heldSampler()
    const e = await open(DESIGN, { sampler })
    void e.core.pickColour()
    hover(e, 'sq')
    await turn()
    e.core.stopPicking()
    expect(counted.cancels).toBe(1)
  })

  it('drops a drag held when picking starts, as Escape does: its release and later moves move nothing', async () => {
    const e = await open()
    e.core.zoomTo(1)
    const red = e.core.boxOf('red')
    const from = middle(e, 'sq', 60, 50)
    e.mouse.move(from.x, from.y)
    e.mouse.down()
    e.mouse.move(from.x + 40, from.y + 30, { steps: 4 })
    expect(e.core.boxOf('red')).not.toEqual(red)
    void e.core.pickColour()
    expect(e.core.boxOf('red')).toEqual(red)
    expect(e.core.gesturing()).toBe(false)
    e.mouse.up()
    expect(e.core.picking()).toBe(true)
    e.core.stopPicking()
    e.mouse.move(from.x + 80, from.y + 60, { steps: 4 })
    expect(e.core.boxOf('red')).toEqual(red)
    expect(e.core.canUndo()).toBe(false)
  })
})
