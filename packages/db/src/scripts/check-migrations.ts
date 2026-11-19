// Fails when `tables.ts` holds a change that `packages/db/migrations` has no migration for.
import { MIGRATIONS } from '../index.ts'
import { checkMigrations } from '../migrations-check.ts'

const check = await checkMigrations(MIGRATIONS)
if (!check.ok) {
  console.error(check.output)
  console.error(`✗ tables.ts and packages/db/migrations disagree: ${check.reason}.`)
  console.error(
    '  Run `pnpm --filter @dazbee/db migration <name>` locally, answer its questions, and commit what it writes.',
  )
  process.exit(1)
}
console.log('Migrations match tables.ts OK')
