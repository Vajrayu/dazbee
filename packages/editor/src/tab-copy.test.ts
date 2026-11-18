// The device copy on fake-indexeddb, with the Web Locks stand-in, under links to the core's design
// host in memory (`test-tab-copy.ts`'s browser).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Client } from '@dazbee/doc'
import { testDesign } from '@dazbee/doc/test-design'
import type { DesignInput, Member } from '@dazbee/schema'

import type { SyncLink } from './sync-link.ts'
import { OPEN_STEP_WRITE_MS, openTabCopies, RELOAD_LOCK_WAIT_MS } from './tab-copy.ts'
import { memorySync } from './test-link.ts'
import { ANN, BOB, type Page, rename, session, type TestBrowser, testBrowser } from './test-tab-copy.ts'

const nameIn = (c: Client, id: string) => (c.working().get('layer', id) as { name: string } | undefined)?.name

let browser: TestBrowser
const settle = (ms?: number) => browser.settle(ms)
const page: TestBrowser['page'] = (tab, member) => browser.page(tab, member)
const openPage: TestBrowser['openPage'] = (tab, member) => browser.openPage(tab, member)
const linkFor: TestBrowser['linkFor'] = (token, start) => browser.linkFor(token, start)
const rows = () => browser.rows()
const changeSetsOf = (tabId: number) => browser.changeSetsOf(tabId)

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
  browser = testBrowser()
})
afterEach(() => {
  browser.destroy()
  vi.useRealTimers()
})

describe('a reload', () => {
  it('opens offline from its tab copy, as the same tab', async () => {
    const tab = session()
    const a = await page(tab)
    a.step('box', 'Kept')
    await settle()
    await a.unload()
    browser.mem.down()
    const b = await page(tab)
    expect(b.saved?.tabId).toBe(a.client().tabId())
    expect(nameIn(b.client(), 'box')).toBe('Kept')
    expect(b.link.status()).toBe('disconnected')
  })

  it('with change sets queued sends each once when it is back', async () => {
    const tab = session()
    const a = await page(tab)
    browser.mem.down()
    await settle()
    a.step('box', 'One')
    a.step('headline', 'Two')
    await settle()
    await a.unload()
    browser.mem.up()
    const b = await page(tab)
    await settle(1000)
    expect([browser.mem.nameOf('box'), browser.mem.nameOf('headline')]).toEqual(['One', 'Two'])
    expect(changeSetsOf(b.client().tabId()).map((m) => m.type === 'changes' && m.id)).toEqual([1, 2])
    expect(b.link.synced()).toBe(true)
  })

  it('with an undo waiting sends it after the step it undoes', async () => {
    const tab = session()
    const a = await page(tab)
    browser.mem.down()
    await settle()
    a.step('box', 'One')
    a.link.send(a.client().undo())
    await settle()
    await a.unload()
    browser.mem.up()
    const b = await page(tab)
    await settle(1000)
    expect(changeSetsOf(b.client().tabId()).map((m) => m.type === 'changes' && m.kind)).toEqual(['edit', 'undo'])
    expect(browser.mem.nameOf('box')).toBe('Box')
  })

  it("mid-step brings the open step's writes back as a step nobody undoes, and sends them", async () => {
    const tab = session()
    const a = await page(tab)
    a.client().open()
    a.client().write(rename('box', 'Dragging'))
    await settle(OPEN_STEP_WRITE_MS)
    a.crash()
    const b = await page(tab)
    await settle(1000)
    expect(browser.mem.nameOf('box')).toBe('Dragging')
    expect(b.client().canUndo()).toBe(false)
  })

  it('right after a step ended never sends an older part of it again (the step waits for its tab copy)', async () => {
    const tab = session()
    const a = await page(tab)
    a.client().open()
    a.client().write(rename('box', 'Part way'))
    await settle(OPEN_STEP_WRITE_MS)
    a.client().write(rename('box', 'The end'))
    a.link.send(a.client().end('Move'))
    // The server's answers are microtasks; the tab copy's write is IndexedDB's turn, which comes later.
    await browser.mem.settle()
    a.crash()
    await page(tab)
    await settle(1000)
    expect(browser.mem.nameOf('box')).toBe('The end')
  })

  it('right after a step ended offline finds the whole step, not the open step written a moment before', async () => {
    const tab = session()
    const a = await page(tab)
    browser.mem.down()
    await settle()
    a.client().open()
    a.client().write(rename('box', 'Part way'))
    await settle()
    a.client().write(rename('box', 'The end'))
    a.link.send(a.client().end('Move'))
    await settle()
    a.crash()
    browser.mem.up()
    await page(tab)
    await settle(1000)
    expect(browser.mem.nameOf('box')).toBe('The end')
  })

  it("never takes up another member's tab copy, though the browser tab held it", async () => {
    const tab = session()
    const a = await page(tab)
    await a.unload()
    const bob = await page(tab, BOB)
    expect(bob.saved).toBeUndefined()
    expect(bob.client().tabId()).not.toBe(a.client().tabId())
    expect(await rows()).toEqual([a.client().tabId(), bob.client().tabId()].sort())
  })

  it('after a cancel does not send the cancelled writes', async () => {
    const tab = session()
    const a = await page(tab)
    a.client().open()
    a.client().write(rename('box', 'Cancelled'))
    await settle(OPEN_STEP_WRITE_MS)
    a.link.send(a.client().cancel())
    await settle()
    a.crash()
    await page(tab)
    await settle(1000)
    expect(browser.mem.nameOf('box')).toBe('Box')
  })
})

