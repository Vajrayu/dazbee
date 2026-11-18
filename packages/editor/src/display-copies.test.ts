import { describe, expect, it } from 'vitest'

import type { Scene, SceneLayer } from '@dazbee/renderer'
import { loadCanvasKit } from '@dazbee/renderer/node'
import type { ImagePaint } from '@dazbee/schema'

import {
  boxSide,
  CopyLost,
  copyOf,
  copySide,
  displayCopies,
  drawnSide,
  heldBytes,
  imageUses,
  madeCopy,
  SETTLE_MS,
} from './display-copies.ts'
import { asked, halfPng, settle } from './test-display-copies.ts'

const ck = await loadCanvasKit()

const fill = (assetId: string, more: Partial<ImagePaint> = {}): ImagePaint =>
  ({ type: 'image', assetId, fit: 'fill', opacity: 1, visible: true, ...more }) as ImagePaint
const layer = (props: Record<string, unknown>, children: SceneLayer[] = []) =>
  ({ id: 'l', type: 'graphic', props, children }) as unknown as SceneLayer
const scene = (fills: ImagePaint[], layers: SceneLayer[]): Scene => ({
  frameId: 'f',
  width: 1000,
  height: 500,
  fills,
  layers,
})

const BIG = { width: 6000, height: 4000 }

describe('copySide', () => {
  it('picks the smallest step at least the drawn side, the own side past the last step, never past the most', () => {
    expect(copySide(BIG, 0)).toBe(1024)
    expect(copySide(BIG, 1024)).toBe(1024)
    expect(copySide(BIG, 1025)).toBe(2048)
    expect(copySide(BIG, 3000)).toBe(4096)
    expect(copySide(BIG, 4097)).toBe(6000)
    expect(copySide(BIG, 4097, 4096)).toBe(4096)
  })

  it('never makes a copy bigger than the image itself', () => {
    expect(copySide({ width: 800, height: 600 }, 3000)).toBe(800)
    expect(copySide({ width: 1500, height: 900 }, 1500)).toBe(1500)
  })
})

describe('drawnSide', () => {
  it('takes the largest long side the whole image is drawn at, times the device pixels a design pixel takes', () => {
    // Filling 300 × 100 with a 3:2 image draws it 300 × 200; fitting it, 150 × 100.
    const uses = [
      { fill: fill('a'), box: { width: 300, height: 100 } },
      { fill: fill('a', { fit: 'fit' }), box: { width: 300, height: 100 } },
    ]
    expect(drawnSide(BIG, uses, 2)).toBe(600)
  })

  it('counts the whole image of a crop, and a tile at its own size times its tile scale', () => {
    const crop = fill('a', { fit: 'crop', crop: { x: 0, y: 0, width: 600, height: 400 } })
    // A tenth of the image stretched over 100 × 67 draws the whole of it ten times as big.
    expect(drawnSide(BIG, [{ fill: crop, box: { width: 100, height: 400 / 6 } }], 1)).toBeCloseTo(1000)
    // A 6000 px image tiled at 50 %, at half a device pixel a design pixel: drawn 1500 device pixels long.
    expect(drawnSide(BIG, [{ fill: fill('a', { fit: 'tile', tileScale: 0.5 }), box: BIG }], 0.5)).toBe(1500)
  })

  it('is 0 for an image drawn nowhere', () => {
    expect(drawnSide(BIG, [], 2)).toBe(0)
  })
})

describe('imageUses', () => {
  it("finds a frame's own image fills and every layer's image paints, nested ones too, with the box each fills", () => {
    const uses = imageUses([
      scene(
        [fill('back')],
        [
          layer({ width: 200, height: 100, fills: [fill('photo')] }, [
            layer({ width: 40, height: 20, strokes: [{ paint: fill('photo') }] }),
          ]),
        ],
      ),
      scene([], [layer({ width: 10, height: 10, fills: [{ type: 'solid', color: '#000000FF' }] })]),
    ])
    expect([...uses.keys()].sort()).toEqual(['back', 'photo'])
    expect(uses.get('back')?.map((u) => u.box)).toEqual([{ width: 1000, height: 500 }])
    expect(uses.get('photo')?.map((u) => u.box)).toEqual([
      { width: 200, height: 100 },
      { width: 40, height: 20 },
    ])
  })

  it('works a scene out once while it is the same object', () => {
    const one = scene([fill('back')], [])
    expect(imageUses([one]).get('back')?.[0]).toBe(imageUses([one]).get('back')?.[0])
  })
})

