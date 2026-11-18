import { describe, expect, it } from 'vitest'

import type { ExportedFile } from '@dazbee/export'
import type { ResourceBytes } from '@dazbee/renderer'
import type { Design } from '@dazbee/schema'

import {
  BIG_EXPORT_PIXELS,
  biggestFramePixels,
  exportClient,
  type ExportJob,
  type ExportReply,
  type ExportWorker,
  type SampleJob,
} from './export-client.ts'

/** A stand-in worker: it keeps the jobs posted to it and replies when told. */
class FakeWorker implements ExportWorker {
  jobs: (ExportJob | SampleJob)[] = []
  terminated = false
  onmessage: Worker['onmessage'] = null
  onerror: Worker['onerror'] = null
  postMessage(job: ExportJob | SampleJob) {
    this.jobs.push(job)
  }
  terminate() {
    this.terminated = true
  }
  reply(data: ExportReply) {
    this.onmessage?.call(this as unknown as Worker, { data } as MessageEvent)
  }
}

const frame = (width: number, height: number) => ({ pageId: 'p', name: 'F', width, height, x: 0, y: 0, order: 'a0' })
/** A post and a 5,000 × 5,000 billboard: 25 million pixels at 1x, 100 million at 2x. */
const design = {
  meta: { designId: 'd', name: 'D' },
  pages: { p: { name: 'P', order: 'a0' } },
  frames: { post: frame(1080, 1080), board: frame(5000, 5000) },
  nodes: {},
} as unknown as Design
const bytes: ResourceBytes = {
  fonts: [{ family: 'Noto Sans', bytes: new Uint8Array([1]) }],
  fallbackFamilies: [],
  images: {},
}
const file: ExportedFile = { name: 'F.png', type: 'image/png', bytes: new Uint8Array([1]) }
/** A frame's pixels as the worker answers a sample with them. */
const drawn = (width: number, height: number) => ({ width, height, pixels: new Uint8Array(4) })
/** The bytes with an image, which a fresh worker is sent again. */
const withImage: ResourceBytes = { ...bytes, images: { photo: new Uint8Array([9]) } }

function client() {
  const made: FakeWorker[] = []
  const exporter = exportClient(() => {
    const worker = new FakeWorker()
    made.push(worker)
    return worker
  })
  return { exporter, made }
}

describe('biggestFramePixels', () => {
  it('counts the biggest raster frame at its scale, and nothing for PDF or SVG', () => {
    expect(biggestFramePixels(design, { frameIds: ['post'], type: 'png' })).toBe(1080 * 1080)
    expect(biggestFramePixels(design, { frameIds: ['post'], type: 'webp', scale: 3 })).toBe(3240 * 3240)
    expect(biggestFramePixels(design, { frameIds: ['post', 'board'], type: 'jpg' })).toBe(25_000_000)
    expect(biggestFramePixels(design, { frameIds: ['board'], type: 'pdf', scale: 3 })).toBe(0)
    // 15,000 pixels a side at 3x: the export refuses it, drawing nothing.
    expect(biggestFramePixels(design, { frameIds: ['post', 'board'], type: 'png', scale: 3 })).toBe(0)
    expect(25_000_000).toBeGreaterThan(BIG_EXPORT_PIXELS)
  })
})