describe('writing', () => {
  it('writes an open step at most once a second', async () => {
    const a = await page(session())
    let writes = 0
    a.kept.onWrite(() => writes++)
    a.client().open()
    for (let n = 1; n <= 25; n++) {
      a.client().write(rename('box', `Moving ${n}`))
      await settle(100)
    }
    expect(writes).toBeGreaterThanOrEqual(2)
    expect(writes).toBeLessThanOrEqual(3)
  })

  it("never reads the client again for the other members' presence, which it keeps none of", async () => {
    const a = await page(session())
    const bob = await page(session(), BOB)
    const save = vi.spyOn(a.client(), 'save')
    for (let x = 1; x <= 20; x++) {
      bob.link.send([{ type: 'presence', page: 'p1', pointer: [x, x], selection: [], frame: null }])
      await settle(50)
    }
    expect(a.client().presence().size).toBe(1)
    expect(save).not.toHaveBeenCalled()
  })

  it('stops writing and says so when the device is full', async () => {
    const a = await page(session())
    const stops: string[] = []
    a.kept.onStop((why) => stops.push(why))
    const put = IDBObjectStore.prototype.put
    let puts = 0
    IDBObjectStore.prototype.put = function () {
      puts++
      throw new DOMException('the device is full', 'QuotaExceededError')
    }
    try {
      a.step('box', 'One')
      await settle()
      a.step('box', 'Two')
      await settle()
    } finally {
      IDBObjectStore.prototype.put = put
    }
    expect(stops).toEqual(['full'])
    expect(a.kept.stopped()).toBe('full')
    expect(puts).toBe(1)
    // Steps still go to the server.
    expect(browser.mem.nameOf('box')).toBe('Two')
  })

  it('deletes the tab copy when the device is full, so a reload never sends an older open step again', async () => {
    const tab = session()
    const a = await page(tab)
    a.client().open()
    a.client().write(rename('box', 'Part way'))
    await settle(OPEN_STEP_WRITE_MS)
    const put = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function () {
      throw new DOMException('the device is full', 'QuotaExceededError')
    }
    try {
      a.client().write(rename('box', 'The end'))
      a.link.send(a.client().end('Move'))
      await settle()
    } finally {
      IDBObjectStore.prototype.put = put
    }
    expect(a.kept.stopped()).toBe('full')
    expect(browser.mem.nameOf('box')).toBe('The end')
    a.crash()
    const b = await page(tab)
    await settle(1000)
    expect(b.saved).toBeUndefined()
    expect(browser.mem.nameOf('box')).toBe('The end')
  })

  it("lets a gated send go after the next write, though the step's writes keep coming", async () => {
    const a = await page(session())
    a.client().open()
    let flushed = false
    let writes = 0
    a.kept.onWrite(() => writes++)
    a.client().write(rename('box', 'Moving 0'))
    // The first flush starts a write; the second comes while it is on its way.
    void a.kept.flushed()
    a.client().write(rename('box', 'Moving 1'))
    void a.kept.flushed().then(() => (flushed = true))
    // Well inside the open step's second, which the next write would otherwise wait out.
    for (let n = 1; n <= 4 && !flushed; n++) {
      a.client().write(rename('box', `Moving ${n}`))
      await settle()
    }
    expect(flushed).toBe(true)
    expect(writes).toBeLessThanOrEqual(3)
  })

  it('moves the tab copy to the new tab id a server that no longer knew the tab gives', async () => {
    const tab = session()
    const a = await page(tab)
    const before = a.client().tabId()
    a.step('box', 'One')
    await settle()
    await a.unload()
    // A new server for the design, which another tab joined first.
    browser.mem = memorySync()
    linkFor('bob').connect()
    await settle()
    const b = await page(tab)
    const after = b.client().tabId()
    expect(after).not.toBe(before)
    expect(await rows()).toEqual([after])
    expect(tab.values.get('dazbee-tab-d1')).toBe(String(after))
    expect(browser.locks.held()).toEqual([`dazbee-tab-d1-${after}`])
  })

  it('keeps the tab copy when the tab closes, for a reload', async () => {
    const a = await page(session())
    await a.unload()
    expect(await rows()).toEqual([a.client().tabId()])
  })
})

