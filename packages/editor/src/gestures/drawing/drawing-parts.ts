// The box a text, image box or frame drag is drawing, as an overlay element.
import type { Rect } from '@dazbee/schema'

import { type Camera, toScreen } from '../../canvas/camera.ts'
import type { Frame } from '../../canvas/frames.ts'
import { px } from '../../canvas/rulers.ts'
import type { ShownDrawing } from './drawing.ts'

/** The box a drag is drawing, drawn as a marquee is and marked with the drag's kind; nothing with none. */
export function drawingParts(
  drawn: ShownDrawing | null,
  camera: Camera,
  placeBox: (el: HTMLElement, frame: Frame, box: Rect) => void,
) {
  if (!drawn) return []
  const box = document.createElement('div')
  box.className = 'marquee'
  box.dataset[drawn.kind] = ''
  const { rect } = drawn
  if (drawn.frame) {
    placeBox(box, drawn.frame, rect)
    return [box]
  }
  const at = toScreen(camera, rect)
  Object.assign(box.style, {
    left: px(at.x),
    top: px(at.y),
    width: px(rect.width * camera.zoom),
    height: px(rect.height * camera.zoom),
  })
  return [box]
}
