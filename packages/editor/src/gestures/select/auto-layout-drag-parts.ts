// What a drag in a flow, or into one, shows, as overlay elements: each dragged layer following the
// pointer, the box the layers would leave and the line where they would go.
import type { Frame } from '../../canvas/frames.ts'
import type { Box } from '../../layers/transform.ts'
import type { FlowPart } from './auto-layout-drag.ts'

/** Each part outlined on the overlay, with the class of its kind. */
export function flowParts(parts: FlowPart[], outline: (className: string, frame: Frame, box: Box) => HTMLElement) {
  return parts.map((part) => outline(`reorder-${part.kind}`, part.frame, part.box))
}