describe('taking up and sending others', () => {
  /** Pages open at once that each made a step offline, in order (the last is the newest), then died. */
  async function leftOffline(steps: [Member, string, string][]) {
    const pages: Page[] = []
    for (const [member] of steps) pages.push(await page(session(), member))
    browser.mem.down()
    await settle()
    for (const [at, [, id, to]] of steps.entries()) {
      pages[at]?.step(id, to)
      await settle(1000)
    }
    for (const p of pages) p.crash()
    browser.mem.up()
    return pages
  }

  it("takes up the newest free tab copy of its member, and sends the others' work, each once", async () => {
    const [a, b, bob, c] = await leftOffline([
      [ANN, 'box', 'From A'],
      [ANN, 'headline', 'From B'],
      [BOB, 'banner-headline', 'From Bob'],
      [ANN, 'banner-box', 'From C'],
    ])
    const d = await page(session())
    expect(d.client().tabId()).toBe(c?.client().tabId())
    const notices = await d.copies.sendOthers((saved) => linkFor('ann', saved))
    await settle()
    expect([browser.mem.nameOf('box'), browser.mem.nameOf('headline'), browser.mem.nameOf('banner-box')]).toEqual([
      'From A',
      'From B',
      'From C',
    ])
    expect(browser.mem.nameOf('banner-headline')).toBe('Headline')
    for (const p of [a, b]) expect(changeSetsOf(p?.client().tabId() as number)).toHaveLength(1)
    expect(notices).toEqual([])
    // Bob's stays for Bob, D's is its own.
    expect(await rows()).toEqual([d.client().tabId(), bob?.client().tabId()].sort())
  })

  it("never sends one tab copy's work from two tabs", async () => {
    const [a, b, c] = await leftOffline([
      [ANN, 'box', 'From A'],
      [ANN, 'headline', 'From B'],
      [ANN, 'banner-box', 'From C'],
    ])
    const d = await page(session())
    const e = await page(session())
    expect([d.client().tabId(), e.client().tabId()].sort()).toEqual([b?.client().tabId(), c?.client().tabId()].sort())
    await Promise.all([d, e].map((p) => p.copies.sendOthers((saved) => linkFor('ann', saved))))
    await settle()
    const id = a?.client().tabId() as number
    const resumed = browser.mem.sockets.filter((s) => s.sent.some((m) => m.type === 'hello' && m.resume?.tabId === id))
    expect(resumed).toHaveLength(1)
    expect(changeSetsOf(id)).toHaveLength(1)
    expect(browser.mem.nameOf('box')).toBe('From A')
  })

  it("stops sending others' work when the tab closes, though their links can't connect, and keeps it", async () => {
    const [a] = await leftOffline([
      [ANN, 'box', 'From A'],
      [ANN, 'headline', 'From B'],
    ])
    browser.mem.down()
    const d = await page(session())
    let done = false
    const sending = d.copies.sendOthers((saved) => linkFor('ann', saved)).then(() => (done = true))
    await settle(5000)
    expect(done).toBe(false)
    d.link.destroy()
    await d.copies.close()
    await settle()
    await sending
    expect(await rows()).toContain(a?.client().tabId())
  })

  it('deletes a free tab copy with no work without connecting it', async () => {
    const one = await page(session())
    await one.unload()
    const two = await page(session())
    await two.unload()
    const three = await page(session())
    expect(three.client().tabId()).toBe(two.client().tabId())
    const sockets = browser.mem.sockets.length
    await three.copies.sendOthers((saved) => linkFor('ann', saved))
    expect(browser.mem.sockets).toHaveLength(sockets)
    expect(await rows()).toEqual([three.client().tabId()])
  })

  it("never takes up a tab copy whose lock is held, or another member's", async () => {
    const tab = session()
    const a = await page(tab)
    // The browser tab duplicated: a session with the same tab id, whose tab copy is still held.
    const dup = session()
    for (const [key, value] of tab.values) dup.setItem(key, value)
    const opening = openPage(dup)
    await settle()
    await settle(RELOAD_LOCK_WAIT_MS)
    const duplicate = await opening
    expect(duplicate.saved).toBeUndefined()
    expect(duplicate.client().tabId()).not.toBe(a.client().tabId())
    await settle()
    expect(dup.values.get('dazbee-tab-d1')).toBe(String(duplicate.client().tabId()))
    const bob = await page(session(), BOB)
    expect(bob.saved).toBeUndefined()
  })
})

