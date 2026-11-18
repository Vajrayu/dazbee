import { defineConfig } from 'vitest/config'

import preset from '@dazbee/config/vitest'

import { SPEED_CHECKS } from './vitest.config.js'

// The speed checks alone, one file at a time, with nothing else running: `pnpm test` runs them last.
export default defineConfig({
  ...preset,
  test: { ...preset.test, include: SPEED_CHECKS, fileParallelism: false, testTimeout: 120_000 },
})
