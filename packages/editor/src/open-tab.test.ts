// The tab opened on a design, on `test-tab-copy`'s browser: fake-indexeddb, the Web Locks stand-in
// and the core's design host in memory, on fake time.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { type Client, readDesign, type Recompute } from '@dazbee/doc'
import { type DesignRecords, type Member, SCHEMA_VERSION, SYNC_CLOSE } from '@dazbee/schema'

import type { LinkNotice } from './core-interface.ts'
import { type OpenTab, openTab, type OpenTabOptions, TabStopped } from './open-tab.ts'
import type { Locks } from './tab-copy.ts'
import { memorySync } from './test-link.ts'
import { ANN, rename, type Session, session, type TestBrowser, testBrowser } from './test-tab-copy.ts'
import { TokenRefused } from './token-source.ts'

/** A tab as a test holds it: what it told, what it reported, and how its page goes. */
interface TestTab extends OpenTab {
  notices: LinkNotice[]
  reported: unknown[]
  /** Starts hearing the notices, for a tab opened with `listenLate`. */
  listen(): void
  client(): Client
  /** One step that renames `id`, as a command's step writes the store. */
  step(id: string, to: string): void
  /** The page goes: what is due written, its locks let go. */
  unload(): Promise<void>
  /** The page dies at once: nothing more is written. */
  crash(): void
}

interface TabOptions extends Partial<Omit<OpenTabOptions, 'token'>> {
  /** The token's member, as the server in memory reads it: Ann's unless told. */
  token?: string | (() => Promise<string>)
  /** A browser with no Web Locks. */
  noLocks?: boolean
  /** The test listens to the notices only once it calls `listen`. */
  listenLate?: boolean
}

let browser: TestBrowser
const settle = (ms?: number) => browser.settle(ms)
const opened: TestTab[] = []

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
  browser = testBrowser()
})
afterEach(async () => {
  for (const t of opened.splice(0)) await t.close()
  browser.destroy()
  vi.useRealTimers()
})

/** Opens the tab in browser tab `tab` as `openTab` opens it for the editor, without waiting. */
function opening(tab: Session, { token = 'ann', noLocks = false, listenLate = false, ...options }: TabOptions = {}) {
  const locks: Locks = browser.locks.tab()
  const reported: unknown[] = []
  const notices: LinkNotice[] = []
  const tabOpened = openTab({
    designId: 'd1',
    member: ANN,
    url: 'ws://s',
    token: typeof token === 'string' ? () => Promise.resolve(token) : token,
    socket: (url) => browser.mem.socket(url),
    indexedDB: browser.factory,
    ...(noLocks ? {} : { locks }),
    session: tab,
    random: () => 0.001,
    report: (error) => reported.push(error),
    ...options,
  }).then((t): TestTab => {
    const listen = () => void t.linkNotices.on((notice) => notices.push(notice))
    if (!listenLate) listen()
    const client = () => t.link.client() as Client
    const testTab: TestTab = {
      ...t,
      notices,
      reported,
      listen,
      client,
      step(id, to) {
        client().open()
        t.store.set('layer', id, 'name', to)
        t.link.send(client().end('Rename'))
      },
      async unload() {
        await t.close()
        browser.locks.dropAll(locks)
        await settle()
      },
      crash() {
        t.link.destroy()
        browser.locks.dropAll(locks)
      },
    }
    opened.push(testTab)
    return testTab
  })
  return { tabOpened }
}

/** Opens the tab and lets it connect. */
async function tabIn(tab: Session, options?: TabOptions): Promise<TestTab> {
  const t = await opening(tab, options).tabOpened
  await settle()
  return t
}

const nameIn = (t: OpenTab, id: string) => readDesign(t.store).nodes[id]?.name

/** Whether a promise is still pending after the fake time and deliveries settle. */
async function pending(promise: Promise<unknown>) {
  let done = false
  void promise.then(
    () => (done = true),
    () => (done = true),
  )
  await settle()
  return !done
}

