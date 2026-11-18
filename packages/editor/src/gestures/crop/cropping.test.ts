import { describe, expect, it } from 'vitest'

import { render } from '@dazbee/renderer'
import type { DesignInput, ImagePaint, Paint, Point } from '@dazbee/schema'

import type { Frame } from '../../canvas/frames.ts'
import { watchFaults } from '../../faults.ts'
import { editorDuplicate } from '../../layers/duplicate.ts'
import { hug } from '../../layers/hug.ts'
import { measure, sessionOf, testBoxes, testLaidOut } from '../../layers/test-boxes.ts'
import { drawnFrom, localTo, pageFrom } from '../../layers/transform.ts'
import { editorSelection } from '../../selection.ts'
import { faultOn, registerFaultyCommand } from '../../test-faults.ts'
import { editorAutoLayoutDrag } from '../select/auto-layout-drag.ts'
import { editorTransformDrag } from '../select/transform-drag.ts'
import { pointerInput } from '../test-inputs.ts'
import { type CropDrag, type CroppingDeps, editorCropping } from './cropping.ts'

/** A red fill under the square image, which `fit` places. */
const image = (fit: ImagePaint['fit'] = 'fill'): Paint[] => [
  { type: 'solid', color: '#FF0000FF' },
  { type: 'image', assetId: 'a1', fit, opacity: 1 },
]
/** A rect layer filled with the image, at a box. */
const graphic = (
  link: string,
  parentId: string,
  index: string,
  props: { x: number; y: number; width: number; height: number } & Record<string, unknown>,
) => ({
  type: 'graphic' as const,
  parentId,
  link,
  index,
  name: 'Photo',
  props: { shape: { kind: 'rect' as const }, fills: image(), ...props },
})
/**
 * A box 200 × 100 filled with a square image, which covers it: the image's whole sits 200 × 200
 * around it. A copy of it turned a quarter, and one filling the width of a row laid out by auto layout.
 */
const DESIGN: DesignInput = {
  meta: { designId: 'd', name: 'D' },
  pages: { p1: { name: 'One', order: 'a0' } },
  frames: { sq: { pageId: 'p1', name: 'Square', width: 1080, height: 1080, x: 0, y: 0, order: 'a0' } },
  nodes: {
    photo: graphic('photo', 'sq', 'a0', { x: 100, y: 100, width: 200, height: 100 }),
    turned: graphic('turned', 'sq', 'a1', { x: 500, y: 100, width: 200, height: 100, rotation: 90 }),
    row: {
      type: 'box',
      parentId: 'sq',
      link: 'row',
      index: 'a2',
      name: 'Row',
      props: { x: 100, y: 600, width: 400, height: 200, layout: { direction: 'row' } },
    },
    inRow: graphic('inRow', 'row', 'a0', {
      x: 0,
      y: 0,
      width: 400,
      height: 100,
      sizing: { width: 'fill', height: 'fixed' },
    }),
  },
}
/** The image's top half over a box 200 × 100: the whole image starts at the box's corner, 200 × 200. */
const TOP_HALF: Paint[] = [
  { type: 'image', assetId: 'a1', fit: 'crop', crop: { x: 0, y: 0, width: 400, height: 200 }, opacity: 1 },
]
/**
 * A box turned a quarter that holds an image off its centre, and an image turned a quarter itself.
 * Each shows the image's top half, so before any turn its whole image reaches 100 below its window.
 */
const QUARTER_TURNS: DesignInput = {
  ...DESIGN,
  nodes: {
    tilted: {
      type: 'box',
      parentId: 'sq',
      link: 'tilted',
      index: 'a0',
      name: 'Tilted',
      props: { x: 100, y: 100, width: 400, height: 200, rotation: 90 },
    },
    framed: graphic('framed', 'tilted', 'a0', { x: 120, y: 120, width: 200, height: 100, fills: TOP_HALF }),
    spun: graphic('spun', 'sq', 'a1', { x: 600, y: 100, width: 200, height: 100, rotation: 90, fills: TOP_HALF }),
  },
}
/** The image's top half over a box flipped upside down: drawn mirrored, its whole image reaches 100 above its window. */
const FLIPPED: DesignInput = {
  ...DESIGN,
  nodes: {
    mirrored: graphic('mirrored', 'sq', 'a0', {
      x: 100,
      y: 100,
      width: 200,
      height: 100,
      flipY: true,
      fills: TOP_HALF,
    }),
  },
}
const SQUARE: Frame = { id: 'sq', pageId: 'p1', name: 'Square', x: 0, y: 0, width: 1080, height: 1080 }
const IMAGE = { width: 400, height: 400 }
const pointer = pointerInput()

