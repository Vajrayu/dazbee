// The image worker's jobs: decodes an image the screen draws and shrinks it to its
// display copy off the main thread, so a big photo arriving never stalls the editor. It runs in
// the editor's worker (`editor-worker`) with a CanvasKit of its own, loaded at the first copy, and
// keeps nothing between jobs: the client ends the worker once it has been idle a while, which gives
// back the memory its biggest decode took.
import type { CanvasKit } from '@dazbee/canvaskit'

import { madeCopy } from './display-copies.ts'
import type { CopyJob, CopyReply } from './image-client.ts'
import { loadCanvasKit } from './vendor.ts'

let loaded: Promise<CanvasKit> | undefined

/** Makes the copy a job asks for and answers with it, transferring its pixels. */
export async function copyJob(job: CopyJob, answer: (reply: CopyReply, transfer: Transferable[]) => void) {
  try {
    const copy = madeCopy(await (loaded ??= loadCanvasKit()), job.bytes, job.side)
    answer({ id: job.id, copy }, copy ? [copy.pixels.buffer] : [])
  } catch (error) {
    // CanvasKit may have aborted (an allocation too big), which no later job survives: the client
    // ends this worker and starts another.
    answer({ id: job.id, copy: null, crashed: error instanceof Error ? error.message : String(error) }, [])
  }
}
