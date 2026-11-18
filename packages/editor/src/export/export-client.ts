// The main thread's side of the export worker (#55). It sends the design as the tab holds it, and
// fonts and images only the first time the worker needs them. It also asks the worker for a frame
// drawn whole at 1x, which picking a colour reads: only the latest of those waits.
import type { ExportedFile } from '@dazbee/export'
import type { ResourceBytes } from '@dazbee/renderer'
import {
  type Design,
  exportedSize,
  exportFits,
  ExportRequest,
  type ExportRequestInput,
  isRasterExport,
  type Variables,
} from '@dazbee/schema'

import type { SampledFrame } from '../gestures/colour-pick.ts'

export interface ExportJob {
  kind: 'export'
  id: number
  /** The design as JSON: the editor's live view of it is not something a worker can be sent. */
  design: string
  request: ExportRequestInput
  fonts?: ResourceBytes['fonts']
  fallbackFamilies?: string[]
  images: Record<string, Uint8Array>
  /** The brand kit's values bound layers take (#53), sent with every job: they are small. */
  variables?: Variables
}
/** A frame to draw whole at 1x, as the 1x export draws it, for picking a colour; fonts and images as an export's. */
export interface SampleJob extends Omit<ExportJob, 'kind' | 'request'> {
  kind: 'sample'
  frameId: string
}
/** The worker the client posts to: a dedicated worker, or a stand-in in a test. */
export type ExportWorker = Pick<Worker, 'postMessage' | 'terminate' | 'onmessage' | 'onerror'>

export type ExportReply =
  | { id: number; kind: 'progress'; done: number; total: number }
  | { id: number; kind: 'done'; file: ExportedFile }
  | { id: number; kind: 'sampled'; sample: SampledFrame }
  | { id: number; kind: 'error'; message: string }

/**
 * A job drawing a frame past this many pixels ends its worker once done: CanvasKit's wasm memory
 * grows to fit the biggest surface drawn and never shrinks, so a worker kept after one would hold
 * hundreds of megabytes for the tab’s life. The next job starts a fresh worker.
 */
export const BIG_EXPORT_PIXELS = 20_000_000

/**
 * The most pixels any one frame of the request is drawn at; 0 for PDF and SVG, and for a request
 * the export refuses, which draws nothing.
 */
export function biggestFramePixels(design: Design, input: ExportRequestInput): number {
  const parsed = ExportRequest.safeParse(input)
  if (!parsed.success || !isRasterExport(parsed.data.type)) return 0
  const { frameIds, scale } = parsed.data
  const frames = frameIds.map((frameId) => design.frames[frameId])
  if (frames.some((frame) => !frame || !exportFits(frame, scale))) return 0
  return Math.max(
    0,
    ...frames.map((frame) => {
      const { width, height } = exportedSize(frame as NonNullable<typeof frame>, scale)
      return width * height
    }),
  )
}

/** The export worker's client, which the editor's exports and the frames picking a colour reads share. */
export type ExportClient = ReturnType<typeof exportClient>

