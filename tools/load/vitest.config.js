import { defineConfig } from 'vitest/config'

import preset from '@dazbee/config/vitest'

// The scripts sit at the folder's root, with their tests. The workspace tests share one database, which
// is migrated once, before any of them run.
export default defineConfig({
  ...preset,
  test: { ...preset.test, include: ['*.test.ts'], globalSetup: ['./test-database.ts'] },
})