describe('copyOf', () => {
  it('shrinks an image to a long side, keeping its shape and its see-through parts, and hands back a small one itself', () => {
    const image = ck.MakeImageFromEncoded(halfPng(2400, 1600))
    if (!image) throw new Error('no image')
    const copy = copyOf(ck, image, 1024)
    expect([copy.width(), copy.height()]).toEqual([1024, 683])
    const info = {
      width: 1,
      height: 1,
      colorType: ck.ColorType.RGBA_8888,
      alphaType: ck.AlphaType.Unpremul,
      colorSpace: ck.ColorSpace.SRGB,
    }
    expect([...(copy.readPixels(100, 300, info) ?? [])]).toEqual([10, 200, 90, 255])
    expect(copy.readPixels(900, 300, info)?.[3]).toBe(0)
    expect(copyOf(ck, image, 4096)).toBe(image)
    copy.delete()
    image.delete()
  })

  it("keeps an opaque image's copy opaque, as an export draws the image", () => {
    const image = ck.MakeImageFromEncoded(halfPng(2400, 1600, true))
    expect(image && copyOf(ck, image, 1024).getImageInfo().alphaType).toBe(ck.AlphaType.Opaque)
  })
})

describe('displayCopies', () => {
  /** Display copies of the images given, with a hand-run wait and a count of changes. */
  function copies(bytes: Record<string, Uint8Array>, maxSide?: number) {
    const waits: { ms: number; run: () => void; cancelled: boolean }[] = []
    let changes = 0
    const made = displayCopies({
      ck,
      encoded: (assetId) => bytes[assetId],
      changed: () => changes++,
      after: (ms, run) => {
        const wait = { ms, run, cancelled: false }
        waits.push(wait)
        return () => {
          wait.cancelled = true
        }
      },
      ...(maxSide ? { maxSide } : {}),
    })
    return { made, waits, changes: () => changes }
  }
  const sideOf = (made: ReturnType<typeof displayCopies>, assetId: string) => {
    const image = made.images().get(assetId)
    return image ? Math.max(image.width(), image.height()) : undefined
  }

  it('makes a copy at the smallest step of an image drawn nowhere yet, with its own size beside it', () => {
    const { made } = copies({ photo: halfPng(2400, 1600) })
    expect(made.make(['photo', 'coming'])).toBe(true)
    expect(sideOf(made, 'photo')).toBe(1024)
    expect(made.sizes().get('photo')).toEqual({ width: 2400, height: 1600 })
    expect(made.images().has('coming')).toBe(false)
    expect(made.make(['photo'])).toBe(false)
    made.destroy()
  })

  it('makes no copy of an image smaller than the smallest step, and gives no own size for it', () => {
    const { made } = copies({ small: halfPng(600, 400) })
    made.make(['small'])
    expect(sideOf(made, 'small')).toBe(600)
    expect(made.sizes().has('small')).toBe(false)
    made.destroy()
  })

  it('makes a first copy at the step the shown page draws it at', () => {
    const { made } = copies({ photo: halfPng(2400, 1600) })
    // Filling 750 × 500 at 2 device pixels a design pixel draws it 1500 px long.
    made.show(new Map([['photo', [{ fill: fill('photo'), box: { width: 750, height: 500 } }]]]), 2)
    made.make(['photo'])
    expect(sideOf(made, 'photo')).toBe(2048)
    made.destroy()
  })

  it('makes a bigger copy once a zoom past its side has settled, once, and tells of it', () => {
    const { made, waits, changes } = copies({ photo: halfPng(2400, 1600) })
    made.make(['photo'])
    const before = made.images()
    const uses = new Map([['photo', [{ fill: fill('photo'), box: { width: 750, height: 500 } }]]])
    made.show(uses, 1)
    expect(waits).toHaveLength(0)
    // 1125 px long wants the 2048 copy; 2250, the image itself.
    made.show(uses, 1.5)
    made.show(uses, 3)
    expect(waits.map((w) => [w.ms, w.cancelled])).toEqual([
      [SETTLE_MS, true],
      [SETTLE_MS, false],
    ])
    expect(sideOf(made, 'photo')).toBe(1024)
    waits[1]?.run()
    expect(sideOf(made, 'photo')).toBe(2400)
    expect(made.sizes().has('photo')).toBe(false)
    expect(made.images()).not.toBe(before)
    expect(changes()).toBe(1)
    made.show(uses, 3)
    expect(waits).toHaveLength(2)
    made.destroy()
  })

  it('keeps the wait through redraws that want the same sides, as when another tab edits', () => {
    const { made, waits } = copies({ photo: halfPng(2400, 1600) })
    made.make(['photo'])
    const uses = new Map([['photo', [{ fill: fill('photo'), box: { width: 750, height: 500 } }]]])
    made.show(uses, 1.5)
    made.show(uses, 2)
    made.show(new Map(uses), 2)
    expect(waits.map((w) => w.cancelled)).toEqual([false])
    made.destroy()
  })

  it('tells once of bytes that do not decode, and never tries them again', () => {
    const failed: string[] = []
    let asked = 0
    const made = displayCopies({
      ck,
      encoded: () => {
        asked++
        return new Uint8Array([1, 2, 3])
      },
      changed: () => {},
      failed: (assetId) => failed.push(assetId),
    })
    expect(made.make(['bad'])).toBe(false)
    expect(made.make(['bad'])).toBe(false)
    expect(failed).toEqual(['bad'])
    expect(asked).toBe(1)
    expect(made.images().has('bad')).toBe(false)
    made.destroy()
  })

  it('cancels the wait when the zoom comes back under the copy', () => {
    const { made, waits } = copies({ photo: halfPng(2400, 1600) })
    made.make(['photo'])
    const uses = new Map([['photo', [{ fill: fill('photo'), box: { width: 750, height: 500 } }]]])
    made.show(uses, 2)
    made.show(uses, 1)
    expect(waits[0]?.cancelled).toBe(true)
    made.destroy()
  })

  it('draws the image itself past the last step, never past the largest side', () => {
    const { made, waits } = copies({ photo: halfPng(2400, 1600) }, 2000)
    made.make(['photo'])
    made.show(new Map([['photo', [{ fill: fill('photo'), box: { width: 3000, height: 2000 } }]]]), 1)
    waits[0]?.run()
    expect(sideOf(made, 'photo')).toBe(2000)
    made.destroy()
  })

  it('makes bigger copies at once without a wait to run', () => {
    const png = halfPng(2400, 1600)
    const made = displayCopies({ ck, encoded: () => png, changed: () => {} })
    made.make(['photo'])
    made.show(new Map([['photo', [{ fill: fill('photo'), box: { width: 2400, height: 1600 } }]]]), 1)
    expect(sideOf(made, 'photo')).toBe(2400)
    expect(made.sizes().has('photo')).toBe(false)
    made.destroy()
  })
})