/** Cropping a layer of a design on a real session, selection and resize, at zoom 1 with the frame at the origin, logging what it draws and hugs. */
function harness(id = 'photo', design = DESIGN) {
  /** How many times the pointer was held. */
  let holds = 0
  const session = sessionOf(design)
  const log: string[] = []
  const selection = editorSelection({ drawn: () => session.design(), frames: () => [SQUARE], changed: () => {} })
  const boxes = testBoxes(session, selection, [SQUARE], { a1: IMAGE })
  const camera = () => ({ x: 0, y: 0, zoom: 1 })
  const hugging = (ids: string[]) => {
    log.push(`hug ${ids.join(',')}`)
    hug(session, ids)
  }
  const duplicate = editorDuplicate({ session, selection, boxes, hug: hugging })
  const autoLayoutDrag = editorAutoLayoutDrag({
    session,
    scenes: testLaidOut(session),
    boxes,
    duplicate,
    selection,
    camera,
    hug: hugging,
    notify: () => {},
    frames: () => [],
  })
  const transformDrag = editorTransformDrag({
    hold: () => (holds += 1),
    session,
    scenes: { shownScene: (f) => render(session.design(), f.id, undefined, measure) },
    selection,
    duplicate,
    typing: { editing: () => null, fitText: () => {} },
    tools: { tool: () => 'select' },
    boxes,
    camera,
    frames: () => [SQUARE],
    autoLayoutDrag,
    hug: hugging,
    notify: () => {},
    radiusLabel: String,
    shownChanged: () => {},
  })
  const deps: CroppingDeps = {
    hold: () => (holds += 1),
    session,
    selection,
    typing: { stop: () => log.push('stop typing') },
    thumbnails: { ghost: () => 'faint.png' },
    camera,
    frameOf: (key) => (key === SQUARE.id ? SQUARE : undefined),
    boxes,
    transformDrag,
    hug: hugging,
    shownChanged: () => log.push('draw'),
  }
  const cropping = editorCropping(deps)
  selection.select([id], SQUARE.id)
  selection.crop({ id, frameId: SQUARE.id })
  /** A layer's fills. */
  const fills = (of = id) => (session.design().nodes[of]?.props as { fills: Paint[] }).fills
  /** A layer's stored box. */
  const props = (of = id) => session.design().nodes[of]?.props as Record<string, unknown>
  /** Where the layer draws its whole image in the frame, turned as it is drawn. */
  const drawnImage = (of = id) => {
    const target = boxes.cropTarget(SQUARE, of)
    if (!target) throw new Error('nothing to crop')
    return drawnFrom({ ...target.rect, rotation: 0 }, target.around)
  }
  /** Presses at a point in the frame, which must start a drag. */
  const press = (at: Point) => {
    const drag = cropping.press(pointer, at)
    if (!drag) throw new Error('no drag')
    return drag
  }
  /** Drags to a point in the frame, as the pointer gives it: inside the layer's containers and turn as the drag began. */
  const dragTo = (drag: CropDrag, at: Point) => cropping.drag(drag, localTo(at, drag.around))
  return { cropping, session, selection, boxes, log, fills, props, drawnImage, press, dragTo, holds: () => holds }
}

/** Rounds a rect's numbers to hundredths, for comparing where things are drawn. */
const near = (r: { x: number; y: number; width: number; height: number }) =>
  Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Math.round(v * 100) / 100 + 0]))

