// The crop being made, as overlay elements: the window with its handles, and the whole image, faint
// outside the window and mirrored as the layer draws it, with a round handle on each corner.
import type { Frame } from '../../canvas/frames.ts'
import { type Box, handleAt, HANDLES } from '../../layers/transform.ts'
import { cornersOfRect } from './crop.ts'
import type { ShownCrop } from './cropping.ts'

/** The crop being made: the window with its handles, then the whole image, faint outside the window, with a round handle on each corner. */
export function cropParts(
  crop: ShownCrop | null,
  outline: (className: string, frame: Frame, box: Box) => HTMLElement,
): HTMLElement[] {
  if (!crop) return []
  const { frame, id, box, rect } = crop
  const pane = outline('selection', frame, crop.window)
  pane.dataset.cropping = id
  for (const handle of HANDLES) {
    const at = handleAt(handle)
    const el = document.createElement('div')
    el.className = at.x === 0.5 || at.y === 0.5 ? 'crop-bar' : 'crop-bracket'
    el.dataset.cropWindow = handle
    Object.assign(el.style, { left: `${at.x * 100}%`, top: `${at.y * 100}%` })
    pane.append(el)
  }
  const whole = outline('crop-image', frame, crop.whole)
  const ghost = document.createElement('div')
  ghost.className = 'crop-ghost'
  ghost.style.backgroundImage = `url("${crop.ghost}")`
  if (crop.flipX || crop.flipY) ghost.style.transform = `scale(${crop.flipX ? -1 : 1}, ${crop.flipY ? -1 : 1})`
  // Clear over the window, where the layer shows the image itself: in the faint picture's own
  // place, which its mirror then turns round with it.
  const x0 = (box.x - rect.x) / rect.width
  const y0 = (box.y - rect.y) / rect.height
  const x1 = x0 + box.width / rect.width
  const y1 = y0 + box.height / rect.height
  const [l, r] = (crop.flipX ? [1 - x1, 1 - x0] : [x0, x1]).map(percent)
  const [t, b] = (crop.flipY ? [1 - y1, 1 - y0] : [y0, y1]).map(percent)
  ghost.style.clipPath = `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${l} ${t}, ${l} ${b}, ${r} ${b}, ${r} ${t}, ${l} ${t})`
  whole.append(ghost)
  for (const i of cornersOfRect(rect).keys()) {
    const handle = document.createElement('div')
    handle.className = 'crop-zoom'
    handle.dataset.cropCorner = String(i)
    Object.assign(handle.style, { left: `${i === 1 || i === 2 ? 100 : 0}%`, top: `${i >= 2 ? 100 : 0}%` })
    whole.append(handle)
  }
  return [pane, whole]
}

/** A share of a side, as CSS. */
function percent(share: number) {
  return `${share * 100}%`
}