describe('madeCopy', () => {
  it("shrinks encoded bytes to a side as premultiplied pixels, with the image's own size", () => {
    const copy = madeCopy(ck, halfPng(2400, 1600), 1024)
    expect([copy?.width, copy?.height, copy?.pixels.length, copy?.own]).toEqual([
      1024,
      683,
      1024 * 683 * 4,
      { width: 2400, height: 1600 },
    ])
    expect([...(copy?.pixels.subarray(0, 4) ?? [])]).toEqual([10, 200, 90, 255])
    expect(copy?.pixels[(1000 + 300 * 1024) * 4 + 3]).toBe(0)
  })

  it("gives the image's own pixels when it is no bigger than the side, and null for bytes that don't decode", () => {
    const copy = madeCopy(ck, halfPng(600, 400), 1024)
    expect([copy?.width, copy?.height, copy?.own]).toEqual([600, 400, { width: 600, height: 400 }])
    expect(madeCopy(ck, new Uint8Array([1, 2, 3]), 1024)).toBeNull()
  })
})

describe('boxSide', () => {
  it('takes the long side of the largest box an image fills, in device pixels', () => {
    expect(
      boxSide(
        [
          { fill: fill('a'), box: { width: 300, height: 100 } },
          { fill: fill('a'), box: { width: 50, height: 400 } },
        ],
        2,
      ),
    ).toBe(800)
    expect(boxSide([], 2)).toBe(0)
  })
})

