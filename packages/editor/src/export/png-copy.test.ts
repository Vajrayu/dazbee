import { afterEach, describe, expect, it } from 'vitest'

import { renderPixels, resourceCache } from '@dazbee/renderer'
import { loadCanvasKit } from '@dazbee/renderer/node'
import type { Design, DesignInput } from '@dazbee/schema'

import { type TestEditor, testEditor } from '../test-editor.ts'
import type { PngCopy } from './png-copy.ts'

const ck = await loadCanvasKit()

const RED = { type: 'solid' as const, color: '#E0302AFF' }
const GREEN = { type: 'solid' as const, color: '#20A050FF' }
const SHADOW = { type: 'dropShadow' as const, x: 4, y: 6, blur: 8, color: '#00000080' }
/**
 * A white frame holding a red card with a shadow, a blue square, a box turned 30° holding a green
 * bar and a group of two dots, and a mask on top with nothing above it; a frame too wide for a 2x
 * export, and one too wide for any.
 */
const DESIGN: DesignInput = {
  meta: { designId: 'd', name: 'D' },
  pages: { p1: { name: 'One', order: 'a0' } },
  frames: {
    sq: {
      pageId: 'p1',
      name: 'Square',
      width: 400,
      height: 300,
      x: 0,
      y: 0,
      order: 'a0',
      fills: [{ type: 'solid', color: '#FFFFFFFF' }],
    },
    wide: { pageId: 'p1', name: 'Wide', width: 9000, height: 100, x: 0, y: 400, order: 'a1' },
    huge: { pageId: 'p1', name: 'Huge', width: 17000, height: 100, x: 0, y: 600, order: 'a2' },
  },
  nodes: {
    card: {
      link: 'card',
      type: 'graphic',
      parentId: 'sq',
      index: 'a0',
      name: 'Card',
      props: { x: 100.25, y: 60, width: 80, height: 40, shape: { kind: 'rect' }, fills: [RED], effects: [SHADOW] },
    },
    square: {
      link: 'square',
      type: 'graphic',
      parentId: 'sq',
      index: 'a1',
      name: 'Square',
      props: {
        x: 300,
        y: 200,
        width: 50,
        height: 50,
        shape: { kind: 'rect' },
        fills: [{ type: 'solid', color: '#2050E0FF' }],
      },
    },
    holder: {
      link: 'holder',
      type: 'box',
      parentId: 'sq',
      index: 'a2',
      name: 'Holder',
      props: { x: 20, y: 150, width: 100, height: 60, rotation: 30, fills: [{ type: 'solid', color: '#FFE000FF' }] },
    },
    bar: {
      link: 'bar',
      type: 'graphic',
      parentId: 'holder',
      index: 'a0',
      name: 'Bar',
      props: { x: 30, y: 160, width: 60, height: 20, shape: { kind: 'rect' }, fills: [GREEN] },
    },
    pair: {
      link: 'pair',
      type: 'group',
      parentId: 'holder',
      index: 'a1',
      name: 'Pair',
      props: { x: 30, y: 185, width: 60, height: 20 },
    },
    dot1: {
      link: 'dot1',
      type: 'graphic',
      parentId: 'pair',
      index: 'a0',
      name: 'Dot',
      props: { x: 30, y: 185, width: 20, height: 20, shape: { kind: 'ellipse' }, fills: [RED] },
    },
    dot2: {
      link: 'dot2',
      type: 'graphic',
      parentId: 'pair',
      index: 'a1',
      name: 'Dot',
      props: { x: 70, y: 185, width: 20, height: 20, shape: { kind: 'ellipse' }, fills: [GREEN] },
    },
    lone: {
      link: 'lone',
      type: 'graphic',
      parentId: 'sq',
      index: 'a9',
      name: 'Mask',
      props: { x: 200, y: 20, width: 50, height: 50, mask: 'alpha', shape: { kind: 'rect' }, fills: [RED] },
    },
  },
}

let editor: TestEditor | undefined
afterEach(() => editor?.end())

/** The picture a copy draws, as the PNG export draws it, with the editor's fonts and images. */
function pixelsOf(e: TestEditor, { design, frameId, scale }: PngCopy) {
  const cache = resourceCache(ck)
  try {
    return renderPixels(ck, design, frameId, e.modules.resources.bytes(), cache, scale)
  } finally {
    cache.delete()
  }
}

