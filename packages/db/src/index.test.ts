// Migrating a database as servers do on start, on a throwaway database beside the one
// `DATABASE_URL` names (the compose one locally and in CI).
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import pg from 'pg'
import { afterAll, describe, expect, it } from 'vitest'

import { migrateDatabase, MIGRATIONS, openDatabase } from './index.ts'

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://dazbee:dazbee-local@127.0.0.1:55432/dazbee'

const journal = JSON.parse(await readFile(join(MIGRATIONS, 'meta', '_journal.json'), 'utf8')) as {
  entries: unknown[]
}

/** Databases the cases made, dropped once they have run. */
const made: string[] = []

afterAll(async () => {
  const admin = new pg.Client({ connectionString: DATABASE_URL })
  await admin.connect()
  try {
    for (const name of made) await admin.query(`drop database if exists "${name}" with (force)`)
  } finally {
    await admin.end()
  }
})

/** Makes an empty database beside `DATABASE_URL`'s, dropped after the file runs; its URL. */
async function freshDatabase(): Promise<string> {
  const name = `dazbee_migrate_${randomUUID().slice(0, 8)}`
  const admin = new pg.Client({ connectionString: DATABASE_URL })
  await admin.connect()
  try {
    await admin.query(`create database "${name}"`)
  } finally {
    await admin.end()
  }
  made.push(name)
  const url = new URL(DATABASE_URL)
  url.pathname = `/${name}`
  return url.toString()
}

describe('migrateDatabase', () => {
  it('brings a new database up once when several servers start on it at the same moment', async () => {
    const url = await freshDatabase()
    const servers = Array.from({ length: 4 }, () => openDatabase(url))
    const reader = openDatabase(url, { max: 1 })
    try {
      const results = await Promise.allSettled(servers.map((server) => migrateDatabase(server.db)))
      expect(results.filter((r) => r.status === 'rejected')).toEqual([])
      const applied = await reader.db.$client.query('select count(*)::int as n from drizzle.__drizzle_migrations')
      expect(applied.rows[0].n).toBe(journal.entries.length)
    } finally {
      await Promise.all([...servers, reader].map((server) => server.close()))
    }
  }, 30_000)

  it('leaves the pool it was given usable, with every connection free', async () => {
    const url = await freshDatabase()
    const { db, close } = openDatabase(url, { max: 1 })
    try {
      await migrateDatabase(db)
      await migrateDatabase(db)
      const users = await db.$client.query('select count(*)::int as n from users')
      expect(users.rows[0].n).toBe(0)
    } finally {
      await close()
    }
  }, 30_000)
})
