// The canvas gesture matrix in both linked frames, run in Node: every canvas gesture against every
// kind of container, checked against what it should do (@dazbee/editor/test-matrix), through the
// test editor's driver (gesture-matrix-driver.ts). All 1050 rows run, shared out in the parts
// matrixParts gives, and each part writes its table of results to output/ under the file name
// matrixParts gives it.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { matrixParts, matrixRows, runMatrix } from '@dazbee/editor/test-matrix'

import { nodeDriver } from './gesture-matrix-driver.ts'
import { ASSETS_DIR, OUTPUT_DIR } from './pixels.ts'

const photo = new Uint8Array(readFileSync(join(ASSETS_DIR, 'sneaker.jpg')))

describe('the gesture matrix in Node', () => {
  for (const { frameId, subjects, title, file } of matrixParts()) {
    it(title, { timeout: 60_000 }, async () => {
      const driver = nodeDriver(photo)
      const { unexpected, table } = await runMatrix(driver, matrixRows(frameId, subjects)).finally(driver.end)
      mkdirSync(OUTPUT_DIR, { recursive: true })
      writeFileSync(join(OUTPUT_DIR, file), `${table}\n`)
      expect(unexpected).toEqual([])
    })
  }
})
