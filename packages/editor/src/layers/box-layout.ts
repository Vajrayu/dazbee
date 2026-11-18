// Setting the selected boxes' layout: Free, a row or column read off their layers, or the row,
// column or grid named; whether Shift+A lays out in place or wraps, and doing either; and the Box
// action, which Shift+A wraps with. One module behind the panel, the keys and the menus.
import { type BoxLayout, changesLayout, laidOutBox, type Session } from '@dazbee/doc'
import type { Design, NonEmpty } from '@dazbee/schema'

import type { CoreOptions } from '../core-interface.ts'
import { runQuietly } from '../run-quietly.ts'
import type { EditorBoxes } from './boxes.ts'
import { whyNotWrapped, type WrapState, wrapStateOf } from './wrap-state.ts'

/**
 * What Shift+A does with one frame's selected layers: `inPlace` when they are one Free box alone,
 * laid out where it is, which is no wrap; `locked` when that box is locked against style changes,
 * so nothing is laid out; `wrap` otherwise, wrapping them as the Box action does, under its rule
 * (`wrapStateOf`).
 */
export type LayOutWay = 'inPlace' | 'locked' | 'wrap'
/**
 * What setting the selected boxes' layout did: `set` when it changed a box; `locked` when each box
 * it would change is locked against style changes; `none` when no selected box would change.
 */
export type SetLayout = 'set' | 'locked' | 'none'

export interface BoxLayoutDeps {
  session: Session
  boxes: Pick<EditorBoxes, 'roots' | 'drawnInFlow'>
  /** The name a new box takes, in the app's words. */
  layerName: CoreOptions['layerName']
}

export interface EditorBoxLayout {
  /**
   * Sets the layout of each selected box, in every frame, as one undo step; going Free, each box
   * and what it holds stay where they are drawn. A locked box, and every other layer, is left as it
   * is. Gives what it did (`SetLayout`).
   */
  setLayout(layout: BoxLayout): SetLayout
  /** Lays one Free box out where it is, its row or column read off its layers, at Fit both ways. */
  layOutInPlace(id: string): void
  /** Wraps layers that share a parent in one new box laid out round them, its row or column read off them, at Fit both ways. Returns the box. */
  wrapInLayout(ids: string[]): string
  /** The Box action: wraps layers that share a parent in a new Free box, nothing moving. Returns the box. */
  box(ids: string[]): string
}

export function editorBoxLayout({ session, boxes, layerName }: BoxLayoutDeps): EditorBoxLayout {
  function setLayout(layout: BoxLayout): SetLayout {
    const { ids, does } = layoutChangeOf(session.design(), boxes.roots(), layout)
    if (does !== 'set') return does
    session.gesture(() => {
      for (const id of ids)
        runQuietly(() =>
          session.run('node.autoLayout', {
            id,
            layout,
            ...(layout === 'free' ? { drawn: boxes.drawnInFlow([id]) } : {}),
          }),
        )
    })
    return 'set'
  }

  function box(ids: string[]) {
    return session.run('node.box', { ids, name: layerName('box'), drawn: boxes.drawnInFlow(ids) })
  }

  function layOutInPlace(id: string) {
    session.run('node.autoLayout', { id, layout: 'auto' })
  }

  function wrapInLayout(ids: string[]) {
    const made = box(ids)
    layOutInPlace(made)
    return made
  }

  return { setLayout, layOutInPlace, wrapInLayout, box }
}

/**
 * What setting `layout` on the boxes among the selected layers `roots` would do (`SetLayout`), with
 * the boxes it would change: each box whose layout it changes, unless locked against style changes.
 */
export function layoutChangeOf(
  design: Design,
  roots: readonly string[],
  layout: BoxLayout,
): { does: SetLayout; ids: string[] } {
  const changing = roots.filter((id) => {
    const node = design.nodes[id]
    return node?.type === 'box' && changesLayout(node.props.layout, layout)
  })
  const ids = changing.filter((id) => !design.nodes[id]?.lock?.style)
  return { does: ids.length > 0 ? 'set' : changing.length > 0 ? 'locked' : 'none', ids }
}

/**
 * Why Shift+A would lay out nothing for each frame's selected layers (`parts`): `locked` for a lone
 * box locked against style changes, else the Box action's reason for the frames it would wrap; null
 * while it would lay them out.
 */
export function whyNotLaidOut(
  design: Design,
  parts: readonly { ids: NonEmpty<string> }[],
): Exclude<WrapState, 'ready' | 'none'> | null {
  const ways = parts.map(({ ids }) => layOutWayOf(design, ids))
  if (ways.includes('locked')) return 'locked'
  return whyNotWrapped(
    wrapStateOf(
      design,
      parts.filter((_, i) => ways[i] === 'wrap'),
      'box',
    ),
  )
}

/** What Shift+A does with one frame's selected layers (`LayOutWay`): the one place that decides it. */
export function layOutWayOf(design: Design, [id, ...others]: NonEmpty<string>): LayOutWay {
  if (others.length > 0 || design.nodes[id]?.type !== 'box' || laidOutBox(design, id)) return 'wrap'
  return design.nodes[id]?.lock?.style ? 'locked' : 'inPlace'
}
