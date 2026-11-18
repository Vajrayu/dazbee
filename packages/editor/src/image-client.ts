// The main thread's side of the image worker: it asks for display copies and hands
// back their pixels. The worker starts with the first copy asked for and is ended once it has
// had nothing to do for IDLE_MS, since a worker's memory never shrinks after a big decode.
import { CopyLost, type CopyMaker, type MadeCopy } from './display-copies.ts'

export interface CopyJob {
  kind: 'copy'
  id: number
  bytes: Uint8Array
  side: number
}
export interface CopyReply {
  id: number
  copy: MadeCopy | null
  /** Set when making it threw, which may leave the worker's CanvasKit unusable: what went wrong. */
  crashed?: string
}

/** What the client uses of a worker, so a test can give it one that runs in Node. */
export interface CopyWorker {
  onmessage: ((event: { data: CopyReply }) => void) | null
  onerror: ((event: { message?: string }) => void) | null
  postMessage(job: CopyJob): void
  terminate(): void
}

/** How long the worker waits with nothing to do before it is ended. */
export const IDLE_MS = 10_000

export interface ImageClient {
  /** Makes a display copy in the worker; null when the bytes don't decode, and rejects when the worker failed. */
  make: CopyMaker
  destroy(): void
}

export function imageClient(
  start: () => CopyWorker = () =>
    new Worker(new URL('./editor-worker.ts', import.meta.url), { type: 'module' }) as unknown as CopyWorker,
): ImageClient {
  let worker: CopyWorker | undefined
  let next = 0
  let idle: ReturnType<typeof setTimeout> | undefined
  const waiting = new Map<number, { resolve: (copy: MadeCopy | null) => void; reject: (error: Error) => void }>()

  function started() {
    if (worker) return worker
    const made = start()
    made.onmessage = ({ data }) => {
      if (data.crashed !== undefined) return crash(data.crashed, data.id)
      const job = waiting.get(data.id)
      waiting.delete(data.id)
      job?.resolve(data.copy)
      rest()
    }
    made.onerror = (event) => crash(event.message || 'the image worker failed')
    worker = made
    return made
  }

  /**
   * Ends the worker, and the next copy asked for starts a fresh one. The job that failed it is
   * rejected with what went wrong, and the rest as lost. The worker makes copies in the order
   * asked, so when it ends without saying which, it was the oldest.
   */
  function crash(message: string, culprit = Math.min(...waiting.keys())) {
    for (const [id, job] of waiting) job.reject(id === culprit ? new Error(message) : new CopyLost(message))
    waiting.clear()
    stop()
  }

  /** Ends the worker once it has had nothing to do for IDLE_MS. */
  function rest() {
    clearTimeout(idle)
    if (waiting.size === 0) idle = setTimeout(stop, IDLE_MS)
  }

  function stop() {
    clearTimeout(idle)
    worker?.terminate()
    worker = undefined
  }

  return {
    make(bytes, side) {
      clearTimeout(idle)
      const to = started()
      const id = next++
      const copy = new Promise<MadeCopy | null>((resolve, reject) => waiting.set(id, { resolve, reject }))
      to.postMessage({ kind: 'copy', id, bytes, side })
      return copy
    },
    destroy() {
      crash('the editor closed', -1)
    },
  }
}
