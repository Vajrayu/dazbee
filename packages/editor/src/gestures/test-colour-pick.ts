// The fixtures of the colour picking tests: a page of frames to pick from, photos, a sampler the
// test answers, and the inputs a finger and the wheel send.
import { renderPixels } from '@dazbee/renderer'
import { loadCanvasKit } from '@dazbee/renderer/node'
import type { DesignInput, Point } from '@dazbee/schema'

import type { TestEditor } from '../test-editor.ts'
import { ALPHA_CUT, type FrameSampler, type SampledFrame } from './colour-pick.ts'
import type { PointerInput } from './inputs.ts'

const ck = await loadCanvasKit()

export const solid = (color: string) => [{ type: 'solid' as const, color }]
const rect = (
  parentId: string,
  index: string,
  box: { x: number; y: number; width: number; height: number; rotation?: number },
  color: string,
) => ({
  type: 'graphic' as const,
  parentId,
  link: `${parentId}-${index}`,
  index,
  name: 'Rect',
  props: { ...box, shape: { kind: 'rect' as const }, fills: solid(color) },
})

/**
 * A page of four frames: a white square with a red rectangle and a turned blue one, whose edges
 * are anti-aliased; a clear frame with a green square too faint to pick; a second square; and a
 * frame past the export's limits.
 */
export const DESIGN: DesignInput = {
  meta: { designId: 'd', name: 'D' },
  pages: { p: { name: 'P', order: 'a0' } },
  frames: {
    sq: { pageId: 'p', name: 'Square', width: 400, height: 300, x: 0, y: 0, order: 'a0', fills: solid('#FFFFFFFF') },
    clear: { pageId: 'p', name: 'Clear', width: 200, height: 200, x: 500, y: 0, order: 'a1' },
    other: {
      pageId: 'p',
      name: 'Other',
      width: 200,
      height: 200,
      x: 800,
      y: 0,
      order: 'a2',
      fills: solid('#FFCC00FF'),
    },
    wide: { pageId: 'p', name: 'Wide', width: 17_000, height: 100, x: 0, y: 400, order: 'a3' },
  },
  nodes: {
    red: { ...rect('sq', 'a0', { x: 20, y: 20, width: 100, height: 80 }, '#E0301EFF'), name: 'Red' },
    blue: { ...rect('sq', 'a1', { x: 200.3, y: 60.7, width: 120, height: 90, rotation: 17 }, '#1E50E0FF') },
    faint: rect(
      'clear',
      'a0',
      { x: 50, y: 50, width: 100, height: 100 },
      `#00FF00${(ALPHA_CUT - 2).toString(16).padStart(2, '0')}`,
    ),
  },
}

/** The stage point in the middle of a design pixel of a frame. */
export const middle = (e: TestEditor, frameId: string, x: number, y: number) =>
  e.core.stagePoint(x + 0.5, y + 0.5, frameId)

/** The pixel of a frame's 1x export, as `#RRGGBB`, and its alpha. */
export function exported(e: TestEditor, frameId: string, x: number, y: number) {
  const pixels = e.core.exportPixels(frameId)
  const { width } = e.core.design().frames[frameId] ?? { width: 0 }
  const i = (y * width + x) * 4
  const hex = [0, 1, 2].map((c) => (pixels[i + c] ?? 0).toString(16).padStart(2, '0')).join('')
  return { hex: `#${hex.toUpperCase()}`, alpha: pixels[i + 3] ?? 0 }
}

/** One pointer input of a finger, then a redraw pass, as a browser's next frame runs. */
export function finger(e: TestEditor, type: PointerInput['type'], at: Point) {
  e.core.input.pointer({
    type,
    at,
    button: 0,
    detail: type === 'click' ? 1 : 0,
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    pointerType: 'touch',
  })
  e.core.redraw()
}

/**
 * A sampler the test answers: each ask waits until the test draws it, gives it pixels, fails it or
 * leaves it; `cancels` counts the frames let go of when picking ended.
 */