/**
 * The frame `sq` of the editor's design at 2x with only `shown` and what they hold drawn: every
 * other layer hidden, and the frame's and the containers' own paint left out.
 */
function aloneInFrame(e: TestEditor, shown: string[]) {
  const now = e.core.design()
  const inside = (id: string): boolean => id !== '' && (shown.includes(id) || inside(now.nodes[id]?.parentId ?? ''))
  const kept = (id: string) => inside(id) || shown.some((s) => holds(now, id, s))
  const nodes = Object.fromEntries(
    Object.entries(now.nodes).map(([id, node]) => [
      id,
      kept(id)
        ? inside(id)
          ? node
          : { ...node, props: { ...node.props, fills: [], strokes: [], effects: [] } }
        : { ...node, visible: false, props: { ...node.props, visible: false } },
    ]),
  )
  const design = { ...now, frames: { ...now.frames, sq: { ...now.frames.sq, fills: [] } }, nodes } as Design
  const cache = resourceCache(ck)
  try {
    return renderPixels(ck, design, 'sq', e.modules.resources.bytes(), cache, 2)
  } finally {
    cache.delete()
  }
}

/** Whether `id` holds `inner`, at any depth. */
function holds(design: Design, id: string, inner: string): boolean {
  for (let up = design.nodes[inner]?.parentId; up; up = design.nodes[up]?.parentId) if (up === id) return true
  return false
}

/** The part of a picture `width` wide from `left`, `top`, `w` by `h`. */
function crop(pixels: Uint8Array, width: number, left: number, top: number, w: number, h: number) {
  const out = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++)
    out.set(pixels.subarray(((top + y) * width + left) * 4, ((top + y) * width + left + w) * 4), y * w * 4)
  return out
}

/** The most two pictures of one size differ by, in any channel, each colour weighed by its pixel's alpha. */
function furthest(a: Uint8Array, b: Uint8Array) {
  let most = 0
  for (let i = 0; i < a.length; i += 4) {
    const alphaA = a[i + 3] ?? 0
    const alphaB = b[i + 3] ?? 0
    most = Math.max(most, Math.abs(alphaA - alphaB))
    for (let k = 0; k < 3; k++)
      most = Math.max(most, Math.abs(((a[i + k] ?? 0) * alphaA - (b[i + k] ?? 0) * alphaB) / 255))
  }
  return most
}

/** How many pixels of a picture `width` wide outside the box from `left`, `top`, `w` by `h` show anything. */
function shownOutside(pixels: Uint8Array, width: number, left: number, top: number, w: number, h: number) {
  let shown = 0
  for (let i = 0; i < pixels.length / 4; i++) {
    const x = i % width
    const y = Math.floor(i / width)
    const inBox = x >= left && x < left + w && y >= top && y < top + h
    if (!inBox && (pixels[i * 4 + 3] ?? 0) > 0) shown++
  }
  return shown
}

