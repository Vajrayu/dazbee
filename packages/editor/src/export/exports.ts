// Exporting one frame of the design as this tab holds it, drawn here on the CPU surface as pixels.
import type { CanvasKit } from '@dazbee/canvaskit'
import type { Session } from '@dazbee/doc'
import { renderPixels, type ResourceBytes, type ResourceCache } from '@dazbee/renderer'
import type { Design } from '@dazbee/schema'

import type { EditorView } from '../canvas/view.ts'
import type { SampledFrame } from '../gestures/colour-pick.ts'
import type { EditorResources } from '../resources.ts'

export interface ExportsDeps {
  ck: CanvasKit
  cache: ResourceCache
  session: Pick<Session, 'design'>
  resources: Pick<EditorResources, 'bytes'>
  view: Pick<EditorView, 'defaultFrame'>
}

/** What the `Editor`'s `exportPixels` does. */
export interface EditorExports {
  pixels(frameId?: string): Uint8Array
  /** A frame of a design drawn whole at 1x with these bytes, as the 1x export draws it: what picking a colour reads with no worker. */
  frame(design: Design, frameId: string, bytes: ResourceBytes): SampledFrame
}

export function editorExports({ ck, cache, session, resources, view }: ExportsDeps): EditorExports {
  const { defaultFrame } = view

  /** A frame drawn as pixels, shown or not; the shown page's first frame by default. */
  function exportPixels(frameId?: string) {
    return drawFrame(session.design(), frameId ?? defaultFrame().id, resources.bytes()).pixels
  }
  function drawFrame(design: Design, frameId: string, bytes: ResourceBytes): SampledFrame {
    try {
      const { width, height, pixels } = renderPixels(ck, design, frameId, bytes, cache)
      return { width, height, pixels }
    } finally {
      // The originals it decoded are let go: the screen draws display copies, which the cache doesn't hold.
      cache.resources({ ...bytes, images: {} })
    }
  }

  return {
    pixels: exportPixels,
    frame: drawFrame,
  }
}
