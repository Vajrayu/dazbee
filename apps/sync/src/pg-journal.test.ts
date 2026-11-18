// The sync server's storage on Postgres, end to end through its design hosts (D8, I2): what was stored
// but never answered is confirmed after a restart; a failed write sends nothing and leaves no gap; a
// second server holding the design fails; a fold, then a whole-design catch-up; and a journal tail
// that no longer applies goes to the dead letters, under a new sync id, where a reader stops too.
import { afterAll, describe, expect, it } from 'vitest'

import { appendRows, listVersions, loadDesignRows, versionRecords } from '@dazbee/db'
import { type Journal, storedDesign } from '@dazbee/doc/sync'
import { type RestoreMark, SYNC_CLOSE } from '@dazbee/schema'

import { type DesignsOptions, openDesigns } from './design-host.ts'
import { LIMITS } from './limits.ts'
import { pgJournal } from './pg-journal.ts'
import {
  ANN,
  BOB,
  changes,
  deleteDesign,
  editor,
  hello,
  rename,
  resumeOf,
  socket,
  storeSaved,
  typesOf,
  welcomeOf,
} from './test-saves.ts'
import { closeDatabase, db, until } from './test-sync.ts'

afterAll(() => closeDatabase())

const options = (more: Partial<DesignsOptions> = {}): DesignsOptions => ({
  db,
  limits: { idleMs: 60_000, idleDesigns: 50, loadedBytes: LIMITS.loadedBytes },
  ...more,
})

/** A Postgres journal whose next append fails, before storing (`'before'`) or after (`'after'`). */
function faulty() {
  let fault: 'before' | 'after' | undefined
  const journal = (designId: string, turn: () => Promise<void>): Journal => {
    const pg = pgJournal(db, designId, turn)
    return {
      ...pg,
      append: async (entries, expected) => {
        const now = fault
        fault = undefined
        if (now === 'before') throw new Error('a planted write failure')
        await pg.append(entries, expected)
        if (now === 'after') throw new Error('stored, then the server stopped')
      },
    }
  }
  return { journal, failNext: (when: 'before' | 'after') => (fault = when) }
}

/** The stored journal has no gap: its entries count up from the state's. */
async function expectNoGap(designId: string) {
  const rows = await loadDesignRows(db, designId)
  if (!rows) throw new Error('no rows')
  const entries = rows.journal.map((e) => e.entry)
  expect(entries).toEqual(entries.map((_, i) => rows.saved.entry + i + 1))
  expect(rows.lastEntry).toBe(rows.saved.entry + entries.length)
  return rows
}

const accepted = (rows: Awaited<ReturnType<typeof expectNoGap>>) =>
  rows.journal.flatMap((e) => (e.kind === 'accepted' ? [e.changeSet.changes] : []))