describe('opening', () => {
  it('waits for the welcome on a first visit, and opens on the server’s design once it comes', async () => {
    browser.mem.down()
    const { tabOpened } = opening(session())
    expect(await pending(tabOpened)).toBe(true)
    browser.mem.up()
    await settle(1000)
    const t = await tabOpened
    expect(t.kept).toBe(false)
    expect(nameIn(t, 'box')).toBe('Box')
    expect(t.link.status()).toBe('connected')
  })

  it('stops waiting when the page is left, holding no lock and no socket open', async () => {
    browser.mem.down()
    const leaving = new AbortController()
    const { tabOpened } = opening(session(), { signal: leaving.signal })
    await settle()
    leaving.abort()
    await expect(tabOpened).rejects.toThrow('stopped while connecting')
    browser.mem.up()
    await settle(60_000)
    expect(browser.mem.sockets.every((s) => s.closed)).toBe(true)
    expect(browser.locks.held()).toEqual([])
  })

  it('opens at once from its tab copy after a reload, offline, as the same tab, and sends its queue once', async () => {
    const tab = session()
    const a = await tabIn(tab)
    browser.mem.down()
    await settle()
    a.step('box', 'Offline')
    await settle(1000)
    const tabId = a.client().tabId()
    await a.unload()
    const b = await opening(tab).tabOpened
    expect(b.kept).toBe(true)
    expect(nameIn(b, 'box')).toBe('Offline')
    expect(b.client().tabId()).toBe(tabId)
    browser.mem.up()
    await settle(1000)
    expect(browser.mem.nameOf('box')).toBe('Offline')
    expect(browser.changeSetsOf(tabId)).toHaveLength(1)
  })
})

describe('synced', () => {
  it('is false while a step is open or its change set waits, and true once the server stored it (C34)', async () => {
    const t = await tabIn(session())
    expect(t.synced()).toBe(true)
    t.client().open()
    expect(t.synced()).toBe(false)
    t.store.set('layer', 'box', 'name', 'Stored')
    t.link.send(t.client().end('Rename'))
    expect(t.synced()).toBe(false)
    let storedWhenSynced: string | undefined
    t.link.onStatus(() => {
      if (t.synced() && storedWhenSynced === undefined) storedWhenSynced = browser.mem.nameOf('box')
    })
    await settle()
    expect(t.synced()).toBe(true)
    expect(storedWhenSynced).toBe('Stored')
  })
})

describe('fetchVersion', () => {
  it('gives a stored version read as a stored design reads, a layer the schema refuses left out and told, and null for an unknown id', async () => {
    const records = structuredClone(browser.mem.state())
    const box = records.nodes.box as { name: string } | undefined
    if (box) box.name = 'As it was'
    // A layer of a kind the schema no longer takes.
    const nodes: Record<string, unknown> = records.nodes
    nodes.gizmo = { type: 'gizmo', parentId: 'sq', index: 'a9', name: 'Gizmo', props: {} }
    browser.mem.journal.rows.versions.push({
      id: 'v1',
      kind: 'auto',
      name: '',
      description: '',
      savedBy: null,
      syncId: 's0',
      seq: 0,
      schemaVersion: SCHEMA_VERSION,
      records: records as DesignRecords,
      keep: null,
    })
    const t = await tabIn(session())
    const read = t.fetchVersion('v1')
    const unknown = t.fetchVersion('v2')
    await settle()
    const version = await read
    expect(version?.design.nodes.box?.name).toBe('As it was')
    expect(version?.design.nodes.gizmo).toBeUndefined()
    expect(version?.leftOut.map((part) => part.id)).toEqual(['gizmo'])
    expect(await unknown).toBeNull()
    // The live design is untouched.
    expect(nameIn(t, 'box')).not.toBe('As it was')
  })
})

