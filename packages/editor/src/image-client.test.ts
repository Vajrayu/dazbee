import { afterEach, describe, expect, it, vi } from 'vitest'

import { loadCanvasKit } from '@dazbee/renderer/node'

import { CopyLost, madeCopy } from './display-copies.ts'
import { type CopyJob, type CopyReply, type CopyWorker, IDLE_MS, imageClient } from './image-client.ts'

const ck = await loadCanvasKit()

/** Workers that run each job in Node when the test lets them, with what each was asked and whether it ended. */
function workers() {
  const made: { jobs: CopyJob[]; ended: boolean; worker: CopyWorker; reply: () => void; crash: () => void }[] = []
  const start = (): CopyWorker => {
    const entry = {
      jobs: [] as CopyJob[],
      ended: false,
      worker: {
        onmessage: null,
        onerror: null,
        postMessage: (job: CopyJob) => entry.jobs.push(job),
        terminate: () => {
          entry.ended = true
        },
      } as CopyWorker,
      reply: () => {
        for (const job of entry.jobs.splice(0)) {
          const data: CopyReply = { id: job.id, copy: madeCopy(ck, job.bytes, job.side) }
          entry.worker.onmessage?.({ data })
        }
      },
      crash: () => entry.worker.onerror?.({ message: 'out of memory' }),
    }
    made.push(entry)
    return entry.worker
  }
  return { made, start }
}

function png(width: number, height: number) {
  const surface = ck.MakeSurface(width, height)
  if (!surface) throw new Error('no surface')
  surface.getCanvas().clear(ck.Color(0, 0, 255, 1))
  const image = surface.makeImageSnapshot()
  const bytes = image.encodeToBytes()
  image.delete()
  surface.delete()
  if (!bytes) throw new Error('could not encode')
  return bytes
}

afterEach(() => {
  vi.useRealTimers()
})

describe('imageClient', () => {
  it('starts one worker for the copies asked for and gives back each copy', async () => {
    const { made, start } = workers()
    const client = imageClient(start)
    const a = client.make(png(2000, 1000), 1024)
    const b = client.make(png(300, 300), 1024)
    expect(made).toHaveLength(1)
    made[0]?.reply()
    expect([(await a)?.width, (await a)?.height, (await b)?.width]).toEqual([1024, 512, 300])
    client.destroy()
  })

  it('ends the worker once it has had nothing to do for IDLE_MS, and starts a fresh one for the next copy', async () => {
    vi.useFakeTimers()
    const { made, start } = workers()
    const client = imageClient(start)
    const copy = client.make(png(200, 200), 1024)
    vi.advanceTimersByTime(IDLE_MS * 2)
    expect(made[0]?.ended).toBe(false)
    made[0]?.reply()
    await copy
    vi.advanceTimersByTime(IDLE_MS - 1)
    expect(made[0]?.ended).toBe(false)
    vi.advanceTimersByTime(1)
    expect(made[0]?.ended).toBe(true)
    const lost = client.make(png(200, 200), 1024)
    expect(made).toHaveLength(2)
    client.destroy()
    expect(made[1]?.ended).toBe(true)
    await expect(lost).rejects.toBeInstanceOf(CopyLost)
  })

  it('rejects the oldest copy a worker that failed was making, the rest as lost, and starts another for what comes next', async () => {
    const { made, start } = workers()
    const client = imageClient(start)
    const first = client.make(png(200, 200), 1024)
    const second = client.make(png(200, 200), 1024)
    made[0]?.crash()
    await expect(first).rejects.toThrow('out of memory')
    await expect(second).rejects.toBeInstanceOf(CopyLost)
    expect(made[0]?.ended).toBe(true)
    const next = client.make(png(200, 200), 1024)
    made[1]?.reply()
    expect((await next)?.width).toBe(200)
    client.destroy()
  })

  it('ends the worker when a job threw in it, blaming that job only', async () => {
    const { made, start } = workers()
    const client = imageClient(start)
    const first = client.make(png(200, 200), 1024)
    const second = client.make(png(200, 200), 1024)
    const [, job] = made[0]?.jobs ?? []
    made[0]?.worker.onmessage?.({ data: { id: job?.id ?? -1, copy: null, crashed: 'aborted' } })
    await expect(first).rejects.toBeInstanceOf(CopyLost)
    await expect(second).rejects.toThrow('aborted')
    await expect(second).rejects.not.toBeInstanceOf(CopyLost)
    expect(made[0]?.ended).toBe(true)
  })

  it('rejects every copy still on its way as lost when destroyed', async () => {
    const { start } = workers()
    const client = imageClient(start)
    const copy = client.make(png(200, 200), 1024)
    client.destroy()
    await expect(copy).rejects.toBeInstanceOf(CopyLost)
  })
})
