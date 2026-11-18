// The sync server's check for an Autosave: an open design that has changed for 30 minutes takes one
// at the next check, and no second until it changes again. On Postgres, with a clock the test moves.
import { afterAll, describe, expect, it } from 'vitest'

import { listVersions } from '@dazbee/db'
import { VERSION_LIMITS } from '@dazbee/schema'

import { openDesigns } from './design-host.ts'
import { LIMITS } from './limits.ts'
import { changes, editor, hello, rename, socket, storeSaved } from './test-saves.ts'
import { closeDatabase, db, until } from './test-sync.ts'

afterAll(() => closeDatabase())

/** Long enough for a few checks every 10 ms to run. */
const checks = () => new Promise((resolve) => setTimeout(resolve, 60))

describe('the check for an Autosave', () => {
  it('takes one of a design changed 30 minutes ago at the next check, none before, and no second until it changes', async () => {
    const clock = { now: 1_000_000 }
    const id = await storeSaved()
    const designs = openDesigns({
      db,
      limits: { idleMs: 60_000, idleDesigns: 50, loadedBytes: LIMITS.loadedBytes, autosaveCheckMs: 10 },
      host: { now: () => clock.now },
    })
    const a = socket()
    designs.connect(id, a, hello(), editor())
    designs.message(id, a, changes(1, 0, [rename('l0', 'Changed')]), 100)
    await designs.settled()
    const kinds = async () => (await listVersions(db, id)).map((v) => v.kind)

    clock.now += VERSION_LIMITS.autosaveMs - 60_000
    await checks()
    await designs.settled()
    expect(await kinds()).toEqual([])

    clock.now += 60_000
    expect(await until(async () => (await kinds()).length === 1)).toBe(true)

    clock.now += VERSION_LIMITS.autosaveMs
    await checks()
    await designs.settled()
    expect(await kinds()).toEqual(['auto'])

    designs.message(id, a, changes(2, 1, [rename('l0', 'Again')]), 100)
    await designs.settled()
    clock.now += VERSION_LIMITS.autosaveMs
    expect(await until(async () => (await kinds()).length === 2)).toBe(true)
    await designs.closeAll()
  })
})
