// The frame stepper's choices: which of the page's frames the layers panel shows, as its arrows
// step through them in the page's order, as a selection or a picked frame takes it to theirs, as the
// panel opens, and once the frame shown is gone.
import { type Design, frameIdOf } from '@dazbee/schema'

/** The frame the layers panel shows, and its place among the page's frames by order. */
export interface ShownFrame {
  id: string | null
  at: number
}

/**
 * The arrow keys, which on the stepper only move the focus and never reach the stage, where they
 * would move the picked frame or the selection.
 */
export const ARROW_KEYS: readonly string[] = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']

/** Whether the stepper's arrows show: only when the page has another frame to step to. */
export const canStep = (frameIds: readonly string[]) => frameIds.length > 1

/** A frame shown, at its place among the page's frames; the first place for none or one the page lacks. */
export function shownAt(frameIds: readonly string[], id: string | null): ShownFrame {
  return { id, at: id === null ? 0 : Math.max(0, frameIds.indexOf(id)) }
}

/**
 * The frame `by` places from `id` among the page's frames by order, wrapping round: the last's next
 * is the first. The first frame for an id the page lacks, and none on a page with no frame.
 */
export function stepFrame(frameIds: readonly string[], id: string | null, by: 1 | -1): string | null {
  const at = id === null ? -1 : frameIds.indexOf(id)
  if (at < 0) return frameIds[0] ?? null
  return frameIds[(at + by + frameIds.length) % frameIds.length] ?? null
}

/**
 * The frame a selection or a picked frame takes the panel to: the frame of the layer selected last,
 * else the picked frame; none with nothing selected, or only what the design no longer has.
 */
export function followedFrame(design: Design, selection: readonly string[], picked: string | null): string | null {
  const last = selection.findLast((id) => design.nodes[id] !== undefined)
  if (last !== undefined) return frameIdOf(design, last) ?? null
  return picked !== null && Object.hasOwn(design.frames, picked) ? picked : null
}

/**
 * The frame the panel opens on: the one the selection or picked frame is in (`followed`), else the
 * frame in the middle of the view (`middle`), else the page's first.
 */
export function openingFrame(
  frameIds: readonly string[],
  followed: string | null,
  middle: string | null,
): string | null {
  for (const id of [followed, middle]) if (id !== null && frameIds.includes(id)) return id
  return frameIds[0] ?? null
}

/**
 * The frame shown, kept as the page's frames change: itself at its place now while the page has
 * it, else the frame now at its place, else the last one left; the first when none was shown.
 */
export function keptFrame(frameIds: readonly string[], shown: ShownFrame): ShownFrame {
  const at = shown.id === null ? -1 : frameIds.indexOf(shown.id)
  if (at >= 0) return { id: shown.id, at }
  if (frameIds.length === 0) return { id: null, at: 0 }
  const near = shown.id === null ? 0 : Math.min(shown.at, frameIds.length - 1)
  return { id: frameIds[near] ?? null, at: near }
}

/**
 * What a key on the stepper's name does: Enter or F2 renames the frame, unless the tab may only
 * view; the down arrow goes into the tree; the other arrows are held, so they never reach the stage.
 * Null leaves the key to the button and the stage, as Space picking the frame or Delete deleting it.
 */
export function nameKey(key: string, viewOnly: boolean): 'rename' | 'into tree' | 'held' | null {
  if (key === 'Enter' || key === 'F2') return viewOnly ? null : 'rename'
  if (key === 'ArrowDown') return 'into tree'
  return ARROW_KEYS.includes(key) ? 'held' : null
}
