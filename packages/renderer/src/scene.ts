import { childrenOf } from '@dazbee/doc'
import { bindProps, type Design, type Layer, type Paint, type Variables } from '@dazbee/schema'

import { applyLayout, type MeasureText } from './layout.ts'

/**
 * One layer as a scene draws it: its props, bound to the brand's values, and its visible children.
 * A hidden layer the scene keeps faded has `faded`, the share of its own opacity its props hold.
 */
export type SceneLayer = {
  [T in Layer['type']]: {
    id: string
    type: T
    props: Extract<Layer, { type: T }>['props']
    children: SceneLayer[]
    faded?: number
  }
}[Layer['type']]

/**
 * A resolved tree for one frame, ready to draw on any surface.
 * Positions are in the frame's design pixels: a layer inside a box or group keeps its own frame
 * coordinates, and a container's rotation turns its children about the container's centre.
 */
export interface Scene {
  frameId: string
  width: number
  height: number
  fills: Paint[]
  layers: SceneLayer[]
}

/** How `render` builds the frame's layers. */
export interface RenderOptions {
  /**
   * Keeps the hidden layers, as the editor's stage shows them while hidden layers are shown: each
   * still hidden, so no flow places it, and masking nothing; the outermost hidden layer of each
   * branch at this share of its opacity, and the layers inside it as they are. A boolean's hidden
   * shapes stay out, since they would change its outline. Left out, as every export leaves it,
   * hidden layers are not in the scene.
   */
  hiddenOpacity?: number
}

/** How a layer is built: shown, hidden and faded, or hidden inside a faded layer. */
type HiddenLook = 'shown' | 'faded' | 'inside'

/**
 * Scene layers built before, by frame and layer, for the editor (#36): with it, `render` hands back
 * the same layer object while the layer and its children are the same objects, so a cache can know
 * an unchanged layer by identity alone.
 */
export type SceneMemo = Map<
  string,
  WeakMap<object, { variables: Variables | undefined; look: HiddenLook; layer: SceneLayer }>
>

/**
 * Builds the scene for one frame, auto layout solved: the frame's size and fills, and its
 * visible layers, or its hidden ones too as `options` asks. Pure: the design is only read. Without
 * `measure`, text in an auto layout keeps the size its box says. Bound properties take their values
 * from `variables`, the brand kit's, or stay as stored without one.
 */
export function render(
  design: Design,
  frameId: string,
  memo?: SceneMemo,
  measure?: MeasureText,
  variables?: Variables,
  { hiddenOpacity }: RenderOptions = {},
): Scene {
  const frame = Object.hasOwn(design.frames, frameId) ? design.frames[frameId] : undefined
  if (!frame) throw new Error(`no frame "${frameId}"`)
  let built = memo?.get(frameId)
  if (memo && !built) memo.set(frameId, (built = new WeakMap()))

  /** The layers under a parent; `faded`, whether a hidden layer holding them is faded already. */
  const layersUnder = (parentId: string, faded: boolean): SceneLayer[] =>
    childrenOf(design, parentId).flatMap(([id, node]) => {
      const hidden = !node.props.visible
      if (hidden && (hiddenOpacity === undefined || design.nodes[parentId]?.type === 'boolean')) return []
      const look: HiddenLook = !hidden ? 'shown' : faded ? 'inside' : 'faded'
      const children = layersUnder(id, faded || hidden)
      // Only a bound layer depends on the variables, so a brand change rebuilds only those.
      const used = node.bindings ? variables : undefined
      const before = built?.get(node)
      if (
        before &&
        before.variables === used &&
        before.look === look &&
        before.layer.id === id &&
        sameLayers(before.layer.children, children)
      )
        return [before.layer]
      const props = bindProps(node.type, node.props, node.bindings, used)
      const layer = {
        id,
        type: node.type,
        props: look === 'shown' ? props : shownHidden(props, look === 'faded' ? (hiddenOpacity ?? 1) : 1),
        children,
        ...(look === 'faded' && hiddenOpacity !== undefined ? { faded: hiddenOpacity } : {}),
      } as SceneLayer
      built?.set(node, { variables: used, look, layer })
      return [layer]
    })

  return {
    frameId,
    width: frame.width,
    height: frame.height,
    fills: frame.fills,
    layers: applyLayout(layersUnder(frameId, false), measure),
  }
}

export const sceneMemo = (): SceneMemo => new Map()

function sameLayers(a: SceneLayer[], b: SceneLayer[]) {
  return a.length === b.length && a.every((layer, i) => layer === b[i])
}

/** A hidden layer's props as the stage shows it: at `share` of its opacity, masking nothing. */
function shownHidden<P extends { opacity: number; mask?: unknown }>(props: P, share: number): P {
  const shown = { ...props, opacity: props.opacity * share }
  delete shown.mask
  return shown
}
