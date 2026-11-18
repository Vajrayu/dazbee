// How much of the design a press of undo or redo reads and compares: what its step touched, never the rest.
import { generateNKeysBetween } from 'fractional-indexing'
import { describe, expect, it, vi } from 'vitest'

import { parseDesign } from '@dazbee/schema'

import { openSession } from './session.ts'
import { openTestStore } from './test-store.ts'

/** The link ids of the layers the design view parsed, and of those it compared with what it held. */
const seen = { parsed: [] as string[], compared: [] as string[] }
const linkOf = (value: unknown) =>
  typeof value === 'object' && value !== null && 'parentId' in value && 'link' in value ? String(value.link) : null

vi.mock('@dazbee/schema', async (original) => {
  const real = await original<typeof import('@dazbee/schema')>()
  return {
    ...real,
    parseLayer: (value: unknown) => {
      const link = linkOf(value)
      if (link !== null) seen.parsed.push(link)
      return real.parseLayer(value)
    },
  }
})

vi.mock('./same-value.ts', async (original) => {
  const real = await original<typeof import('./same-value.ts')>()
  return {
    sameValue: (a: unknown, b: unknown) => {
      const link = linkOf(a)
      if (link !== null) seen.compared.push(link)
      return real.sameValue(a, b)
    },
  }
})

/** A session on one frame holding 5,000 layers, n0 to n4999. */
function large() {
  const indexes = generateNKeysBetween(null, null, 5000)
  const shape = { x: 1, y: 1, width: 1, height: 1, shape: { kind: 'rect' } }
  const parsed = parseDesign({
    meta: { designId: 'd', name: 'D' },
    pages: { p: { name: 'P', order: 'a0' } },
    frames: { f: { pageId: 'p', name: 'F', width: 1080, height: 1080, x: 0, y: 0, order: 'a0' } },
    nodes: Object.fromEntries(
      indexes.map((index, i) => [
        `n${i}`,
        { type: 'graphic', parentId: 'f', link: `l${i}`, index, name: 'R', props: shape },
      ]),
    ),
  })
  if (!parsed.success) throw new Error(parsed.errors.join('\n'))
  return openSession(openTestStore(parsed.design))
}

describe('a press of undo or redo', () => {
  it('reads and compares, of 5,000 layers, only the one its step touched', () => {
    const session = large()
    session.run('node.update', { ids: ['n7'], patch: { x: 20 } })
    session.design()
    for (const press of [() => session.undo(), () => session.redo()]) {
      seen.parsed = []
      seen.compared = []
      press()
      // The sync client compares the step's records too, as it makes and sends the press.
      const compared = [...new Set(seen.compared)]
      expect({ parsed: seen.parsed, compared }).toEqual({ parsed: ['l7'], compared: ['l7'] })
    }
  })
})