describe('exportClient', () => {
  it('keeps its worker, and the fonts it was sent, between small exports', async () => {
    const { exporter, made } = client()
    const first = exporter.run(design, { frameIds: ['post'], type: 'png', scale: 2 }, bytes)
    made[0]?.reply({ id: 0, kind: 'done', file })
    await first
    const second = exporter.run(design, { frameIds: ['post'], type: 'png' }, bytes)
    made[0]?.reply({ id: 1, kind: 'done', file })
    expect(await second).toBe(file)
    expect(made).toHaveLength(1)
    expect(made[0]?.terminated).toBe(false)
    expect(made[0]?.jobs.map((job) => Boolean(job.fonts))).toEqual([true, false])
  })

  it('ends its worker after a big export, once no other job waits, and the next export starts afresh', async () => {
    const { exporter, made } = client()
    const big = exporter.run(design, { frameIds: ['post', 'board'], type: 'png' }, bytes)
    const small = exporter.run(design, { frameIds: ['post'], type: 'png' }, bytes)
    made[0]?.reply({ id: 0, kind: 'done', file })
    expect(await big).toBe(file)
    // The small export posted after it is still drawn by the same worker.
    expect(made[0]?.terminated).toBe(false)
    made[0]?.reply({ id: 1, kind: 'done', file })
    expect(await small).toBe(file)
    expect(made[0]?.terminated).toBe(true)

    const next = exporter.run(design, { frameIds: ['post'], type: 'jpg' }, bytes)
    expect(made).toHaveLength(2)
    // A fresh worker has no fonts yet, so they are sent again.
    expect(made[1]?.jobs[0]?.fonts).toBe(bytes.fonts)
    made[1]?.reply({ id: 2, kind: 'done', file })
    expect(await next).toBe(file)
    expect(made[1]?.terminated).toBe(false)
  })

  it('ends its worker after a big export that failed too', async () => {
    const { exporter, made } = client()
    const big = exporter.run(design, { frameIds: ['post'], type: 'webp', scale: 3 }, bytes)
    expect(biggestFramePixels(design, { frameIds: ['post'], type: 'webp', scale: 3 })).toBeLessThan(BIG_EXPORT_PIXELS)
    made[0]?.reply({ id: 0, kind: 'done', file })
    await big
    expect(made[0]?.terminated).toBe(false)
    const failed = exporter.run(design, { frameIds: ['board'], type: 'png' }, bytes)
    made[0]?.reply({ id: 1, kind: 'error', message: 'out of memory' })
    await expect(failed).rejects.toThrow('out of memory')
    expect(made[0]?.terminated).toBe(true)
  })

  it('a worker that crashes, or the editor closing, rejects every waiting job, and the next export starts afresh', async () => {
    const { exporter, made } = client()
    const first = exporter.run(design, { frameIds: ['post'], type: 'png' }, bytes)
    const second = exporter.run(design, { frameIds: ['board'], type: 'png' }, bytes)
    made[0]?.onerror?.call(made[0] as unknown as Worker, { message: 'crashed' } as ErrorEvent)
    await expect(first).rejects.toThrow('crashed')
    await expect(second).rejects.toThrow('crashed')
    expect(made[0]?.terminated).toBe(true)

    const third = exporter.run(design, { frameIds: ['board'], type: 'png' }, bytes)
    expect(made[1]?.jobs[0]?.fonts).toBe(bytes.fonts)
    exporter.destroy()
    await expect(third).rejects.toThrow('the editor closed')
    expect(made[1]?.terminated).toBe(true)
    // A big job's end leaves no mark on the next worker.
    const fourth = exporter.run(design, { frameIds: ['post'], type: 'png' }, bytes)
    made[2]?.reply({ id: 3, kind: 'done', file })
    await fourth
    expect(made[2]?.terminated).toBe(false)
  })
})

