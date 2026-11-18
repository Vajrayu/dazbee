// Copy as PNG's picture: the selected layers, or the picked frame, as a design and a frame the PNG
// export draws on the CPU surface, at 2x where the export takes it, else 1x.
import type { CanvasKit } from '@dazbee/canvaskit'
import { boundsOf, centreOf, openSession, plainStore, type Session } from '@dazbee/doc'
import { layerReach, render } from '@dazbee/renderer'
import { type Design, exportFits, type Layer, type LayerTree, type Rect } from '@dazbee/schema'

import type { FrameScenes } from '../canvas/scenes.ts'
import type { EditorView } from '../canvas/view.ts'
import type { EditorBoxes } from '../layers/boxes.ts'
import type { EditorPlace } from '../place.ts'
import type { EditorResources } from '../resources.ts'
import type { EditorSelection } from '../selection.ts'

/** What Copy as PNG draws: a frame of a design, at a scale the export takes. */
export interface PngCopy {
  design: Design
  frameId: string
  scale: 1 | 2
}

export interface PngCopyDeps {
  ck: CanvasKit
  session: Pick<Session, 'design'>
  view: Pick<EditorView, 'frameOf'>
  selection: Pick<EditorSelection, 'current' | 'pickedFrame'>
  boxes: Pick<EditorBoxes, 'drawnBoxOf'>
  scenes: Pick<FrameScenes, 'measure'>
  resources: Pick<EditorResources, 'bytes' | 'resources'>
  /** The selected layers as Copy takes them. */
  place: Pick<EditorPlace, 'copied'>
}

/**
 * What Copy as PNG takes, read when it is asked: the picked frame, or the selected layers as Copy
 * takes them, their top ones at their boxes as their frame draws them, and the frame they are in.
 */
export type PngChoice =
  { frameId: string } | { frame: { name: string; width: number; height: number }; tree: LayerTree }

export interface EditorPngCopy {
  /**
   * What Copy as PNG takes now: the picked frame, or the selected layers of the first selected
   * frame, as Copy takes them, each top one at its box as its frame draws it, turned by its
   * containers, with what it holds carried along. Null with nothing selected or picked, or while a
   * text is typed in.
   */
  chosen(): PngChoice | null
  /** The design a choice is drawn from, whose fonts and images it needs: the tab's own for a frame, or the layers alone. */
  designOf(choice: PngChoice): { design: Design; frameId: string }
  /**
   * What Copy as PNG draws for a choice, what is chosen now when none is given. A picked frame is the
   * frame itself, as its export draws it. The layers are drawn alone, their containers' paint,
   * opacity and clipping left out: in a frame of a design of their own, with no fill, as big as what
   * they draw, shadows and blurs included, to whole pixels. At the first of PNG_SCALES the export
   * takes; 'tooBig' when it takes none. Null when there is nothing to draw: nothing chosen, a frame
   * gone, or layers that draw nothing. What is chosen now is worked out once for the design, the
   * selection and the fonts as they are.
   */
  pngToCopy(choice?: PngChoice | null): PngCopy | 'tooBig' | null
}

/** The scales Copy as PNG draws at, the first the export takes: 2x, as FigCraft copies, else 1x. */
export const PNG_SCALES: readonly PngCopy['scale'][] = [2, 1]
/** The page and frame of the design the selected layers are drawn alone in. */
const COPY_PAGE = 'png-copy-page'
const COPY_FRAME = 'png-copy-frame'

