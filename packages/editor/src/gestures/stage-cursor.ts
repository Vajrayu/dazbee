// The cursor the stage shows: a pan's, none while a colour is picked (the loupe stands in its
// place), the tool's, the copy cursor while Alt would have a move or a reorder make copies, or that
// of the handle, the picked frame's handle, the ruler, the guide or the crop under the pointer; and the
// listeners told when it changes.
import type { Point } from '@dazbee/schema'

import { grabCursor } from '../canvas/cursors.ts'
import type { EditorBoxes } from '../layers/boxes.ts'
import { listenerSet } from '../listener-set.ts'
import type { EditorSelection } from '../selection.ts'
import type { EditorTools } from '../tools.ts'
import type { EditorCropping } from './crop/cropping.ts'
import { isDrawTool } from './drawing/draw-tools.ts'
import type { EditorGuideDrag } from './guides/guide-drag.ts'
import type { EditorHeldKeys } from './held-keys.ts'
import type { Grab } from './hit-zones.ts'
import type { EditorPan } from './pan.ts'
import type { Gesture } from './pointer.ts'
import type { EditorFrameResize } from './select/frame-resize.ts'
import type { EditorTransformDrag } from './select/transform-drag.ts'

export interface StageCursorDeps {
  tools: Pick<EditorTools, 'tool' | 'imageToPlace'>
  selection: Pick<EditorSelection, 'cropping'>
  boxes: Pick<EditorBoxes, 'selectionBox'>
  cropping: Pick<EditorCropping, 'cursorAt'>
  transformDrag: Pick<EditorTransformDrag, 'handleUnder' | 'carries'>
  frameResize: Pick<EditorFrameResize, 'handleUnder'>
  guideDrag: Pick<EditorGuideDrag, 'cursorAt'>
  held: Pick<EditorHeldKeys, 'alt' | 'deep'>
  pan: Pick<EditorPan, 'held'>
  panning: EditorPan['ready']
  /** The drag of the selection a press at a stage point would start, `handle` being the handle under it. */
  dragAt: (screen: Point, handle: Grab | null) => 'move' | 'reorder' | null
  /** The drag on the stage, or null. */
  gesture: () => Gesture | null
  /** Where the pointer last was over the stage, as a stage point, or null. */
  pointerAt: () => Point | null
  /** Whether a colour is being picked. */
  picking: () => boolean
}

export interface EditorStageCursor {
  /** Shows the cursor for a pan, picking a colour, the tool, a move or a reorder that copies, or the handle under the pointer. */
  showCursor(): void
  /** Follows a pointer hovering at a stage point: the cursor of the crop, the handle, the ruler or the guide under it, shown. */
  cursorFor(screen: Point): void
  /** The cursor the stage shows now, as CSS names it; empty for the browser's own. */
  cursor(): string
  /** Adds a listener told the cursor each time it changes; returns the function that stops it. */
  onCursor(listener: (cursor: string) => void): () => void
}

export function editorStageCursor({
  tools,
  selection,
  boxes,
  cropping,
  transformDrag,
  frameResize,
  guideDrag,
  held,
  pan,
  panning,
  dragAt,
  gesture,
  pointerAt,
  picking,
}: StageCursorDeps): EditorStageCursor {
  /** The cursor the handle under the pointer asks for, shown when the tool and a pan don't ask for another. */
  let hoverCursor = ''
  /** The cursor the stage shows. */
  let shownCursor = ''
  /** The listeners told the cursor when it changes. */
  const cursorListeners = listenerSet<[cursor: string]>()
  const cursor = () => shownCursor

  /**
   * Whether Alt has a drag make copies: Alt is held, and a move held carries layers, a reorder is
   * held, or a press at the pointer would move or reorder the selection. `handle` is the handle
   * under the pointer, when the hover move has just found it.
   */
  function copies(handle?: Grab | null) {
    if (!held.alt()) return false
    const drag = gesture()
    if (drag) return drag.kind === 'reorder' || (drag.kind === 'move' && transformDrag.carries(drag))
    const at = pointerAt()
    return (
      at !== null &&
      dragAt(at, handle === undefined ? transformDrag.handleUnder(at, false, !held.deep()) : handle) !== null
    )
  }
  /** Shows the cursor, `handle` being the handle under the pointer when a hover move has just found it. */
  function showCursor(handle?: Grab | null) {
    const tool = tools.tool()
    const drawing = isDrawTool(tool) || tool === 'frame' || tool === 'pen' || (tool === 'image' && tools.imageToPlace())
    const next = pan.held()
      ? 'grabbing'
      : panning()
        ? 'grab'
        : picking()
          ? 'none'
          : drawing
            ? 'crosshair'
            : tool === 'text'
              ? 'text'
              : copies(handle)
                ? 'copy'
                : hoverCursor
    if (next === shownCursor) return
    shownCursor = next
    cursorListeners.emit(next)
  }
  function cursorFor(screen: Point) {
    const kind = gesture()?.kind
    if (kind === 'resize' || kind === 'rotate' || kind === 'end' || kind === 'guide') return
    if (selection.cropping()) {
      // Cropping, the window's handles and the image's corners resize, and the image moves (#48).
      hoverCursor = cropping.cursorAt(screen)
      showCursor()
      return
    }
    // The pointer hovering passes over the radius dots while the deep key is held.
    const handle = transformDrag.handleUnder(screen, false, !held.deep()) ?? frameResize.handleUnder(screen)
    // A ruler is over the handles; a guide under them.
    hoverCursor =
      guideDrag.cursorAt(screen, handle !== null) || grabCursor(handle, boxes.selectionBox()?.drawn.rotation ?? 0)
    showCursor(handle)
  }

  return { showCursor, cursorFor, cursor, onCursor: cursorListeners.on }
}
