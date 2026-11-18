// What a drag shows over the stage while it runs: the marquee being dragged, and the snap lines,
// with a cross on each point that lined up, and the equal gaps of the move or resize in progress,
// as overlay elements, the lines turned with the containers the drag is in.
import type { Point, Rect } from '@dazbee/schema'

import { type Camera, toScreen } from '../../canvas/camera.ts'
import type { Frame } from '../../canvas/frames.ts'
import { px } from '../../canvas/rulers.ts'
import type { ShownSnap } from '../../layers/snap.ts'
import { type Box, drawnFrom, round } from '../../layers/transform.ts'

/** The marquee being dragged, then the snap lines and equal gaps of the drag in progress. */
export function dragParts(
  marquee: { from: Point; to: Point } | null,
  snapped: ShownSnap | null,
  camera: Camera,
  outline: (className: string, frame: Frame, box: Box) => HTMLElement,
) {
  const parts: HTMLElement[] = []
  if (marquee) {
    const el = document.createElement('div')
    el.className = 'marquee'
    const from = toScreen(camera, marquee.from)
    const to = toScreen(camera, marquee.to)
    Object.assign(el.style, {
      left: px(Math.min(from.x, to.x)),
      top: px(Math.min(from.y, to.y)),
      width: px(Math.abs(to.x - from.x)),
      height: px(Math.abs(to.y - from.y)),
    })
    parts.push(el)
  }
  if (snapped) parts.push(...snapParts(snapped, camera, outline))
  return parts
}
/**
 * Snap lines across what lined up, each point that lined up crossed, and equal gaps as
 * lines across them with their size, each where the containers around the drag put it: the lines
 * turned with them, the crosses and a gap's size upright on screen.
 */
function snapParts(
  { frame, around, snapLines, gaps }: ShownSnap,
  camera: Camera,
  outline: (className: string, frame: Frame, box: Box) => HTMLElement,
) {
  /** A box of the drag's space as it is drawn in the frame. */
  const drawn = (box: Rect) => drawnFrom({ ...box, rotation: 0 }, around)
  const parts: HTMLElement[] = []
  for (const g of snapLines) {
    const line = outline(
      'snap-line',
      frame,
      drawn(
        g.axis === 'x'
          ? { x: g.at, y: g.from, width: 0, height: g.to - g.from }
          : { x: g.from, y: g.at, width: g.to - g.from, height: 0 },
      ),
    )
    line.dataset.axis = g.axis
    parts.push(line)
    for (const along of g.points) {
      const cross = document.createElement('div')
      cross.className = 'snap-cross'
      const point = drawn({ x: g.axis === 'x' ? g.at : along, y: g.axis === 'x' ? along : g.at, width: 0, height: 0 })
      const at = toScreen(camera, { x: frame.x + point.x, y: frame.y + point.y })
      Object.assign(cross.style, { left: px(at.x), top: px(at.y) })
      parts.push(cross)
    }
  }
  for (const g of gaps) {
    const box = drawn(
      g.axis === 'x'
        ? { x: g.from, y: g.at, width: g.to - g.from, height: 0 }
        : { x: g.at, y: g.from, width: 0, height: g.to - g.from },
    )
    const span = outline('gap', frame, box)
    span.dataset.axis = g.axis
    const size = document.createElement('span')
    size.className = 'gap-size'
    size.textContent = String(round(g.to - g.from, 0))
    if (box.rotation) size.style.transform = `rotate(${-box.rotation}deg)`
    span.append(size)
    parts.push(span)
  }
  return parts
}