export function editorPngCopy({
  ck,
  session,
  view,
  selection,
  boxes,
  scenes,
  resources,
  place,
}: PngCopyDeps): EditorPngCopy {
  /** The last answer for what is chosen now, with what it was worked out from. */
  let last: { from: readonly unknown[]; answer: PngCopy | 'tooBig' | null } | null = null

  function chosen(): PngChoice | null {
    const now = session.design()
    const picked = selection.pickedFrame()
    if (picked !== null && Object.hasOwn(now.frames, picked)) return { frameId: picked }
    const copied = place.copied()
    const frame = copied && view.frameOf(copied.frameId)
    if (!copied || !frame) return null
    // Each top layer as its frame draws it: its box turned by its containers, and what it holds
    // carried with its centre, which the layer's own turn then turns them about.
    const nodes = { ...copied.tree.nodes }
    for (const root of copied.tree.roots) {
      const node = nodes[root]
      const drawn = boxes.drawnBoxOf(frame, root, now)
      if (!node || !drawn) continue
      const from = centreOf({ ...node.props, rotation: 0 })
      const to = centreOf(drawn)
      nodes[root] = { ...node, props: { ...node.props, ...drawn } } as Layer
      for (const id of insideOf(copied.tree, root)) {
        const inner = nodes[id]
        if (inner)
          nodes[id] = {
            ...inner,
            props: { ...inner.props, x: inner.props.x + to.x - from.x, y: inner.props.y + to.y - from.y },
          } as Layer
      }
    }
    return { frame: { name: frame.name, width: frame.width, height: frame.height }, tree: { ...copied.tree, nodes } }
  }

  function designOf(choice: PngChoice) {
    if ('frameId' in choice) return { design: session.design(), frameId: choice.frameId }
    return { design: alone(session.design(), choice.frame, choice.tree, 0, 0), frameId: COPY_FRAME }
  }

  function pngToCopy(choice?: PngChoice | null): PngCopy | 'tooBig' | null {
    if (choice !== undefined) return choice && drawnFor(choice)
    const from = [session.design(), selection.current(), selection.pickedFrame(), resources.bytes().fonts]
    if (last?.from.every((value, i) => value === from[i])) return last.answer
    const now = chosen()
    last = { from, answer: now && drawnFor(now) }
    return last.answer
  }

  /** What Copy as PNG draws for a choice, as `pngToCopy` says. */
  function drawnFor(choice: PngChoice): PngCopy | 'tooBig' | null {
    const now = session.design()
    if ('frameId' in choice) {
      const frame = Object.hasOwn(now.frames, choice.frameId) ? now.frames[choice.frameId] : undefined
      return frame ? atScale(now, choice.frameId, frame) : null
    }
    const reach = reachOf(alone(now, choice.frame, choice.tree, 0, 0))
    if (!reach) return null
    const left = Math.floor(reach.x)
    const top = Math.floor(reach.y)
    const size = {
      width: Math.max(1, Math.ceil(reach.x + reach.width) - left),
      height: Math.max(1, Math.ceil(reach.y + reach.height) - top),
    }
    return atScale(alone(now, { name: choice.frame.name, ...size }, choice.tree, -left, -top), COPY_FRAME, size)
  }

  /**
   * Everything the copy frame's layers draw, in the frame: a mask draws nothing itself, so only what
   * it masks counts. Null when they draw nothing.
   */
  function reachOf(design: Design): Rect | null {
    const scene = render(design, COPY_FRAME, undefined, scenes.measure(), resources.bytes().variables)
    const drawn = resources.resources()
    const reaches = scene.layers
      .filter((layer) => !layer.props.mask)
      .map((layer) => ({ ...layerReach(ck, layer, drawn), rotation: 0 }))
      .filter((r) => r.width > 0 || r.height > 0)
    return reaches.length > 0 ? boundsOf(reaches) : null
  }

  return { chosen, designOf, pngToCopy }
}

/** A frame of a design at the first of PNG_SCALES the export takes; 'tooBig' when it takes none. */
function atScale(design: Design, frameId: string, frame: { width: number; height: number }): PngCopy | 'tooBig' {
  const scale = PNG_SCALES.find((s) => exportFits(frame, s))
  return scale ? { design, frameId, scale } : 'tooBig'
}

/**
 * A design of its own holding the tree alone, moved by `dx`, `dy`, in a frame of this size with
 * no fill, made on a scratch store as a paste makes it.
 */
function alone(
  now: Design,
  frame: { name: string; width: number; height: number },
  tree: LayerTree,
  dx: number,
  dy: number,
): Design {
  const trial = openSession(
    plainStore(
      {
        meta: now.meta,
        pages: { [COPY_PAGE]: { name: '', order: 'a0' } },
        frames: {
          [COPY_FRAME]: {
            pageId: COPY_PAGE,
            name: frame.name,
            width: frame.width,
            height: frame.height,
            x: 0,
            y: 0,
            fills: [],
            order: 'a0',
          },
        },
        nodes: {},
      },
      { scratch: true },
    ),
  )
  trial.run('design.place', { parentId: COPY_FRAME, tree, dx, dy })
  return trial.design()
}

/** The layers inside a layer of a tree, at every depth. */
function insideOf(tree: LayerTree, id: string): string[] {
  const under = Object.entries(tree.nodes).flatMap(([child, node]) => (node.parentId === id ? [child] : []))
  return under.flatMap((child) => [child, ...insideOf(tree, child)])
}
