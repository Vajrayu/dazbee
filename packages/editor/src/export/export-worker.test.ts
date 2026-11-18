// The export worker's sample job, run in Node with its CanvasKit: the frame's pixels are the 1x
// export's, handed back transferred, drawn with the fonts and images an earlier job sent.
import { describe, expect, it, vi } from 'vitest'

import { FALLBACK_FAMILIES } from '@dazbee/fonts'
import { loadFontFiles } from '@dazbee/fonts/node'
import { renderPixels } from '@dazbee/renderer'
import { loadCanvasKit } from '@dazbee/renderer/node'

import type { ExportReply } from './export-client.ts'
import { sampleJob } from './export-worker.ts'

// The worker loads CanvasKit from the app's files; in Node, from the package's.
vi.mock('../vendor.ts', () => ({ loadCanvasKit }))

const ck = await loadCanvasKit()

/** A frame with a red square and a word, over a half-clear background. */
const design = {
  meta: { designId: 'd', name: 'D' },
  pages: { p: { name: 'P', order: 'a0' } },
  frames: {
    f: {
      pageId: 'p',
      name: 'F',
      width: 120,
      height: 80,
      x: 0,
      y: 0,
      order: 'a0',
      fills: [{ type: 'solid', color: '#3366CC80' }],
    },
  },
  nodes: {
    square: {
      type: 'graphic',
      parentId: 'f',
      link: 'square',
      index: 'a0',
      name: 'Square',
      props: {
        x: 10.5,
        y: 10.25,
        width: 40,
        height: 30,
        rotation: 12,
        shape: { kind: 'rect' },
        fills: [{ type: 'solid', color: '#FF0000FF' }],
      },
    },
    word: {
      type: 'text',
      parentId: 'f',
      link: 'word',
      index: 'a1',
      name: 'Word',
      props: {
        x: 55,
        y: 40,
        width: 60,
        height: 30,
        text: 'Ag',
        style: { fontFamily: 'Noto Sans', fontSize: 24, fontWeight: 400, color: '#111111FF' },
      },
    },
  },
}
const fonts = loadFontFiles().map(({ family, bytes }) => ({ family, bytes }))

/** Runs a job and gives what it answered, with what it transferred. */
async function answered(job: Parameters<typeof sampleJob>[0]) {
  const replies: { reply: ExportReply; transfer: Transferable[] }[] = []
  await sampleJob(job, (reply, transfer = []) => replies.push({ reply, transfer }))
  return replies
}

describe('sampleJob', () => {
  it('answers with the 1x export’s pixels of the frame, transferred, and draws later frames with the fonts sent once', async () => {
    const expected = renderPixels(ck, design, 'f', { fonts, fallbackFamilies: [...FALLBACK_FAMILIES], images: {} })
    const job = { kind: 'sample', design: JSON.stringify(design), frameId: 'f', images: {} } as const
    const [first] = await answered({ ...job, id: 1, fonts, fallbackFamilies: [...FALLBACK_FAMILIES] })
    expect(first?.reply.kind).toBe('sampled')
    const sample = first?.reply.kind === 'sampled' ? first.reply.sample : null
    expect(sample).toMatchObject({ width: 120, height: 80 })
    expect(Buffer.from(sample?.pixels ?? []).equals(Buffer.from(expected.pixels))).toBe(true)
    // Handed over, not copied: the worker keeps no copy of the frame's pixels.
    expect(first?.transfer).toEqual([sample?.pixels.buffer])
    // A later job sends no fonts: the worker draws the text with the ones it was sent.
    const [second] = await answered({ ...job, id: 2 })
    const again = second?.reply.kind === 'sampled' ? second.reply.sample : null
    expect(Buffer.from(again?.pixels ?? []).equals(Buffer.from(expected.pixels))).toBe(true)
  })

  it('answers with what went wrong for a frame it can’t draw', async () => {
    const [only] = await answered({ kind: 'sample', id: 3, design: '{}', frameId: 'f', images: {} })
    expect(only?.reply).toMatchObject({ id: 3, kind: 'error' })
    expect(only?.transfer).toEqual([])
  })
})