describe('editorPngCopy', () => {
  describe('pngToCopy', () => {
    it('draws one selected layer alone at 2x on no fill, as big as what it draws with its shadow, its pixels as its frame draws them', async () => {
      editor = await testEditor(DESIGN)
      editor.core.select(['card'])
      const copy = editor.modules.pngCopy.pngToCopy()
      if (!copy || copy === 'tooBig') throw new Error('nothing to copy')
      const frame = copy.design.frames[copy.frameId]
      expect(copy.scale).toBe(2)
      expect(frame?.fills).toEqual([])
      expect(Object.values(copy.design.nodes).map((node) => node.name)).toEqual(['Card'])
      // The card from 100.25 to 180.25 and 60 to 100, its shadow 12 past the card moved 4 and 6, to whole pixels.
      expect([frame?.width, frame?.height]).toEqual([197 - 92, 118 - 54])
      const drawn = pixelsOf(editor, copy)
      const whole = aloneInFrame(editor, ['card'])
      expect([drawn.width, drawn.height]).toEqual([2 * 105, 2 * 64])
      expect(crop(whole.pixels, whole.width, 2 * 92, 2 * 54, drawn.width, drawn.height)).toEqual(drawn.pixels)
      expect(shownOutside(whole.pixels, whole.width, 2 * 92, 2 * 54, drawn.width, drawn.height)).toBe(0)
    })

    it.each(['bar', 'pair'])(
      'draws a layer inside a turned box, %s, turned as the box turns it with what it holds, without the box’s own fill',
      async (id) => {
        editor = await testEditor(DESIGN)
        editor.core.select([id])
        const copy = editor.modules.pngCopy.pngToCopy()
        if (!copy || copy === 'tooBig') throw new Error('nothing to copy')
        const bar = Object.values(copy.design.nodes).find((node) => node.parentId === copy.frameId)
        expect(bar?.props.rotation).toBe(30)
        const drawn = pixelsOf(editor, copy)
        const whole = aloneInFrame(editor, [id])
        // Where the copy's frame sat in the source frame: the bar as drawn there, less where the copy has it.
        const square = editor.core.frames().find((f) => f.id === 'sq')
        const there = square && editor.modules.boxes.drawnBoxOf(square, id)
        const left = 2 * ((there?.x ?? 0) - (bar?.props.x ?? 0))
        const top = 2 * ((there?.y ?? 0) - (bar?.props.y ?? 0))
        expect([left, top].every(Number.isInteger)).toBe(true)
        expect(shownOutside(whole.pixels, whole.width, left, top, drawn.width, drawn.height)).toBe(0)
        // Drawn through the box's turn and clip, its edges may shade a few levels apart.
        expect(
          furthest(crop(whole.pixels, whole.width, left, top, drawn.width, drawn.height), drawn.pixels),
        ).toBeLessThanOrEqual(8)
      },
    )

    it('draws several selected layers together, in the order they are stacked', async () => {
      editor = await testEditor(DESIGN)
      editor.core.select(['square', 'card'])
      const copy = editor.modules.pngCopy.pngToCopy()
      if (!copy || copy === 'tooBig') throw new Error('nothing to copy')
      expect(Object.values(copy.design.nodes).map((node) => node.name)).toEqual(['Card', 'Square'])
      const frame = copy.design.frames[copy.frameId]
      expect([frame?.width, frame?.height]).toEqual([350 - 92, 250 - 54])
    })

    it('gives a picked frame itself at 2x, or 1x when 2x passes the export’s limits, or too big when 1x does too', async () => {
      editor = await testEditor(DESIGN)
      const { core, modules } = editor
      core.pickFrame('sq')
      expect(modules.pngCopy.pngToCopy()).toEqual({ design: core.design(), frameId: 'sq', scale: 2 })
      core.pickFrame('wide')
      expect(modules.pngCopy.pngToCopy()).toMatchObject({ frameId: 'wide', scale: 1 })
      core.pickFrame('huge')
      expect(modules.pngCopy.pngToCopy()).toBe('tooBig')
    })

    it('gives nothing for a mask alone, which draws nothing itself, or a hidden layer, and Copy as PNG is not ready then', async () => {
      editor = await testEditor(DESIGN)
      editor.core.select(['lone'])
      expect(editor.modules.pngCopy.pngToCopy()).toBeNull()
      expect(editor.core.actionReady('copyPng')).toBe(false)
      editor.core.select(['square'])
      expect(editor.core.actionReady('copyPng')).toBe(true)
      editor.core.setHidden(['square'], true)
      editor.core.select(['square'])
      expect(editor.modules.pngCopy.pngToCopy()).toBeNull()
      expect(editor.core.actionReady('copyPng')).toBe(false)
    })

    it('gives nothing with nothing selected or picked, or while a text is typed in', async () => {
      editor = await testEditor({
        ...DESIGN,
        nodes: {
          ...DESIGN.nodes,
          words: {
            link: 'words',
            type: 'text',
            parentId: 'sq',
            index: 'a3',
            name: 'Words',
            props: {
              x: 10,
              y: 10,
              width: 100,
              height: 30,
              text: 'Hi',
              style: { fontFamily: 'Noto Sans', fontSize: 20, color: '#000000FF' },
            },
          },
        },
      })
      expect(editor.modules.pngCopy.pngToCopy()).toBeNull()
      editor.core.select(['words'])
      editor.press('goIn')
      expect(editor.modules.pngCopy.pngToCopy()).toBeNull()
    })
  })
})
