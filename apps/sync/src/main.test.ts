// The sync server as `main.ts` starts it (D10), in a process of its own on compose's Postgres. It
// answers a health check, welcomes a tab with a token, closes a tab built before it as too old, and
// folds and exits on SIGTERM; a tab with changes not yet stored then resends them to the next process,
// which stores each once, as during a deploy.
import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'

import { afterAll, describe, expect, it } from 'vitest'

import { loadDesignRows } from '@dazbee/db'
import { type Entry, SCHEMA_VERSION, SYNC_CLOSE } from '@dazbee/schema'

import { rename, storeSaved } from './test-saves.ts'
import { closeDatabase, db, secret, tokenFor, until } from './test-sync.ts'
import { clientTab, openTab, quiet } from './test-tab.ts'

const MAIN = fileURLToPath(new URL('./main.ts', import.meta.url))
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://dazbee:dazbee-local@127.0.0.1:55432/dazbee'

afterAll(() => closeDatabase())

/** Whether a journal entry is the design's second accepted change set. */
const isSecond = (entry: Entry) => entry.kind === 'accepted' && entry.changeSet.seq === 2

/** A port nothing listens on now. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as { port: number }
      probe.close(() => resolve(port))
    })
  })
}

/** Starts `main.ts` on a free port; resolves once it says it listens. */
async function startMain(): Promise<{
  child: ChildProcess
  url: string
  output: () => string
  stop: () => Promise<number | null>
}> {
  const port = await freePort()
  const child = spawn(process.execPath, [MAIN], {
    env: { ...process.env, DATABASE_URL, SYNC_PORT: String(port), SYNC_TOKEN_SECRET: secret },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString()))
  child.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString()))
  await until(() => output.includes('sync server on'), 20_000)
  const exited = new Promise<number | null>((resolve) => child.once('exit', (code) => resolve(code)))
  const stop = () => {
    child.kill('SIGTERM')
    return exited
  }
  return { child, url: `ws://127.0.0.1:${port}`, output: () => output, stop }
}

describe('main.ts', () => {
  it('starts the new sync server: health, a welcome, a tab too old, and a clean exit on SIGTERM', async () => {
    const { child, url } = await startMain()
    const exited = new Promise<number | null>((resolve) => child.once('exit', (code) => resolve(code)))
    try {
      const health = await fetch(url.replace('ws:', 'http:'))
      expect(health.ok).toBe(true)
      const designId = await storeSaved()
      const tab = await openTab(url, designId)
      tab.hello(tokenFor(designId))
      expect((await tab.next('welcome')).type).toBe('welcome')
      const old = await openTab(url, designId, { version: SCHEMA_VERSION - 1, design: null })
      expect(await old.whenClosed()).toBe(SYNC_CLOSE.tabTooOld)
      child.kill('SIGTERM')
      // The open tab is closed to reconnect elsewhere, and the process exits cleanly.
      expect(await tab.whenClosed()).toBe(1001)
      expect(await exited).toBe(0)
    } finally {
      if (child.exitCode === null) child.kill('SIGKILL')
    }
  }, 60_000)

  it('keeps the changes a tab had not yet stored through SIGTERM and a new process, storing each once', async () => {
    const first = await startMain()
    let second: Awaited<ReturnType<typeof startMain>> | undefined
    try {
      const designId = await storeSaved()
      const token = tokenFor(designId)
      const tab = await clientTab(first.url, designId, token)
      tab.edit(rename('l0', 'Stored'))
      await quiet(tab)
      // One change set is stored but its answer never reaches the tab; another is made while no
      // server runs.
      tab.deafen()
      tab.edit(rename('l1', 'Stored, answer lost'))
      const stored = async () => (await loadDesignRows(db, designId))?.journal.some(isSecond) ?? false
      expect(await until(stored)).toBe(true)
      expect(await first.stop()).toBe(0)
      tab.client().disconnect()
      tab.edit(rename('l0', 'Made offline'))
      expect(tab.client().queued()).toBeGreaterThan(0)
      second = await startMain()
      await tab.reconnect(second.url)
      await quiet(tab)
      const shown = tab.client().working().toRecords()
      expect(shown.nodes.l0).toMatchObject({ name: 'Made offline' })
      expect(shown.nodes.l1).toMatchObject({ name: 'Stored, answer lost' })
      expect(await second.stop()).toBe(0)
      tab.close()
      // Three change sets were made and three are stored: a resent one was not applied again.
      const rows = await loadDesignRows(db, designId)
      expect(rows?.journal).toEqual([])
      expect(rows?.saved.seq).toBe(3)
      expect(rows?.saved.state).toEqual(shown)
    } finally {
      for (const run of [first, second]) if (run?.child.exitCode === null) run.child.kill('SIGKILL')
    }
  }, 60_000)
})
