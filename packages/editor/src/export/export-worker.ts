// The export worker's jobs (#55): draws exports on the CPU surface off the main thread, so the
// editor stays responsive while it makes every frame, and a frame whole at 1x for picking a colour.
// It runs in the editor's worker (`editor-worker`) with its own CanvasKit and keeps the
// fonts and images it was sent between jobs, so each is decoded once.
import type { CanvasKit } from '@dazbee/canvaskit'
import { exportDesign, type ExportedFile } from '@dazbee/export'
import { renderPixels, type ResourceBytes, type ResourceCache, resourceCache } from '@dazbee/renderer'

import { loadCanvasKit } from '../vendor.ts'
import type { ExportJob, ExportReply, SampleJob } from './export-client.ts'

let loaded: Promise<{ ck: CanvasKit; cache: ResourceCache }> | undefined
const bytes: ResourceBytes = { fonts: [], fallbackFamilies: [], images: {} }

/** Runs an export job, answering with its progress and then its file, transferred, or what went wrong. */
export async function exportJob(job: ExportJob, answer: (reply: ExportReply, transfer?: Transferable[]) => void) {
  try {
    const { ck, cache } = await kept(job)
    const file: ExportedFile = exportDesign(
      ck,
      JSON.parse(job.design),
      job.request,
      { ...bytes, ...(job.variables ? { variables: job.variables } : {}) },
      cache,
      (done, total) => answer({ id: job.id, kind: 'progress', done, total }),
    )
    answer({ id: job.id, kind: 'done', file }, [file.bytes.buffer])
  } catch (error) {
    answer({ id: job.id, kind: 'error', message: error instanceof Error ? error.message : String(error) })
  }
}

/**
 * Runs a sample job: draws the frame whole at 1x, as the 1x export draws it, and answers with its
 * pixels, transferred, so neither the surface (freed by the draw) nor a copy stays here.
 */
export async function sampleJob(job: SampleJob, answer: (reply: ExportReply, transfer?: Transferable[]) => void) {
  try {
    const { ck, cache } = await kept(job)
    const { width, height, pixels } = renderPixels(
      ck,
      JSON.parse(job.design),
      job.frameId,
      { ...bytes, ...(job.variables ? { variables: job.variables } : {}) },
      cache,
    )
    answer({ id: job.id, kind: 'sampled', sample: { width, height, pixels } }, [pixels.buffer])
  } catch (error) {
    answer({ id: job.id, kind: 'error', message: error instanceof Error ? error.message : String(error) })
  }
}

/** CanvasKit and the cache, loaded once, with the fonts and images a job sent kept beside those sent before. */
async function kept(job: ExportJob | SampleJob) {
  const ready = await (loaded ??= loadCanvasKit().then((ck) => ({ ck, cache: resourceCache(ck) })))
  if (job.fonts) bytes.fonts = job.fonts
  if (job.fallbackFamilies) bytes.fallbackFamilies = job.fallbackFamilies
  Object.assign(bytes.images, job.images)
  return ready
}
