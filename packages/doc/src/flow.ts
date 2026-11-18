// Which layers a laid-out box's flow places: those that are neither absolute nor hidden. An
// absolute layer and a hidden one keep their stored place. How a layer sizes on each axis, where
// Fill stretches it, and which sides of a parent its layers set.
import type { AutoLayout, Design, Layer } from '@dazbee/schema'

import { childrenOf, fitOf, fitsItsLayers } from './children.ts'
import type { Box } from './geometry.ts'

export type Sizing = 'fixed' | 'hug' | 'fill'

export type Axis = 'width' | 'height'

/** A box with auto layout, as a design or a scene holds it: its layout set. */
export type LaidOutBox<L> = Extract<L, { type: 'box' }> & { props: { layout: AutoLayout } }

/** What sizingOf reads of a layer: its own sizing, and a text's box mode. */
type SizedLayer = {
  type: string | undefined
  props: { sizing?: { width: Sizing; height: Sizing } | undefined; boxMode?: string | undefined }
}

/** Whether a layer takes a place in a laid-out parent's flow: it is neither absolute nor hidden. */
export const flows = (layer: { props: { absolute?: boolean | undefined; visible: boolean } }) =>
  !layer.props.absolute && layer.props.visible

/** Whether a layer is a box that lays out what it holds with auto layout. */
export function laidOutBox(design: Design, id: string): boolean {
  return isLaidOutBox(design.nodes[id])
}

/**
 * Whether a layer, as a design or a scene holds it, is a box that lays out what it holds with auto
 * layout: the one rule the document's commands, the editor and the renderer tell such a box by.
 */
export function isLaidOutBox<L extends { type: string; props: object }>(layer: L | undefined): layer is LaidOutBox<L> {
  return layer?.type === 'box' && 'layout' in layer.props && layer.props.layout !== undefined
}

/**
 * The layout of the box whose flow places the first of these layers a flow places: a row, a column
 * or a grid; none where no flow places any.
 */
export function flowLayoutOf(design: Design, ids: readonly string[]): AutoLayout['direction'] | undefined {
  return ids.map((id) => flowAround(design, id)).find((flow) => flow !== null)?.direction
}

/** The layers a box's flow places once it is laid out, in its order. */
export function flowOf(design: Design, boxId: string): [string, Layer][] {
  return childrenOf(design, boxId).filter(([, node]) => flows(node))
}

/** Whether a container's flow places a layer held in it: the container is a laid-out box, and the layer flows in it. */
export function flowPlaces(design: Design, containerId: string, layer: Layer): boolean {
  return laidOutBox(design, containerId) && flows(layer)
}

/** Whether auto layout places a layer: its parent's flow places it. */
export function placedByFlow(design: Design, id: string): boolean {
  const node = design.nodes[id]
  return node !== undefined && flowPlaces(design, node.parentId, node)
}

/** How a layer sizes on each axis. Left unsaid, text hugs as its box mode says, and the rest is fixed. */
export function sizingOf(layer: SizedLayer): { width: Sizing; height: Sizing } {
  if (layer.props.sizing) return layer.props.sizing
  if (layer.type === 'text') return boxModeSizing(layer.props.boxMode)
  return { width: 'fixed', height: 'fixed' }
}

/** How a text sizes on each axis in a box mode: across its words only with Auto width, down them unless Fixed. */
export function boxModeSizing(boxMode: string | undefined): { width: Sizing; height: Sizing } {
  return { width: boxMode === 'autoWidth' ? 'hug' : 'fixed', height: boxMode === 'fixed' ? 'fixed' : 'hug' }
}

/**
 * A parent's box for some of its layers to line up with, `without` them, each box as `boxOf` has
 * it: a group's or a boolean's around the layers left in it (`fitOf`), none when none is left; any
 * other's as it is. `follows` names the axes along which its sides and middle move with those
 * layers: those a laid-out box fits its layers on, when its flow places one of them, since that fit
 * reads only what the flow places.
 */