describe('exportClient sample', () => {
  it('draws only the latest frame asked for while the worker is busy, and hands on the pixels it was sent', async () => {
    const { exporter, made } = client()
    const first = exporter.sample(design, 'post', withImage)
    const replaced = exporter.sample(design, 'board', withImage)
    const latest = exporter.sample(design, 'post', withImage)
    // The worker is drawing the first: the second waits, and the third takes its place.
    expect(made[0]?.jobs.map((job) => job.kind)).toEqual(['sample'])
    expect(await replaced).toBeNull()
    const pixels = drawn(1080, 1080)
    made[0]?.reply({ id: 0, kind: 'sampled', sample: pixels })
    // The very pixels transferred, not a copy.
    expect(await first).toBe(pixels)
    const posted = made[0]?.jobs[1] as SampleJob
    expect(posted).toMatchObject({ kind: 'sample', frameId: 'post', images: {} })
    // Fonts and images go once to a worker.
    expect(posted.fonts).toBeUndefined()
    expect((made[0]?.jobs[0] as SampleJob).images.photo).toBe(withImage.images.photo)
    expect(JSON.parse(posted.design)).toEqual(design)
    made[0]?.reply({ id: 2, kind: 'sampled', sample: pixels })
    expect(await latest).toBe(pixels)
    expect(made).toHaveLength(1)
  })

  it('waits behind an export, and is then drawn by the same worker', async () => {
    const { exporter, made } = client()
    const exported = exporter.run(design, { frameIds: ['post'], type: 'png' }, bytes)
    const sampled = exporter.sample(design, 'post', bytes)
    expect(made[0]?.jobs.map((job) => job.kind)).toEqual(['export'])
    made[0]?.reply({ id: 0, kind: 'done', file })
    await exported
    expect(made[0]?.jobs.map((job) => job.kind)).toEqual(['export', 'sample'])
    made[0]?.reply({ id: 1, kind: 'sampled', sample: drawn(1080, 1080) })
    expect(await sampled).toMatchObject({ width: 1080 })
  })

  it('after a big export ended the worker, starts a fresh one and sends it fonts and images again', async () => {
    const { exporter, made } = client()
    const big = exporter.run(design, { frameIds: ['board'], type: 'png' }, withImage)
    const sampled = exporter.sample(design, 'post', withImage)
    made[0]?.reply({ id: 0, kind: 'done', file })
    await big
    expect(made[0]?.terminated).toBe(true)
    expect(made[0]?.jobs).toHaveLength(1)
    const job = made[1]?.jobs[0] as SampleJob
    expect(job.kind).toBe('sample')
    expect(job.fonts).toBe(bytes.fonts)
    expect(job.images.photo).toBe(withImage.images.photo)
    made[1]?.reply({ id: 1, kind: 'sampled', sample: drawn(1080, 1080) })
    expect(await sampled).not.toBeNull()
  })

  it('ends the worker after a sample past BIG_EXPORT_PIXELS, and the next starts afresh', async () => {
    const { exporter, made } = client()
    const big = exporter.sample(design, 'board', withImage)
    made[0]?.reply({ id: 0, kind: 'sampled', sample: drawn(5000, 5000) })
    await big
    expect(made[0]?.terminated).toBe(true)
    const next = exporter.sample(design, 'post', withImage)
    expect((made[1]?.jobs[0] as SampleJob).fonts).toBe(bytes.fonts)
    expect((made[1]?.jobs[0] as SampleJob).images.photo).toBe(withImage.images.photo)
    made[1]?.reply({ id: 1, kind: 'sampled', sample: drawn(1080, 1080) })
    await next
    expect(made[1]?.terminated).toBe(false)
  })

  it('rejects a sample the worker failed on, or crashed during, and draws the one waiting in a fresh worker', async () => {
    const { exporter, made } = client()
    const failed = exporter.sample(design, 'post', bytes)
    made[0]?.reply({ id: 0, kind: 'error', message: 'out of memory' })
    await expect(failed).rejects.toThrow('out of memory')

    const crashed = exporter.sample(design, 'post', bytes)
    const waiting = exporter.sample(design, 'post', bytes)
    made[0]?.onerror?.call(made[0] as unknown as Worker, { message: 'crashed' } as ErrorEvent)
    await expect(crashed).rejects.toThrow('crashed')
    expect(made[0]?.terminated).toBe(true)
    expect((made[1]?.jobs[0] as SampleJob).fonts).toBe(bytes.fonts)
    made[1]?.reply({ id: 2, kind: 'sampled', sample: drawn(1080, 1080) })
    expect(await waiting).not.toBeNull()
  })

  it('lets go of the sample waiting when told, and of one whose frame is gone by the time the worker is idle', async () => {
    const { exporter, made } = client()
    const exported = exporter.run(design, { frameIds: ['post'], type: 'png' }, bytes)
    const cancelled = exporter.sample(design, 'post', bytes)
    exporter.cancelSample()
    expect(await cancelled).toBeNull()
    // The design is live: the frame is deleted while the sample waits behind the export.
    const live = structuredClone(design)
    const gone = exporter.sample(live, 'post', bytes)
    delete (live.frames as Record<string, unknown>).post
    made[0]?.reply({ id: 0, kind: 'done', file })
    await exported
    expect(await gone).toBeNull()
    expect(made[0]?.jobs.map((job) => job.kind)).toEqual(['export'])
  })

  it('rejects the samples drawing and waiting when the editor closes', async () => {
    const { exporter, made } = client()
    const drawing = exporter.sample(design, 'post', bytes)
    const waiting = exporter.sample(design, 'post', bytes)
    exporter.destroy()
    await expect(drawing).rejects.toThrow('the editor closed')
    await expect(waiting).rejects.toThrow('the editor closed')
    expect(made[0]?.terminated).toBe(true)
  })
})