export function exportClient(
  makeWorker: () => ExportWorker = () =>
    new Worker(new URL('../editor-worker.ts', import.meta.url), { type: 'module' }),
) {
  let worker: ExportWorker | undefined
  /** Set by a big job: the worker is ended once no job is waiting on it. */
  let endWhenIdle = false
  let next = 0
  let fontsSent: ResourceBytes['fonts'] | undefined
  const imagesSent = new Map<string, Uint8Array>()
  /** The jobs posted to the worker and not yet answered: exports, and at most one sample. */
  const waiting = new Map<
    number,
    {
      progress?: (done: number, total: number) => void
      resolve: (answer: ExportedFile | SampledFrame) => void
      reject: (error: Error) => void
    }
  >()
  /** The latest sample asked for while the worker was busy, posted once it is idle. */
  let nextSample: {
    id: number
    design: Design
    frameId: string
    bytes: ResourceBytes
    resolve: (sample: SampledFrame | null) => void
    reject: (error: Error) => void
  } | null = null

  /** Ends the worker. A fresh one has nothing, so the next export sends everything again. */
  function end(ended: ExportWorker) {
    ended.terminate()
    if (worker !== ended) return
    worker = undefined
    endWhenIdle = false
    fontsSent = undefined
    imagesSent.clear()
  }

  function start() {
    const made = makeWorker()
    made.onmessage = ({ data }: MessageEvent<ExportReply>) => {
      const job = waiting.get(data.id)
      if (!job) return
      if (data.kind === 'progress') return job.progress?.(data.done, data.total)
      waiting.delete(data.id)
      if (endWhenIdle && waiting.size === 0) end(made)
      if (data.kind === 'done') job.resolve(data.file)
      else if (data.kind === 'sampled') job.resolve(data.sample)
      else job.reject(new Error(data.message))
      postSample()
    }
    made.onerror = (event) => {
      for (const job of waiting.values()) job.reject(new Error(event.message || 'the export worker failed'))
      waiting.clear()
      end(made)
      postSample()
    }
    return made
  }

  /** Posts a job to the worker, started if there is none, with the fonts and images it lacks; gives its answer. */
  function post<T>(
    job: (sent: Pick<ExportJob, 'fonts' | 'fallbackFamilies' | 'images' | 'variables'>) => ExportJob | SampleJob,
    bytes: ResourceBytes,
    progress?: (done: number, total: number) => void,
  ) {
    worker ??= start()
    const fresh = fontsSent !== bytes.fonts
    const images = Object.fromEntries(
      Object.entries(bytes.images).filter(([assetId, data]) => imagesSent.get(assetId) !== data),
    )
    const posted = job({
      images,
      ...(bytes.variables ? { variables: bytes.variables } : {}),
      ...(fresh ? { fonts: bytes.fonts, fallbackFamilies: bytes.fallbackFamilies } : {}),
    })
    const answer = new Promise<T>((resolve, reject) =>
      waiting.set(posted.id, {
        resolve: resolve as (answer: ExportedFile | SampledFrame) => void,
        reject,
        ...(progress ? { progress } : {}),
      }),
    )
    worker.postMessage(posted)
    fontsSent = bytes.fonts
    for (const [assetId, data] of Object.entries(images)) imagesSent.set(assetId, data)
    return answer
  }

  /** Posts the sample waiting, once the worker has nothing else to do. */
  function postSample() {
    const ask = nextSample
    if (!ask || waiting.size > 0) return
    nextSample = null
    const frame = Object.hasOwn(ask.design.frames, ask.frameId) ? ask.design.frames[ask.frameId] : undefined
    // The design is live: a frame deleted while its sample waited is not drawn.
    if (!frame) return ask.resolve(null)
    const size = exportedSize(frame, 1)
    post<SampledFrame>(
      (sent) => ({ kind: 'sample', id: ask.id, design: JSON.stringify(ask.design), frameId: ask.frameId, ...sent }),
      ask.bytes,
    ).then(ask.resolve, ask.reject)
    if (size.width * size.height > BIG_EXPORT_PIXELS) endWhenIdle = true
  }

  return {
    /** Exports the request from `design` in the worker; `progress` hears each file as it is made. */
    run(
      design: Design,
      request: ExportJob['request'],
      bytes: ResourceBytes,
      progress?: (done: number, total: number) => void,
    ) {
      const id = next++
      const result = post<ExportedFile>(
        (sent) => ({ kind: 'export', id, design: JSON.stringify(design), request, ...sent }),
        bytes,
        progress,
      )
      if (biggestFramePixels(design, request) > BIG_EXPORT_PIXELS) endWhenIdle = true
      return result
    },
    /**
     * Draws a frame of `design` whole at 1x in the worker, as the 1x export draws it, and gives its
     * pixels, transferred. While the worker is busy (an export, another sample) it waits, and a
     * later ask takes its place: the one replaced gives null.
     */
    sample(design: Design, frameId: string, bytes: ResourceBytes): Promise<SampledFrame | null> {
      nextSample?.resolve(null)
      const sampled = new Promise<SampledFrame | null>((resolve, reject) => {
        nextSample = { id: next++, design, frameId, bytes, resolve, reject }
      })
      postSample()
      return sampled
    },
    /** Lets go of the sample waiting, if one is, which gives null: the one drawing is drawn. */
    cancelSample() {
      nextSample?.resolve(null)
      nextSample = null
    },
    destroy() {
      if (worker) end(worker)
      for (const job of waiting.values()) job.reject(new Error('the editor closed'))
      waiting.clear()
      nextSample?.reject(new Error('the editor closed'))
      nextSample = null
    },
  }
}
