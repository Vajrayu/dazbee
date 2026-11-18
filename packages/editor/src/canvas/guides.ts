// Guides on the stage: the rulers' bands a guide is dragged out of, the guides a frame shows and the
// one under a point, where a guide goes in its frame, and a guide found again after other writes.
import type { Design, Guide, Point } from '@dazbee/schema'

import { type Camera, toScreen, toWorld } from './camera.ts'
import type { Frame } from './frames.ts'

/** A guide of a frame as the stage shows it: its frame, its index in the frame's guides, its axis and place. */
export interface PlacedGuide {
  frameId: string
  index: number
  axis: Guide['axis']
  at: number
}

/** The rulers' thickness, in CSS pixels. */
export const RULER_SIZE = 20
/** How near a guide a press or a hover takes it, in screen pixels. */
export const GUIDE_REACH = 3

/**
 * The axis of the guides the ruler under a stage point makes: 'x', vertical guides, from the start
 * ruler down the stage's side; 'y', horizontal ones, from the top ruler; null off both and in the
 * corner where they meet.
 */
export function rulerAt(at: Point): Guide['axis'] | null {
  if (at.y < RULER_SIZE && at.x >= RULER_SIZE) return 'y'
  if (at.x < RULER_SIZE && at.y >= RULER_SIZE) return 'x'
  return null
}

/** Whether a stage point is on the ruler a guide on `axis` comes out of, where letting it go removes it. */
export function onItsRuler(axis: Guide['axis'], at: Point): boolean {
  return axis === 'x' ? at.x < RULER_SIZE : at.y < RULER_SIZE
}

/** A frame's side along a guide's axis: its width for a vertical guide, its height for a horizontal one. */
export const sideOf = (frame: Pick<Frame, 'width' | 'height'>, axis: Guide['axis']) =>
  axis === 'x' ? frame.width : frame.height

/** The guides a frame shows: those within its width or height; one a resize left past its edge is kept but not shown. */
export function guidesShown(design: Design, frame: Frame): PlacedGuide[] {
  const guides = design.frames[frame.id]?.guides ?? []
  return guides.flatMap((guide, index) =>
    guide.at >= 0 && guide.at <= sideOf(frame, guide.axis) ? [{ frameId: frame.id, index, ...guide }] : [],
  )
}

/**
 * The guide under a stage point, within GUIDE_REACH screen pixels of it and along its frame: in the
 * frame drawn last first, and among a frame's guides the one added last first. Null with none.
 */
export function guideUnder(design: Design, frames: readonly Frame[], camera: Camera, at: Point): PlacedGuide | null {
  for (const frame of frames.toReversed()) {
    const start = toScreen(camera, frame)
    const end = toScreen(camera, { x: frame.x + frame.width, y: frame.y + frame.height })
    for (const guide of guidesShown(design, frame).toReversed()) {
      const across = guide.axis === 'x' ? 'x' : 'y'
      const along = guide.axis === 'x' ? 'y' : 'x'
      const line = start[across] + guide.at * camera.zoom
      const near = Math.abs(at[across] - line) <= GUIDE_REACH
      if (near && at[along] >= start[along] - GUIDE_REACH && at[along] <= end[along] + GUIDE_REACH) return guide
    }
  }
  return null
}

/** Where a guide on `axis` through a stage point sits in a frame: its x or y from the frame's top left, in design pixels. */
export function guideOffset(camera: Camera, frame: Frame, axis: Guide['axis'], at: Point): number {
  const world = toWorld(camera, at)
  return axis === 'x' ? world.x - frame.x : world.y - frame.y
}

/**
 * The index a guide has now in its frame's guides, after other writes may have added or removed
 * some: its own index while the guide there is still on its axis at its place, else the first such
 * guide; null once the frame has none.
 */
export function guideNow(design: Design, guide: PlacedGuide): number | null {
  const guides = design.frames[guide.frameId]?.guides ?? []
  const same = (g: Guide | undefined) => g?.axis === guide.axis && g.at === guide.at
  if (same(guides[guide.index])) return guide.index
  const found = guides.findIndex(same)
  return found === -1 ? null : found
}
