// What measuring with Alt shows over the stage: the box measured to outlined, the distance lines,
// solid or dashed, and each line's value in the gap's pill, placed once drawn so that no pill
// covers another or the selection's size label.
import type { Rect } from '@dazbee/schema'

import { measureBetween, type Measured, placePills } from '../layers/measure.ts'
import type { Box } from '../layers/transform.ts'
import { type Camera, toScreen } from './camera.ts'
import type { Frame } from './frames.ts'
import { px } from './rulers.ts'

/**
 * The parts drawn: the box and the lines, drawn under the selection so none crosses its outline or
 * size label, and the pills, drawn over it; and what places the pills once they are on the overlay,
 * clear of `avoid`.
 */
export interface MeasureParts {
  lines: HTMLElement[]
  pills: HTMLElement[]
  place(avoid: readonly Rect[]): void
}

/** The parts of what Alt measures, at the camera; none when nothing is measured. */
export function measureParts(
  measured: Measured | null,
  camera: Camera,
  outline: (className: string, frame: Frame, box: Box) => HTMLElement,
): MeasureParts {
  if (!measured) return { lines: [], pills: [], place: () => {} }
  const { frame, from, to } = measured
  const lines: HTMLElement[] = [outline('measure-box', frame, { ...to, rotation: 0 })]
  const pills: { el: HTMLElement; from: { x: number; y: number }; to: { x: number; y: number } }[] = []
  const onScreen = (p: { x: number; y: number }) => toScreen(camera, { x: frame.x + p.x, y: frame.y + p.y })
  for (const line of measureBetween(from, to)) {
    const a = onScreen(line.from)
    const b = onScreen(line.to)
    const el = document.createElement('div')
    el.className = 'measure-line'
    el.dataset.axis = line.axis
    if (line.value === null) el.dataset.dashed = ''
    Object.assign(el.style, {
      left: px(Math.min(a.x, b.x)),
      top: px(Math.min(a.y, b.y)),
      width: px(line.axis === 'x' ? Math.abs(b.x - a.x) : 1),
      height: px(line.axis === 'y' ? Math.abs(b.y - a.y) : 1),
    })
    lines.push(el)
    if (line.value === null) continue
    const pill = document.createElement('span')
    pill.className = 'gap-size measure-value'
    pill.textContent = line.value
    pills.push({ el: pill, from: a, to: b })
  }
  function place(avoid: readonly Rect[]) {
    const sized = pills.map((p) => ({ from: p.from, to: p.to, width: p.el.offsetWidth, height: p.el.offsetHeight }))
    placePills(sized, avoid).forEach((box, i) => {
      const el = pills[i]?.el
      if (el) Object.assign(el.style, { left: px(box.x), top: px(box.y) })
    })
  }
  return { lines, pills: pills.map((p) => p.el), place }
}
