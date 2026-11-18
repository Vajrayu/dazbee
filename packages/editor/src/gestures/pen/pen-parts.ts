// The path the pen is drawing, or whose points are being edited, as overlay elements: its outline,
// its anchors, the handles of the anchors in play and the pen's next segment.
import type { Point } from '@dazbee/schema'

import { type Camera, toScreen } from '../../canvas/camera.ts'
import { px } from '../../canvas/rulers.ts'
import { pageFrom, round } from '../../layers/transform.ts'
import { type Anchor, anchorOf, sameRef, segmentsOf } from './path.ts'
import type { ShownPath } from './pen.ts'

/** The SVG namespace, for the outline of a path being drawn or edited. */
const SVG = 'http://www.w3.org/2000/svg'

/** What is shown of a path: its outline, its anchors, the handles of the anchors in play, and the pen's next segment. */
export function pathParts(now: ShownPath | null, camera: Camera): Element[] {
  if (!now) return []
  const { frame: f, around, path, handles, picked, preview, closing } = now
  const at = (q: Point) => {
    const p = pageFrom(q, around)
    return toScreen(camera, { x: f.x + p.x, y: f.y + p.y })
  }
  const xy = (q: Point) => {
    const p = at(q)
    return `${round(p.x)} ${round(p.y)}`
  }
  const svg = document.createElementNS(SVG, 'svg')
  svg.setAttribute('class', 'path-edit')
  const line = (className: string, d: string) => {
    const el = document.createElementNS(SVG, 'path')
    el.setAttribute('class', className)
    el.setAttribute('d', d)
    svg.append(el)
  }
  const outline: string[] = []
  for (const contour of path) {
    const [first] = contour.anchors
    if (!first) continue
    outline.push(`M${xy(first)}`)
    for (const [from, to] of segmentsOf(contour)) {
      const a = contour.anchors[from] as Anchor
      const b = contour.anchors[to] as Anchor
      outline.push(`C${xy(a.out ?? a)} ${xy(b.in ?? b)} ${xy(b)}`)
    }
  }
  line('path-outline', outline.join(' '))
  if (preview) {
    const [from, to] = preview
    line('pen-preview', `M${xy(from)} C${xy(from.out ?? from)} ${xy(to)} ${xy(to)}`)
  }
  const dots: HTMLElement[] = []
  const dot = (className: string, q: Point, data: Record<string, string>) => {
    const el = document.createElement('div')
    el.className = className
    const p = at(q)
    Object.assign(el.style, { left: px(p.x), top: px(p.y) })
    Object.assign(el.dataset, data)
    dots.push(el)
  }
  for (const ref of handles) {
    const anchor = anchorOf(path, ref)
    for (const side of ['in', 'out'] as const) {
      const h = anchor?.[side]
      if (!anchor || !h) continue
      line('path-handle-line', `M${xy(anchor)} L${xy(h)}`)
      dot('path-control', h, { control: `${ref.contour}:${ref.index}:${side}` })
    }
  }
  path.forEach((contour, c) =>
    contour.anchors.forEach((a, i) => {
      const data: Record<string, string> = { anchor: `${c}:${i}` }
      if (handles.some((r) => sameRef(r, { contour: c, index: i })) && picked) data.selected = ''
      if (closing && i === 0) data.closing = ''
      dot('path-anchor', a, data)
    }),
  )
  return [svg, ...dots]
}
