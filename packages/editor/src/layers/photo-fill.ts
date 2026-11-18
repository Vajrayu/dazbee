// Whether layers are a photo selection: every one of them has the same fills, and they hold an image
// fill. The edit panel gives such a selection its Image tab, not a shape's, and Combine leaves it out.
import type { Paint } from '@dazbee/schema'

/** An image fill. */
export type ImageFill = Extract<Paint, { type: 'image' }>

/**
 * The topmost image fill, the one showing, with its place in the list, when every layer has the
 * same fill list (`fillLists`, one per layer) and it holds an image fill; null otherwise.
 */
export function sharedImageFill(fillLists: readonly (readonly Paint[])[]): { index: number; paint: ImageFill } | null {
  const [first] = fillLists
  if (!first) return null
  const json = JSON.stringify(first)
  if (!fillLists.every((fills) => JSON.stringify(fills) === json)) return null
  const index = first.findLastIndex((fill) => fill.type === 'image')
  return index >= 0 ? { index, paint: first[index] as ImageFill } : null
}
