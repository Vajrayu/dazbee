// Whether `tables.ts` and a migrations folder agree: `drizzle-kit generate`, run on a copy of the
// folder, finds nothing to write and asks nothing. CI runs it on `packages/db/migrations`.
import { spawn } from 'node:child_process'
import { cp, mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import config from '../drizzle.config.ts'

/** What the check found: whether they agree, and why not, with what drizzle-kit printed. */
export type MigrationsCheck = { ok: true } | { ok: false; reason: string; output: string }

/** How long drizzle-kit may run before the check stops it: a run that asks a question waits for ever. */
export const CHECK_TIMEOUT_MS = 60_000

/** The package's folder, where drizzle-kit runs and finds the config's schema. */
const PACKAGE = fileURLToPath(new URL('..', import.meta.url))

const DRIZZLE_KIT = join(PACKAGE, 'node_modules', 'drizzle-kit', 'bin.cjs')

/** What drizzle-kit prints when `tables.ts` holds nothing the migrations don't. */
const NOTHING_TO_WRITE = 'No schema changes, nothing to migrate'

/**
 * Runs `drizzle-kit generate` against `tables.ts` on a copy of `migrations`, stopped after
 * `timeoutMs`. They agree only when it ends by itself, prints that it has nothing to write, and
 * leaves the copy as it was.
 */
export async function checkMigrations(migrations: string, timeoutMs = CHECK_TIMEOUT_MS): Promise<MigrationsCheck> {
  const copy = await mkdtemp(join(tmpdir(), 'dazbee-migrations-'))
  try {
    await cp(migrations, copy, { recursive: true })
    const before = await folderContents(copy)
    // The config's dialect and schema, with the copy as `--out`: drizzle-kit takes no config file beside
    // flags, and joins `--out` onto its working folder, so it is given a relative path.
    const run = await runDrizzleKit(
      ['generate', '--dialect', config.dialect, '--schema', String(config.schema), '--out', relative(PACKAGE, copy)],
      timeoutMs,
    )
    if (run.timedOut) {
      return { ok: false, reason: `drizzle-kit generate ran past ${timeoutMs / 1000} s`, output: run.output }
    }
    if ((await folderContents(copy)) !== before) {
      return { ok: false, reason: 'drizzle-kit generate wrote a migration', output: run.output }
    }
    if (run.code !== 0 || !run.output.includes(NOTHING_TO_WRITE)) {
      return { ok: false, reason: 'drizzle-kit generate asked a question or failed', output: run.output }
    }
    return { ok: true }
  } finally {
    await rm(copy, { recursive: true, force: true })
  }
}

/** Runs drizzle-kit in the package's folder with no terminal to ask on; its output and exit code, or that it was stopped. */
function runDrizzleKit(args: string[], timeoutMs: number) {
  return new Promise<{ code: number | null; output: string; timedOut: boolean }>((resolve, reject) => {
    const child = spawn(process.execPath, [DRIZZLE_KIT, ...args], {
      cwd: PACKAGE,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    let timedOut = false
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()))
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()))
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, timeoutMs)
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, output, timedOut })
    })
  })
}

/** Every file under `folder` with its bytes, as one string to compare. */
async function folderContents(folder: string): Promise<string> {
  const files = (await readdir(folder, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .toSorted()
  const contents = await Promise.all(
    files.map(async (file) => `${relative(folder, file)}\n${await readFile(file, 'utf8')}`),
  )
  return contents.join('\n\0\n')
}
