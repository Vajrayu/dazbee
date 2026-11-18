import { describe, expect, it } from 'vitest'

import type { DesignInput } from '@dazbee/schema'

import { testEditor } from '../test-editor.ts'
import { runAs } from '../test-platform.ts'
import type { MoveDrag } from './select/move-drag.ts'
import { keyInput } from './test-inputs.ts'
import { event, harness, SQUARE, UNDER } from './test-pointer.ts'

describe('editorPointer', () => {
  describe('gesture', () => {
    it('on a Mac takes a press with Ctrl as the right-click, starting no press', () => {
      runAs(true)
      const { pointer, send, log } = harness()
      send('pointerdown', event(10, 10, { ctrlKey: true }))
      expect(pointer.gesture()).toBeNull()
      expect(log).toEqual([])
      send('pointerdown', event(10, 10, { metaKey: true }))
      expect(log).toEqual(['press 10 10', 'shown changed'])
    })

    it('on a Mac starts no pan from a press with Ctrl with the hand tool', () => {
      runAs(true)
      const { pointer, send, log, cursor } = harness('hand')
      send('pointerdown', event(10, 10, { ctrlKey: true }))
      send('pointermove', event(40, 30, { ctrlKey: true }))
      expect(cursor()).not.toBe('grabbing')
      expect(pointer.gesture()).toBeNull()
      expect(log.filter((line) => line.startsWith('camera'))).toEqual([])
    })

    it('off a Mac pans from a press with Ctrl with the hand tool', () => {
      runAs(false)
      const { send, log, cursor } = harness('hand')
      send('pointerdown', event(10, 10, { ctrlKey: true }))
      expect(cursor()).toBe('grabbing')
      send('pointermove', event(40, 30, { ctrlKey: true }))
      expect(log.filter((line) => line.startsWith('camera'))).toEqual(['camera 30 20'])
    })

    it('holds the pointer from a press in the text being typed in, which starts selecting a range', () => {
      const { pointer, send, holds } = harness('select', UNDER, false, 'words')
      send('pointerdown', event(10, 10))
      expect(pointer.gesture()).toMatchObject({ kind: 'textSelect' })
      expect(holds()).toBe(1)
    })

    it('holds the pointer from a press that pans, the middle button or the main one with the hand tool, and not from the right button', () => {
      const select = harness()
      select.send('pointerdown', event(10, 10, { button: 2 }))
      expect(select.holds()).toBe(0)
      select.send('pointerdown', event(10, 10, { button: 1 }))
      expect(select.holds()).toBe(1)
      const hand = harness('hand')
      hand.send('pointerdown', event(10, 10))
      expect(hand.holds()).toBe(1)
    })

    it("answers that a press that pans and a turn of the wheel were the editor's alone, and no other input", () => {
      const { send } = harness()
      expect(send('pointerdown', event(10, 10, { button: 1 })).handled).toBe(true)
      expect(send('pointerup').handled).toBe(false)
      expect(send('wheel', event(10, 10, { deltaY: 4 })).handled).toBe(true)
      expect(send('pointerdown', event(10, 10)).handled).toBe(false)
      expect(send('pointermove', event(40, 10)).handled).toBe(false)
      expect(send('pointerdown', event(10, 10, { button: 2 })).handled).toBe(false)
      expect(send('click').handled).toBe(false)
      expect(send('dblclick', event(600, 600)).handled).toBe(false)
    })

    it('answers to hold the pointer for the press that asked, and for no input after it', () => {
      const { send } = harness('select', UNDER, false, 'words')
      expect(send('pointermove', event(10, 10)).hold).toBe(false)
      expect(send('pointerdown', event(10, 10)).hold).toBe(true)
      expect(send('pointermove', event(12, 10)).hold).toBe(false)
      expect(send('pointerup').hold).toBe(false)
    })

    it('keeps the drag held when another press starts none', () => {
      const { pointer, send, log, pressed } = harness()
      send('pointerdown', event(10, 10))
      send('pointerdown', event(600, 10))
      expect(pointer.gesture()).toBe(pressed())
      send('pointerup')
      expect(log).toEqual([
        'press 10 10',
        'shown changed',
        'press 600 10',
        'release move',
        'redraw',
        'release press',
        'shown changed',
      ])
    })

    it("holds the select tool's drag from its press until the pointer goes up, then draws the canvas again", () => {
      const { pointer, send, log, pressed } = harness()
      send('pointerdown', event(10, 10))
      expect(pointer.gesture()).toBe(pressed())
      send('pointermove', event(12, 10))
      send('pointermove', event(30, 12))
      send('pointerup')
      expect(pointer.gesture()).toBeNull()
      expect(log).toEqual([
        'press 10 10',
        'shown changed',
        'drag 30 12 snapped',
        'release move',
        'redraw',
        'release press after a drag',
        'shown changed',
      ])
    })

    it('turns snapping off while the deep key is held mid-drag, ⌘ on a Mac and not Ctrl there', () => {
      runAs(false)
      const { send, log } = harness()
      send('pointerdown', event(10, 10))
      send('pointermove', event(30, 12, { ctrlKey: true }))
      runAs(true)
      send('pointermove', event(31, 12, { ctrlKey: true }))
      send('pointermove', event(32, 12, { metaKey: true }))
      expect(log.filter((line) => line.startsWith('drag'))).toEqual(['drag 30 12', 'drag 31 12 snapped', 'drag 32 12'])
    })

    it('sends the press of a drawing tool to what draws with it', () => {
      const { pointer, send, log } = harness('pen')
      send('pointerdown', event(40, 50))
      expect(log).toEqual(['pen down 40 50'])
      const text = harness('text')
      text.send('pointerdown', event(40, 50))
      expect(text.pointer.gesture()).toEqual({ kind: 'textBox' })
      expect(pointer.gesture()).toBeNull()
    })

    it('sends a press with an image armed on a frame to placing it, and one off every frame puts the select tool back, placing nothing', () => {
      const on = harness('image')
      on.send('pointerdown', event(40, 50))
      expect(on.pointer.gesture()).toEqual({ kind: 'imageBox' })
      const off = harness('image')
      off.send('pointerdown', event(1300, 50))
      expect(off.pointer.gesture()).toBeNull()
      expect(off.log).toEqual(['tool select'])
    })

    it('sends a press of the Frame tool anywhere on the stage to drawing a frame, the drag in world units', () => {
      const { pointer, send, log, cursor } = harness('frame')
      send('wheel', event(0, 0, { deltaX: -100, deltaY: -50 }))
      pointer.showCursor()
      expect(cursor()).toBe('crosshair')
      send('pointerdown', event(1300, 70))
      expect(pointer.gesture()).toMatchObject({ kind: 'frameDraw' })
      send('pointermove', event(1500, 250))
      send('pointerup')
      expect(pointer.gesture()).toBeNull()
      expect(log).toEqual(['camera 100 50', 'frame from 1200 20', 'frame to 1400 200', 'frame drawn', 'shown changed'])
    })
  })

  describe('the click slop', () => {
    /** Every drag that waits for the slop, by what the pointer logs of its moves. */
    const WAITING = [
      ['move', 'drag'],
      ['resize', 'drag'],
      ['rotate', 'drag'],
      ['end', 'drag'],
      ['reorder', 'reorder to'],
      ['crop', 'crop to'],
      ['path', 'points to'],
      ['draw', 'draw to'],
      ['textBox', 'textBox to'],
      ['imageBox', 'imageBox to'],
      ['frameDraw', 'frame to'],
      ['frameMove', 'move frame to'],
    ] as const
    /** How far a press wanders and is still a click, and how far it goes and is a drag, by mouse, pen and finger. */
    const WANDERS = [
      ['mouse', 2, 4],
      ['pen', 2, 4],
      ['touch', 7, 9],
    ] as const

    it('hands a move to a drag that waits only once the press has gone past the slop, and tells its release', () => {
      for (const [kind, logged] of WAITING)
        for (const [pointerType, within, past] of WANDERS) {
          const { send, log, pressAs } = harness()
          pressAs(kind)
          send('pointerdown', event(50, 50, { pointerType }))
          send('pointermove', event(50 + within, 50, { pointerType }))
          expect(
            log.filter((line) => line.startsWith(logged)),
            `${kind} by ${pointerType}`,
          ).toEqual([])
          send('pointermove', event(50 + past, 50, { pointerType }))
          expect(
            log.filter((line) => line.startsWith(logged)),
            `${kind} by ${pointerType}`,
          ).toHaveLength(1)
        }
    })

    it('keeps a drag going once the pointer comes back inside the slop', () => {
      const { send, log } = harness()
      send('pointerdown', event(50, 50))
      send('pointermove', event(60, 50))
      send('pointermove', event(51, 50))
      expect(log.filter((line) => line.startsWith('drag'))).toEqual(['drag 60 50 snapped', 'drag 51 50 snapped'])
    })

    it('tells the select press whether the press was a click', () => {
      const clicked = harness()
      clicked.send('pointerdown', event(50, 50))
      clicked.send('pointermove', event(52, 50))
      clicked.send('pointerup')
      expect(clicked.log).toContain('release press')
      const dragged = harness()
      dragged.send('pointerdown', event(50, 50))
      dragged.send('pointermove', event(54, 50))
      dragged.send('pointermove', event(50, 50))
      dragged.send('pointerup')
      expect(dragged.log).toContain('release press after a drag')
    })

    it('starts a marquee and a text selection at once, a pixel from the press', () => {
      const marquee = harness()
      marquee.pressAs('marquee')
      marquee.send('pointerdown', event(50, 50))
      marquee.send('pointermove', event(51, 50))
      expect(marquee.log).toContain('marquee to 51 50')
      marquee.send('pointerup')
      expect(marquee.log).toContain('release press marquee')
      const text = harness('select', UNDER, false, 'words')
      text.send('pointerdown', event(50, 50))
      text.send('pointermove', event(51, 50))
      expect(text.log).toContain('select text to the pointer')
    })
  })

  describe("a frame's label", () => {
    it('picks and moves the frame from a press on it, the drag in world units, until the pointer goes up', () => {
      const { pointer, send, log } = harness()
      send('pointerdown', event(20, -10))
      expect(pointer.gesture()).toMatchObject({ kind: 'frameMove', frame: SQUARE })
      send('pointermove', event(70, -20, { shiftKey: true }))
      send('pointerup')
      expect(pointer.gesture()).toBeNull()
      expect(log).toEqual([
        'press label of one-sq at 20 -10',
        'shown changed',
        'move frame to 70 -20 along one axis',
        'release frame move',
        'release press after a drag',
        'shown changed',
      ])
    })

    it('takes a press on its size too, and leaves one on its row beside its text to what is under it, so a marquee can start there', () => {
      const { pointer, send, log } = harness()
      send('pointerdown', event(1040, -10))
      expect(pointer.gesture()).toMatchObject({ kind: 'frameMove', frame: SQUARE })
      send('pointerup')
      log.length = 0
      send('pointerdown', event(600, -10))
      send('dblclick', event(600, -10))
      expect(log).toEqual(['press 600 -10'])
    })

    it("leaves a press on the selection's handles to the selection where the label is over them, telling it the label's frame", () => {
      const { selection, send, log } = harness('select', UNDER, true)
      selection.select(['under'], SQUARE.id)
      send('pointerdown', event(20, -10))
      expect(log).toEqual(['press 20 -10 over the label of one-sq', 'shown changed'])
    })

    it('is left to the drawing tools, which draw nothing off a frame', () => {
      const { pointer, send, log } = harness('text')
      send('pointerdown', event(20, -10))
      expect(pointer.gesture()).toBeNull()
      expect(log).toEqual([])
    })
  })

  describe('pointerAt and rehover', () => {
    it('keeps where the pointer is over the stage and outlines what a press there would pick', () => {
      const { pointer, selection, send, log } = harness()
      expect(pointer.pointerAt()).toBeNull()
      send('pointermove', event(5, 6))
      expect(pointer.pointerAt()).toEqual({ x: 5, y: 6 })
      expect(selection.hovered()).toEqual({ id: 'under picked', frameId: 'one-sq' })
      expect(log).toEqual(['shown changed'])
      expect(pointer.rehover()).toBe(false)
      send('pointerleave')
      expect(pointer.pointerAt()).toBeNull()
      expect(selection.hovered()).toBeNull()
    })

    it('outlines the deepest layer under the pointer while Ctrl is held, as a press then picks it', () => {
      runAs(false)
      const { pointer, selection, send, log } = harness()
      send('pointermove', event(5, 6, { ctrlKey: true }))
      expect(selection.hovered()).toEqual({ id: 'deep', frameId: 'one-sq' })
      send('pointermove', event(5, 7))
      expect(selection.hovered()).toEqual({ id: 'under picked', frameId: 'one-sq' })
      // Ctrl pressed and let go with the pointer at rest: the next redraw outlines it, with the design
      // as a key such as Ctrl+Z has left it.
      log.length = 0
      pointer.keyDown(keyInput('ControlLeft', { ctrlKey: true }))
      expect(log).toEqual(['redraw'])
      expect(selection.hovered()).toEqual({ id: 'under picked', frameId: 'one-sq' })
      pointer.rehover()
      expect(selection.hovered()).toEqual({ id: 'deep', frameId: 'one-sq' })
      pointer.keyUp(keyInput('ControlLeft', { ctrlKey: false }))
      pointer.rehover()
      expect(selection.hovered()).toEqual({ id: 'under picked', frameId: 'one-sq' })
      pointer.keyDown(keyInput('ControlLeft', { ctrlKey: true }))
      pointer.blur()
      pointer.rehover()
      expect(selection.hovered()).toEqual({ id: 'under picked', frameId: 'one-sq' })
    })

    it('on a Mac outlines the deepest layer while ⌘ is held, and not while Ctrl is', () => {
      runAs(true)
      const { pointer, selection, send } = harness()
      send('pointermove', event(5, 6, { ctrlKey: true }))
      expect(selection.hovered()).toEqual({ id: 'under picked', frameId: 'one-sq' })
      send('pointermove', event(5, 6, { metaKey: true }))
      expect(selection.hovered()).toEqual({ id: 'deep', frameId: 'one-sq' })
      pointer.keyUp(keyInput('MetaLeft', { metaKey: false }))
      pointer.keyDown(keyInput('ControlLeft', { ctrlKey: true }))
      pointer.rehover()
      expect(selection.hovered()).toEqual({ id: 'under picked', frameId: 'one-sq' })
    })

    it('outlines what is under the pointer as a drag ends, with no move after it', () => {
      const { selection, send } = harness()
      send('pointermove', event(200, 200))
      send('pointerdown', event(200, 200))
      send('pointermove', event(50, 50))
      expect(selection.hovered()).toBeNull()
      send('pointerup', event(50, 50))
      expect(selection.hovered()).toEqual({ id: 'under picked', frameId: 'one-sq' })
    })

    it('outlines the text being typed in where a press puts the caret in it, below its lines too', () => {
      const { selection, send } = harness('select', UNDER, false, 'words')
      send('pointermove', event(5, 90))
      expect(selection.hovered()).toEqual({ id: 'words picked', frameId: 'one-sq' })
    })
  })

  describe('onCursor', () => {
    /** A square frame holding a 600 × 300 box, the same turned a quarter, an 8 × 8 one and a 400 long line turned 45°. */
    const ZONES: DesignInput = {
      meta: { designId: 'd', name: 'D' },
      pages: { p1: { name: 'One', order: 'a0' } },
      frames: { sq: { pageId: 'p1', name: 'Square', width: 1080, height: 1080, x: 0, y: 0, order: 'a0' } },
      nodes: {
        wide: shape('a0', { x: 100, y: 100, width: 600, height: 300 }),
        turned: shape('a1', { x: 100, y: 500, width: 600, height: 300, rotation: 90 }),
        small: shape('a2', { x: 900, y: 100, width: 8, height: 8 }),
        line: shape('a3', { x: 100, y: 800, width: 400, height: 0, rotation: 45, shape: { kind: 'line' } }),
      },
    }
    function shape(
      index: string,
      props: { x: number; y: number; width: number; height: number; rotation?: number; shape?: { kind: 'line' } },
    ) {
      return {
        type: 'graphic' as const,
        parentId: 'sq',
        link: index,
        index,
        name: index,
        props: { shape: { kind: 'rect' as const }, ...props },
      }
    }

    it("tells the cursor of the zone under the pointer: an edge's and a corner's resize, the turning arrow facing the corner, a line's end, and none over the middle", async () => {
      const editor = await testEditor(ZONES)
      const { core, mouse } = editor
      const told: string[] = []
      core.input.onCursor((cursor) => told.push(cursor))
      /** The cursor shown with the pointer `dx`, `dy` screen pixels from a design point of the square. */
      const over = (x: number, y: number, dx = 0, dy = 0) => {
        const at = core.stagePoint(x, y, 'sq')
        mouse.move(at.x + dx, at.y + dy)
        const cursor = core.input.cursor()
        return cursor.startsWith('url(') ? /rotate\(\d+ 12 12\)/.exec(decodeURIComponent(cursor))?.[0] : cursor
      }
      core.select(['wide'])
      expect(over(250, 100, 0, -3)).toBe('ns-resize')
      expect(over(400, 250)).toBe('')
      expect(over(700, 250, 3)).toBe('ew-resize')
      expect(over(100, 100, -9, -9)).toBe('rotate(207 12 12)')
      expect(over(700, 400, 9, 9)).toBe('rotate(27 12 12)')
      expect(over(700, 400, 3, 3)).toBe('nwse-resize')
      expect(told.at(-1)).toBe('nwse-resize')
      // Turned a quarter, its top edge, now on the east, resizes across.
      core.select(['turned'])
      expect(over(550, 650, 3)).toBe('ew-resize')
      // Under 16 px on screen, with no handles drawn, just outside its corner.
      core.select(['small'])
      expect(over(908, 108, 3, 3)).toBe('nwse-resize')
      // A line's end, along the line, then its middle.
      core.select(['line'])
      expect(over(300 + 200 * Math.SQRT1_2, 800 + 200 * Math.SQRT1_2, 1, 1)).toBe('nwse-resize')
      expect(over(300, 800)).toBe('')
      editor.end()
    })
  })

  describe('the pointer seen', () => {
    it('tells the transform drag the type of each pointer it routes a press or a move of, and what is shown changed when its dots do', () => {
      const { send, log, seen } = harness()
      send('pointerdown', event(2001, 2000, { pointerType: 'touch' }))
      expect([seen().at(-1), log.at(-1)]).toEqual(['touch', 'shown changed'])
      send('pointerup', event(2001, 2000, { pointerType: 'touch' }))
      send('click', event(2001, 2000, { pointerType: 'touch' }))
      expect(seen()).toEqual(['mouse', 'touch'])
      log.length = 0
      send('pointermove', event(2002, 2000))
      expect([seen().at(-1), log]).toEqual(['mouse', ['shown changed']])
      log.length = 0
      send('pointermove', event(2003, 2000))
      send('pointerleave', event(2003, 2000, { pointerType: 'pen' }))
      expect([seen(), log]).toEqual([['mouse', 'touch', 'mouse', 'mouse'], []])
    })
  })

  describe('endDrag', () => {
    it('ends the drag on the stage as a pointerup does', () => {
      const { pointer, send, log } = harness()
      send('pointerdown', event(10, 10))
      pointer.endDrag()
      expect(pointer.gesture()).toBeNull()
      expect(log.slice(2)).toEqual(['release move', 'redraw', 'release press', 'shown changed'])
    })

    it('drops nothing into a flow when the browser takes the drag away', () => {
      for (const [type, released] of [
        ['pointerup', 'release move into a flow'],
        ['pointercancel', 'release move'],
      ] as const) {
        const { pointer, send, log } = harness()
        send('pointerdown', event(10, 10))
        const drag = pointer.gesture() as MoveDrag
        drag.drop = { boxId: 'row', around: [], slot: 0, near: null }
        send(type)
        expect(log).toContain(released)
      }
    })

    it('takes back what a drag in a flow wrote before its release when the browser takes it away, and only then', () => {
      for (const [type, logged] of [
        ['pointerup', ['release reorder']],
        ['pointercancel', ['cancel reorder', 'release reorder']],
        ['lostpointercapture', ['cancel reorder', 'release reorder']],
      ] as const) {
        const { send, log, pressAs } = harness()
        pressAs('reorder')
        send('pointerdown', event(50, 50))
        send('pointermove', event(80, 50))
        send(type)
        expect(
          log.filter((line) => line === 'cancel reorder' || line === 'release reorder'),
          type,
        ).toEqual(logged)
      }
    })

    it('moves nothing onto another frame when the browser takes the drag away', () => {
      for (const [type, released] of [
        ['pointerup', 'release move onto a frame'],
        ['pointercancel', 'release move'],
      ] as const) {
        const { pointer, send, log } = harness()
        send('pointerdown', event(10, 10))
        const drag = pointer.gesture() as MoveDrag
        drag.target = { id: 'other', pageId: 'p1', name: 'Other', x: 2000, y: 0, width: 100, height: 100 }
        send(type)
        expect(log).toContain(released)
      }
    })

    it('cancels a press whose pointer capture goes, and nothing once the press has ended', () => {
      const { send, log } = harness()
      send('pointerdown', event(10, 10))
      send('lostpointercapture')
      expect(log.slice(2)).toEqual(['cancel press', 'release move', 'redraw', 'release press', 'shown changed'])
      log.length = 0
      send('lostpointercapture')
      expect(log).toEqual([])
    })
  })

  describe('layersAt', () => {
    it('lists the layers that show under a client point, front-most first with their depth, in its frame', () => {
      const { pointer } = harness()
      expect(pointer.layersAt({ x: 5, y: 5 })).toEqual([
        { id: 'group', frameId: 'one-sq', depth: 0 },
        { id: 'under', frameId: 'one-sq', depth: 1 },
      ])
      expect(pointer.layersAt({ x: 500, y: 5 })).toEqual([])
      // Off every frame, as between two frames.
      expect(pointer.layersAt({ x: 1200, y: 5 })).toEqual([])
    })
  })

  describe('selectAt', () => {
    it('selects what a press under a client point picks, keeping a selection it is in', () => {
      const { pointer, selection } = harness()
      expect(pointer.selectAt({ x: 5, y: 5 })).toEqual(['under picked'])
      selection.select(['under picked', 'other'], 'one-sq')
      expect(pointer.selectAt({ x: 5, y: 5 })).toEqual(['under picked', 'other'])
    })
  })

  describe('wheel', () => {
    it('pans with a scroll, sideways with Shift, and zooms about the pointer with Ctrl', () => {
      const { send, log } = harness()
      send('wheel', event(100, 200, { deltaX: 3, deltaY: 4 }))
      send('wheel', event(100, 200, { deltaY: 10, shiftKey: true }))
      send('wheel', event(100, 200, { deltaY: -10, ctrlKey: true }))
      expect(log).toEqual(['camera -3 -4', 'camera -13 -4', `zoom ${Math.exp(0.1).toFixed(3)} at 100 200`])
    })
  })
})
