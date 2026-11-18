import { describe, expect, it } from 'vitest'

import { ALL_PLATFORMS, type Design, type Rect } from '@dazbee/schema'

import { fit, NO_INSETS, revealWhole, toWorld } from './camera.ts'
import { pageFrames } from './frames.ts'
import { design } from './test-design.ts'
import { testMotion } from './test-motion.ts'
import { editorView, type ViewDeps } from './view.ts'

/** The size of the stage the tests give the view, at two screen pixels for each of its own. */
const STAGE = { width: 1000, height: 800, dpr: 2 }

/** The view over the test design, logging its zooms and each redraw it asks for. */
function harness(start: Design = design) {
  let now = start
  const log: string[] = []
  const deps: ViewDeps = {
    session: { design: () => now, changes: () => 0 },
    onZoom: (zoom) => log.push(`zoom ${zoom}`),
  }
  const view = editorView(deps)
  const asked: string[] = []
  view.onRedraw(() => asked.push('redraw'))
  const change = (next: Design) => {
    now = next
  }
  return { view, log, asked, change }
}
/**
 * The view on a 1000 × 800 stage at 100%, its glides stepped by hand, with the system's reduced
 * motion on or off. While `drawing.on`, a redraw it asks for runs at the next animation frame, as
 * the surface runs the redraw pass, finding the frames in view.
 */
function glideHarness(reduced = false) {
  const clock = testMotion(reduced)
  const view = editorView({
    session: { design: () => design, changes: () => 0 },
    onZoom: () => {},
    motion: clock.motion,
  })
  view.setViewport({ width: 1000, height: 800, dpr: 1 })
  view.setCamera({ x: 0, y: 0, zoom: 1 })
  const asked: string[] = []
  const drawing = { on: true, pending: false }
  view.onRedraw(() => {
    asked.push('redraw')
    if (!drawing.on || drawing.pending) return
    drawing.pending = true
    clock.drawNext(() => {
      drawing.pending = false
      view.findInView()
    })
  })
  return { view, clock, asked, drawing }
}
const white = [{ type: 'solid' as const, color: '#FFFFFFFF' }]
/** The test design with a third page, `three`, holding one frame away from the origin, or none. */
const withPageThree = (frames: boolean): Design => ({
  ...design,
  pages: { ...design.pages, three: { name: 'Three', order: 'a2' } },
  frames: frames
    ? {
        ...design.frames,
        'three-sq': {
          pageId: 'three',
          name: 'Square',
          width: 500,
          height: 400,
          x: 100,
          y: 200,
          fills: white,
          order: 'a0',
        },
      }
    : design.frames,
})
/** The test design without page `one` and its frames. */
const withoutPageOne: Design = {
  ...design,
  pages: { two: design.pages.two as Design['pages'][string] },
  frames: Object.fromEntries(Object.entries(design.frames).filter(([, f]) => f.pageId !== 'one')),
}