describe('storage on Postgres', () => {
  it("confirms, on the tab's next welcome, a change set stored but never answered", async () => {
    const id = await storeSaved()
    const { journal, failNext } = faulty()
    const held = openDesigns(options({ journal }))
    const a = socket()
    held.connect(id, a, hello(), editor())
    await held.settled()
    failNext('after')
    held.message(id, a, changes(1, 0, [rename('l0', 'Stored')]), 100)
    await held.settled()
    expect(a.closed?.code).toBe(SYNC_CLOSE.storeFailed)
    expect(typesOf(a)).toEqual(['welcome'])
    const back = socket()
    held.connect(id, back, hello(resumeOf(a, 0), 1), editor())
    await held.settled()
    const welcome = welcomeOf(back)
    expect(welcome.processed.lastChangeSet).toBe(1)
    expect('changeSets' in welcome.catchUp && welcome.catchUp.changeSets.map((c) => c.changeSetId)).toEqual([1])
    expect(accepted(await expectNoGap(id))).toHaveLength(1)
  })

  it('sends nothing for a write that failed, stores nothing after it, and leaves no gap once the tab sends again', async () => {
    const id = await storeSaved()
    const { journal, failNext } = faulty()
    const held = openDesigns(options({ journal }))
    const a = socket()
    const b = socket()
    held.connect(id, a, hello(), editor())
    held.connect(id, b, hello(), editor(BOB))
    await held.settled()
    failNext('before')
    held.message(id, a, changes(1, 0, [rename('l0', 'Lost')]), 100)
    held.message(id, b, changes(1, 0, [rename('l1', 'Lost too')]), 100)
    await held.settled()
    expect([a.closed?.code, b.closed?.code]).toEqual([SYNC_CLOSE.storeFailed, SYNC_CLOSE.storeFailed])
    expect([typesOf(a), typesOf(b)]).toEqual([['welcome', 'joined'], ['welcome']])
    const back = socket()
    held.connect(id, back, hello(resumeOf(a, 0), 1), editor())
    held.message(id, back, changes(1, 0, [rename('l0', 'Sent again')]), 100)
    await held.settled()
    expect(typesOf(back)).toEqual(['welcome', 'accepted'])
    const rows = await expectNoGap(id)
    expect(accepted(rows)).toEqual([[rename('l0', 'Sent again')]])
  })

  it.each([false, true])(
    'fails the server holding a design that another stored past, whether or not that one folded (fold: %s)',
    async (fold) => {
      const id = await storeSaved()
      const first = openDesigns(options())
      const second = openDesigns(options({ host: fold ? { foldEntries: 1 } : {} }))
      const a = socket()
      first.connect(id, a, hello(), editor())
      await first.settled()
      // The second server loads after the first stored, and stores past it.
      const b = socket()
      second.connect(id, b, hello(), editor(BOB))
      await second.settled()
      second.message(id, b, changes(1, 0, [rename('l1', 'Second')]), 100)
      await second.settled()
      if (fold) expect((await loadDesignRows(db, id))?.journal).toEqual([])
      first.message(id, a, changes(1, 0, [rename('l0', 'First')]), 100)
      await first.settled()
      expect(a.closed?.code).toBe(SYNC_CLOSE.storeFailed)
      expect(typesOf(a)).not.toContain('accepted')
      // The tab comes back to the server that holds the design, and sends again.
      const back = socket()
      second.connect(id, back, hello(resumeOf(a, 0), 1), editor())
      second.message(id, back, changes(1, 0, [rename('l0', 'First')]), 100)
      await second.settled()
      expect(typesOf(back).at(-1)).toBe('accepted')
      const state = second.host(id)?.server()?.state()
      expect([state?.get('layer', 'l0')?.name, state?.get('layer', 'l1')?.name]).toEqual(['First', 'Second'])
      await expectNoGap(id)
    },
  )

  it('folds past the limit, and catches a tab that was away up with the whole design', async () => {
    const id = await storeSaved()
    const held = openDesigns(options({ host: { foldEntries: 2, limits: { logChangeSets: 1 } } }))
    const a = socket()
    const b = socket()
    held.connect(id, a, hello(), editor())
    held.connect(id, b, hello(), editor(BOB))
    await held.settled()
    held.close(id, a)
    for (let n = 1; n <= 3; n++) held.message(id, b, changes(n, n - 1, [rename('l0', `Edit ${n}`)]), 100)
    await held.settled()
    const rows = await expectNoGap(id)
    expect(rows.saved.seq).toBeGreaterThanOrEqual(2)
    const back = socket()
    held.connect(id, back, hello(resumeOf(a, 0)), editor())
    await held.settled()
    const { catchUp, seq } = welcomeOf(back)
    expect(seq).toBe(3)
    expect('design' in catchUp && (catchUp.design.nodes.l0 as { name: string }).name).toBe('Edit 3')
  })

  it('moves a tail that no longer applies to the dead letters, under a new sync id, where a reader stops too', async () => {
    const id = await storeSaved()
    const held = openDesigns(options())
    const a = socket()
    held.connect(id, a, hello(), editor())
    held.message(id, a, changes(1, 0, [rename('l0', 'Good')]), 100)
    await held.settled()
    await held.closeAll()
    const before = await expectNoGap(id)
    const last = before.lastEntry
    // A change set stored under other rules, which this design's no longer take: it names no layer it holds.
    const bad = { seq: 2, author: 1, changeSetId: 2, changes: [rename('no-such-layer', 'Bad')] }
    expect(
      await appendRows(db, id, [{ entry: last + 1, kind: 'accepted', member: ANN, changeSet: bad, bytes: 80 }], last),
    ).toBe('stored')
    const read = storedDesign((await loadDesignRows(db, id)) ?? before)
    const lines: string[] = []
    const again = openDesigns(options({ log: (line) => lines.push(line) }))
    const back = socket()
    again.connect(id, back, hello(resumeOf(a, 1)), editor())
    await again.settled()
    const welcome = welcomeOf(back)
    expect(welcome.syncId).not.toBe(welcomeOf(a).syncId)
    expect(welcome.tabId).not.toBe(welcomeOf(a).tabId)
    expect(read).toMatchObject({ entry: last, seq: 1 })
    expect(again.host(id)?.server()?.seq()).toBe(read.seq)
    expect(read.design.nodes.l0?.name).toBe('Good')
    expect(lines.some((line) => line.includes(`entry ${last + 1} no longer applies`))).toBe(true)
    await until(async () => (await loadDesignRows(db, id))?.saved.syncId === welcome.syncId)
    const dead = await db.execute(`select entry, error from design_journal_dead where design_id = '${id}'`)
    expect(dead.rows.map((r) => Number(r.entry))).toEqual([last + 1])
  })
})

