// The sync server as `main.ts` starts it (D10), in a process of its own on compose's Postgres. It
// answers a health check, welcomes a tab with a token, closes a tab built before it as too old, and
// folds and exits on SIGTERM.
import { type ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'

import { afterAll, describe, expect, it } from 'vitest'

import { SCHEMA_VERSION, SYNC_CLOSE } from '@dazbee/schema'

import { storeSaved } from './test-saves.ts'
import { closeDatabase, secret, tokenFor, until } from './test-sync.ts'
import { openTab } from './test-tab.ts'

const MAIN = fileURLToPath(new URL('./main.ts', import.meta.url))
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://dazbee:dazbee-local@127.0.0.1:55432/dazbee'

afterAll(() => closeDatabase())

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
async function startMain(): Promise<{ child: ChildProcess; url: string; output: () => string }> {
  const port = await freePort()
  const child = spawn(process.execPath, [MAIN], {
    env: { ...process.env, DATABASE_URL, SYNC_PORT: String(port), SYNC_TOKEN_SECRET: secret },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString()))
  child.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString()))
  await until(() => output.includes('sync server on'), 20_000)
  return { child, url: `ws://127.0.0.1:${port}`, output: () => output }
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
})
