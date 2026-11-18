// Builders of designs as tests seed them: one frame holding given layers, and frames of linked
// copies added beside it, with the ids each copy takes; and a design as JSON that reads the same
// for the same design, as tests compare them.
import {
  type Design as Stored,
  type DesignInput,
  frameIdOf,
  framesOf,
  type Layer,
  NEW_FRAME_FILLS,
  newFramePosition,
} from '@dazbee/schema'

type Node = DesignInput['nodes'][string]
/** A layer as the builders take it: its link may be left out, and is then its own id. */
export type Seeded = Node extends unknown ? Omit<Node, 'link'> & { link?: string } : never

/**
 * A design as the editor stores it, each layer with what every layer has and its props loose, so a
 * test reads any layer's props without narrowing by its type.
 */
export interface Design extends Pick<Stored, 'meta' | 'pages' | 'frames'> {
  nodes: Record<
    string,
    Pick<Layer, 'type' | 'parentId' | 'link' | 'index' | 'name' | 'lock'> & {
      bindings?: Record<string, string>
      props: Record<string, unknown>
    }
  >
}

/** A frame `linkedFrames` adds: its id, name and size, and the copies' own values, by the layer each copies. */
export interface LinkedFrame {
  id: string
  name: string
  width: number
  height: number
  values?: Record<string, Record<string, unknown>> | undefined
}
type FrameInput = DesignInput['frames'][string]

/**
 * A design of one page, `p1`, holding one frame at 0, 0 (`sq`, 1080 × 1080, white and named Square
 * unless given), which holds `nodes`; each layer's link is its own id unless given.
 */
export function frameDesign({
  name,
  frameId = 'sq',
  frameName = 'Square',
  width = 1080,
  height = 1080,
  fills = NEW_FRAME_FILLS,
  nodes = {},
}: {
  name: string
  frameId?: string
  frameName?: string
  width?: number
  height?: number
  fills?: FrameInput['fills']
  nodes?: Record<string, Seeded>
}): DesignInput {
  return {
    meta: { designId: 'replaced-by-the-api', name },
    pages: { p1: { name: 'Page 1', order: 'a0' } },
    frames: { [frameId]: { pageId: 'p1', name: frameName, width, height, x: 0, y: 0, fills, order: 'a0' } },
    nodes: Object.fromEntries(
      Object.entries(nodes).map(([id, node]) => [id, { ...node, link: node.link ?? id } as Node]),
    ),
  }
}

/** The layers a frame holds, however deep, as `[id, layer]` pairs in the design's order. */
export const layersIn = <L extends { parentId: string }>(
  design: { frames: Record<string, unknown>; nodes: Record<string, L> },
  frameId: string,
): [string, L][] => Object.entries(design.nodes).filter(([id]) => frameIdOf(design, id) === frameId)

/** The id of a layer's linked copy in another frame, as `linkedFrames` names it. */
export const copyIn = (frameId: string, id: string) => `${frameId}-${id}`

/**
 * Adds frames to a page, `p1` by default, each where the frame rule puts it (newFramePosition) with
 * the fills of the page's first frame, holding a linked copy of every layer of that frame:
 * `copyIn(frame, id)` of layer `id`, with its link, inside the copy of its parent, its props with
 * `values[id]` on top.
 */
export function linkedFrames(design: DesignInput, frames: LinkedFrame[], pageId = 'p1'): DesignInput {
  const all = { ...design.frames }
  const nodes = { ...design.nodes }
  const onPage = () => framesOf({ frames: all }, pageId)
  const [first] = onPage()
  if (!first) throw new Error(`page ${pageId} has no frame`)
  const [firstId, firstFrame] = first
  const layers = layersIn(design, firstId)
  for (const { id: frameId, name, width, height, values = {} } of frames) {
    const placed = onPage().map(([, frame]) => ({ x: frame.x, y: frame.y, width: frame.width }))
    all[frameId] = {
      pageId,
      name,
      width,
      height,
      ...newFramePosition(placed),
      fills: firstFrame.fills,
      order: `a${placed.length}`,
    }
    for (const [id, node] of layers) {
      nodes[copyIn(frameId, id)] = {
        ...node,
        parentId: node.parentId === firstId ? frameId : copyIn(frameId, node.parentId),
        props: { ...node.props, ...values[id] },
      } as Node
    }
  }
  return { ...design, frames: all, nodes }
}

/** A value as JSON with every object's keys sorted, however deep, so the same design reads the same. */
export const sortedJson = (value: unknown) => JSON.stringify(sortedKeys(value))

/** A value with every object's keys sorted, however deep; arrays keep their order. */
function sortedKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedKeys)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([key, inner]) => [key, sortedKeys(inner)]),
  )
}
