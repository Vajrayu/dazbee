import { afterEach, describe, expect, it } from 'vitest'

import type { DesignInput, Point } from '@dazbee/schema'

import { toScreen } from '../../canvas/camera.ts'
import { type Handle, handleAt, HANDLES } from '../../layers/transform.ts'
import { type DragOptions, type TestEditor, testEditor, type TestEditorOptions } from '../../test-editor.ts'
import { isFrameGesture } from './frame-resize.ts'

/** A rect under the frame at x, y, width and height, set to the constraints given. */
const rect = (
  index: string,
  [x, y, width, height]: [number, number, number, number],
  more: Record<string, unknown> = {},
) => ({
  type: 'graphic' as const,
  parentId: 'F',
  link: index,
  index,
  name: index,
  props: { x, y, width, height, shape: { kind: 'rect' as const }, ...more },
})
/** A frame 400 × 300 at the page's origin, with a guide at x 100, holding a layer set to each constraint. */
const DESIGN: DesignInput = {
  meta: { designId: 'd', name: 'D' },
  pages: { p1: { name: 'One', order: 'a0' } },
  frames: {
    F: { pageId: 'p1', name: 'F', width: 400, height: 300, x: 0, y: 0, order: 'a0', guides: [{ axis: 'x', at: 100 }] },
  },
  nodes: {
    leftTop: rect('a0', [10, 10, 40, 40]),
    right: rect('a1', [340, 10, 50, 50], { constraints: { horizontal: 'right', vertical: 'top' } }),
    stretch: rect('a2', [20, 100, 360, 20], { constraints: { horizontal: 'leftRight', vertical: 'top' } }),
    middle: rect('a3', [180, 130, 40, 40], { constraints: { horizontal: 'center', vertical: 'center' } }),
    pinned: { ...rect('a4', [200, 250, 20, 20]), lock: { move: true } },
    words: {
      type: 'text',
      parentId: 'F',
      link: 'a5',
      index: 'a5',
      name: 'Words',
      props: {
        x: 20,
        y: 200,
        width: 360,
        height: 40,
        boxMode: 'autoHeight',
        text: 'Summer sale on every hat and every scarf',
        style: { fontFamily: 'Noto Sans', fontSize: 24, color: '#000000FF' },
        constraints: { horizontal: 'leftRight', vertical: 'top' },
      },
    },
  },
}
/** Where the frame's top left is on the stage: the camera at zoom 1 puts the page's origin there. */
const ORIGIN = { x: 100, y: 100 }

let opened: TestEditor | null = null
afterEach(() => {
  opened?.end()
  opened = null
})

/** The test editor on a design at zoom 1, the frame picked unless told not to, with what the tests ask of it. */
async function editorOn(
  design: DesignInput = DESIGN,
  { pick = true, ...options }: TestEditorOptions & { pick?: boolean } = {},
) {
  const editor = await testEditor(design, options)
  opened = editor
  editor.core.setCamera({ ...ORIGIN, zoom: 1 })
  if (pick) editor.core.pickFrame('F')
  editor.core.redraw()
  const { session } = editor.core
  const frame = () => {
    const { x, y, width, height } = session.design().frames.F ?? { x: 0, y: 0, width: 0, height: 0 }
    return { x, y, width, height }
  }
  const props = (id: string) => {
    const { x, y, width, height } = session.design().nodes[id]?.props ?? { x: 0, y: 0, width: 0, height: 0 }
    return { x, y, width, height }
  }
  /** Where a handle of the frame is on the stage now. */
  const handlePoint = (handle: Handle): Point => {
    const f = frame()
    const at = handleAt(handle)
    return toScreen(editor.core.camera(), { x: f.x + at.x * f.width, y: f.y + at.y * f.height })
  }
  /** Drags a handle of the frame by `by` stage pixels, the keys named held for the whole drag. */
  const dragHandle = (handle: Handle, by: Point, options: DragOptions = {}) => {
    const from = handlePoint(handle)
    editor.mouse.drag(from, { x: from.x + by.x, y: from.y + by.y }, options)
  }
  /** Presses a handle and moves it by each of `steps` in turn, without letting go. */
  const holdHandle = (handle: Handle, ...steps: Point[]) => {
    const from = handlePoint(handle)
    editor.mouse.move(from.x, from.y)
    editor.mouse.down()
    for (const by of steps) editor.mouse.move(from.x + by.x, from.y + by.y)
  }
  /** Undoes the last step and redraws, as the stage does after a change. */
  const undo = () => {
    session.undo()
    editor.core.redraw()
  }
  return { editor, session, frame, props, handlePoint, dragHandle, holdHandle, undo }
}

