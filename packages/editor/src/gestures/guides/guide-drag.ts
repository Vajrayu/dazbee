// Guides on the stage while the rulers show: a drag out of a ruler adds one to the frame it is let go
// over, a drag on one moves it (with Alt at the press, a copy), and a drag back onto its ruler
// removes it; each such drag is one command when it is let go, so one undo step, and writes nothing
// before. A click picks a guide, which Delete removes, the arrows move and Escape lets go. A dragged
// guide snaps to its frame's sides and middle and to every layer shown in it, unless the deep key is
// held, and lands on whole pixels. Also the guide under the pointer, its cursor, what the guides
// show, and the frame the rulers count from.
import { childrenOf, type Session } from '@dazbee/doc'
import { type Guide, MAX_GUIDES, type Point, type Rect } from '@dazbee/schema'

import type { Frame } from '../../canvas/frames.ts'
import {
  guideNow,
  guideOffset,
  guidesShown,
  guideUnder,
  onItsRuler,
  type PlacedGuide,
  rulerAt,
  sideOf,
} from '../../canvas/guides.ts'
import type { EditorView } from '../../canvas/view.ts'
import type { EditorBoxes } from '../../layers/boxes.ts'
import { nearestLine, SNAP_DISTANCE, snapTargets, type Targets } from '../../layers/snap.ts'
import { boundsOf } from '../../layers/transform.ts'
import { runQuietly } from '../../run-quietly.ts'
import { type EditorSelection, firstFrameOf } from '../../selection.ts'
import { deepKeyHeld, NUDGES, type StageAction } from '../../shortcuts.ts'
import type { EditorTyping } from '../../text/typing.ts'
import type { EditorTools } from '../../tools.ts'
import type { PointerInput } from '../inputs.ts'
import type { EditorFrameResize } from '../select/frame-resize.ts'
import type { EditorTransformDrag } from '../select/transform-drag.ts'

/** A guide being dragged, from the press on a ruler or a guide until it is let go. */
export interface GuideDrag {
  kind: 'guide'
  axis: Guide['axis']
  /** The guide pressed, as the stage showed it then; null for a new one dragged out of a ruler. */
  from: PlacedGuide | null
  /** Whether letting go adds a copy and leaves the guide pressed where it is: Alt was held at the press. */
  copy: boolean
  /** The frame the rulers counted from at the press, which a new guide goes in while no frame is under the pointer. */
  origin: Frame | null
  /** Where the guide would land now, in its frame; null while it would land nowhere. */
  to: { frame: Frame; at: number } | null
  /** Whether the pointer is on the guide's own ruler, where letting go removes the guide pressed and adds none. */
  onRuler: boolean
  /** What the guide snaps to in each frame it has been over, by the frame's id, gathered once. */
  targets: Map<string, Targets>
}

/** A guide as the stage draws it: `hot` while it is under the pointer, picked or dragged, drawn thicker with its place. */
export interface ShownGuide {
  frame: Frame
  axis: Guide['axis']
  at: number
  hot: boolean
}

export interface GuideDragDeps {
  /** Holds the pointer from a press. */
  hold: () => void
  session: Pick<Session, 'design' | 'run' | 'readOnly'>
  view: Pick<EditorView, 'camera' | 'design' | 'rulers' | 'pointOn' | 'frameOf' | 'inView'>
  tools: Pick<EditorTools, 'tool'>
  selection: Pick<EditorSelection, 'current' | 'hovered' | 'guide' | 'selectGuide' | 'cropping' | 'pathEditing'>
  boxes: Pick<EditorBoxes, 'drawnBoxOf'>
  typing: Pick<EditorTyping, 'editing'>
  transformDrag: Pick<EditorTransformDrag, 'handleUnder'>
  frameResize: Pick<EditorFrameResize, 'handleUnder'>
  /** Whether this computer is Apple's, whose deep key is ⌘. */
  onMac: () => boolean
  /** Tells that what is shown changed. */
  shownChanged: () => void
}

export interface EditorGuideDrag {
  /**
   * The drag a press starts: on a ruler, a new guide's; on a guide a frame shows, that guide's, unless
   * the selection's handles, which come first, are under it. Null elsewhere, and while the rulers
   * are hidden, a tool other than Select is on, the tab may only view, or a crop, a path edit or
   * typing is open; a press that starts none lets the picked guide go.
   */
  press(e: PointerInput): GuideDrag | null
  /** Follows the pointer at a stage point, once the press is a drag: where the guide would land, snapped with `snap`, shown. */
  drag(g: GuideDrag, at: Point, snap: boolean): void
  /**
   * Lets the drag go: a new guide is added where it would land, a copy added beside the guide
   * pressed, or the guide pressed moved there and picked, or removed on its ruler; a click picks it.
   * The guide pressed is found again first, by its axis and place, and nothing happens once it is gone.
   */
  release(g: GuideDrag): void
  /** Follows the pointer hovering at a stage point, or off the stage with null; returns whether the guide under it changed. */
  hover(at: Point | null): boolean
  /** The cursor a press at a stage point would drag a guide with, as CSS names it; empty where it would drag none. */
  cursorAt(at: Point, overHandle: boolean): string
  /**
   * Acts on the picked guide for an action of the keys, while a press could drag it: Delete removes
   * it, the arrows across it move it, Escape lets it go. Returns whether it did.
   */
  key(action: StageAction): boolean
  /**
   * The picked guide where it is now: at its index while the guide there is on its axis, else found
   * by its axis and place; null with none, or while the rulers are hidden or it is past its frame's edge.
   */
  selected(): PlacedGuide | null
  /** The guides to draw while the rulers show: each one the frames in view show, and the one `g` drags where it would land. */
  shown(g: GuideDrag | null): ShownGuide[]
  /** The frame the rulers count from: the dragged guide's, the picked guide's, the selection's, the hovered layer's, else the first in view. */
  rulerFrame(g: GuideDrag | null): Frame | undefined
}

