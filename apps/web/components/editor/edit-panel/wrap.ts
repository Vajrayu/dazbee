// How the layout section sets a row or column to wrap and the room between its lines: Wrap turned on
// fixes a box that fits its length along the flow at the size it is drawn, so it wraps at once; a
// number for the room between lines gathers spread lines again, and Auto spreads them.
import { sizingOf } from '@dazbee/doc'
import type { AutoLayout } from '@dazbee/schema'

import { tidy } from '@/lib/editor/size.ts'

import type { Patch, Props } from './target.ts'

/** Whether a box's layout can wrap: a row or a column; a grid has its own rows. */
export const wrapApplies = (layout: Pick<AutoLayout, 'direction'> | undefined) =>
  layout !== undefined && layout.direction !== 'grid'

/**
 * A box whose values are `now` set to wrap, or not. Turned on, a box that fits what it holds along
 * its flow is given the length it is drawn at there, which fixes that side. Null for a box that is
 * Free or a grid.
 */
export function wrapPatch(now: Props, on: boolean): Patch | null {
  const layout = now.layout as AutoLayout | undefined
  if (!layout || !wrapApplies(layout)) return null
  const along = layout.direction === 'column' ? 'height' : 'width'
  const fits = sizingOf({ type: 'box', props: now })[along] === 'hug'
  return { layout: { ...layout, wrap: on }, ...(on && fits ? { [along]: tidy(now[along] as number) } : {}) }
}

/** The room between a laid-out box's lines set to `to`, its lines gathered again where they were spread. */
export function lineGapPatch(layout: AutoLayout, to: number): Partial<AutoLayout> {
  return { lineGap: to, ...(layout.alignLines === 'space-between' ? { alignLines: 'packed' as const } : {}) }
}

/** The room between a box's lines: its own, or its gap where it sets none. */
export const lineGapOf = (layout: AutoLayout) => layout.lineGap ?? layout.gap
