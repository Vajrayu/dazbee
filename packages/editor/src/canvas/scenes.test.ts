import { describe, expect, it } from 'vitest'

import type { Session } from '@dazbee/doc'
import { makeResources, outlineOf, type Scene, type SceneLayer } from '@dazbee/renderer'
import { loadCanvasKit } from '@dazbee/renderer/node'
import { type Design, type DesignInput, NEW_FRAME_FILLS, type Rect, type Variables } from '@dazbee/schema'

import { sessionOf } from '../layers/test-boxes.ts'
import type { EditorResources } from '../resources.ts'
import { copyIn, linkedFrames, type Seeded } from '../test-matrix/design-builders.ts'
import { type Camera, fit, framesInView } from './camera.ts'
import { type Frame, pageFrames } from './frames.ts'
import { findLayer, frameScenes, outlinePathOf } from './scenes.ts'
import { layer, RED } from './test-layers.ts'

const ck = await loadCanvasKit()
/** A layer's outline path data, its outline made as the hit test's is. */
const pathOf = (layer: SceneLayer) => outlinePathOf(layer, (l) => outlineOf(ck, l))

const NO_VARIABLES: Variables = {}
const SQ: Frame = { id: 'sq', pageId: 'p', name: 'Square', x: 0, y: 0, width: 1080, height: 1080 }
/** A square frame holding an ellipse and a second frame holding a box. */
const TWO_FRAMES = {
  meta: { designId: 'd', name: 'D' },
  pages: { p: { name: 'P', order: 'a0' } },
  frames: {
    sq: { pageId: 'p', name: 'Square', width: 1080, height: 1080, x: 0, y: 0, order: 'a0' },
    other: { pageId: 'p', name: 'Other', width: 1080, height: 1080, x: 1280, y: 0, order: 'a1' },
  },
  nodes: {
    oval: {
      type: 'graphic' as const,
      parentId: 'sq',
      link: 'oval',
      index: 'a0',
      name: 'Oval',
      props: { x: 100, y: 100, width: 200, height: 100, shape: { kind: 'ellipse' as const } },
    },
    box: {
      type: 'graphic' as const,
      parentId: 'other',
      link: 'box',
      index: 'a0',
      name: 'Box',
      props: { x: 100, y: 100, width: 200, height: 100, shape: { kind: 'rect' as const } },
    },
  },
}

/** The sizes of a page's five linked frames, the square first: `<page>-<size>` each. */
const SIZES = [
  ['sq', 1080, 1080],
  ['story', 1080, 1920],
  ['land', 1200, 628],
  ['mpu', 300, 250],
  ['leader', 728, 90],
] as const
/** The stage the redraws draw on: a laptop's, 1440 × 900. */
const VIEWPORT = { width: 1440, height: 900 }

/**
 * A square's layers: a rounded box `<page>-box`, a headline `<page>-headline` and `fill` more,
 * rounded rects, ellipses and short texts, spread over it.
 */
function cardLayers(pageId: string, frameId: string, fill: number): Record<string, Seeded> {
  const nodes: Record<string, Seeded> = {
    [`${pageId}-box`]: {
      type: 'graphic',
      parentId: frameId,
      index: 'a0',
      name: 'Box',
      props: { x: 100, y: 100, width: 200, height: 160, shape: { kind: 'rect', cornerRadius: 24 }, fills: [RED] },
    },
    [`${pageId}-headline`]: {
      type: 'text',
      parentId: frameId,
      index: 'a1',
      name: 'Headline',
      props: {
        x: 80,
        y: 480,
        width: 920,
        height: 120,
        text: 'Summer sale',
        style: { fontFamily: 'Noto Sans', fontSize: 80, color: '#111111FF' },
      },
    },
  }
  for (let i = 0; i < fill; i++) {
    const [x, y, index] = [(i * 97) % 980, (i * 61) % 1000, `Z${String(i).padStart(4, '0')}`]
    nodes[`${pageId}-f${i}`] =
      i % 6 === 5
        ? {
            type: 'text',
            parentId: frameId,
            index,
            name: `Note ${i}`,
            props: {
              x,
              y,
              width: 300,
              height: 48,
              text: `Line ${i}`,
              style: { fontFamily: 'Noto Sans', fontSize: 32, color: '#111111FF' },
            },
          }
        : {
            type: 'graphic',
            parentId: frameId,
            index,
            name: `Shape ${i}`,
            props: {
              x,
              y,
              width: 40 + (i % 7) * 20,
              height: 30 + (i % 5) * 20,
              shape: i % 2 ? { kind: 'ellipse' } : { kind: 'rect', cornerRadius: 8 },
              fills: [RED],
              opacity: i % 4 === 3 ? 0.6 : 1,
            },
          }
  }
  return nodes
}