describe('editorFrameResize', () => {
  describe('handled', () => {
    it('is the picked frame, to a tab that may edit with nothing selected', async () => {
      const { editor } = await editorOn()
      expect(editor.modules.frameResize.handled()?.id).toBe('F')
    })

    it('is none for a frame not picked, while layers are selected, or to a tab that may only view', async () => {
      const unpicked = await editorOn(DESIGN, { pick: false })
      expect(unpicked.editor.modules.frameResize.handled()).toBeNull()
      unpicked.editor.end()
      const selected = await editorOn()
      selected.editor.core.select(['leftTop'])
      expect(selected.editor.modules.frameResize.handled()).toBeNull()
      selected.editor.end()
      const viewing = await editorOn(DESIGN, { access: { readOnly: () => true, onChange: () => () => {} } })
      expect(viewing.editor.modules.frameResize.handled()).toBeNull()
    })

    it('leaves the frame as it is when its edge is dragged without handles', async () => {
      const viewing = await editorOn(DESIGN, { access: { readOnly: () => true, onChange: () => () => {} } })
      viewing.dragHandle('e', { x: 60, y: 0 })
      expect(viewing.frame()).toEqual({ x: 0, y: 0, width: 400, height: 300 })
    })
  })

  describe('handleUnder', () => {
    it('grabs the frame’s corners and edges at a stage point, none where it shows no handles', async () => {
      const { editor, handlePoint } = await editorOn()
      for (const handle of HANDLES)
        expect(editor.modules.frameResize.handleUnder(handlePoint(handle))).toMatchObject({ kind: 'resize', handle })
      expect(editor.modules.frameResize.handleUnder({ x: 300, y: 250 })).toBeNull()
      editor.core.pickFrame(null)
      expect(editor.modules.frameResize.handleUnder(handlePoint('e'))).toBeNull()
    })

    it('shows the resize cursor over a handle', async () => {
      const { editor, handlePoint } = await editorOn()
      const east = handlePoint('e')
      editor.mouse.move(east.x, east.y)
      expect(editor.modules.pointer.cursor()).toBe('ew-resize')
      const corner = handlePoint('se')
      editor.mouse.move(corner.x, corner.y)
      expect(editor.modules.pointer.cursor()).toBe('nwse-resize')
    })
  })

  describe('press', () => {
    it('wins over the frame’s label inside a handle’s reach, by a mouse and by a finger, and elsewhere on it moves the frame', async () => {
      const { editor, frame, undo } = await editorOn()
      // The label's row is 76 to 96 down the stage; the frame's top left corner is at 100, 100.
      editor.mouse.drag({ x: 102, y: 94 }, { x: 72, y: 74 })
      expect(frame()).toEqual({ x: -30, y: -20, width: 430, height: 320 })
      undo()
      editor.mouse.drag({ x: 300, y: 95 }, { x: 300, y: 75 })
      expect(frame()).toEqual({ x: 0, y: -20, width: 400, height: 320 })
      undo()
      editor.mouse.drag({ x: 300, y: 85 }, { x: 340, y: 85 })
      expect(frame()).toEqual({ x: 40, y: 0, width: 400, height: 300 })
      undo()
      // 18 px from the corner: past a mouse's reach, within a finger's.
      const finger = (type: 'pointerdown' | 'pointermove' | 'pointerup', at: Point) => {
        editor.core.input.pointer({
          type,
          at,
          button: 0,
          detail: 0,
          shiftKey: false,
          altKey: false,
          ctrlKey: false,
          metaKey: false,
          pointerType: 'touch',
          ...(type === 'pointerdown' ? { label: 'F' } : {}),
        })
        editor.core.redraw()
      }
      finger('pointerdown', { x: 110, y: 85 })
      finger('pointermove', { x: 90, y: 75 })
      finger('pointermove', { x: 80, y: 65 })
      finger('pointerup', { x: 80, y: 65 })
      expect(frame()).toEqual({ x: -30, y: -20, width: 430, height: 320 })
    })
    it('wins over a guide under it, and a click on it keeps the frame picked, writing nothing', async () => {
      const { editor, session, frame } = await editorOn()
      editor.press('toggleRulers')
      // The guide at x 100 runs down the frame at 200 across the stage, over its top edge.
      editor.mouse.drag({ x: 200, y: 102 }, { x: 200, y: 82 })
      expect(frame()).toEqual({ x: 0, y: -20, width: 400, height: 320 })
      expect(session.design().frames.F?.guides).toEqual([{ axis: 'x', at: 100 }])
      session.undo()
      editor.core.redraw()
      editor.mouse.click(500, 250)
      expect(editor.core.pickedFrame()).toBe('F')
      expect(session.canUndo()).toBe(false)
    })
  })

  describe('drag', () => {
    it('ends each of the eight handles at the size and place it was let go at, in whole pixels, the side across staying', async () => {
      const ends: Record<Handle, { x: number; y: number; width: number; height: number }> = {
        e: { x: 0, y: 0, width: 440, height: 300 },
        w: { x: 40, y: 0, width: 360, height: 300 },
        s: { x: 0, y: 0, width: 400, height: 320 },
        n: { x: 0, y: 20, width: 400, height: 280 },
        se: { x: 0, y: 0, width: 440, height: 320 },
        sw: { x: 40, y: 0, width: 360, height: 320 },
        ne: { x: 0, y: 20, width: 440, height: 280 },
        nw: { x: 40, y: 20, width: 360, height: 280 },
      }
      const { frame, dragHandle, undo } = await editorOn()
      for (const handle of HANDLES) {
        dragHandle(handle, { x: 40.4, y: 20.4 })
        expect([handle, frame()]).toEqual([handle, ends[handle]])
        undo()
      }
    })

    it('has the handle follow the pointer from where it was grabbed', async () => {
      const { editor, frame, handlePoint } = await editorOn()
      const east = handlePoint('e')
      editor.mouse.drag({ x: east.x - 3, y: east.y + 2 }, { x: east.x + 27, y: east.y + 2 })
      expect(frame()).toEqual({ x: 0, y: 0, width: 430, height: 300 })
    })

    it('keeps a whole width on a frame at a fractional place', async () => {
      const at = { ...DESIGN, frames: { F: { ...DESIGN.frames.F, x: 10.5 } } } as DesignInput
      const { frame, dragHandle } = await editorOn(at)
      dragHandle('e', { x: 40.4, y: 0 })
      expect(frame()).toEqual({ x: 10.5, y: 0, width: 440, height: 300 })
      dragHandle('w', { x: 20.2, y: 0 })
      expect(frame()).toEqual({ x: 30.5, y: 0, width: 420, height: 300 })
    })

    it('has each layer follow its constraints from the right edge, never writing one that keeps to the left and top', async () => {
      const { session, props, dragHandle } = await editorOn()
      const leftTop = session.design().nodes.leftTop
      dragHandle('e', { x: 40, y: 0 })
      expect(props('right')).toEqual({ x: 380, y: 10, width: 50, height: 50 })
      expect(props('stretch')).toEqual({ x: 20, y: 100, width: 400, height: 20 })
      expect(props('middle')).toEqual({ x: 200, y: 130, width: 40, height: 40 })
      expect(session.design().nodes.leftTop).toBe(leftTop)
    })

    it('keeps a layer set to the left at its distance from the left edge as that edge is dragged, so it moves on the page', async () => {
      const { frame, props, dragHandle } = await editorOn()
      dragHandle('w', { x: 40, y: 0 })
      expect(frame()).toEqual({ x: 40, y: 0, width: 360, height: 300 })
      expect(props('leftTop')).toEqual({ x: 10, y: 10, width: 40, height: 40 })
      expect(props('right')).toEqual({ x: 300, y: 10, width: 50, height: 50 })
      expect(props('stretch')).toEqual({ x: 20, y: 100, width: 320, height: 20 })
      expect(props('middle')).toEqual({ x: 160, y: 130, width: 40, height: 40 })
    })

    it('writes back a layer it changed when the drag puts it back, and leaves the guides from the frame’s top left', async () => {
      const { session, frame, props, holdHandle, editor } = await editorOn()
      holdHandle('e', { x: 20, y: 0 }, { x: 40, y: 0 }, { x: 0, y: 0 })
      editor.mouse.up()
      expect(frame()).toEqual({ x: 0, y: 0, width: 400, height: 300 })
      expect(props('right')).toEqual({ x: 340, y: 10, width: 50, height: 50 })
      expect(session.design().frames.F?.guides).toEqual([{ axis: 'x', at: 100 }])
    })

    it('with the deep key held leaves every layer where it was on the page, from any handle, a layer locked in place in the frame, the guides with them', async () => {
      for (const handle of HANDLES) {
        const { session, frame, props, dragHandle, editor } = await editorOn()
        const ids = ['leftTop', 'right', 'stretch', 'middle', 'words']
        // Where each layer is on the page, its size with it.
        const page = (id: string) => ({ ...props(id), x: props(id).x + frame().x, y: props(id).y + frame().y })
        const before = ids.map(page)
        dragHandle(handle, { x: 40, y: 20 }, { ctrl: true })
        expect([handle, ids.map(page)]).toEqual([handle, before])
        expect(props('pinned')).toEqual({ x: 200, y: 250, width: 20, height: 20 })
        expect(session.design().frames.F?.guides).toEqual([{ axis: 'x', at: 100 - frame().x }])
        editor.end()
      }
    })

    it('switches to the deep key, and back, on the next move after it is pressed or let go', async () => {
      const { frame, props, holdHandle, editor } = await editorOn()
      holdHandle('w', { x: 20, y: 0 })
      expect(props('leftTop').x).toBe(10)
      editor.keys.down('Control')
      expect(props('leftTop').x).toBe(10)
      editor.mouse.move(140, 250)
      expect(frame().x).toBe(40)
      expect(props('leftTop').x).toBe(-30)
      editor.keys.up('Control')
      editor.mouse.move(150, 250)
      expect(frame().x).toBe(50)
      expect(props('leftTop').x).toBe(10)
      editor.mouse.up()
    })

    it('keeps the frame’s shape with Shift', async () => {
      const { frame, dragHandle, undo } = await editorOn()
      dragHandle('se', { x: 100, y: 10 }, { shift: true })
      expect(frame()).toEqual({ x: 0, y: 0, width: 500, height: 375 })
      undo()
      // From an edge the other side grows about its middle, on whole pixels.
      dragHandle('e', { x: 100, y: 0 }, { shift: true })
      expect(frame()).toEqual({ x: 0, y: -37, width: 500, height: 375 })
    })

    it('keeps the frame’s middle with Alt within half a pixel, its size and place whole', async () => {
      const { frame, dragHandle, undo } = await editorOn()
      dragHandle('e', { x: 40.4, y: 0 }, { alt: true })
      expect(frame()).toEqual({ x: -40, y: 0, width: 481, height: 300 })
      undo()
      dragHandle('nw', { x: 10, y: 10 }, { alt: true })
      expect(frame()).toEqual({ x: 10, y: 10, width: 380, height: 280 })
    })

    it('stops at the limits: 50 px a side, 8000 px, 12 times as long as wide; past the side across, at its smallest, never flipped', async () => {
      const { frame, dragHandle, undo } = await editorOn()
      dragHandle('e', { x: -900, y: 0 })
      expect(frame()).toEqual({ x: 0, y: 0, width: 50, height: 300 })
      undo()
      dragHandle('n', { x: 0, y: 500 })
      expect(frame()).toEqual({ x: 0, y: 250, width: 400, height: 50 })
      undo()
      dragHandle('se', { x: 9000, y: 9000 })
      expect(frame()).toEqual({ x: 0, y: 0, width: 8000, height: 8000 })
      undo()
      dragHandle('e', { x: 5000, y: 0 })
      expect(frame()).toEqual({ x: 0, y: 0, width: 3600, height: 300 })
      undo()
      dragHandle('se', { x: 9000, y: -600 })
      expect(frame()).toEqual({ x: 0, y: 0, width: 600, height: 50 })
    })

    it('stops a corner drag at 12 times as long as wide by the side it moved more, never the side it left', async () => {
      const wide = { ...DESIGN, frames: { F: { ...DESIGN.frames.F, width: 1200, height: 600 } } } as DesignInput
      const { frame, dragHandle } = await editorOn(wide)
      dragHandle('se', { x: 0, y: -560 })
      expect(frame()).toEqual({ x: 0, y: 0, width: 1200, height: 100 })
    })

    it('leaves a guide added during the drag, and the frame’s own sides it doesn’t drag, as they are', async () => {
      const { session, frame, holdHandle, editor } = await editorOn()
      holdHandle('e', { x: 20, y: 0 })
      session.run('guide.add', { frameId: 'F', axis: 'y', at: 50 })
      session.run('frame.update', { frameId: 'F', y: 7 })
      editor.mouse.move(540, 250)
      editor.mouse.up()
      expect(session.design().frames.F?.guides).toEqual([
        { axis: 'x', at: 100 },
        { axis: 'y', at: 50 },
      ])
      expect(frame()).toEqual({ x: 0, y: 7, width: 440, height: 300 })
    })

    it('keeps both sides inside the limits with Shift, the side worked out from the other stopping at 8000 px', async () => {
      const tall = { ...DESIGN, frames: { F: { ...DESIGN.frames.F, width: 699, height: 7990 } } } as DesignInput
      const { frame, dragHandle } = await editorOn(tall)
      dragHandle('se', { x: 3000, y: 3000 }, { shift: true })
      expect(frame()).toEqual({ x: 0, y: 0, width: 700, height: 8000 })
    })

    it('fits a text set left and right that grows down with its words to the height its new width gives', async () => {
      const { editor, props, dragHandle } = await editorOn()
      editor.modules.typing.fitText('words')
      const wide = props('words')
      dragHandle('e', { x: -200, y: 0 })
      const narrow = props('words')
      expect(narrow.width).toBe(160)
      expect(narrow.height).toBeGreaterThan(wide.height)
      editor.modules.typing.fitText('words')
      expect(props('words')).toEqual(narrow)
    })
  })

  describe('release', () => {
    it('makes the whole drag one undo step called resize, which undo puts back and redo brings again', async () => {
      const { session, dragHandle } = await editorOn()
      const before = JSON.stringify(session.design())
      dragHandle('sw', { x: 40, y: 20 }, { steps: 8 })
      const after = JSON.stringify(session.design())
      expect(session.undoName()).toBe('resize')
      session.undo()
      expect(JSON.stringify(session.design())).toBe(before)
      expect(session.canUndo()).toBe(false)
      session.redo()
      expect(JSON.stringify(session.design())).toBe(after)
    })

    it('puts frame and layers back exactly with Escape mid-drag, leaving no undo step', async () => {
      const { session, holdHandle, editor } = await editorOn()
      const before = JSON.stringify(session.design())
      holdHandle('w', { x: 20, y: 0 }, { x: 77.3, y: 0 })
      editor.keys.down('Control')
      editor.mouse.move(250, 250)
      editor.keys.press('Escape')
      editor.mouse.up()
      expect(JSON.stringify(session.design())).toBe(before)
      expect(session.canUndo()).toBe(false)
    })
  })

  describe('work', () => {
    it('counts each move of a resize and only the layers whose box it changed', async () => {
      const { editor, dragHandle } = await editorOn()
      const before = editor.modules.frameResize.work()
      // Six moves 10 px apart: the layers set right, left and right, and centred change; the one
      // set left and top and the one locked in place never do.
      dragHandle('e', { x: 60, y: 0 }, { steps: 6 })
      const after = editor.modules.frameResize.work()
      expect({ moves: after.moves - before.moves, written: after.written - before.written }).toEqual({
        moves: 6,
        written: 24,
      })
    })
  })
})

describe('isFrameGesture', () => {
  it('is a frame’s move or resize, and no other drag', () => {
    expect(isFrameGesture({ kind: 'frameMove' })).toBe(true)
    expect(isFrameGesture({ kind: 'frameResize' })).toBe(true)
    expect(isFrameGesture({ kind: 'resize' })).toBe(false)
    expect(isFrameGesture(null)).toBe(false)
  })
})
