// The stage's cursors over the selection's hit zones: resize ones along the handle as the box is
// turned, in 45° steps, and the turning arrow outside a corner, drawn facing that corner.
import type { Grab } from '../gestures/hit-zones.ts'

/** Resize cursors point along the handle's direction as the box is turned. */
const RESIZE_CURSORS = ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize']
const HANDLE_ANGLE = { e: 0, se: 45, s: 90, sw: 135, w: 180, nw: 225, n: 270, ne: 315 }
/**
 * A curved double arrow bowing towards the right, about the cursor's centre at (12, 12): turned by
 * a corner's angle, it bows away from the selection there. The shaft is an arc of radius 9.5 about
 * (3, 12) from -48° to 48°, and each end has a solid head 4.6 px long and 7.2 px wide pointing
 * along the arc.
 */
const ROTATE_SHAFT = 'M9.36 4.94A9.5 9.5 0 0 1 9.36 19.06'
const ROTATE_HEADS = ['M5.94 1.86L12.21 2.67L7.39 8.02Z', 'M5.94 22.14L7.39 15.98L12.21 21.33Z']
/** The room around the 24 px drawing, so a head turned towards an edge keeps its tip and white edge. */
const ROTATE_ROOM = 2
const ROTATE_SIZE = 24 + 2 * ROTATE_ROOM
/** The drawing's centre, (12, 12), in the image: the hotspot. */
const ROTATE_HOTSPOT = 12 + ROTATE_ROOM

/** The resize cursor over a handle of a box turned by `rotation` degrees: the one nearest the handle's direction. */
export function resizeCursor(handle: keyof typeof HANDLE_ANGLE, rotation: number): string {
  return RESIZE_CURSORS[Math.round(((((HANDLE_ANGLE[handle] + rotation) % 180) + 180) % 180) / 45) % 4] ?? ''
}

/** The cursor outside a corner, where a press turns the selection, facing `angle` degrees from the selection's centre, 0 to the right and 90 down. */
export function rotateCursor(angle: number): string {
  const degrees = ((Math.round(angle) % 360) + 360) % 360
  // The white edge is drawn whole under the black, as the system's own cursors are.
  const shaft = (colour: string, width: number) =>
    `<path d="${ROTATE_SHAFT}" fill="none" stroke="${colour}" stroke-width="${width}" stroke-linecap="round"/>`
  const heads = (colour: string, width: number) =>
    ROTATE_HEADS.map(
      (d) => `<path d="${d}" fill="${colour}" stroke="${colour}" stroke-width="${width}" stroke-linejoin="round"/>`,
    ).join('')
  const white = shaft('white', 5) + heads('white', 3)
  const black = shaft('black', 2) + heads('black', 0.6)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${ROTATE_SIZE}" height="${ROTATE_SIZE}" viewBox="${-ROTATE_ROOM} ${-ROTATE_ROOM} ${ROTATE_SIZE} ${ROTATE_SIZE}"><g transform="rotate(${degrees} 12 12)">${white}${black}</g></svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${ROTATE_HOTSPOT} ${ROTATE_HOTSPOT}, crosshair`
}

/** The cursor over what a press would grab on a selection turned by `rotation` degrees; none over nothing or a radius dot. */
export function grabCursor(grab: Grab | null, rotation: number): string {
  if (!grab || grab.kind === 'radius') return ''
  if (grab.kind === 'rotate') return rotateCursor(grab.angle)
  // A line's end moves along the line, as its east handle would.
  return resizeCursor(grab.kind === 'end' ? 'e' : grab.handle, rotation)
}
