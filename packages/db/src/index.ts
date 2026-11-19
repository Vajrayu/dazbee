// The database every server shares: tables, migrations and a design as the sync server stores it.
import { fileURLToPath } from 'node:url'

import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import pg from 'pg'

import * as tables from './tables.ts'

export * from './ids.ts'
export * from './journal.ts'
export * from './tables.ts'
export * from './versions.ts'

export type Db = NodePgDatabase<typeof tables>

export interface Database {
  db: Db
  close(): Promise<void>
}

/** The migrations every database is brought up to, oldest first. */
export const MIGRATIONS = fileURLToPath(new URL('../migrations', import.meta.url))

export function openDatabase(url: string, { max = 4 } = {}): Database {
  const pool = new pg.Pool({ connectionString: url, max })
  return { db: drizzle(pool, { schema: tables }), close: () => pool.end() }
}

/** Brings the database up to the latest migration; servers call it on start. */
export async function migrateDatabase(db: Db): Promise<void> {
  await migrate(db, { migrationsFolder: MIGRATIONS })
}