/**
 * Adds a page `pageId` to a design: a square `<page>-sq` holding `cardLayers`, and the other four
 * SIZES beside it holding their linked copies.
 */
function withCard(design: DesignInput, pageId: string, order: string, fill: number): DesignInput {
  const square = `${pageId}-sq`
  const layers = cardLayers(pageId, square, fill)
  return linkedFrames(
    {
      ...design,
      pages: { ...design.pages, [pageId]: { name: pageId, order } },
      frames: {
        ...design.frames,
        [square]: {
          pageId,
          name: 'Square',
          width: 1080,
          height: 1080,
          x: 0,
          y: 0,
          fills: NEW_FRAME_FILLS,
          order: 'a0',
        },
      },
      nodes: {
        ...design.nodes,
        ...Object.fromEntries(Object.entries(layers).map(([id, node]) => [id, { ...node, link: id }])),
      } as DesignInput['nodes'],
    },
    SIZES.slice(1).map(([size, width, height]) => ({ id: `${pageId}-${size}`, name: size, width, height })),
    pageId,
  )
}
/** A design of `cards` pages `c0`, `c1` …, each of five linked frames of `fill` + 2 layers. */
const cards = (count: number, fill: number) =>
  Array.from({ length: count }, (_, i) => i).reduce(
    (design, i) => withCard(design, `c${i}`, `a${String(i).padStart(2, '0')}`, fill),
    { meta: { designId: 'd', name: 'Cards' }, pages: {}, frames: {}, nodes: {} } as DesignInput,
  )

const BOX = { x: 10, y: 20, width: 100, height: 60 }
const graphic = (shape: Record<string, unknown>, more: Record<string, unknown> = {}) =>
  layer('g', 'graphic', { ...BOX, shape, fills: [RED], ...more })

/** The commands of path data, in order, without their numbers. */
const commands = (d: string) => d.replace(/[^A-Za-z]/g, '')

/**
 * The scenes over a session's design, as `drawn` gives it, with no fonts and the brand kit's
 * variables `variables` gives; `arrive` tells them fonts or images arrived.
 */
function scenesOver(
  session: Session,
  drawn: () => Design = () => session.design(),
  variables: () => Variables = () => NO_VARIABLES,
  hiddenShown: () => boolean = () => false,
) {
  const listeners = new Set<(fonts: boolean) => void>()
  const decoded = makeResources(ck, { fonts: [], fallbackFamilies: [], images: {} })
  const resources = {
    resources: () => decoded,
    bytes: () => ({ variables: variables() }),
    alpha: () => undefined,
    onArrive: (listener: (fonts: boolean) => void) => (listeners.add(listener), () => listeners.delete(listener)),
  } as unknown as EditorResources
  const arrive = (fonts: boolean) => {
    for (const listener of listeners) listener(fonts)
  }
  return {
    scenes: frameScenes({ ck, resources, drawn, changes: () => session.changes(), hiddenShown }),
    arrive,
    screen: decoded,
  }
}