describe('displayCopies with a maker', () => {
  const uses = (width: number, height: number) =>
    new Map([['photo', [{ fill: fill('photo'), box: { width, height } }]]])

  it('asks once for a copy sized by the box it fills, draws nothing until it comes, then holds it and tells', async () => {
    const { made, jobs, changes } = asked({ photo: halfPng(2400, 1600) })
    made.show(uses(750, 500), 2)
    expect(made.make(['photo'])).toBe(false)
    made.make(['photo'])
    expect(jobs.map((j) => j.side)).toEqual([2048])
    expect(made.images().has('photo')).toBe(false)
    jobs[0]?.answer()
    await settle()
    expect(made.images().get('photo')?.width()).toBe(2048)
    expect(made.sizes().get('photo')).toEqual({ width: 2400, height: 1600 })
    expect(changes()).toBe(1)
    made.destroy()
  })

  it('keeps a copy opaque when its image decodes opaque, as the worker says', async () => {
    const { made, jobs } = asked({ photo: halfPng(2400, 1600, true) })
    made.make(['photo'])
    jobs[0]?.answer()
    await settle()
    expect(made.images().get('photo')?.getImageInfo().alphaType).toBe(ck.AlphaType.Opaque)
    made.destroy()
  })

  it('changes the images once for copies that came together', async () => {
    const { made, jobs } = asked({ photo: halfPng(2400, 1600), other: halfPng(1600, 1600) })
    made.make(['photo', 'other'])
    const before = made.images()
    for (const job of jobs) job.answer()
    await settle()
    const after = made.images()
    expect(after).not.toBe(before)
    expect([...after.keys()].sort()).toEqual(['other', 'photo'])
    expect(made.images()).toBe(after)
    made.destroy()
  })

  it('asks for a bigger copy once the zoom settles, keeping the smaller one drawn until it comes', async () => {
    const { made, jobs, waits } = asked({ photo: halfPng(2400, 1600) })
    made.make(['photo'])
    jobs[0]?.answer()
    await settle()
    made.show(uses(750, 500), 2)
    waits[0]?.()
    made.show(uses(750, 500), 2)
    expect(jobs.map((j) => j.side)).toEqual([1024, 2048])
    expect(made.images().get('photo')?.width()).toBe(1024)
    jobs[1]?.answer()
    await settle()
    expect(made.images().get('photo')?.width()).toBe(2048)
    made.destroy()
  })

  it('tells once of an image whose bytes do not decode, and never asks for it again', async () => {
    const { made, jobs, failed } = asked({ photo: new Uint8Array([1, 2, 3]) })
    made.make(['photo'])
    jobs[0]?.answer()
    await settle()
    made.make(['photo'])
    expect(jobs).toHaveLength(1)
    expect(failed).toEqual(['photo'])
    made.destroy()
  })

  it('asks again after the maker failed on an image, and takes it as failed only the second time', async () => {
    const { made, jobs, failed } = asked({ photo: halfPng(2400, 1600) })
    made.make(['photo'])
    await settle()
    jobs[0]?.answer(new Error('worker ended'))
    await settle()
    made.make(['photo'])
    await settle()
    expect(jobs).toHaveLength(2)
    expect(failed).toEqual([])
    jobs[1]?.answer(new Error('worker ended'))
    await settle()
    made.make(['photo'])
    await settle()
    expect(jobs).toHaveLength(2)
    expect(failed).toEqual(['photo'])
    made.destroy()
  })

  it('holds nothing against an image whose copy was lost to another failing', async () => {
    const { made, jobs, failed } = asked({ photo: halfPng(2400, 1600) })
    for (let i = 0; i < 3; i++) {
      made.make(['photo'])
      await settle()
      jobs[i]?.answer(new CopyLost('another image ended the worker'))
      await settle()
    }
    made.make(['photo'])
    await settle()
    jobs[3]?.answer()
    await settle()
    expect(failed).toEqual([])
    expect(made.images().get('photo')?.width()).toBe(1024)
    made.destroy()
  })

  it('keeps the copy it has, quietly, when a bigger one could not be made', async () => {
    const { made, jobs, failed, waits } = asked({ photo: halfPng(2400, 1600) })
    made.make(['photo'])
    await settle()
    jobs[0]?.answer()
    await settle()
    made.show(uses(750, 500), 2)
    waits[0]?.()
    await settle()
    jobs[1]?.answer(new Error('too big'))
    await settle()
    made.show(uses(750, 500), 2)
    waits[1]?.()
    await settle()
    jobs[2]?.answer(new Error('too big'))
    await settle()
    made.show(uses(750, 500), 2)
    expect(waits).toHaveLength(2)
    expect(failed).toEqual([])
    expect(made.images().get('photo')?.width()).toBe(1024)
    made.destroy()
  })

  it('takes a maker that throws at once as failed, not stuck asking', async () => {
    let calls = 0
    const made = displayCopies({
      ck,
      encoded: () => new Uint8Array([1]),
      changed: () => {},
      maker: () => {
        calls++
        throw new Error('no workers here')
      },
    })
    made.make(['photo'])
    await settle()
    made.make(['photo'])
    await settle()
    made.make(['photo'])
    await settle()
    expect(calls).toBe(2)
    made.destroy()
  })

  it('drops a copy that comes after it was destroyed', async () => {
    const { made, jobs, changes } = asked({ photo: halfPng(2400, 1600) })
    made.make(['photo'])
    made.destroy()
    jobs[0]?.answer()
    await settle()
    expect(changes()).toBe(0)
    expect(made.images().size).toBe(0)
  })
})