describe('versions on Postgres', () => {
  const mark: RestoreMark = { versionId: 'v1', kind: 'named', name: 'Sent', takenAt: '2026-11-16T14:30:00.000Z' }
  const restore = (id: number, base: number) => ({ ...changes(id, base, [rename('l0', 'Restored')]), restore: mark })

  it('keeps a Before restore version of the design as it was, and the restore after it', async () => {
    const id = await storeSaved()
    const held = openDesigns(options())
    const a = socket()
    held.connect(id, a, hello(), editor())
    held.message(id, a, changes(1, 0, [rename('l0', 'Changed')]), 100)
    held.message(id, a, restore(2, 1), 100)
    await held.settled()

    const [kept] = await listVersions(db, id)
    expect(kept?.kind).toBe('beforeRestore')
    const stored = await versionRecords(db, id, kept?.id ?? '')
    expect((JSON.parse(stored?.json ?? '{}') as { nodes: { l0: { name: string } } }).nodes.l0.name).toBe('Changed')
    expect(accepted(await expectNoGap(id))).toHaveLength(2)
  })

  it('unloads a design left changed with an Autosave, and one left unchanged with none', async () => {
    const changed = await storeSaved()
    const unchanged = await storeSaved()
    const held = openDesigns(options({ limits: { idleMs: 0, idleDesigns: 50, loadedBytes: LIMITS.loadedBytes } }))
    const a = socket()
    const b = socket()
    held.connect(changed, a, hello(), editor())
    held.connect(unchanged, b, hello(), editor())
    held.message(changed, a, changes(1, 0, [rename('l0', 'Changed')]), 100)
    await held.settled()
    held.close(changed, a)
    held.close(unchanged, b)
    await until(() => !held.host(changed) && !held.host(unchanged))
    await held.settled()

    expect((await listVersions(db, changed)).map((v) => v.kind)).toEqual(['auto'])
    expect(await listVersions(db, unchanged)).toEqual([])
  })

  it('opens a design whose newest version holds its sync id and sequence number unchanged', async () => {
    const id = await storeSaved()
    const first = openDesigns(options())
    const a = socket()
    first.connect(id, a, hello(), editor())
    first.message(id, a, changes(1, 0, [rename('l0', 'Changed')]), 100)
    await first.settled()
    await first.closeAll()
    expect(await listVersions(db, id)).toHaveLength(1)
    // Only the newest version says the design is unchanged now.
    await db.execute(`update design_saves set versioned_seq = 0 where design_id = '${id}'`)

    const again = openDesigns(options())
    again.connect(id, socket(), hello(), editor())
    await again.settled()
    expect(again.host(id)?.changedSince()).toBeUndefined()
    await again.closeAll()
    expect(await listVersions(db, id)).toHaveLength(1)
  })

  it('answers a version asked for with its stored records, and none for another design’s', async () => {
    const id = await storeSaved()
    const other = await storeSaved()
    const held = openDesigns(options())
    const a = socket()
    const b = socket()
    held.connect(id, a, hello(), editor())
    held.connect(other, b, hello(), editor())
    held.message(id, a, changes(1, 0, [rename('l0', 'Kept')]), 100)
    await held.settled()
    held.host(id)?.autosave()
    await held.settled()
    const [kept] = await listVersions(db, id)
    const stored = await versionRecords(db, id, kept?.id ?? '')

    held.message(id, a, { type: 'version', id: kept?.id }, 50)
    held.message(other, b, { type: 'version', id: kept?.id }, 50)
    await held.settled()

    const asked = (s: typeof a) => s.heard().filter((m) => m.type === 'version')
    expect(asked(a)).toEqual([
      { type: 'version', id: kept?.id, schemaVersion: stored?.schemaVersion, design: JSON.parse(stored?.json ?? '') },
    ])
    expect(asked(b)).toEqual([{ type: 'version', id: kept?.id, schemaVersion: null, design: null }])
  })

  it('closes its tabs for good when the design is deleted before its version is written', async () => {
    const id = await storeSaved()
    let hold = Promise.resolve()
    let release = () => {}
    const journal = (designId: string, turn: () => Promise<void>): Journal => {
      const pg = pgJournal(db, designId, turn)
      return {
        ...pg,
        version: async (version) => {
          await hold
          return pg.version(version)
        },
      }
    }
    const held = openDesigns(options({ journal }))
    const a = socket()
    held.connect(id, a, hello(), editor())
    held.message(id, a, changes(1, 0, [rename('l0', 'Changed')]), 100)
    await held.settled()
    hold = new Promise((resolve) => (release = resolve))
    held.host(id)?.autosave()
    await deleteDesign(id)
    release()
    await held.settled()

    expect(a.closed?.code).toBe(SYNC_CLOSE.designDeleted)
  })
})