describe('access', () => {
  it('is read-only for a Reviewer from the welcome, and from a kept tab copy offline', async () => {
    const tab = session()
    const viewer: Member = { userId: 'vic', workspaceId: 'w1' }
    const t = await tabIn(tab, { token: 'viewer', member: viewer })
    expect(t.access.readOnly()).toBe(true)
    expect(t.access.quiet?.()).toBe(false)
    await t.unload()
    browser.mem.down()
    const kept = await opening(tab, { token: 'viewer', member: viewer }).tabOpened
    expect(kept.kept).toBe(true)
    expect(kept.access.readOnly()).toBe(true)
  })

  it('follows the server’s word on the role, and says when it changed', async () => {
    const t = await tabIn(session())
    let changes = 0
    t.access.onChange(() => changes++)
    t.link.send([{ type: 'token', token: 'viewer' }])
    await settle()
    expect(t.access.readOnly()).toBe(true)
    expect(changes).toBeGreaterThan(0)
  })

  it.each([
    ['a deleted design', SYNC_CLOSE.designDeleted, 'designDeleted'],
    ['another connection taking over', SYNC_CLOSE.replaced, 'replaced'],
  ])('is read-only and quiet once the link ends for %s, and connects no more', async (_, code, ended) => {
    const t = await tabIn(session())
    browser.mem.sockets.at(-1)?.closeWith(code)
    await settle(60_000)
    expect(t.link.ended()).toBe(ended)
    expect(t.access.readOnly()).toBe(true)
    expect(t.access.quiet?.()).toBe(true)
    expect(browser.mem.sockets).toHaveLength(1)
  })

  it('is read-only and quiet once the API turns the member away, opened from its tab copy', async () => {
    const tab = session()
    await (await tabIn(tab)).unload()
    const t = await opening(tab, { token: () => Promise.reject(new TokenRefused()) }).tabOpened
    await settle(60_000)
    expect(t.link.ended()).toBe('refused')
    expect(t.access.readOnly()).toBe(true)
    expect(t.access.quiet?.()).toBe(true)
  })

  it.each([
    ['the API turns the member away', () => Promise.reject(new TokenRefused()), 'NoAccess'],
    ['the tab is older than the design', () => Promise.resolve('old'), 'Outdated'],
  ] as const)(
    'throws the state a first visit stopped in when %s before the welcome, letting go of everything',
    async (_, token, state) => {
      const { tabOpened } = opening(session(), { token })
      const stopped = await tabOpened.catch((error: unknown) => error)
      expect(stopped).toBeInstanceOf(TabStopped)
      expect((stopped as TabStopped).state).toBe(state)
      expect(browser.locks.held()).toEqual([])
    },
  )
})