describe('frameScenes', () => {
  describe('scene', () => {
    it("answers again without reading the design's layers while the design and the variables are as they were", () => {
      const session = sessionOf(TWO_FRAMES)
      let reads = 0
      const design = new Proxy(session.design(), {
        get: (target, key, receiver) => {
          if (key === 'nodes') reads++
          return Reflect.get(target, key, receiver) as unknown
        },
      })
      const { scenes } = scenesOver(session, () => design)
      const first = scenes.scene(SQ)
      reads = 0
      for (let i = 0; i < 5; i++) expect(scenes.scene(SQ)).toBe(first)
      expect(scenes.outlinePath(SQ, 'oval')).not.toBeNull()
      expect(reads).toBe(0)
    })

    it('keeps the scene when another frame changes, and makes it again when a layer, the variables or the fonts change', () => {
      const session = sessionOf(TWO_FRAMES)
      let variables: Variables = {}
      const { scenes, arrive } = scenesOver(
        session,
        () => session.design(),
        () => variables,
      )
      const first = scenes.scene(SQ)
      session.run('node.update', { ids: ['box'], patch: { x: 120 } })
      expect(scenes.scene(SQ)).toBe(first)
      session.run('node.update', { ids: ['oval'], patch: { x: 120 } })
      const moved = scenes.scene(SQ)
      expect(moved).not.toBe(first)
      expect(scenes.outlinePath(SQ, 'oval')?.box.x).toBe(120)
      arrive(false)
      expect(scenes.scene(SQ)).toBe(moved)
      variables = { accent: '#FF0000FF' }
      const kit = scenes.scene(SQ)
      expect(kit).not.toBe(moved)
      arrive(true)
      expect(scenes.scene(SQ)).not.toBe(kit)
    })

    it('shows a move made inside a batch to a scene asked for there, and after the batch answers at once again', () => {
      const session = sessionOf(TWO_FRAMES)
      const { scenes } = scenesOver(session)
      const first = scenes.scene(SQ)
      let inside: Scene | null = null
      session.batch(() => {
        session.run('node.update', { ids: ['oval'], patch: { x: 120 } })
        inside = scenes.scene(SQ)
      })
      expect(inside).not.toBe(first)
      expect(inside && findLayer((inside as Scene).layers, 'oval')?.props.x).toBe(120)
      const after = scenes.scene(SQ)
      expect(findLayer(after.layers, 'oval')?.props.x).toBe(120)
      expect(scenes.scene(SQ)).toBe(after)
    })
  })

  describe('shownScene', () => {
    it('while hidden layers are shown, draws and hits them faded, and the scene the thumbnails read leaves them out', () => {
      const session = sessionOf({
        ...TWO_FRAMES,
        nodes: {
          ...TWO_FRAMES.nodes,
          faded: {
            type: 'graphic' as const,
            parentId: 'sq',
            link: 'faded',
            index: 'a1',
            name: 'Faded',
            props: { x: 500, y: 500, width: 200, height: 100, visible: false, shape: { kind: 'rect' as const } },
          },
        },
      })
      let shown = false
      const { scenes, screen } = scenesOver(session, undefined, undefined, () => shown)
      const at = { x: 600, y: 550 }
      expect(scenes.pictures([SQ], [SQ], screen).recorded).toBe(1)
      expect(scenes.hit(SQ, at)).toBeNull()
      expect(scenes.shownScene(SQ)).toBe(scenes.scene(SQ))
      shown = true
      expect(scenes.hit(SQ, at)?.id).toBe('faded')
      expect(scenes.under(SQ, at).map(({ layer }) => layer.id)).toEqual(['faded'])
      expect(findLayer(scenes.shownScene(SQ).layers, 'faded')?.props).toMatchObject({ visible: false, opacity: 0.25 })
      expect(findLayer(scenes.scene(SQ).layers, 'faded')).toBeUndefined()
      expect(scenes.pictures([SQ], [SQ], screen).recorded).toBe(1)
      expect(scenes.pictures([SQ], [SQ], screen).recorded).toBe(0)
      // Turned off, the frame's own picture, kept, is drawn again.
      shown = false
      expect(scenes.hit(SQ, at)).toBeNull()
      expect(scenes.pictures([SQ], [SQ], screen).recorded).toBe(0)
    })
  })

  describe('laidOut', () => {
    it('gives the same layers for the same design and frame, built once, and a layer by id that findLayer finds', () => {
      const session = sessionOf(TWO_FRAMES)
      let variables: Variables = {}
      const { scenes } = scenesOver(
        session,
        () => session.design(),
        () => variables,
      )
      const design = session.design()
      const laid = scenes.laidOut('sq', design)
      expect(scenes.laidOut('sq', design)).toBe(laid)
      expect(scenes.laidOutLayer('sq', design, 'oval')).toBe(findLayer(laid, 'oval'))
      expect(scenes.laidOutLayer('sq', design, 'box')).toBeUndefined()
      variables = { accent: '#FF0000FF' }
      expect(scenes.laidOut('sq', design)).not.toBe(laid)
    })

    it('lays the live design out again once it changes, and keeps a design kept apart as it was laid out', () => {
      const session = sessionOf(TWO_FRAMES)
      const { scenes } = scenesOver(session)
      const kept = { ...session.design(), nodes: { ...session.design().nodes } }
      const keptLaid = scenes.laidOut('sq', kept)
      const laid = scenes.laidOut('sq', session.design())
      session.run('node.update', { ids: ['oval'], patch: { x: 120 } })
      const now = scenes.laidOut('sq', session.design())
      expect(now).not.toBe(laid)
      expect(scenes.laidOutLayer('sq', session.design(), 'oval')?.props.x).toBe(120)
      expect(scenes.laidOut('sq', kept)).toBe(keptLaid)
      expect(scenes.laidOutLayer('sq', kept, 'oval')?.props.x).toBe(100)
    })
  })

  describe('pictures', () => {
    it('on five frames of 120 layers each records none on a pan or zoom, one a drag step and one a key typed', () => {
      const session = sessionOf(cards(1, 118))
      expect(Object.keys(session.design().nodes)).toHaveLength(600)
      const { scenes, screen } = scenesOver(session)
      const { frames: all, bounds } = pageFrames(session.design(), 'c0')
      const story = all.find((frame) => frame.id === 'c0-story') as Frame
      const dragged = copyIn('c0-story', 'c0-box')
      let camera = fit(bounds as Rect, VIEWPORT)
      /** A redraw with the camera as it is: the frames in view drawn, and how many were recorded. */
      const redraw = () => {
        const inView = framesInView(all, camera, VIEWPORT)
        const { pictures, recorded } = scenes.pictures(all, inView, screen)
        // The selected box's rounded outline is drawn round it in every redraw.
        scenes.outlinePath(story, dragged)
        return { drawn: pictures.map((p) => p.frame.id), inView: inView.map((f) => f.id), recorded }
      }
      expect(redraw()).toMatchObject({ drawn: all.map((f) => f.id), recorded: 5 })
      expect(scenes.outlinePath(story, dragged)).not.toBeNull()
      const outlines = scenes.outlinePaths()
      for (let i = 0; i < 40; i++) {
        const sign = Math.floor(i / 10) % 2 ? -1 : 1
        camera = { ...camera, x: camera.x + sign * 6, y: camera.y + sign * 3 }
        const pan = redraw()
        expect(pan.inView).toHaveLength(5)
        expect(pan).toEqual({ drawn: pan.inView, inView: pan.inView, recorded: 0 })
      }
      for (let i = 0; i < 20; i++) {
        camera = { ...camera, zoom: camera.zoom * (Math.floor(i / 5) % 2 ? 1 / 1.1 : 1.1) }
        const zoom = redraw()
        expect(zoom).toEqual({ drawn: zoom.inView, inView: zoom.inView, recorded: 0 })
      }
      expect(scenes.outlinePaths()).toBe(outlines)
      const { end } = session.beginGesture()
      for (let i = 1; i <= 10; i++) {
        session.run('node.update', { ids: [dragged], patch: { x: 100 + i * 3, y: 100 + i } })
        const step = redraw()
        expect(step.inView).toContain('c0-story')
        expect(step.recorded).toBe(1)
      }
      end()
      for (let i = 0; i < 10; i++) {
        session.run('text.edit', { id: 'c0-headline', op: { kind: 'insert', at: 0, text: 'a' } })
        expect(redraw().recorded).toBe(1)
      }
    })

    it("on a page of a 20-card carousel fitted to its Story frame draws and records only that page's frames in view", () => {
      const session = sessionOf(cards(20, 10))
      expect(Object.keys(session.design().frames)).toHaveLength(100)
      const { scenes, screen } = scenesOver(session)
      const first = pageFrames(session.design(), 'c0')
      scenes.pictures(first.frames, framesInView(first.frames, fit(first.bounds as Rect, VIEWPORT), VIEWPORT), screen)
      const { frames: all } = pageFrames(session.design(), 'c3')
      expect(all.map((frame) => frame.id)).toEqual(['c3-sq', 'c3-story', 'c3-land', 'c3-mpu', 'c3-leader'])
      let camera: Camera = fit(all[1] as Frame, VIEWPORT)
      const redraw = () => {
        const inView = framesInView(all, camera, VIEWPORT)
        const { pictures, recorded } = scenes.pictures(all, inView, screen)
        return { drawn: pictures.map((p) => p.frame.id), inView: inView.map((f) => f.id), recorded }
      }
      // The Story frame with the Square and the Landscape at its sides; the MPU and the Leaderboard out of view.
      const shown = redraw()
      expect(shown).toEqual({ drawn: ['c3-sq', 'c3-story', 'c3-land'], inView: shown.drawn, recorded: 3 })
      for (let i = 0; i < 20; i++) {
        camera = { ...camera, y: camera.y + (Math.floor(i / 5) % 2 ? -24 : 24) }
        const pan = redraw()
        expect(pan.drawn.length).toBeLessThan(5)
        expect(pan).toEqual({ drawn: pan.inView, inView: pan.inView, recorded: 0 })
      }
      for (let i = 0; i < 5; i++) {
        session.run('text.edit', { id: 'c3-headline', op: { kind: 'insert', at: 0, text: 'a' } })
        const typed = redraw()
        expect(typed.drawn.length).toBeGreaterThan(1)
        expect(typed.recorded).toBe(1)
      }
    })
  })
})