export function boxWithout(
  design: Design,
  id: string,
  boxOf: (id: string) => Box | null | undefined,
  without: readonly string[],
): { box: Box; follows: Record<Axis, boolean> } | null {
  const parent = design.nodes[id]
  if (fitsItsLayers(parent)) {
    const box = fitOf(design, id, boxOf, without)
    return box && { box, follows: { width: false, height: false } }
  }
  const box = parent && boxOf(id)
  if (!box) return null
  const placed = without.some((one) => design.nodes[one]?.parentId === id && placedByFlow(design, one))
  const own = sizingOf(parent)
  return { box, follows: { width: placed && own.width === 'hug', height: placed && own.height === 'hug' } }
}

/** Whether Fit content can apply to a layer: a text fits its words, and a laid-out box what it holds. */
export function hugApplies(design: Design, id: string): boolean {
  return design.nodes[id]?.type === 'text' || laidOutBox(design, id)
}

/**
 * Whether Fill stretches a layer on `axis` in a laid-out box laid out `direction`, whose sides
 * `fits` says fit what they hold: across the flow always; along it in a grid, which gives each
 * layer a cell, or where that side doesn't fit, which leaves room to take. A layer turned by other
 * than a half turn has no one width or height to stretch, so it keeps its own.
 */
export function fillStretches(
  direction: 'row' | 'column' | 'grid',
  fits: Record<Axis, boolean>,
  rotation: number,
  axis: Axis,
): boolean {
  if (rotation % 180 !== 0) return false
  const along: Axis = direction === 'column' ? 'height' : 'width'
  return axis !== along || direction === 'grid' || !fits[axis]
}

/**
 * Whether a laid-out box's flow runs onto more lines: a row or a column set to wrap, while it keeps
 * its length along the flow (`hugsAlong` false), as FigCraft wraps. A box that fits what it holds
 * along the flow lays it out in one line, and a grid has its own rows.
 */
export function flowWraps(layout: Pick<AutoLayout, 'direction' | 'wrap'>, hugsAlong: boolean): boolean {
  return layout.wrap === true && layout.direction !== 'grid' && !hugsAlong
}

/**
 * Whether a layer is a laid-out box whose flow runs onto more lines (`flowWraps`): it fits what it
 * holds along the flow only while its flow places something.
 */
export function boxWraps(design: Design, id: string): boolean {
  const box = design.nodes[id]
  if (!isLaidOutBox(box)) return false
  const along: Axis = box.props.layout.direction === 'column' ? 'height' : 'width'
  return flowWraps(box.props.layout, sizingOf(box)[along] === 'hug' && flowOf(design, id).length > 0)
}

/**
 * Whether Fill on `axis` can apply to a layer: its box's flow places it, and would stretch it there
 * once that box keeps its own size. Along the flow of a box that fits what it holds, Fill applies
 * by fixing that box (`fillFixesBox`).
 */
export function fillApplies(design: Design, id: string, axis: Axis): boolean {
  const flow = flowAround(design, id)
  return flow !== null && fillStretches(flow.direction, { width: false, height: false }, flow.rotation, axis)
}

/**
 * Whether Fill on `axis` fixes the layer's box on that side, at the size it is drawn: Fill applies,
 * but the box fits what it holds there, which leaves no room to take.
 */
export function fillFixesBox(design: Design, id: string, axis: Axis): boolean {
  const flow = flowAround(design, id)
  if (!flow || !fillApplies(design, id, axis)) return false
  const own = sizingOf(flow.box)
  const fits = { width: own.width === 'hug', height: own.height === 'hug' }
  return !fillStretches(flow.direction, fits, flow.rotation, axis)
}

/** The laid-out box whose flow places a layer, with its direction and the layer's turn; null where no flow places it. */
function flowAround(design: Design, id: string) {
  const node = design.nodes[id]
  const box = node && design.nodes[node.parentId]
  if (!node || !isLaidOutBox(box) || !flows(node)) return null
  return { box, direction: box.props.layout.direction, rotation: node.props.rotation }
}
