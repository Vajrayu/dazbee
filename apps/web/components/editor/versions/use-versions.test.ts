import { afterEach, describe, expect, it } from 'vitest'

import type { Editor } from '@dazbee/editor'
import type { Design, VersionSummary } from '@dazbee/schema'

import { stopViewing, viewing, viewVersion } from './use-versions.ts'

/** A version of the history, by its id. */
const version = (id: string): VersionSummary => ({
  id,
  kind: 'named',
  name: id,
  description: '',
  savedBy: 'Ann',
  takenAt: '2026-11-16T14:30:00.000Z',
})
const design = (name: string) => ({ meta: { designId: 'd', name }, pages: {}, frames: {}, nodes: {} }) as Design

/** An editor whose fetches answer only when the test says, each with the design named after its version. */
function fetching() {
  const asked: { id: string; answer: () => void; fail: () => void }[] = []
  const editor = {
    fetchVersion: (id: string) =>
      new Promise((resolve, reject) =>
        asked.push({
          id,
          answer: () => resolve({ design: design(id), leftOut: [] }),
          fail: () => reject(new Error('the connection ended')),
        }),
      ),
  } as unknown as Editor
  return { editor, asked }
}

afterEach(() => {
  stopViewing()
})

describe('viewVersion', () => {
  it('shows the version clicked last, whichever answer comes first', async () => {
    const { editor, asked } = fetching()
    const first = viewVersion(editor, version('a'))
    const second = viewVersion(editor, version('b'))
    asked[1]?.answer()
    asked[0]?.answer()
    expect(await second).toEqual({ leftOut: 0 })
    expect(await first).toBe('stale')
    expect(viewing.get()?.design.meta.name).toBe('b')
  })

  it('shows nothing that answers after Back, and says nothing of a fetch that failed after it', async () => {
    const { editor, asked } = fetching()
    const answered = viewVersion(editor, version('a'))
    const failed = viewVersion(editor, version('b'))
    stopViewing()
    asked[0]?.answer()
    asked[1]?.fail()
    expect([await answered, await failed]).toEqual(['stale', 'stale'])
    expect(viewing.get()).toBeNull()
  })

  it('fetches nothing for the version already on the canvas, and says a failed fetch when it is the latest', async () => {
    const { editor, asked } = fetching()
    const shown = viewVersion(editor, version('a'))
    asked[0]?.answer()
    await shown
    expect(await viewVersion(editor, version('a'))).toBe('stale')
    expect(asked).toHaveLength(1)
    const failing = viewVersion(editor, version('b'))
    asked[1]?.fail()
    expect(await failing).toBe('failed')
  })
})