describe('outlinePathOf', () => {
  it('keeps a rectangle for a plain rectangle, a photo, a line, a group, a text and a box without corners', () => {
    expect(pathOf(graphic({ kind: 'rect' }))).toBeNull()
    expect(pathOf(graphic({ kind: 'rect' }, { fills: [{ type: 'image', assetId: 'a' }] }))).toBeNull()
    expect(pathOf(graphic({ kind: 'line' }, { height: 0 }))).toBeNull()
    expect(pathOf(layer('g', 'group', BOX))).toBeNull()
    expect(
      pathOf(
        layer('t', 'text', {
          ...BOX,
          text: 'Hi',
          style: { fontFamily: 'Noto Sans', fontSize: 20, color: '#000000FF' },
        }),
      ),
    ).toBeNull()
    expect(pathOf(layer('b', 'box', BOX))).toBeNull()
  })

  it('follows a rounded rectangle, and a box with corner radii, in the layer box it gives', () => {
    const rounded = pathOf(graphic({ kind: 'rect', cornerRadius: 12 }))
    expect(rounded?.box).toEqual({ x: 10, y: 20, width: 100, height: 60 })
    // Straight sides joined by curves at the corners.
    expect(commands(rounded?.d ?? '')).toMatch(/[CQ]/)
    // The box's corner is cut off.
    expect(rounded?.d).not.toMatch(/(^|[A-Z])10 20(?=[A-Z])/)
    const corners = pathOf(layer('b', 'box', { ...BOX, cornerRadius: [0, 20, 0, 20] }))
    expect(commands(corners?.d ?? '')).toMatch(/[CQ]/)
    expect(pathOf(graphic({ kind: 'rect', corners: [4, 4, 4, 4] }))?.d).toMatch(/[CQ]/)
  })

  it('follows an ellipse, a polygon, a star and a path', () => {
    expect(commands(pathOf(graphic({ kind: 'ellipse' }))?.d ?? '')).toMatch(/^M[CQ]+Z$/)
    expect(commands(pathOf(graphic({ kind: 'polygon' }))?.d ?? '')).toMatch(/^ML+Z$/)
    expect(commands(pathOf(graphic({ kind: 'star' }))?.d ?? '')).toMatch(/^ML+Z$/)
    const path = pathOf(graphic({ kind: 'path', d: 'M0 0 L100 60' }, { fills: [] }))
    expect(path?.d).toBe('M10 20L110 80')
  })

  it("follows a boolean's result", () => {
    const left = layer('l', 'graphic', { x: 0, y: 0, width: 60, height: 60, shape: { kind: 'rect' } })
    const right = layer('r', 'graphic', { x: 40, y: 0, width: 60, height: 60, shape: { kind: 'rect' } })
    const union = layer('u', 'boolean', { x: 0, y: 0, width: 100, height: 60, op: 'union', fills: [RED] }, [
      left,
      right,
    ])
    // The two squares' union: one outline round both, with no line where they overlap.
    const d = pathOf(union)?.d ?? ''
    expect(commands(d)).toBe('MLLLLZ')
    expect(d).toContain('100 60')
    expect(d).not.toContain('40 ')
  })

  it('keeps a rectangle for a layer with no width or height', () => {
    expect(pathOf(graphic({ kind: 'ellipse' }, { width: 0 }))).toBeNull()
  })
})