describe('without the browser', () => {
  it('keeps no device copy without Web Locks or IndexedDB', async () => {
    // A browser with no Web Locks: Node has them from version 24 on, so they are taken away here.
    vi.stubGlobal('navigator', {})
    try {
      expect(await openTabCopies({ designId: 'd1', member: ANN, indexedDB: browser.factory })).toBe('off')
    } finally {
      vi.unstubAllGlobals()
    }
    const broken = {
      open: () => {
        throw new Error('no storage')
      },
    } as unknown as IDBFactory
    expect(await openTabCopies({ designId: 'd1', member: ANN, indexedDB: broken, locks: browser.locks })).toBe('off')
  })
})

describe('what a step writes (I10)', () => {
  /** The test design with 600 more layers: the big carousel's size. */
  function carousel(): DesignInput {
    const design = testDesign()
    const box = design.nodes.box as Record<string, unknown>
    for (let n = 0; n < 600; n++) {
      design.nodes[`l${n}`] = {
        ...box,
        link: `l${n}`,
        index: `b${String(n).padStart(4, '0')}`,
        name: `Layer ${n}`,
      } as never
    }
    return design
  }

  it('writes only what changed: the whole design once, then never again for a step', async () => {
    browser.mem = memorySync(carousel())
    // Bytes as IndexedDB is handed them, per write, and whether the `tab` entry is among them.
    const put = IDBObjectStore.prototype.put
    let bytes = 0
    let tabEntry = false
    IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
      bytes += JSON.stringify(value).length
      if (Array.isArray(key) && key[1] === 'tab') tabEntry = true
      return put.call(this, value, key)
    }
    let a: Page
    let bob: SyncLink
    try {
      a = await page(session())
      // The first write holds the whole design, once.
      expect(tabEntry).toBe(true)
      expect(bytes).toBeGreaterThan(100 * 1024)
      bob = linkFor('bob')
      bob.connect()
      await settle()
    } catch (error) {
      IDBObjectStore.prototype.put = put
      throw error
    }
    const measure = async (run: () => void) => {
      bytes = 0
      tabEntry = false
      run()
      await settle()
      return { bytes, tabEntry }
    }
    try {
      const other = await measure(() => {
        const c = bob.client() as Client
        c.open()
        c.write(rename('l7', 'Bob was here'))
        bob.send(c.end('Rename'))
      })
      expect(other.tabEntry).toBe(false)
      expect(other.bytes).toBeGreaterThan(0)
      expect(other.bytes).toBeLessThan(500)
      const oneValue = await measure(() => a.step('l1', 'One value'))
      expect(oneValue.tabEntry).toBe(false)
      expect(oneValue.bytes).toBeGreaterThan(0)
      expect(oneValue.bytes).toBeLessThan(1024)
      const drag = await measure(() => {
        a.client().open()
        for (let n = 0; n < 50; n++) {
          a.client().write({ op: 'set', value: { part: 'layer', id: `l${n}`, key: 'props', prop: 'x' }, to: 500 + n })
        }
        a.link.send(a.client().end('Move'))
      })
      expect(drag.tabEntry).toBe(false)
      expect(drag.bytes).toBeGreaterThan(50 * 20)
      expect(drag.bytes).toBeLessThan(20 * 1024)
    } finally {
      IDBObjectStore.prototype.put = put
    }
    expect(JSON.stringify(browser.mem.state()).length).toBeGreaterThan(100 * 1024)
  })
})