export function heldSampler() {
  const asks: {
    frameId: string
    draw: () => void
    give: (sample: SampledFrame) => void
    fail: () => void
  }[] = []
  const counted = { cancels: 0 }
  const sampler: FrameSampler = {
    sample: (design, frameId, bytes) =>
      new Promise((resolve, reject) => {
        asks.push({
          frameId,
          draw: () => resolve(renderPixels(ck, design, frameId, bytes)),
          give: resolve,
          fail: () => reject(new Error('the export worker failed')),
        })
      }),
    cancel: () => {
      counted.cancels += 1
    },
  }
  return { sampler, asks, counted }
}

/** Pixels of a frame's size, all one colour, as a sampler gives them. */
export function flat(width: number, height: number): SampledFrame {
  return { width, height, pixels: new Uint8Array(width * height * 4).fill(255) }
}

/** The first pixel along the middle row of a frame's pixels that is neither white nor the blue: on the turned rectangle's edge. */
export function edgeOf(pixels: Uint8Array, width: number, height: number): [number, number] {
  const y = Math.floor(height / 2)
  for (let x = 0; x < width; x++) {
    const [r, g, b] = pixels.subarray((y * width + x) * 4, (y * width + x) * 4 + 3)
    const white = r === 255 && g === 255 && b === 255
    if (!white && !(r === 0x1e && g === 0x50 && b === 0xe0)) return [x, y]
  }
  throw new Error('no edge')
}

/** An Escape key input on the stage. */
export function escape() {
  return {
    code: 'Escape',
    key: 'Escape',
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    repeat: false,
    target: { field: false, control: false, dialog: 'none', toolbarArrow: false, buttonEnter: false, stage: true },
  } as const
}

/** A wheel input over the stage's middle. */
export function wheel(): PointerInput {
  return {
    type: 'wheel',
    at: { x: 400, y: 300 },
    button: 0,
    detail: 0,
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    pointerType: 'mouse',
  }
}

/** A photo's bytes: blocks `block` pixels a side in colours a seed picks, as a JPEG. */
export function photoBytes(width: number, height: number, block: number, seed: number): Uint8Array {
  const surface = ck.MakeSurface(width, height)
  if (!surface) throw new Error('no surface')
  const canvas = surface.getCanvas()
  const paint = new ck.Paint()
  let state = seed
  const next = () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648
    return Math.floor(state / 8_388_608)
  }
  for (let y = 0; y < height; y += block)
    for (let x = 0; x < width; x += block) {
      paint.setColor(ck.Color(next(), next(), next(), 1))
      canvas.drawRect(ck.XYWHRect(x, y, block, block), paint)
    }
  paint.delete()
  const image = surface.makeImageSnapshot()
  const bytes = image.encodeToBytes(ck.ImageFormat.JPEG, 90)
  image.delete()
  surface.dispose()
  if (!bytes) throw new Error('could not encode')
  return bytes
}

/** A design whose frame is filled by the photo `photo`. */
export function onePhoto(width: number, height: number) {
  return {
    meta: { designId: 'd', name: 'D' },
    pages: { p: { name: 'P', order: 'a0' } },
    frames: { f: { pageId: 'p', name: 'F', width, height, x: 0, y: 0, order: 'a0' } },
    nodes: {
      photo: {
        type: 'graphic' as const,
        parentId: 'f',
        link: 'photo',
        index: 'a0',
        name: 'Photo',
        props: {
          x: 0,
          y: 0,
          width,
          height,
          shape: { kind: 'rect' as const },
          fills: [{ type: 'image' as const, assetId: 'photo', fit: 'fill' as const }],
        },
      },
    },
  }
}

/** Two pages: a white frame on the first, and a frame filled by the photo `photo` on the second. */
export function twoPages(): DesignInput {
  const photo = onePhoto(300, 200)
  return {
    ...photo,
    pages: { p: { name: 'P', order: 'a0' }, q: { name: 'Q', order: 'a1' } },
    frames: {
      w: { pageId: 'p', name: 'W', width: 300, height: 200, x: 0, y: 0, order: 'a0', fills: solid('#FFFFFFFF') },
      g: { ...photo.frames.f, pageId: 'q', x: 1000 },
    },
    nodes: { photo: { ...photo.nodes.photo, parentId: 'g' } },
  }
}