describe('editorCropping', () => {
  describe('shown', () => {
    it("gives the crop's window and the whole image as drawn in the frame, with the faint image", () => {
      const { cropping, boxes, drawnImage } = harness()
      const target = boxes.cropTarget(SQUARE, 'photo')
      if (!target) throw new Error('nothing to crop')
      expect(cropping.shown()).toEqual({
        frame: SQUARE,
        id: 'photo',
        window: drawnFrom(target.box, target.around.slice(0, -1)),
        whole: drawnImage(),
        box: target.box,
        rect: target.rect,
        ghost: 'faint.png',
      })
    })

    it("gives the window and the whole image of an image in a turned box where the box's turn puts them", () => {
      const { cropping } = harness('framed', QUARTER_TURNS)
      // The box turns what it holds a quarter about its centre, (300, 200): the window's centre
      // goes from (220, 170) to (330, 120), and the whole image's from (220, 220) to (280, 120).
      const shown = cropping.shown()
      expect(shown && near(shown.window)).toEqual({ x: 230, y: 70, width: 200, height: 100, rotation: 90 })
      expect(shown && near(shown.whole)).toEqual({ x: 180, y: 20, width: 200, height: 200, rotation: 90 })
    })

    it("gives a turned image's window where the layer is drawn, and its whole image turned with it about the layer's centre", () => {
      const { cropping } = harness('spun', QUARTER_TURNS)
      // The layer turns a quarter about its centre, (700, 150): the whole image's centre goes from
      // (700, 200) to (650, 150).
      const shown = cropping.shown()
      expect(shown && near(shown.window)).toEqual({ x: 600, y: 100, width: 200, height: 100, rotation: 90 })
      expect(shown && near(shown.whole)).toEqual({ x: 550, y: 50, width: 200, height: 200, rotation: 90 })
    })

    it("gives a flipped layer's whole image mirrored, where it is drawn, with the layer's flips", () => {
      const { cropping } = harness('mirrored', FLIPPED)
      expect(cropping.shown()).toMatchObject({
        whole: { x: 100, y: 0, width: 200, height: 200, rotation: 0 },
        rect: { x: 100, y: 0, width: 200, height: 200 },
        flipY: true,
      })
    })

    it('gives nothing once the crop ends', () => {
      const { cropping, selection } = harness()
      selection.crop(null)
      expect(cropping.shown()).toBeNull()
    })
  })

  describe('start', () => {
    it('crops a layer with an image fill, selecting it alone', () => {
      const { cropping, selection, log } = harness()
      selection.select([], null)
      expect(cropping.start(SQUARE, 'photo')).toBe(true)
      expect(selection.cropping()).toEqual({ id: 'photo', frameId: 'sq' })
      expect(selection.current()).toEqual([{ id: 'photo', frameId: 'sq' }])
      expect(log).toEqual(['stop typing', 'draw'])
    })

    it('crops nothing without an image fill, or with its style locked', () => {
      const { cropping, session, selection } = harness()
      selection.crop(null)
      expect(cropping.start(SQUARE, 'row')).toBe(false)
      session.run('node.lock', { ids: ['photo'], lock: { style: true } })
      expect(cropping.start(SQUARE, 'photo')).toBe(false)
      expect(selection.cropping()).toBeNull()
    })

    it("gives a tile fill's place as its crop, one undo step, so the layer is drawn where the crop shows it", () => {
      const { cropping, session, selection, fills, drawnImage } = harness()
      session.run('node.update', { ids: ['photo'], patch: { fills: image('tile') } })
      selection.crop(null)
      expect(cropping.start(SQUARE, 'photo')).toBe(true)
      expect(fills()[1]).toMatchObject({ fit: 'crop', crop: { x: 0, y: 100, width: 400, height: 200 } })
      expect(near(drawnImage())).toEqual({ x: 100, y: 50, width: 200, height: 200, rotation: 0 })
      session.undo()
      expect(fills()[1]).toMatchObject({ fit: 'tile' })
    })
  })

  describe('cursorAt', () => {
    it("resizes on the window's handles and the image's corners, and moves on the image", () => {
      const { cropping } = harness()
      expect(cropping.cursorAt({ x: 300, y: 150 })).toBe('ew-resize')
      expect(cropping.cursorAt({ x: 100, y: 50 })).toBe('nwse-resize')
      expect(cropping.cursorAt({ x: 200, y: 160 })).toBe('move')
      expect(cropping.cursorAt({ x: 600, y: 600 })).toBe('')
    })
  })

  describe('press', () => {
    it('holds the pointer once from a press that starts a drag, and not from one off the crop, which leaves it', () => {
      const { cropping, holds } = harness()
      expect(cropping.press(pointer, { x: 200, y: 102 })).not.toBeNull()
      expect(holds()).toBe(1)
      expect(cropping.press(pointer, { x: 200, y: 150 })).not.toBeNull()
      expect(holds()).toBe(2)
      expect(cropping.press(pointer, { x: 900, y: 900 })).toBeNull()
      expect(holds()).toBe(2)
    })

    it("on a window's side bar or corner starts a drag that sizes it", () => {
      const { cropping, log } = harness()
      expect(cropping.press(pointer, { x: 200, y: 102 })).toMatchObject({ grabbed: { kind: 'window', handle: 'n' } })
      expect(cropping.press(pointer, { x: 298, y: 150 })).toMatchObject({ grabbed: { kind: 'window', handle: 'e' } })
      expect(cropping.press(pointer, { x: 110, y: 198 })).toMatchObject({ grabbed: { kind: 'window', handle: 'sw' } })
      expect(log).toEqual([])
    })

    it('on the image starts a drag that moves it, and on a corner one that zooms it', () => {
      const { cropping } = harness()
      expect(cropping.press(pointer, { x: 200, y: 150 })).toMatchObject({ kind: 'crop', id: 'photo', grabbed: null })
      expect(cropping.press(pointer, { x: 297, y: 247 })).toMatchObject({ grabbed: { kind: 'zoom', corner: 2 } })
      expect(cropping.press(pointer, { x: 102, y: 52 })).toMatchObject({ grabbed: { kind: 'zoom', corner: 0 } })
    })

    it('anywhere else ends the crop and draws it gone', () => {
      const { cropping, selection, log } = harness()
      expect(cropping.press(pointer, { x: 600, y: 600 })).toBeNull()
      expect(selection.cropping()).toBeNull()
      expect(log).toEqual(['draw'])
    })

    it('ends a crop whose layer has nothing left to crop', () => {
      const { cropping, selection, log } = harness()
      selection.crop({ id: 'gone', frameId: 'sq' })
      expect(cropping.press(pointer, { x: 200, y: 150 })).toBeNull()
      expect(selection.cropping()).toBeNull()
      expect(log).toEqual([])
    })
  })

  describe('drag', () => {
    it("pans the image, kept covering the window, as the fill's own crop", () => {
      const { cropping, press, fills, log } = harness()
      const drag = press({ x: 200, y: 150 })
      cropping.drag(drag, { x: 200, y: 180 })
      expect(fills()[1]).toMatchObject({ type: 'image', fit: 'crop', crop: { x: 0, y: 40, width: 400, height: 200 } })
      // Past the window's edge, the image stops there.
      cropping.drag(drag, { x: 200, y: 500 })
      expect(fills()[1]).toMatchObject({ crop: { x: 0, y: 0, width: 400, height: 200 } })
      expect(fills()[0]).toMatchObject({ type: 'solid' })
      expect(log).toEqual(['draw', 'draw'])
    })

    it("pans a flipped layer's image the way the pointer goes, and sizes its window with the image staying where it is drawn", () => {
      const panning = harness('mirrored', FLIPPED)
      // Drawn from 0 to 200, the image moves down 30: stored unmirrored, it moves up 30 from 100.
      panning.cropping.drag(panning.press({ x: 200, y: 150 }), { x: 200, y: 180 })
      expect(panning.fills()[0]).toMatchObject({ crop: { x: 0, y: 60, width: 400, height: 200 } })
      // The window's bottom side, dragged up 40: the image is still drawn from 0 to 200.
      const sizing = harness('mirrored', FLIPPED)
      sizing.cropping.drag(sizing.press({ x: 200, y: 200 }), { x: 200, y: 160 })
      expect(sizing.fills()[0]).toMatchObject({ crop: { x: 0, y: 80, width: 400, height: 120 } })
    })

    it('zooms the image from the corner opposite the one dragged', () => {
      const { cropping, press, fills } = harness()
      const drag = press({ x: 300, y: 250 })
      cropping.drag(drag, { x: 400, y: 350 })
      const fill = fills()[1]
      const crop = fill?.type === 'image' ? fill.crop : undefined
      expect(crop?.x).toBe(0)
      expect(crop?.y).toBeCloseTo(66.67, 2)
      expect(crop?.width).toBeCloseTo(266.67, 2)
      expect(crop?.height).toBeCloseTo(133.33, 2)
    })

    it("moves the window's dragged side with the layer's box, the image staying where it is drawn", () => {
      const { press, dragTo, fills, props, drawnImage } = harness()
      const before = drawnImage()
      const drag = press({ x: 300, y: 150 })
      dragTo(drag, { x: 260, y: 150 })
      expect(props()).toMatchObject({ x: 100, y: 100, width: 160, height: 100 })
      expect(fills()[1]).toMatchObject({ fit: 'crop', crop: { x: 0, y: 100, width: 320, height: 200 } })
      expect(near(drawnImage())).toEqual(near(before))
      // The start side, dragged in: the end side stays.
      const start = press({ x: 100, y: 150 })
      dragTo(start, { x: 150, y: 150 })
      expect(props()).toMatchObject({ x: 150, y: 100, width: 110, height: 100 })
      expect(near(drawnImage())).toEqual(near(before))
    })

    it('moves the window’s dragged side to the place the pointer gives, unrounded', () => {
      const { press, dragTo, props } = harness()
      dragTo(press({ x: 300, y: 150 }), { x: 260.4, y: 150.3 })
      expect(props()).toMatchObject({ x: 100, width: 160.4 })
    })

    it("grows the window no further than the image's edges", () => {
      const { press, dragTo, props, fills } = harness()
      dragTo(press({ x: 300, y: 150 }), { x: 500, y: 150 })
      expect(props()).toMatchObject({ x: 100, width: 200 })
      dragTo(press({ x: 200, y: 100 }), { x: 200, y: 0 })
      expect(props()).toMatchObject({ y: 50, height: 150 })
      expect(fills()[1]).toMatchObject({ crop: { x: 0, y: 0, width: 400, height: 300 } })
    })

    it('sizes the window of a turned layer along its own sides, the image staying where it is drawn', () => {
      const { press, dragTo, props, drawnImage, boxes } = harness('turned')
      const before = drawnImage()
      const target = boxes.cropTarget(SQUARE, 'turned')
      if (!target) throw new Error('nothing to crop')
      // Its end side, at the bottom once turned: dragged 40 in along the layer's own width.
      const at = (q: Point) => pageFrom(q, target.around)
      dragTo(press(at({ x: 700, y: 150 })), at({ x: 660, y: 150 }))
      expect(props()).toMatchObject({ width: 160, height: 100, rotation: 90 })
      expect(near(drawnImage())).toEqual(near(before))
    })

    it('starts a fit inside image where it is drawn, and moves it inside the window along the axis it is smaller on', () => {
      const { session, cropping, press, dragTo, fills, drawnImage } = harness()
      session.run('node.update', { ids: ['photo'], patch: { fills: image('fit') } })
      expect(near(drawnImage())).toEqual({ x: 150, y: 100, width: 100, height: 100, rotation: 0 })
      // A press in the window's band beside the image moves it too; a drag that doesn't move it leaves it as drawn.
      const drag = press({ x: 120, y: 150 })
      cropping.drag(drag, drag.grab)
      expect(fills()[1]).toMatchObject({ fit: 'crop', crop: { x: -200, y: 0, width: 800, height: 400 } })
      expect(near(drawnImage())).toEqual({ x: 150, y: 100, width: 100, height: 100, rotation: 0 })
      dragTo(drag, { x: 150, y: 150 })
      expect(near(drawnImage())).toMatchObject({ x: 180 })
      dragTo(drag, { x: 400, y: 170 })
      expect(near(drawnImage())).toMatchObject({ x: 200, y: 100 })
    })

    it('zooms a fit inside image out no further than fitting inside the window', () => {
      const { session, press, dragTo, drawnImage } = harness()
      session.run('node.update', { ids: ['photo'], patch: { fills: image('fit') } })
      dragTo(press({ x: 250, y: 200 }), { x: 160, y: 110 })
      expect(near(drawnImage())).toEqual({ x: 150, y: 100, width: 100, height: 100, rotation: 0 })
    })

    it('starts a fit inside image writing nothing, and its window’s end side dragged in narrows the layer, the image staying where it is drawn, one undo step', () => {
      // A 200 × 300 layer: the square image fits inside it at 200 × 200, with bands above and below.
      const tall = graphic('photo', 'sq', 'a0', { x: 100, y: 100, width: 200, height: 300, fills: image('fit') })
      const { cropping, session, selection, press, dragTo, fills, props, drawnImage } = harness('photo', {
        ...DESIGN,
        nodes: { ...DESIGN.nodes, photo: tall },
      })
      selection.crop(null)
      expect(cropping.start(SQUARE, 'photo')).toBe(true)
      expect(fills()[1]).toMatchObject({ fit: 'fit' })
      expect(session.canUndo()).toBe(false)
      const before = drawnImage()
      expect(near(before)).toEqual({ x: 100, y: 150, width: 200, height: 200, rotation: 0 })
      const drag = press({ x: 300, y: 250 })
      dragTo(drag, { x: 260, y: 250 })
      expect(props()).toMatchObject({ x: 100, y: 100, width: 160, height: 300 })
      // The crop reaches past the image across the bands above and below it.
      expect(fills()[1]).toMatchObject({ fit: 'crop', crop: { x: 0, y: -100, width: 320, height: 600 } })
      expect(near(drawnImage())).toEqual(near(before))
      cropping.release(drag)
      session.undo()
      expect(props()).toMatchObject({ width: 200 })
      expect(fills()[1]).toMatchObject({ fit: 'fit' })
      expect(fills()[1]).not.toHaveProperty('crop')
      expect(session.canUndo()).toBe(false)
    })

    it('resizes a layer a flow places as a resize handle does: the side dragged becomes Fixed', () => {
      const { press, dragTo, props, boxes } = harness('inRow')
      const target = boxes.cropTarget(SQUARE, 'inRow')
      if (!target) throw new Error('nothing to crop')
      const { box } = target
      const end = { x: box.x + box.width, y: box.y + box.height / 2 }
      dragTo(press(end), { x: end.x - 100, y: end.y })
      expect(props('inRow')).toMatchObject({ width: 300, sizing: { width: 'fixed', height: 'fixed' } })
    })
  })

  describe('release', () => {
    it('leaves nothing to undo after a press on the image or a window handle that never dragged', () => {
      const { cropping, press, session, fills, props } = harness()
      const before = [fills(), props()]
      for (const at of [
        { x: 200, y: 150 },
        { x: 300, y: 150 },
      ])
        cropping.release(press(at))
      expect([fills(), props()]).toEqual(before)
      expect([session.inGesture(), session.canUndo()]).toEqual([false, false])
    })

    it('ends the drag: everything it wrote is one undo step, called crop', () => {
      const { cropping, press, session, fills } = harness()
      const drag = press({ x: 200, y: 150 })
      cropping.drag(drag, { x: 200, y: 170 })
      cropping.drag(drag, { x: 200, y: 180 })
      cropping.release(drag)
      expect(session.inGesture()).toBe(false)
      expect(session.undoName()).toBe('crop')
      session.undo()
      expect(fills()[1]).toMatchObject({ type: 'image', fit: 'fill' })
      expect(session.canUndo()).toBe(false)
    })

    it('ends a window drag, the groups around the layer fitting it again: its box and crop are one undo step', () => {
      const { cropping, press, dragTo, session, fills, props, log } = harness()
      const drag = press({ x: 300, y: 150 })
      dragTo(drag, { x: 280, y: 150 })
      dragTo(drag, { x: 260, y: 150 })
      cropping.release(drag)
      expect(log).toContain('hug photo')
      expect(session.inGesture()).toBe(false)
      session.undo()
      expect(props()).toMatchObject({ x: 100, y: 100, width: 200, height: 100 })
      expect(fills()[1]).toMatchObject({ type: 'image', fit: 'fill' })
      expect(session.canUndo()).toBe(false)
    })
  })

  describe('a fault in the middle of a drag', () => {
    registerFaultyCommand()

    it('leaves no gesture open and the fill as it was, and the next press starts a drag of its own', () => {
      const { cropping, session, press, fills } = harness()
      const before = fills()
      const drag = press({ x: 200, y: 150 })
      // The editor has the pointer drop the drag when a fault is told, which cancels its step.
      watchFaults({ session, endOpen: () => drag.step.cancel(), notify: () => {} })
      cropping.drag(drag, { x: 200, y: 180 })
      faultOn(session, ['photo'])
      expect([session.inGesture(), session.canUndo()]).toEqual([false, false])
      expect(fills()).toEqual(before)
      const next = press({ x: 200, y: 150 })
      expect(session.inGesture()).toBe(true)
      cropping.drag(next, { x: 200, y: 180 })
      cropping.release(next)
      expect(session.inGesture()).toBe(false)
      expect(fills()[1]).toMatchObject({ fit: 'crop', crop: { x: 0, y: 40, width: 400, height: 200 } })
      session.undo()
      expect([fills(), session.canUndo()]).toEqual([before, false])
    })
  })
})
