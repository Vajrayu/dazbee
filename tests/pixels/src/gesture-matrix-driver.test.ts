import { describe, expect, it, vi } from 'vitest'

import type { TestEditor } from '@dazbee/editor/test-editor'
import { frameDesign } from '@dazbee/editor/test-matrix'

import { nodeDriver } from './gesture-matrix-driver.ts'

/** The test editor the driver last opened. */
const last = vi.hoisted(() => ({ editor: null as TestEditor | null }))

vi.mock('@dazbee/editor/test-editor', async (actual) => {
  const real = await actual<typeof import('@dazbee/editor/test-editor')>()
  return {
    ...real,
    testEditor: async (...args: Parameters<typeof real.testEditor>) => {
      last.editor = await real.testEditor(...args)
      return last.editor
    },
  }
})

describe('nodeDriver', () => {
  it.each([
    ['setSnapping', (driver: ReturnType<typeof nodeDriver>) => driver.setSnapping(false)],
    ['fitFrame', (driver: ReturnType<typeof nodeDriver>) => driver.fitFrame('sq')],
    ['select', (driver: ReturnType<typeof nodeDriver>) => driver.select([])],
  ] as const)("rejects with what the core's %s throws", async (call, run) => {
    const driver = nodeDriver(new Uint8Array())
    await driver.open(() => frameDesign({ name: 'Throws' }))
    const core = last.editor?.core
    if (!core) throw new Error('the driver opened no test editor')
    vi.spyOn(core, call).mockImplementation(() => {
      throw new Error(`${call} threw`)
    })
    await expect(run(driver)).rejects.toThrow(`${call} threw`)
    expect(await driver.takeErrors()).toEqual([])
    driver.end()
  })
})