describe('the memory budget', () => {
  const png = halfPng(1200, 800)
  /** Display copies that may hold `budget` bytes, made at once. */
  const budgeted = (budget: number) => displayCopies({ ck, encoded: () => png, changed: () => {}, budget })
  const drawing = (...assetIds: string[]) =>
    new Map(assetIds.map((assetId) => [assetId, [{ fill: fill(assetId), box: { width: 300, height: 200 } }]]))
  const one = heldBytes({ width: () => 1024, height: () => 683 } as never)

  it('counts a copy as its pixels and its mipmapped texture', () => {
    expect(one).toBeCloseTo((1024 * 683 * 4 * 7) / 3)
  })

  it('lets go of the copies drawn longest ago once past the budget, and makes one again only when it is drawn', () => {
    const made = budgeted(2.5 * one)
    for (const assetId of ['a', 'b', 'c']) {
      made.show(drawing(assetId), 1)
      made.make([assetId])
    }
    expect([...made.images().keys()].sort()).toEqual(['b', 'c'])
    made.make(['a'])
    expect(made.images().has('a')).toBe(false)
    made.show(drawing('a'), 1)
    made.make(['a'])
    expect([...made.images().keys()].sort()).toEqual(['a', 'c'])
    made.destroy()
  })

  it('never lets go of a copy the shown page draws, holding them past the budget when it needs more', () => {
    const made = budgeted(one)
    made.show(drawing('a', 'b', 'c'), 1)
    made.make(['a', 'b', 'c'])
    expect(made.images().size).toBe(3)
    made.show(drawing('c'), 1)
    expect([...made.images().keys()]).toEqual(['c'])
    made.destroy()
  })

  it("lets go of an earlier page's copies before one made for a page's thumbnail", () => {
    const made = budgeted(2.5 * one)
    made.show(drawing('a', 'b'), 1)
    made.make(['a', 'b'])
    made.show(drawing('c'), 1)
    made.make(['c'])
    made.make(['t'])
    expect([...made.images().keys()].sort()).toEqual(['c', 't'])
    made.destroy()
  })

  it("makes a copy let go again for a page's thumbnail, at the smallest step, only while it fits the budget", () => {
    const made = budgeted(3 * one)
    made.show(drawing('a', 'b'), 4)
    made.make(['a', 'b'])
    made.show(drawing('c', 'd'), 1)
    made.make(['c', 'd'])
    expect([...made.images().keys()].sort()).toEqual(['c', 'd'])
    made.make(['a', 'b'])
    expect([...made.images().keys()].sort()).toEqual(['a', 'c', 'd'])
    expect(made.images().get('a')?.width()).toBe(1024)
    made.destroy()
  })
})
