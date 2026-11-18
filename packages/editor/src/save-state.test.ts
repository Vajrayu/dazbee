import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Client } from '@dazbee/doc'
import { SCHEMA_VERSION, SYNC_CLOSE } from '@dazbee/schema'

import { type Link, type LinkStatus, type SaveState, syncUrl, watchSaveState } from './save-state.ts'
import { openSyncLink } from './sync-link.ts'
import { memorySync } from './test-link.ts'
import { TokenRefused } from './token-source.ts'

/** A link that only holds a status, whether the tab may only view and whether it is synced, and says when they change. */
function fakeLink(initial: LinkStatus = 'connected') {
  const listeners = new Set<() => void>()
  let status = initial
  let viewOnly = false
  let synced = true
  const tell = () => {
    for (const listener of listeners) listener()
  }
  const fake = {
    connects: 0,
    disconnects: 0,
    link: {
      status: () => status,
      viewOnly: () => viewOnly,
      synced: () => synced,
      onStatus(listener) {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      connect() {
        fake.connects++
      },
      disconnect() {
        fake.disconnects++
        if (status === 'connected') fake.status('disconnected')
      },
    } satisfies Link,
    /** The connection going up, down, or stopping. */
    status(next: LinkStatus) {
      status = next
      tell()
    },
    viewOnly(next: boolean) {
      viewOnly = next
      tell()
    },
    /** Edits waiting for the sync server, or none left. */
    unsynced(waiting: boolean) {
      synced = !waiting
      tell()
    },
    listening: () => listeners.size,
  }
  return fake
}

/** A save state on a fake link, with every state it showed. */
function watched(status?: LinkStatus) {
  const fake = fakeLink(status)
  const shown: SaveState[] = []
  const watch = watchSaveState({ link: fake.link, onSaveState: (state) => shown.push(state) })
  return { fake, shown, watch }
}

let online = true
let browser = new EventTarget()

beforeEach(() => {
  vi.useFakeTimers()
  online = true
  browser = new EventTarget()
  vi.stubGlobal('navigator', {
    get onLine() {
      return online
    },
  })
  vi.stubGlobal(
    'window',
    Object.assign(browser, { setTimeout: (run: () => void, ms: number) => setTimeout(run, ms) as unknown as number }),
  )
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('watchSaveState', () => {
  it('shows nothing until it starts, then where the edits are', () => {
    const { fake, shown, watch } = watched()
    fake.unsynced(true)
    expect(shown).toEqual([])
    watch.start()
    expect(shown).toEqual(['Saving'])
    fake.unsynced(false)
    expect(shown).toEqual(['Saving', 'Saved'])
  })

  it('shows a state once, not again while it holds', () => {
    const { fake, shown, watch } = watched()
    watch.start()
    fake.unsynced(false)
    fake.status('connected')
    expect(shown).toEqual(['Saved'])
  })

  it('reads Saving while the connection is gone, and Offline only after a moment', () => {
    const { fake, shown, watch } = watched()
    watch.start()
    fake.status('disconnected')
    expect(shown).toEqual(['Saved', 'Saving'])
    vi.advanceTimersByTime(1499)
    expect(shown).toEqual(['Saved', 'Saving'])
    vi.advanceTimersByTime(1)
    expect(shown).toEqual(['Saved', 'Saving', 'Offline'])
    // Still gone: it keeps reading Offline, not Saving.
    fake.status('disconnected')
    expect(shown).toEqual(['Saved', 'Saving', 'Offline'])
    fake.status('connected')
    expect(shown).toEqual(['Saved', 'Saving', 'Offline', 'Saved'])
  })

  it('never flashes Offline for a reconnect that takes a blink', () => {
    const { fake, shown, watch } = watched()
    watch.start()
    fake.status('disconnected')
    vi.advanceTimersByTime(1000)
    fake.status('connected')
    vi.advanceTimersByTime(5000)
    expect(shown).toEqual(['Saved', 'Saving', 'Saved'])
  })

  it('reads Offline at once when the browser has no network', () => {
    const { fake, shown, watch } = watched()
    watch.start()
    online = false
    fake.status('disconnected')
    expect(shown).toEqual(['Saved', 'Offline'])
  })

  it('opens Offline when it starts without a connection and the browser has no network', () => {
    online = false
    const { shown, watch } = watched('disconnected')
    watch.start()
    expect(shown).toEqual(['Offline'])
  })

  it('drops the socket when the browser goes offline, and connects again when it is back', () => {
    const { fake, shown, watch } = watched()
    watch.start()
    online = false
    browser.dispatchEvent(new Event('offline'))
    expect(fake.disconnects).toBe(1)
    expect(watch.connected()).toBe(false)
    expect(shown).toEqual(['Saved', 'Offline'])
    online = true
    browser.dispatchEvent(new Event('online'))
    expect(fake.connects).toBe(1)
  })

  it('says whether the sync server is connected', () => {
    const { fake, watch } = watched('disconnected')
    expect(watch.connected()).toBe(false)
    fake.status('connected')
    expect(watch.connected()).toBe(true)
    fake.status('disconnected')
    expect(watch.connected()).toBe(false)
  })

  it('reads ViewOnly while the sync server says the tab may only view the design, and what it was once it may write again', () => {
    const { fake, shown, watch } = watched()
    watch.start()
    fake.viewOnly(true)
    fake.unsynced(true)
    expect(shown).toEqual(['Saved', 'ViewOnly'])
    fake.viewOnly(false)
    expect(shown).toEqual(['Saved', 'ViewOnly', 'Saving'])
  })

  it.each([['Outdated'], ['Deleted'], ['Replaced'], ['NoAccess']] as const)(
    'reads %s at once, before it starts too, and the network coming back does not connect it again',
    (stopped) => {
      const { fake, shown, watch } = watched('disconnected')
      fake.status(stopped)
      expect(shown).toEqual([stopped])
      watch.start()
      browser.dispatchEvent(new Event('online'))
      vi.advanceTimersByTime(5000)
      expect(shown).toEqual([stopped])
      expect(fake.connects).toBe(0)
    },
  )

  it('stays stopped after the connection drops, as the socket reports the drop before the end', () => {
    const { fake, shown, watch } = watched()
    watch.start()
    fake.status('disconnected')
    fake.status('Deleted')
    vi.advanceTimersByTime(5000)
    expect(shown).toEqual(['Saved', 'Saving', 'Deleted'])
  })

  it('stops listening and showing once destroyed', () => {
    const { fake, shown, watch } = watched()
    watch.start()
    fake.status('disconnected')
    watch.destroy()
    vi.advanceTimersByTime(5000)
    fake.status('connected')
    browser.dispatchEvent(new Event('offline'))
    browser.dispatchEvent(new Event('online'))
    expect(shown).toEqual(['Saved', 'Saving'])
    expect(fake.listening()).toBe(0)
    expect(fake.disconnects).toBe(0)
    expect(fake.connects).toBe(0)
  })
})

describe('watchSaveState on the sync link', () => {
  /** A save state on a sync link to a server in memory, as `token`'s member, with every state it showed. */
  async function onLink(token: string | (() => Promise<string>) = 'ann') {
    const mem = memorySync()
    const link = openSyncLink({
      url: 'ws://s',
      designId: 'd1',
      token: typeof token === 'string' ? () => Promise.resolve(token) : token,
      socket: mem.socket,
      random: () => 1,
    })
    const shown: SaveState[] = []
    const watch = watchSaveState({ link, onSaveState: (state) => shown.push(state) })
    link.connect()
    await mem.settle()
    watch.start()
    const settle = async (ms = 0) => {
      await vi.advanceTimersByTimeAsync(ms)
      await mem.settle()
    }
    return { mem, link, shown, watch, settle, client: () => link.client() as Client }
  }

  it('reads Saving while a change set waits for the server, and Saved once it is stored', async () => {
    const { link, shown, settle, client } = await onLink()
    client().open()
    client().write({ op: 'set', value: { part: 'layer', id: 'box', key: 'name' }, to: 'Moved' })
    expect(shown).toEqual(['Saved', 'Saving'])
    link.send(client().end('Rename'))
    expect(shown).toEqual(['Saved', 'Saving'])
    await settle()
    expect(shown).toEqual(['Saved', 'Saving', 'Saved'])
  })

  it('reads Offline a moment after the connection drops, keeps the step, and Saved once it is back and sent', async () => {
    const { mem, link, shown, settle, client } = await onLink()
    mem.down()
    await settle()
    expect(shown).toEqual(['Saved', 'Saving'])
    client().open()
    client().write({ op: 'set', value: { part: 'layer', id: 'box', key: 'name' }, to: 'Offline' })
    link.send(client().end('Rename'))
    await settle(1500)
    expect(shown).toEqual(['Saved', 'Saving', 'Offline'])
    mem.up()
    await settle(30_000)
    expect(shown).toEqual(['Saved', 'Saving', 'Offline', 'Saving', 'Saved'])
    expect(mem.nameOf('box')).toBe('Offline')
  })

  it('reads Offline at once when the browser goes offline, and connects again when it is back', async () => {
    const { mem, shown, settle } = await onLink()
    online = false
    browser.dispatchEvent(new Event('offline'))
    await settle()
    expect(shown).toEqual(['Saved', 'Offline'])
    expect(mem.sockets[0]?.closed).toBe(true)
    online = true
    browser.dispatchEvent(new Event('online'))
    await settle()
    expect(mem.sockets).toHaveLength(2)
    expect(shown).toEqual(['Saved', 'Offline', 'Saved'])
  })

  it("reads ViewOnly for a Reviewer's tab", async () => {
    const { shown, link } = await onLink('viewer')
    expect(shown).toEqual(['ViewOnly'])
    expect(link.viewOnly()).toBe(true)
  })

  it('reads ViewOnly once the server says the role changed, and Saved once it changes back', async () => {
    const { link, shown, settle } = await onLink()
    // A renewed token for another role, as the sync server checks it.
    link.send([{ type: 'token', token: 'viewer' }])
    await settle()
    link.send([{ type: 'token', token: 'ann' }])
    await settle()
    expect(shown).toEqual(['Saved', 'ViewOnly', 'Saved'])
  })

  it('reads Outdated and stops connecting when the server refuses a tab older than the design', async () => {
    const { mem, shown, settle } = await onLink('old')
    await settle(60_000)
    expect(shown).toEqual(['Outdated'])
    expect(mem.sockets).toHaveLength(1)
    browser.dispatchEvent(new Event('online'))
    await settle(60_000)
    expect(mem.sockets).toHaveLength(1)
  })

  it.each([
    ['Deleted', SYNC_CLOSE.designDeleted],
    ['Replaced', SYNC_CLOSE.replaced],
  ] as const)(
    'reads %s once the server ends the tab, and the network coming back does not connect it',
    async (state, code) => {
      const { mem, shown, settle } = await onLink()
      mem.sockets[0]?.closeWith(code)
      await settle(60_000)
      expect(shown).toEqual(['Saved', state])
      browser.dispatchEvent(new Event('online'))
      await settle(60_000)
      expect(mem.sockets).toHaveLength(1)
    },
  )

  it('reads NoAccess when the API turns the member away', async () => {
    const { mem, shown, settle } = await onLink(() => Promise.reject(new TokenRefused()))
    await settle(60_000)
    expect(shown).toEqual(['NoAccess'])
    expect(mem.sockets).toHaveLength(0)
  })
})

describe('syncUrl', () => {
  it('says which schema version the tab was built with', () => {
    expect(syncUrl('ws://localhost:1234')).toBe(`ws://localhost:1234?schemaVersion=${SCHEMA_VERSION}`)
    expect(syncUrl('wss://sync.example/ws?region=eu')).toBe(
      `wss://sync.example/ws?region=eu&schemaVersion=${SCHEMA_VERSION}`,
    )
  })
})
