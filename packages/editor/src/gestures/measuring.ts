// What Alt measures with the Select tool: from a selection in one frame to the layer under the
// pointer there, the deepest with the deep key, else, over the selection or empty space, to its
// group or box or its frame. The distances and where their values sit are `layers/measure.ts`'s.
import { isContainer, type Point } from '@dazbee/schema'

import type { Frame } from '../canvas/frames.ts'
import type { EditorView } from '../canvas/view.ts'
import type { EditorBoxes } from '../layers/boxes.ts'
import { alongAxes, type Measured } from '../layers/measure.ts'
import { type EditorSelection, idsOf } from '../selection.ts'
import type { EditorTyping } from '../text/typing.ts'
import type { EditorTools } from '../tools.ts'
import type { EditorHeldKeys } from './held-keys.ts'

export interface MeasuringDeps {
  view: Pick<EditorView, 'design'>
  tools: Pick<EditorTools, 'tool'>
  selection: Pick<EditorSelection, 'current' | 'hovered' | 'cropping' | 'pathEditing'>
  boxes: Pick<EditorBoxes, 'drawnBoxOf'>
  typing: Pick<EditorTyping, 'editing'>
  held: Pick<EditorHeldKeys, 'alt'>
  /**
   * The frame under a mouse or pen hovering over the stage and the point in its design pixels; null
   * by touch, during a press or a pan, and off every frame.
   */
  hoverAt: () => { frame: Frame; p: Point } | null
}

export interface EditorMeasuring {
  /**
   * What Alt measures with the select tool and a selection in one frame, the pointer over that
   * frame and no press, typing, crop or point edit: to the layer under the pointer, the deepest
   * with the deep key, else, over the selection or empty space, to its group or box or its frame.
   */
  measured(): Measured | null
}

export function editorMeasuring({
  view,
  tools,
  selection,
  boxes,
  typing,
  held,
  hoverAt,
}: MeasuringDeps): EditorMeasuring {
  /** Whether Alt is held and measures: with the Select tool, and nothing typed in, cropped or edited by its points. */
  function altActs() {
    return (
      held.alt() && tools.tool() === 'select' && !typing.editing() && !selection.cropping() && !selection.pathEditing()
    )
  }
  function measured(): Measured | null {
    const current = selection.current()
    const at = hoverAt()
    if (!altActs() || !at || !current || current.some((layer) => layer.frameId !== at.frame.id)) return null
    const ids = idsOf(current)
    const now = view.design()
    const drawnOf = (id: string) => boxes.drawnBoxOf(at.frame, id, now)
    const drawn = ids.flatMap((id) => drawnOf(id) ?? [])
    const hovered = selection.hovered()
    const parentId = now.nodes[ids[0] ?? '']?.parentId ?? ''
    const parent = now.nodes[parentId]
    const onto =
      hovered && hovered.frameId === at.frame.id && !ids.includes(hovered.id)
        ? drawnOf(hovered.id)
        : parent && isContainer(parent.type)
          ? drawnOf(parentId)
          : { x: 0, y: 0, width: at.frame.width, height: at.frame.height, rotation: 0 }
    if (drawn.length === 0 || !onto) return null
    return { frame: at.frame, from: alongAxes(drawn), to: alongAxes([onto]) }
  }

  return { measured }
}