describe('notices', () => {
  it('tells a change set the server rejected (C36), told before the editor listened', async () => {
    const tab = session()
    const a = await tabIn(tab)
    browser.mem.down()
    await settle()
    a.step('box', 'Offline')
    await settle(1000)
    await a.unload()
    // Another tab deletes the layer meanwhile.
    browser.mem.up()
    const other = browser.linkFor('bob')
    other.connect()
    await settle()
    const bob = other.client() as Client
    bob.open()
    bob.write({ op: 'delete', part: 'layer', id: 'box' })
    other.send(bob.end('Delete'))
    await settle()
    // The editor listens only once the tab opened and the welcome landed.
    const b = await tabIn(tab, { listenLate: true })
    expect(b.notices).toEqual([])
    b.listen()
    expect(b.notices).toEqual([expect.objectContaining({ kind: 'rejected', changeSetKind: 'edit' })])
    expect(nameIn(b, 'box')).toBeUndefined()
  })

  it('tells change sets lost to a new server that no longer knows the tab (C43)', async () => {
    const tab = session()
    const a = await tabIn(tab)
    browser.mem.down()
    await settle()
    a.step('box', 'Lost')
    await settle(1000)
    await a.unload()
    // A new server for the design, which another tab joined first.
    browser.mem = memorySync()
    browser.linkFor('bob').connect()
    await settle()
    const b = await tabIn(tab)
    expect(b.notices).toEqual([{ kind: 'lost', changeSets: 1 }])
  })

  it('tells a step too big to send, puts it back and sends nothing', async () => {
    const t = await tabIn(session(), { client: { limits: { messageBytes: 200 } } })
    t.step('box', 'x'.repeat(500))
    await settle()
    expect(t.notices).toEqual([{ kind: 'tooBig', step: 'Rename' }])
    expect(nameIn(t, 'box')).toBe('Box')
    expect(browser.changeSetsOf(t.client().tabId())).toEqual([])
  })

  it('tells the device full once its tab copy can no longer be written', async () => {
    const t = await tabIn(session())
    const put = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function () {
      throw new DOMException('the device is full', 'QuotaExceededError')
    }
    try {
      t.step('box', 'Full')
      await settle()
    } finally {
      IDBObjectStore.prototype.put = put
    }
    expect(t.notices).toEqual([{ kind: 'deviceStopped', why: 'full' }])
    expect(browser.mem.nameOf('box')).toBe('Full')
  })

  it('opens with no device copy in a browser without Web Locks, says so, and still saves', async () => {
    vi.stubGlobal('navigator', {})
    try {
      const t = await tabIn(session(), { noLocks: true })
      expect(t.notices).toEqual([{ kind: 'noDeviceCopy' }])
      t.step('box', 'Saved')
      await settle()
      expect(browser.mem.nameOf('box')).toBe('Saved')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('tells the design’s size from the welcome and each change set stored', async () => {
    const t = await tabIn(session())
    expect(t.linkNotices.size()).toMatchObject({ layers: expect.any(Number) as number })
    let sized = 0
    t.linkNotices.onSize(() => sized++)
    t.step('box', 'Sized')
    await settle()
    expect(sized).toBe(1)
  })
})

describe('other tab copies', () => {
  /** Two pages that each made a step offline and crashed: the older renamed the box, the newer the headline. */
  async function crashedTwo() {
    const crashed = [await tabIn(session()), await tabIn(session())]
    browser.mem.down()
    await settle()
    for (const [at, page] of crashed.entries()) {
      page.step(at === 0 ? 'box' : 'headline', `From crash ${at}`)
      await settle(1000)
    }
    const ids = crashed.map((page) => page.client().tabId())
    for (const page of crashed) page.crash()
    browser.mem.up()
    return ids
  }

  it('sends crashed pages’ queues after the first welcome, each on a link of its own, then deletes their tab copies', async () => {
    const ids = await crashedTwo()
    // The newest free tab copy is taken up as this tab's; the other's work is sent on a link of its own.
    const t = await tabIn(session())
    await settle(1000)
    expect(t.client().tabId()).toBe(ids[1])
    expect([browser.mem.nameOf('box'), browser.mem.nameOf('headline')]).toEqual(['From crash 0', 'From crash 1'])
    expect(browser.changeSetsOf(ids[0] as number)).toHaveLength(1)
    expect(await browser.rows()).toEqual([t.client().tabId()])
  })

  it('tells what the other tab copies’ links had to tell, such as a change set the server rejected', async () => {
    await crashedTwo()
    const other = browser.linkFor('bob')
    other.connect()
    await settle()
    const bob = other.client() as Client
    bob.open()
    bob.write({ op: 'delete', part: 'layer', id: 'box' })
    other.send(bob.end('Delete'))
    await settle()
    const t = await tabIn(session())
    await settle(1000)
    expect(t.notices).toEqual([expect.objectContaining({ kind: 'rejected', changeSetKind: 'edit' })])
  })

  it('stops sending other tab copies’ work quietly when the tab closes meanwhile', async () => {
    await crashedTwo()
    const t = await opening(session()).tabOpened
    await t.close()
    await settle(1000)
    expect(t.reported).toEqual([])
  })
})

describe('settling', () => {
  it('reports what a notice listener throws, and tells the other notices of the batch', async () => {
    const t = await tabIn(session(), { client: { limits: { messageBytes: 200 } } })
    let throws = true
    t.linkNotices.on(() => {
      if (!throws) return
      throws = false
      throw new Error('a notice listener broke')
    })
    t.step('box', 'x'.repeat(500))
    t.step('headline', 'y'.repeat(500))
    await settle()
    expect(t.reported).toEqual([new Error('a notice listener broke')])
    expect(t.notices).toEqual([
      { kind: 'tooBig', step: 'Rename' },
      { kind: 'tooBig', step: 'Rename' },
    ])
  })

  it('reports what a store listener throws as a message lands, stays connected and takes the next', async () => {
    const t = await tabIn(session())
    let throws = true
    t.store.onChange(() => {
      if (!throws) return
      throws = false
      throw new Error('a listener broke')
    })
    const other = browser.linkFor('bob')
    other.connect()
    await settle()
    const bob = other.client() as Client
    for (const to of ['One', 'Two']) {
      bob.open()
      bob.write(rename('box', to))
      other.send(bob.end('Rename'))
      await settle()
    }
    expect(t.reported).toEqual([new Error('a listener broke')])
    expect(t.link.status()).toBe('connected')
    expect(nameIn(t, 'box')).toBe('Two')
  })
})

describe('the recompute', () => {
  /** The headline's name follows the box's, as a derived value does. */
  const headlineFollowsBox: Recompute = (state, touched) =>
    touched.has('layer/box')
      ? [
          {
            op: 'set',
            value: { part: 'layer', id: 'headline', key: 'name' },
            to: String(state.get('layer', 'box')?.name).toUpperCase(),
          },
        ]
      : []

  it('waits for the editor’s own, then sends the follow-up a crossing edit owes with it', async () => {
    const t = await tabIn(session())
    const other = browser.linkFor('bob')
    other.connect()
    await settle()
    const bob = other.client() as Client
    // Bob's step reaches the server first: Ann's crosses it.
    bob.open()
    bob.write(rename('box', 'From Bob'))
    other.send(bob.end('Rename'))
    t.step('box', 'From Ann')
    await settle()
    expect(t.client().owes()).toBe(true)
    expect(t.synced()).toBe(false)
    expect(browser.mem.nameOf('headline')).toBe('Headline')
    const binding = new AbortController()
    let settled: (() => void) | undefined
    t.bind(
      {
        recompute: headlineFollowsBox,
        onFontsSettled(listener) {
          settled = listener
          return () => (settled = undefined)
        },
      },
      binding.signal,
    )
    await settle()
    expect(browser.mem.nameOf('headline')).toBe('FROM ANN')
    expect(t.synced()).toBe(true)
    expect(settled).toBeDefined()
    binding.abort()
    expect(settled).toBeUndefined()
  })

  it('sends a follow-up that waited for its fonts once the editor says they settled', async () => {
    const t = await tabIn(session())
    let fontsHere = false
    let settled: (() => void) | undefined
    t.bind(
      {
        recompute: (state, touched) => (fontsHere ? headlineFollowsBox(state, touched) : 'wait'),
        onFontsSettled(listener) {
          settled = listener
          return () => (settled = undefined)
        },
      },
      new AbortController().signal,
    )
    const other = browser.linkFor('bob')
    other.connect()
    await settle()
    const bob = other.client() as Client
    bob.open()
    bob.write(rename('box', 'From Bob'))
    other.send(bob.end('Rename'))
    t.step('box', 'From Ann')
    await settle()
    expect(t.client().owes()).toBe(true)
    fontsHere = true
    settled?.()
    await settle()
    expect(browser.mem.nameOf('headline')).toBe('FROM ANN')
    expect(t.synced()).toBe(true)
  })
})
