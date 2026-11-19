// The check CI runs: `drizzle-kit generate` on a copy of a migrations folder, against `tables.ts`.
import { cp, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { MIGRATIONS } from './index.ts'
import { checkMigrations } from './migrations-check.ts'

const folders: string[] = []

afterEach(async () => {
  await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })))
})

/** An empty folder, removed after the test. */
async function emptyFolder(): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), 'dazbee-migrations-test-'))
  folders.push(folder)
  return folder
}

/** A copy of the migrations, removed after the test. */
async function copiedMigrations(): Promise<string> {
  const folder = await emptyFolder()
  await cp(MIGRATIONS, folder, { recursive: true })
  return folder
}

/** A copy of the migrations whose newest snapshot calls the workspaces' `name` column `title`. */
async function migrationsWithRenamedColumn(): Promise<string> {
  const folder = await copiedMigrations()
  const snapshots = (await readdir(join(folder, 'meta'))).filter((file) => file.endsWith('_snapshot.json')).toSorted()
  const newest = join(folder, 'meta', snapshots.at(-1) ?? '')
  const snapshot = JSON.parse(await readFile(newest, 'utf8')) as {
    tables: Record<string, { columns: Record<string, { name: string }> }>
  }
  const columns = snapshot.tables['public.workspaces']?.columns ?? {}
  const { name, ...rest } = columns
  if (!name) throw new Error('the snapshot has no workspaces.name')
  snapshot.tables['public.workspaces'] = {
    ...snapshot.tables['public.workspaces'],
    columns: { ...rest, title: { ...name, name: 'title' } },
  }
  await writeFile(newest, JSON.stringify(snapshot))
  return folder
}

describe('checkMigrations', () => {
  it('passes the migrations kept with tables.ts', async () => {
    expect(await checkMigrations(MIGRATIONS)).toEqual({ ok: true })
  }, 30_000)

  it('fails a folder that lacks a migration tables.ts needs', async () => {
    const check = await checkMigrations(await emptyFolder())
    expect(check).toMatchObject({ ok: false, reason: 'drizzle-kit generate wrote a migration' })
  }, 30_000)

  it('fails when drizzle-kit would ask whether a column was renamed', async () => {
    const check = await checkMigrations(await migrationsWithRenamedColumn())
    expect(check).toMatchObject({ ok: false, reason: 'drizzle-kit generate asked a question or failed' })
  }, 30_000)

  it('fails a folder with a SQL file or snapshot its journal does not list', async () => {
    const withSql = await copiedMigrations()
    await writeFile(join(withSql, '0001_unlisted.sql'), 'select 1;')
    const withSnapshot = await copiedMigrations()
    await cp(join(withSnapshot, 'meta', '0000_snapshot.json'), join(withSnapshot, 'meta', '0001_snapshot.json'))
    const reason = 'the journal, the SQL files and the snapshots list different migrations'
    expect(await checkMigrations(withSql)).toMatchObject({ ok: false, reason })
    expect(await checkMigrations(withSnapshot)).toMatchObject({ ok: false, reason })
  })

  it('fails a run that goes past its time limit', async () => {
    const check = await checkMigrations(MIGRATIONS, 1)
    expect(check).toMatchObject({ ok: false, reason: 'drizzle-kit generate ran past 0.001 s' })
  }, 30_000)

  it('leaves the folder it checks as it was', async () => {
    const folder = await emptyFolder()
    await checkMigrations(folder)
    expect(await readdir(folder)).toEqual([])
  }, 30_000)
})