export function editorGuideDrag({
  hold,
  session,
  view,
  tools,
  selection,
  boxes,
  typing,
  transformDrag,
  frameResize,
  onMac,
  shownChanged,
}: GuideDragDeps): EditorGuideDrag {
  /** The guide under the pointer, drawn hot. */
  let hovered: PlacedGuide | null = null

  /** Whether a press may drag guides now. */
  function takes() {
    return (
      view.rulers() &&
      !session.readOnly() &&
      tools.tool() === 'select' &&
      !selection.cropping() &&
      !selection.pathEditing() &&
      !typing.editing()
    )
  }
  /** The guide a frame in view shows under a stage point; null with none. */
  function under(at: Point) {
    return guideUnder(view.design(), view.inView(), view.camera(), at)
  }
  /** Whether the selection's handles, or the picked frame's, are under a stage point, which a press takes before a guide. */
  function overHandle(at: Point, touch: boolean, dots: boolean) {
    if (frameResize.handleUnder(at, touch)) return true
    return selection.current() !== null && transformDrag.handleUnder(at, touch, dots) !== null
  }
  function selected(): PlacedGuide | null {
    const picked = selection.guide()
    const frame = picked && view.rulers() ? view.frameOf(picked.frameId) : undefined
    if (!picked || !frame) return null
    const guides = session.design().frames[picked.frameId]?.guides ?? []
    // An undo or another tab may have moved it: kept while its index holds a guide on its axis.
    const kept = guides[picked.index]?.axis === picked.axis ? picked.index : guideNow(session.design(), picked)
    const at = kept === null ? undefined : guides[kept]?.at
    if (kept === null || at === undefined || at > sideOf(frame, picked.axis)) return null
    return { ...picked, index: kept, at }
  }
  function rulerFrame(g: GuideDrag | null) {
    const frame = (id: string | undefined) => (id === undefined ? undefined : view.frameOf(id))
    return (
      frame(g?.to?.frame.id) ??
      frame(g?.from?.frameId) ??
      frame(g?.origin?.id) ??
      frame(selected()?.frameId) ??
      frame(firstFrameOf(selection.current())) ??
      frame(selection.hovered()?.frameId) ??
      view.inView()[0]
    )
  }

  function press(e: PointerInput): GuideDrag | null {
    const drag = startAt(e)
    if (!drag && selection.guide()) selection.selectGuide(null)
    return drag
  }
  /** The drag a press starts (see `press`), letting no picked guide go. */
  function startAt(e: PointerInput): GuideDrag | null {
    if (!takes()) return null
    const ruler = rulerAt(e.at)
    const handle = !ruler && overHandle(e.at, e.pointerType === 'touch', !deepKeyHeld(e, onMac()))
    const pressed = ruler || handle ? null : under(e.at)
    const frame = pressed && view.frameOf(pressed.frameId)
    if (!ruler && !(pressed && frame)) return null
    hold()
    return {
      kind: 'guide',
      axis: ruler ?? pressed?.axis ?? 'x',
      from: pressed,
      copy: pressed !== null && e.altKey,
      origin: rulerFrame(null) ?? null,
      to: pressed && frame ? { frame, at: pressed.at } : null,
      onRuler: false,
      targets: new Map(),
    }
  }
  function drag(g: GuideDrag, at: Point, snap: boolean) {
    land(g, at, snap)
    shownChanged()
  }
  /** Where a dragged guide would land with the pointer at a stage point. */
  function land(g: GuideDrag, at: Point, snap: boolean) {
    g.onRuler = onItsRuler(g.axis, at)
    const frame = g.from ? view.frameOf(g.from.frameId) : (view.pointOn(at)?.frame ?? g.origin)
    if (!frame) {
      g.to = null
      return
    }
    const offset = guideOffset(view.camera(), frame, g.axis, at)
    const place = Math.round(snap ? snapped(g, frame, offset) : offset)
    const side = sideOf(frame, g.axis)
    // A guide moved stays in its frame; a new one or a copy lands only on it, while it holds fewer than the most.
    const full = (session.design().frames[frame.id]?.guides?.length ?? 0) >= MAX_GUIDES
    if (g.from && !g.copy) g.to = { frame, at: Math.min(side, Math.max(0, place)) }
    else g.to = place >= 0 && place <= side && !full ? { frame, at: place } : null
  }
  /** A place in a frame snapped to the nearest of its lines within SNAP_DISTANCE on screen, else as it is. */
  function snapped(g: GuideDrag, frame: Frame, offset: number) {
    let targets = g.targets.get(frame.id)
    if (!targets) {
      targets = snapTargets([], snapBoxesIn(frame), frame.id)
      g.targets.set(frame.id, targets)
    }
    const by = nearestLine([offset], g.axis === 'x' ? targets.xs : targets.ys, SNAP_DISTANCE / view.camera().zoom)
    return offset + (by ?? 0)
  }
  /** The boxes a guide snaps to the sides and middle of in a frame: the frame's own, and every layer it shows, as drawn and upright. */
  function snapBoxesIn(frame: Frame): Rect[] {
    const design = view.design()
    const found: Rect[] = [{ x: 0, y: 0, width: frame.width, height: frame.height }]
    const walk = (parentId: string) => {
      for (const [id, layer] of childrenOf(design, parentId)) {
        // A hidden layer hides all it holds.
        if (layer.props.visible === false) continue
        const box = boxes.drawnBoxOf(frame, id, design)
        if (box) found.push(boundsOf([box]))
        walk(id)
      }
    }
    walk(frame.id)
    return found
  }
  function release(g: GuideDrag) {
    const { from, to } = g
    if (!from) {
      if (to && !g.onRuler)
        runQuietly(() => session.run('guide.add', { frameId: to.frame.id, axis: g.axis, at: to.at }))
      return
    }
    const index = guideNow(session.design(), from)
    if (index === null) return
    const { frameId } = from
    if (g.onRuler) {
      if (!g.copy) remove(frameId, index)
      return
    }
    if (!to) return
    if (g.copy) {
      if (to.at !== from.at) runQuietly(() => session.run('guide.add', { frameId, axis: g.axis, at: to.at }))
      selection.selectGuide({ ...from, index })
      return
    }
    if (to.at !== from.at) runQuietly(() => session.run('guide.move', { frameId, index, at: to.at }))
    selection.selectGuide({ ...from, index, at: to.at })
  }
  /** Removes a guide, letting it go if it is the one picked. */
  function remove(frameId: string, index: number) {
    const picked = selected()
    runQuietly(() => session.run('guide.remove', { frameId, index }))
    if (picked?.frameId === frameId && picked.index === index) selection.selectGuide(null)
  }
  function hover(at: Point | null) {
    const next = at && takes() && !overHandle(at, false, true) ? under(at) : null
    const changed = next?.frameId !== hovered?.frameId || next?.index !== hovered?.index || next?.at !== hovered?.at
    hovered = next
    return changed
  }
  function cursorAt(at: Point, overHandle: boolean) {
    if (!takes()) return ''
    const axis = rulerAt(at) ?? (overHandle ? null : under(at)?.axis)
    if (!axis) return ''
    return axis === 'x' ? 'col-resize' : 'row-resize'
  }
  function key(action: StageAction) {
    const picked = selected()
    const frame = picked && view.frameOf(picked.frameId)
    if (!picked || !frame || !takes()) return false
    const { frameId, index } = picked
    if (action === 'deselect') {
      selection.selectGuide(null)
      return true
    }
    if (action === 'delete') {
      remove(frameId, index)
      return true
    }
    const step = NUDGES[action]
    const by = step && (picked.axis === 'x' ? step[0] : step[1])
    if (!by) return false
    const at = Math.min(sideOf(frame, picked.axis), Math.max(0, picked.at + by))
    if (at !== picked.at) runQuietly(() => session.run('guide.move', { frameId, index, at }))
    selection.selectGuide({ ...picked, at })
    return true
  }
  function shown(g: GuideDrag | null): ShownGuide[] {
    if (!view.rulers()) return []
    const design = view.design()
    const picked = selected()
    // A guide moved is drawn where it would land, not where it was.
    const moving = g?.from && !g.copy ? g.from : null
    const lines: ShownGuide[] = []
    for (const frame of view.inView()) {
      for (const guide of guidesShown(design, frame)) {
        if (moving?.frameId === guide.frameId && moving.index === guide.index) continue
        const hot = (!g && sameGuide(guide, hovered)) || sameGuide(guide, picked)
        lines.push({ frame, axis: guide.axis, at: guide.at, hot })
      }
    }
    if (g?.to && !g.onRuler) lines.push({ frame: g.to.frame, axis: g.axis, at: g.to.at, hot: true })
    return lines
  }

  return {
    press,
    drag,
    release,
    hover,
    cursorAt,
    key,
    selected,
    shown,
    rulerFrame,
  }
}

/** Whether two guides are on the same axis at the same place of the same frame; false when either is none. */
function sameGuide(a: PlacedGuide | null, b: PlacedGuide | null) {
  return a !== null && b !== null && a.frameId === b.frameId && a.axis === b.axis && a.at === b.at
}
