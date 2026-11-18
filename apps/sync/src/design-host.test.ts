// The designs the sync server holds, on Postgres (D8, D11): a design admitted once however many
// tabs connect, kept idle and then unloaded with a fold, refused with serverBusy past the byte budget,
// closed with designDeleted when its rows go, and admitted again after a failed write.
import { afterAll, describe, expect, it } from 'vitest'

import { loadDesignRows } from '@dazbee/db'
import { type Journal } from '@dazbee/doc/sync'
import { SYNC_CLOSE } from '@dazbee/schema'

import { type DesignsOptions, openDesigns } from './design-host.ts'
import { LIMITS } from './limits.ts'
import { pgJournal } from './pg-journal.ts'
import {
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
import { closeDatabase, db, pause, until } from './test-sync.ts'

afterAll(() => closeDatabase())

const options = (more: Partial<DesignsOptions> = {}): DesignsOptions => ({
  db,
  limits: { idleMs: 0, idleDesigns: 50, loadedBytes: LIMITS.loadedBytes },
  ...more,
})

/** A journal on Postgres whose loads are counted, and whose next append can be made to fail. */
function counted() {
  const counts = { loads: 0 }
  let fail = false
  const journal = (designId: string, turn: () => Promise<void>): Journal => {
    const pg = pgJournal(db, designId, turn)
    return {
      ...pg,
      load: () => {
        counts.loads++
        return pg.load()
      },
      append: (entries, expected) => {
        if (!fail) return pg.append(entries, expected)
        fail = false
        return Promise.reject(new Error('a planted write failure'))
      },
    }
  }
  return { counts, journal, failNextAppend: () => (fail = true) }
}

/** How many folds have started. */
const folding = { count: 0 }

/** A Postgres journal whose next fold waits until released, then stores, or fails with the error given. */
function heldFolds() {
  let held: { wait: Promise<void>; error?: Error } | undefined
  const journal = (designId: string, turn: () => Promise<void>): Journal => {
    const pg = pgJournal(db, designId, turn)
    return {
      ...pg,
      fold: async (saved, expected) => {
        folding.count++
        const now = held
        held = undefined
        if (now) {
          await now.wait
          if (now.error) throw now.error
        }
        return pg.fold(saved, expected)
      },
    }
  }
  const holdFold = (error?: Error) => {
    folding.count = 0
    let release = () => {}
    held = { wait: new Promise<void>((resolve) => (release = resolve)), ...(error ? { error } : {}) }
    return release
  }
  return { journal, holdFold }
}

const nameOf = async (designId: string, layer: string) =>
  ((await loadDesignRows(db, designId))?.saved.state.nodes[layer] as { name?: string } | undefined)?.name

describe('openDesigns', () => {
  it('stores what tabs changed, unloads the design with a fold once they leave, and opens it again the same', async () => {
    const id = await storeSaved()
    const designs1 = openDesigns(options())
    const a = socket()
    designs1.connect(id, a, hello(), editor())
    await designs1.settled()
    designs1.message(id, a, changes(1, 0, [rename('l0', 'Kept')]), 100)
    await designs1.settled()
    expect(typesOf(a)).toEqual(['welcome', 'accepted'])
    designs1.close(id, a)
    await until(() => designs1.host(id) === undefined)
    const rows = await loadDesignRows(db, id)
    expect(rows?.journal).toEqual([])
    expect(await nameOf(id, 'l0')).toBe('Kept')
    // Another server process opens it from the fold.
    const designs2 = openDesigns(options())
    const b = socket()
    designs2.connect(id, b, hello(), editor(BOB))
    await designs2.settled()
    const { catchUp } = welcomeOf(b)
    expect('design' in catchUp && (catchUp.design.nodes.l0 as { name: string }).name).toBe('Kept')
  })

  it('loads a design once for tabs that connect together, and welcomes each', async () => {
    const id = await storeSaved()
    const { counts, journal } = counted()
    const held = openDesigns(options({ journal }))
    const a = socket()
    const b = socket()
    held.connect(id, a, hello(), editor())
    held.connect(id, b, hello(), editor(BOB))
    await held.settled()
    expect(counts.loads).toBe(1)
    expect([typesOf(a)[0], typesOf(b)[0]]).toEqual(['welcome', 'welcome'])
    expect(welcomeOf(a).tabId).not.toBe(welcomeOf(b).tabId)
  })

  it('loads a design once for tabs that connect and leave, over and over, each within idleMs of the last', async () => {
    const id = await storeSaved()
    const { counts, journal } = counted()
    const held = openDesigns(
      options({ journal, limits: { idleMs: 300, idleDesigns: 50, loadedBytes: LIMITS.loadedBytes } }),
    )
    // Five visits over a second: each comes back well within idleMs, though the first leave is long past it.
    for (let visit = 0; visit < 5; visit++) {
      const tab = socket()
      held.connect(id, tab, hello(), editor())
      await held.settled()
      expect(typesOf(tab)[0]).toBe('welcome')
      await pause(50)
      held.close(id, tab)
      await held.settled()
      await pause(150)
    }
    expect(counts.loads).toBe(1)
    expect(held.host(id)).toBeDefined()
  })

  it('takes a connect whose socket closed while the design was admitted, then lets the design go', async () => {
    const id = await storeSaved()
    const held = openDesigns(options())
    const a = socket()
    held.connect(id, a, hello(), editor())
    held.close(id, a)
    await held.settled()
    expect(a.frames).toEqual([])
    await until(() => held.host(id) === undefined)
    expect(held.loadedBytes()).toBe(0)
  })

  it('keeps a design with no tab for idleMs, then unloads it; a connect meanwhile reopens it from storage', async () => {
    const id = await storeSaved()
    const held = openDesigns(options({ limits: { idleMs: 100, idleDesigns: 50, loadedBytes: LIMITS.loadedBytes } }))
    const a = socket()
    held.connect(id, a, hello(), editor())
    await held.settled()
    held.message(id, a, changes(1, 0, [rename('l1', 'Idle')]), 100)
    held.close(id, a)
    await held.settled()
    expect(held.host(id)).toBeDefined()
    await until(() => held.host(id) === undefined)
    expect((await loadDesignRows(db, id))?.journal).toEqual([])
    const b = socket()
    held.connect(id, b, hello(), editor(BOB))
    await held.settled()
    const { catchUp } = welcomeOf(b)
    expect('design' in catchUp && (catchUp.design.nodes.l1 as { name: string }).name).toBe('Idle')
  })

  it('unloads an idle design to admit another past the byte budget, and refuses one with serverBusy when none is idle', async () => {
    const x = await storeSaved()
    const y = await storeSaved()
    const sized = openDesigns(options())
    const probe = socket()
    sized.connect(x, probe, hello(), editor())
    await sized.settled()
    const one = sized.loadedBytes()
    sized.close(x, probe)
    await until(() => sized.host(x) === undefined)
    const lines: string[] = []
    const limits = { idleMs: 60_000, idleDesigns: 50, loadedBytes: Math.floor(one * 1.5) }
    const held = openDesigns(options({ limits, log: (line) => lines.push(line) }))
    const a = socket()
    held.connect(x, a, hello(), editor())
    await held.settled()
    const busy = socket()
    held.connect(y, busy, hello(), editor())
    await held.settled()
    expect(busy.closed?.code).toBe(SYNC_CLOSE.serverBusy)
    expect(lines.some((line) => line.includes(`design ${y}: serverBusy`))).toBe(true)
    // x's tab leaves: x is kept idle, and unloads, folded, to let y in.
    held.message(x, a, changes(1, 0, [rename('l0', 'Folded')]), 100)
    held.close(x, a)
    await held.settled()
    expect(held.host(x)).toBeDefined()
    const b = socket()
    held.connect(y, b, hello(), editor())
    await held.settled()
    expect(typesOf(b)).toEqual(['welcome'])
    expect(held.host(x)).toBeUndefined()
    expect(await nameOf(x, 'l0')).toBe('Folded')
    expect((await loadDesignRows(db, x))?.journal).toEqual([])
  })

  it('closes every tab with designDeleted when the design is deleted while open, and every tab after', async () => {
    const id = await storeSaved()
    const lines: string[] = []
    const held = openDesigns(options({ log: (line) => lines.push(line) }))
    const a = socket()
    const b = socket()
    held.connect(id, a, hello(), editor())
    held.connect(id, b, hello(), editor(BOB))
    await held.settled()
    await deleteDesign(id)
    held.message(id, a, changes(1, 0, [rename('l0', 'Gone')]), 100)
    await held.settled()
    expect([a.closed?.code, b.closed?.code]).toEqual([SYNC_CLOSE.designDeleted, SYNC_CLOSE.designDeleted])
    expect(typesOf(a)).not.toContain('accepted')
    expect(held.host(id)).toBeUndefined()
    expect(lines).toContain(`design ${id}: the design was deleted`)
    const c = socket()
    held.connect(id, c, hello(), editor())
    await held.settled()
    expect(c.closed?.code).toBe(SYNC_CLOSE.designDeleted)
  })

  it('forgets a design after a failed write, and admits it again for the tab that reconnects', async () => {
    const id = await storeSaved()
    const { counts, journal, failNextAppend } = counted()
    const held = openDesigns(options({ journal }))
    const a = socket()
    held.connect(id, a, hello(), editor())
    await held.settled()
    failNextAppend()
    held.message(id, a, changes(1, 0, [rename('l0', 'Lost')]), 100)
    await held.settled()
    expect(a.closed?.code).toBe(SYNC_CLOSE.storeFailed)
    expect(held.host(id)).toBeUndefined()
    expect(held.loadedBytes()).toBe(0)
    const back = socket()
    held.connect(id, back, hello(resumeOf(a, 0), 1), editor())
    held.message(id, back, changes(1, 0, [rename('l0', 'Sent again')]), 100)
    await held.settled()
    expect(counts.loads).toBe(2)
    expect(typesOf(back)).toEqual(['welcome', 'accepted'])
    expect(held.host(id)?.server()?.state().get('layer', 'l0')?.name).toBe('Sent again')
  })

  it('holds a connect that comes during an unload, then opens the design again from the fold', async () => {
    const id = await storeSaved()
    const { journal, holdFold } = heldFolds()
    const held = openDesigns(options({ journal }))
    const a = socket()
    held.connect(id, a, hello(), editor())
    await held.settled()
    held.message(id, a, changes(1, 0, [rename('l0', 'Folded')]), 100)
    await held.settled()
    const release = holdFold()
    held.close(id, a)
    await until(() => folding.count > 0)
    const b = socket()
    held.connect(id, b, hello(), editor(BOB))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(b.frames).toEqual([])
    release()
    await held.settled()
    const { catchUp } = welcomeOf(b)
    expect('design' in catchUp && (catchUp.design.nodes.l0 as { name: string }).name).toBe('Folded')
  })

  it('lets a design go when its fold fails during an unload and the tab that came meanwhile has gone', async () => {
    const id = await storeSaved()
    const { journal, holdFold } = heldFolds()
    const held = openDesigns(options({ journal }))
    const a = socket()
    held.connect(id, a, hello(), editor())
    held.message(id, a, changes(1, 0, [rename('l0', 'Edited')]), 100)
    await held.settled()
    const release = holdFold(new Error('a planted fold failure'))
    held.close(id, a)
    await until(() => folding.count > 0)
    const b = socket()
    held.connect(id, b, hello(), editor(BOB))
    held.close(id, b)
    release()
    await held.settled()
    await until(() => held.host(id) === undefined)
    expect(held.loadedBytes()).toBe(0)
  })

  it('refuses a design it could not admit, and admits the next', async () => {
    const [bad, good] = [await storeSaved(), await storeSaved()]
    const lines: string[] = []
    const held = openDesigns(
      options({
        log: (line) => lines.push(line),
        journal: (designId, turn) => {
          if (designId === bad) throw new Error('no journal')
          return pgJournal(db, designId, turn)
        },
      }),
    )
    const a = socket()
    const b = socket()
    held.connect(bad, a, hello(), editor())
    held.connect(good, b, hello(), editor())
    await held.settled()
    expect(a.closed?.code).toBe(SYNC_CLOSE.storeFailed)
    expect(lines.some((line) => line.includes(`design ${bad}: could not be admitted`))).toBe(true)
    expect(typesOf(b)).toEqual(['welcome'])
  })

  it('closes every tab and unloads every design with a fold as the server stops', async () => {
    const id = await storeSaved()
    const held = openDesigns(options({ limits: { idleMs: 60_000, idleDesigns: 50, loadedBytes: LIMITS.loadedBytes } }))
    const a = socket()
    held.connect(id, a, hello(), editor())
    await held.settled()
    held.message(id, a, changes(1, 0, [rename('l0', 'At stop')]), 100)
    await held.settled()
    await held.closeAll()
    expect(a.closed?.code).toBe(1001)
    expect(held.host(id)).toBeUndefined()
    expect((await loadDesignRows(db, id))?.journal).toEqual([])
    expect(await nameOf(id, 'l0')).toBe('At stop')
  })
})