describe('editorView', () => {
  describe('design, frames, frameOf and page', () => {
    it('reads the design and shows the first page, its frames where they are stored', () => {
      const { view } = harness()
      expect(view.design()).toBe(design)
      expect(view.page()).toBe('one')
      expect(view.frames()).toEqual(pageFrames(design, 'one').frames)
      expect(view.frameOf('one-mpu')).toMatchObject({ pageId: 'one', name: 'MPU', x: 2560, y: 0 })
    })

    it('finds no frame of a page not shown, or one the design lacks', () => {
      const { view } = harness()
      expect(view.frameOf('two-mpu')).toBeUndefined()
      expect(view.frameOf('gone')).toBeUndefined()
      expect(view.frameOf(undefined)).toBeUndefined()
    })
  })

  describe('middleFrame', () => {
    it('finds the frame in the middle of the view', () => {
      const { view } = harness()
      view.setViewport(STAGE)
      view.setCamera({ x: 500 - 540, y: 400 - 540, zoom: 1 })
      expect(view.middleFrame()?.id).toBe('one-sq')
      view.setCamera({ x: 500 - 1200, y: 0, zoom: 1 })
      expect(view.middleFrame()).toBeUndefined()
    })
  })

  describe('nearestFrame', () => {
    it('finds the frame in the middle of the view, else the one nearest the middle', () => {
      const { view } = harness()
      view.setViewport(STAGE)
      view.setCamera({ x: 500 - 540, y: 400 - 540, zoom: 1 })
      expect(view.nearestFrame()?.id).toBe('one-sq')
      // The middle in the gap at 1200, 400: the story is 80 away, the square 120.
      view.setCamera({ x: 500 - 1200, y: 0, zoom: 1 })
      expect(view.nearestFrame()?.id).toBe('one-story')
      // Past the MPU's end, at 3500, 100.
      view.setCamera({ x: 500 - 3500, y: 400 - 100, zoom: 1 })
      expect(view.nearestFrame()?.id).toBe('one-mpu')
    })

    it('finds none on a page with no frames', () => {
      const { view } = harness(withPageThree(false))
      view.showPage('three')
      expect(view.nearestFrame()).toBeUndefined()
    })
  })

  describe('dpr, viewport and setViewport', () => {
    it("takes the stage's size and the screen's pixels for each of its own, asking for no redraw", () => {
      const { view, log, asked } = harness()
      expect(view.viewport()).toEqual({ width: 1, height: 1 })
      expect(view.dpr()).toBe(1)
      view.setViewport({ width: 640, height: 480, dpr: 3 })
      expect(view.viewport()).toEqual({ width: 640, height: 480 })
      expect(view.dpr()).toBe(3)
      expect(asked).toEqual([])
      expect(log).toEqual([])
    })

    it('fits and finds the frames in view in the size it was given', () => {
      const { view } = harness()
      view.setViewport({ width: 600, height: 400, dpr: 1 })
      view.fitArea({ x: 0, y: 0, width: 1080, height: 1080 })
      expect(view.camera()).toEqual(fit({ x: 0, y: 0, width: 1080, height: 1080 }, { width: 600, height: 400 }))
      view.setCamera({ x: -1280, y: 0, zoom: 1 })
      expect(view.findInView().map((f) => f.id)).toEqual(['one-story'])
      view.setViewport({ width: 1600, height: 400, dpr: 1 })
      expect(view.findInView().map((f) => f.id)).toEqual(['one-story', 'one-mpu'])
    })
  })

  describe('pointOn and spotOn', () => {
    it('finds the frame and design pixel under a point on the stage, or none', () => {
      const { view } = harness()
      view.setCamera({ x: 100, y: 50, zoom: 2 })
      expect(view.pointOn({ x: 120, y: 70 })).toMatchObject({ frame: { id: 'one-sq' }, p: { x: 10, y: 10 } })
      expect(view.spotOn({ x: 120, y: 70 })).toEqual({ frameId: 'one-sq', x: 10, y: 10 })
      expect(view.pointOn({ x: 90, y: 40 })).toBeNull()
      expect(view.spotOn({ x: 90, y: 40 })).toBeNull()
    })
  })

  describe('stagePoint', () => {
    it("finds where a frame's design pixel is on the stage, the shown page's first frame by default", () => {
      const { view } = harness()
      view.setCamera({ x: 100, y: 50, zoom: 2 })
      expect(view.stagePoint(5, 6, 'one-mpu')).toEqual({ x: 100 + (2560 + 5) * 2, y: 50 + 6 * 2 })
      expect(view.stagePoint(0, 0)).toEqual({ x: 100, y: 50 })
      expect(() => view.stagePoint(0, 0, 'gone')).toThrow('no frame "gone" on the shown page')
    })
  })

  describe('defaultFrame', () => {
    it('finds a frame of the shown page, its first by default', () => {
      const { view } = harness()
      expect(view.defaultFrame().id).toBe('one-sq')
      expect(view.defaultFrame('one-mpu').id).toBe('one-mpu')
    })

    it('throws for a frame not on the shown page, and on a page with no frames', () => {
      const { view, change } = harness()
      expect(() => view.defaultFrame('two-mpu')).toThrow('no frame "two-mpu" on the shown page')
      change(withPageThree(false))
      view.showPage('three')
      expect(() => view.defaultFrame()).toThrow('the shown page has no frames')
    })
  })

  describe('safeZones and setSafeZones', () => {
    it('starts with the safe zones hidden, and keeps the choice of platform it is given, or none', () => {
      const { view } = harness()
      expect(view.safeZones()).toBeNull()
      view.setSafeZones(ALL_PLATFORMS)
      expect(view.safeZones()).toBe(ALL_PLATFORMS)
      view.setSafeZones('Meta')
      expect(view.safeZones()).toBe('Meta')
      view.setSafeZones(null)
      expect(view.safeZones()).toBeNull()
    })
  })

  describe('redraw and onRedraw', () => {
    it('tells its listener each time a redraw is asked for, until it stops listening', () => {
      const { view } = harness()
      const heard: string[] = []
      const stop = view.onRedraw(() => heard.push('redraw'))
      view.redraw()
      view.setCamera({ x: 5, y: 5, zoom: 1 })
      expect(heard).toEqual(['redraw', 'redraw'])
      stop()
      view.redraw()
      expect(heard).toEqual(['redraw', 'redraw'])
    })
  })

  describe('update', () => {
    it("reads the design again and lays out the shown page's frames", () => {
      const { view, change } = harness()
      const without: Design = {
        ...design,
        frames: Object.fromEntries(Object.entries(design.frames).filter(([id]) => id !== 'one-story')),
      }
      change(without)
      expect(view.design()).toBe(design)
      view.update()
      expect(view.design()).toBe(without)
      expect(view.frames().map((f) => f.id)).toEqual(['one-sq', 'one-mpu'])
    })

    it('shows the first page again when the shown page is gone', () => {
      const { view, change } = harness()
      view.showPage('two')
      change({ ...design, pages: { one: design.pages.one as Design['pages'][string] } })
      view.update()
      expect(view.page()).toBe('one')
      expect(view.frames().map((f) => f.id)).toEqual(['one-sq', 'one-story', 'one-mpu'])
      change(withoutPageOne)
      view.update()
      expect(view.page()).toBe('two')
    })
  })

  describe('showPage', () => {
    it('shows a page, laying out its frames at once, even one just added, and fits them', () => {
      const { view, change } = harness()
      view.setViewport(STAGE)
      change(withPageThree(true))
      view.showPage('three')
      expect(view.page()).toBe('three')
      expect(view.frames().map((f) => f.id)).toEqual(['three-sq'])
      expect(view.camera()).toEqual(fit({ x: 100, y: 200, width: 500, height: 400 }, { width: 1000, height: 800 }))
    })

    it('shows the first page for a page the design lacks', () => {
      const { view } = harness()
      view.showPage('two')
      view.showPage('gone')
      expect(view.page()).toBe('one')
    })
  })

  describe('findInView and inView', () => {
    it('works out the frames in view at the camera, which inView answers until it is asked again', () => {
      const { view } = harness()
      view.setViewport(STAGE)
      view.setCamera({ x: 0, y: 0, zoom: 0.5 })
      expect(view.inView()).toEqual([])
      expect(view.findInView().map((f) => f.id)).toEqual(['one-sq', 'one-story'])
      expect(view.inView().map((f) => f.id)).toEqual(['one-sq', 'one-story'])
      view.setCamera({ x: -640, y: 0, zoom: 0.5 })
      expect(view.inView().map((f) => f.id)).toEqual(['one-sq', 'one-story'])
      expect(view.findInView().map((f) => f.id)).toEqual(['one-story', 'one-mpu'])
      expect(view.inView().map((f) => f.id)).toEqual(['one-story', 'one-mpu'])
    })

    it('finds the frames in view after a pan, in the size it has before it is given one', () => {
      const { view } = harness()
      view.setCamera({ x: -1280, y: 0, zoom: 1 })
      expect(view.findInView().map((f) => f.id)).toEqual(['one-story'])
      expect(view.inView().map((f) => f.id)).toEqual(['one-story'])
    })
  })

  describe('setCamera, zoomTo, zoomIn and zoomOut', () => {
    it('moves the camera and redraws, telling the zoom when it changes', () => {
      const { view, log, asked } = harness()
      view.setCamera({ x: 10, y: 10, zoom: 1 })
      view.setCamera({ x: 20, y: 10, zoom: 1.5 })
      expect(view.camera()).toEqual({ x: 20, y: 10, zoom: 1.5 })
      expect(log).toEqual(['zoom 1.5'])
      expect(asked).toEqual(['redraw', 'redraw'])
    })

    it('zooms in and out through the zoom steps about the middle of the stage, or to a zoom about a point on it', () => {
      const { view } = harness()
      view.setViewport(STAGE)
      view.setCamera({ x: 0, y: 0, zoom: 0.8 })
      /** The world point under the middle of the stage. */
      const middle = () => toWorld(view.camera(), { x: 500, y: 400 })
      const was = middle()
      for (const [zoom, step] of [
        [1, view.zoomIn],
        [2, view.zoomIn],
        [1, view.zoomOut],
        [0.5, view.zoomOut],
      ] as const) {
        step()
        expect(view.camera().zoom).toBe(zoom)
        expect(middle().x).toBeCloseTo(was.x, 9)
        expect(middle().y).toBeCloseTo(was.y, 9)
      }
      const corner = toWorld(view.camera(), { x: 0, y: 0 })
      view.zoomTo(4, { x: 0, y: 0 })
      expect(view.camera().zoom).toBe(4)
      expect(toWorld(view.camera(), { x: 0, y: 0 }).x).toBeCloseTo(corner.x, 9)
      expect(toWorld(view.camera(), { x: 0, y: 0 }).y).toBeCloseTo(corner.y, 9)
    })

    it('leaves the camera be, asking for no redraw, zooming in at the top step and out at the bottom one', () => {
      const { view, log, asked } = harness()
      view.setViewport(STAGE)
      for (const [zoom, step] of [
        [64, view.zoomIn],
        [0.01, view.zoomOut],
      ] as const) {
        view.setCamera({ x: 10, y: 20, zoom })
        log.length = 0
        asked.length = 0
        step()
        expect(view.camera()).toEqual({ x: 10, y: 20, zoom })
        expect([log, asked]).toEqual([[], []])
      }
    })
  })

  describe('fitAll and fitArea', () => {
    it("fits the shown page's frames, clear of the insets", () => {
      const { view } = harness()
      view.setViewport(STAGE)
      const insets = { top: 40, right: 0, bottom: 72, left: 0 }
      view.setInsets(insets)
      view.fitAll()
      const viewport = { width: 1000, height: 800 }
      expect(view.camera()).toEqual(fit(pageFrames(design, 'one').bounds as Rect, viewport, undefined, insets))
      view.showPage('two')
      expect(view.camera()).toEqual(fit(pageFrames(design, 'two').bounds as Rect, viewport, undefined, insets))
    })

    it("puts the page's origin in the middle of the stage at 100% on a page with no frames", () => {
      const { view, change } = harness()
      view.setViewport(STAGE)
      change(withPageThree(false))
      view.showPage('three')
      expect(view.camera()).toEqual({ x: 500, y: 400, zoom: 1 })
    })

    it('fits a part of the canvas, or leaves the camera without one', () => {
      const { view } = harness()
      view.setViewport(STAGE)
      const area = { x: 100, y: 100, width: 200, height: 100 }
      view.fitArea(area)
      expect(view.camera()).toEqual(fit(area, { width: 1000, height: 800 }))
      view.fitArea(undefined)
      expect(view.camera()).toEqual(fit(area, { width: 1000, height: 800 }))
    })
  })

  describe('showArea', () => {
    const AREA = { x: 0, y: 0, width: 400, height: 300 }
    /** The stage at its place on the page, and panels over its right side: one over the area, one below it. */
    const STAGE = { x: 10, y: 10, width: 1000, height: 800 }
    const OVER = { x: 610, y: 110, width: 300, height: 400 }
    const CLEAR = { x: 610, y: 610, width: 300, height: 150 }

    it('pans, at the same zoom, so a part of the canvas off the stage shows', () => {
      const { view } = harness()
      view.setViewport({ width: 1000, height: 800, dpr: 1 })
      view.setCamera({ x: -2000, y: 0, zoom: 1 })
      view.showArea(AREA)
      const shown = view.camera()
      expect(shown.zoom).toBe(1)
      expect(shown.x).toBeGreaterThan(0)
      view.showArea(AREA)
      expect(view.camera()).toBe(shown)
    })

    it('beside a panel, moves only a part that lies under it, clear of it too', () => {
      const { view } = harness()
      view.setViewport({ width: 1000, height: 800, dpr: 1 })
      view.setCamera({ x: 400, y: 100, zoom: 1 })
      const before = view.camera()
      view.showArea(AREA, { panel: CLEAR, stage: STAGE })
      expect(view.camera()).toBe(before)
      view.showArea(AREA, { panel: OVER, stage: STAGE })
      const shown = view.camera()
      expect(shown).not.toBe(before)
      expect(shown.zoom).toBe(1)
      // The panel's left edge is 600 across the stage: the part ends before it.
      expect(shown.x + AREA.width).toBeLessThanOrEqual(600)
    })
  })

  describe('showWhole', () => {
    /** A 400 × 300 frame far right of the stage at 100%. */
    const FAR = { x: 3000, y: 100, width: 400, height: 300 }
    const START = { x: 0, y: 0, zoom: 1 }
    const END = revealWhole(START, FAR, { width: 1000, height: 800 }, NO_INSETS)

    it('glides, eased out over about 300 ms, to the least pan that shows a part off the stage, each step nearer with no overshoot', () => {
      const { view, clock, asked } = glideHarness()
      view.showWhole(FAR)
      expect(view.camera()).toEqual(START)
      const xs = [view.camera().x]
      for (let at = 1000; at <= 1320; at += 16) {
        clock.tick(at)
        xs.push(view.camera().x)
      }
      expect(view.camera()).toEqual(END)
      expect(clock.waiting()).toBe(0)
      for (let i = 1; i < xs.length; i++) {
        expect(xs[i]).toBeLessThanOrEqual(xs[i - 1] as number)
        expect(xs[i]).toBeGreaterThanOrEqual(END.x)
      }
      // Eased out: the first half of the time covers more than half the way.
      expect(xs[10] as number).toBeLessThan(END.x / 2)
      expect(new Set(xs).size).toBeGreaterThan(10)
      expect(asked.length).toBe(new Set(xs).size - 1)
    })

    it('leaves the camera as it is, and waits for no frame, for a part the stage shows already', () => {
      const { view, clock, asked } = glideHarness()
      view.showWhole({ x: 100, y: 100, width: 400, height: 300 })
      expect(view.camera()).toEqual(START)
      expect(clock.waiting()).toBe(0)
      expect(asked).toEqual([])
    })

    it('stops where it is at any other camera move, or when told to', () => {
      const { view, clock } = glideHarness()
      view.showWhole(FAR)
      clock.tick(1000)
      clock.tick(1100)
      const stopped = view.camera()
      expect(stopped).not.toEqual(START)
      // A wheel's or a drag's pan.
      view.setCamera({ ...stopped, x: stopped.x + 10 })
      expect(clock.waiting()).toBe(0)
      clock.tick(1400)
      expect(view.camera()).toEqual({ ...stopped, x: stopped.x + 10 })
      // A zoom key's.
      view.showWhole(FAR)
      clock.tick(1500)
      clock.tick(1550)
      view.zoomIn()
      const zoomed = view.camera()
      clock.tick(2000)
      expect(view.camera()).toBe(zoomed)
      // Told to, as a press that pans does.
      view.showWhole(FAR)
      clock.tick(2100)
      clock.tick(2150)
      const pressed = view.camera()
      view.stopGlide()
      expect(clock.waiting()).toBe(0)
      expect(view.camera()).toBe(pressed)
    })

    it('moves on by at most 20 ms of the glide for an animation frame that comes late, so a busy page still shows it', () => {
      const { view, clock } = glideHarness()
      view.showWhole(FAR)
      // The page is busy for 400 ms after the first animation frame, as it is right after a click adds a frame.
      clock.tick(1000)
      clock.tick(1400)
      // 20 ms of 300, eased out.
      expect(view.camera().x).toBeCloseTo(END.x * (1 - (1 - 20 / 300) ** 3))
      const steps = clock.runOut(view, 1416)
      expect(steps.length).toBeGreaterThan(10)
      expect(view.camera()).toEqual(END)
    })

    it('moves on only once the redraw pass has drawn its last step', () => {
      const { view, clock, drawing } = glideHarness()
      view.showWhole(FAR)
      clock.tick(1000)
      clock.tick(1016)
      const first = view.camera()
      // The step at 1032 isn't drawn until after 1064, as on a busy page: the glide waits on it.
      drawing.on = false
      clock.tick(1032)
      const waiting = view.camera()
      expect(waiting.x).toBeLessThan(first.x)
      clock.tick(1048)
      clock.tick(1064)
      expect(view.camera()).toBe(waiting)
      view.findInView()
      drawing.on = true
      clock.tick(1080)
      // It moves on by the time since its last step, at most 20 ms: from 32 ms of the glide to 52.
      expect(view.camera().x).toBeCloseTo(END.x * (1 - (1 - 52 / 300) ** 3))
    })

    it('stops a glide under way for a part the stage shows where it is now', () => {
      const { view, clock } = glideHarness()
      view.showWhole(FAR)
      clock.tick(1000)
      clock.tick(1100)
      const stopped = view.camera()
      view.showWhole({ x: -stopped.x / stopped.zoom + 100, y: 200, width: 100, height: 100 })
      expect(clock.waiting()).toBe(0)
      expect(view.camera()).toBe(stopped)
    })

    it('moves straight to the end with reduced motion, or with no animation frames given', () => {
      const reduced = glideHarness(true)
      reduced.view.showWhole(FAR)
      expect(reduced.view.camera()).toEqual(END)
      expect(reduced.clock.waiting()).toBe(0)
      const { view } = harness()
      view.setViewport({ width: 1000, height: 800, dpr: 1 })
      view.showWhole(FAR)
      expect(view.camera()).toEqual(END)
    })

    it('cancels its next step when destroyed', () => {
      const { view, clock } = glideHarness()
      view.showWhole(FAR)
      view.destroy()
      expect(clock.waiting()).toBe(0)
    })
  })

  describe('toggleRulers, viewChanged and onView', () => {
    it('turns the rulers on and off, and tells the view listeners until they stop listening', () => {
      const { view, log } = harness()
      const stop = view.onView(() => log.push(`listener ${view.rulers()}`))
      expect(view.rulers()).toBe(false)
      view.toggleRulers()
      expect(log).toEqual([])
      view.viewChanged()
      stop()
      view.toggleRulers()
      view.viewChanged()
      expect(log).toEqual(['listener true'])
      expect(view.rulers()).toBe(false)
    })
  })

  describe('destroy', () => {
    it('lets its listeners go', () => {
      const { view, log, asked } = harness()
      view.onView(() => log.push('view changed'))
      view.destroy()
      view.redraw()
      view.viewChanged()
      expect(asked).toEqual([])
      expect(log).toEqual([])
    })
  })
})
