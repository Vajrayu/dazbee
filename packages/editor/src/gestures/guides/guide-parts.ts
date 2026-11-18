// The guides over the stage, from what the guide drag shows: each a line across its frame, a hot one
// thicker with its place in a pill by the line's start, kept clear of its ruler.
import { type Camera, toScreen } from '../../canvas/camera.ts'
import { RULER_SIZE } from '../../canvas/guides.ts'
import { px } from '../../canvas/rulers.ts'
import type { ShownGuide } from './guide-drag.ts'

/** Screen pixels the place's pill keeps from its line and from the ruler. */
const PLACE_GAP = 4

/** Each guide shown as a line across its frame, then a hot one's place beside it. */
export function guideParts(shown: readonly ShownGuide[], camera: Camera): HTMLElement[] {
  return shown.flatMap(({ frame, axis, at, hot }) => {
    const start = toScreen(camera, frame)
    const across = (axis === 'x' ? start.x : start.y) + at * camera.zoom
    const length = (axis === 'x' ? frame.height : frame.width) * camera.zoom
    const line = document.createElement('div')
    line.className = 'guide-line'
    line.dataset.axis = axis
    line.dataset.frame = frame.id
    if (hot) line.dataset.hot = ''
    Object.assign(
      line.style,
      axis === 'x'
        ? { left: px(across), top: px(start.y), height: px(length) }
        : { left: px(start.x), top: px(across), width: px(length) },
    )
    if (!hot) return [line]
    const place = document.createElement('span')
    place.className = 'guide-place'
    place.textContent = String(at)
    const along = Math.max(axis === 'x' ? start.y : start.x, RULER_SIZE) + PLACE_GAP
    Object.assign(
      place.style,
      axis === 'x'
        ? { left: px(across + PLACE_GAP), top: px(along) }
        : { left: px(along), top: px(across + PLACE_GAP) },
    )
    return [line, place]
  })
}
