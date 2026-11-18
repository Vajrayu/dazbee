// The sync link on the core's sync server in memory: the first hello and welcome, resuming after a
// drop with the queue sent once, the backoff, the closes that end it, the pace, previews, renewal,
// a gzipped welcome and a silent socket.
import { gzipSync } from 'node:zlib'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Client } from '@dazbee/doc'
import { type Change, DESIGN_PARAM, SCHEMA_VERSION, type ServerMessage, SYNC_CLOSE } from '@dazbee/schema'

import {
  type LinkSocket,
  openSyncLink,
  PING_EVERY_MS,
  PRESENCE_EVERY_MS,
  PREVIEW_EVERY_MS,
  RECONNECT_FIRST_MS,
  RECONNECT_LAST_MS,
  type SyncLink,
  type SyncLinkOptions,
} from './sync-link.ts'
import { type MemorySync, memorySync } from './test-link.ts'
import { TokenRefused } from './token-source.ts'

const rename = (id: string, to: string): Change => ({ op: 'set', value: { part: 'layer', id, key: 'name' }, to })
const nameOf = (c: Client, id: string) => (c.working().get('layer', id) as { name: string } | undefined)?.name

let mem: MemorySync
const links: SyncLink[] = []

beforeEach(() => {
  vi.useFakeTimers()
  mem = memorySync()
})
afterEach(() => {
  for (const link of links.splice(0)) link.destroy()
  vi.useRealTimers()
})

/** A link to the server in memory as `token`'s member, connected. */
async function linked(more: Partial<SyncLinkOptions> = {}, token = 'ann') {
  const link = openSyncLink({
    url: 'ws://sync.test',
    designId: 'd1',
    token: () => Promise.resolve(token),
    socket: mem.socket,
    random: () => 1,
    ...more,
  })
  links.push(link)
  link.connect()
  await mem.settle()
  return link
}

/** One step that renames `id`, sent through the link. */
function step(link: SyncLink, id: string, to: string) {
  const c = link.client() as Client
  c.open()
  c.write(rename(id, to))
  link.send(c.end('Rename'))
}

/** Waits `ms` of fake time, and for what it set going. */
async function wait(ms: number) {
  await vi.advanceTimersByTimeAsync(ms)
  await mem.settle()
}

/** `socket` as an old server's: its welcomes say nothing of presence. */
function withoutPresence(socket: LinkSocket): LinkSocket {
  return new Proxy(socket, {
    set(target, key, value: unknown) {
      const handler = value as LinkSocket['onmessage']
      if (key !== 'onmessage' || !handler) return Reflect.set(target, key, value)
      target.onmessage = ({ data }) => {
        const message = JSON.parse(String(data)) as ServerMessage
        if (message.type === 'welcome') delete message.presence
        handler({ data: JSON.stringify(message) })
      }
      return true
    },
  })
}

const changeSetsSent = () => mem.sockets.flatMap((s) => s.sent.filter((m) => m.type === 'changes'))

describe('connecting', () => {
  it('says hello as a new tab on a first visit, and makes the client from the welcome', async () => {
    const made: Client[] = []
    const link = openSyncLink({
      url: 'ws://sync.test/ws',
      designId: 'd1',
      token: () => Promise.resolve('ann'),
      socket: mem.socket,
    })
    links.push(link)
    link.onClient((c) => made.push(c))
    expect(link.client()).toBeUndefined()
    link.connect()
    await mem.settle()
    const [socket] = mem.sockets
    expect(socket?.url).toBe(`ws://sync.test/ws?schemaVersion=${SCHEMA_VERSION}&${DESIGN_PARAM}=d1`)
    expect(socket?.sent[0]).toEqual({ type: 'hello', protocol: 1, token: 'ann', waiting: 0 })
    expect(made).toEqual([link.client()])
    expect(link.status()).toBe('connected')
    expect(link.synced()).toBe(true)
    expect(nameOf(link.client() as Client, 'box')).toBe('Box')
  })

  it('opens offline at once from a saved client, and resumes as that tab', async () => {
    const first = await linked()
    step(first, 'box', 'Saved box')
    await mem.settle()
    const saved = (first.client() as Client).save()
    first.destroy()
    const link = openSyncLink({
      url: 'ws://s',
      designId: 'd1',
      token: () => Promise.resolve('ann'),
      socket: mem.socket,
      start: saved,
    })
    links.push(link)
    expect(nameOf(link.client() as Client, 'box')).toBe('Saved box')
    expect(link.status()).toBe('disconnected')
    link.connect()
    await mem.settle()
    const hello = mem.sockets.at(-1)?.sent[0]
    expect(hello).toMatchObject({ type: 'hello', resume: { tabId: saved.tabId, secret: saved.secret } })
    expect(link.client()?.tabId()).toBe(saved.tabId)
    expect(link.status()).toBe('connected')
  })
})

describe('a dropped connection', () => {
  it('resumes after a backoff, and sends what was made offline once', async () => {
    const link = await linked({ random: () => 0.5 })
    const tabId = link.client()?.tabId()
    mem.sockets[0]?.cut()
    await mem.settle()
    expect(link.status()).toBe('disconnected')
    step(link, 'box', 'Offline box')
    expect(changeSetsSent()).toHaveLength(0)
    await wait(RECONNECT_FIRST_MS * 0.5 - 1)
    expect(mem.sockets).toHaveLength(1)
    await wait(1)
    expect(mem.sockets).toHaveLength(2)
    expect(link.client()?.tabId()).toBe(tabId)
    expect(changeSetsSent()).toHaveLength(1)
    expect(link.synced()).toBe(true)
    expect(mem.nameOf('box')).toBe('Offline box')
  })

  it('waits under a ceiling that doubles from 1 s to 30 s, and starts again from 1 s once a connection held', async () => {
    const waits: number[] = []
    const link = await linked()
    mem.down()
    await mem.settle()
    // Each try fails at once while the network is down: the ceilings double (random() is 1).
    for (let n = 0; n < 7; n++) {
      const before = mem.sockets.length
      let waited = 0
      while (mem.sockets.length === before) {
        await wait(100)
        waited += 100
      }
      waits.push(waited)
    }
    expect(waits).toEqual([1000, 2000, 4000, 8000, 16000, RECONNECT_LAST_MS, RECONNECT_LAST_MS])
    mem.up()
    await wait(RECONNECT_LAST_MS)
    expect(link.status()).toBe('connected')
    await wait(RECONNECT_LAST_MS)
    mem.sockets.at(-1)?.cut()
    await mem.settle()
    const before = mem.sockets.length
    await wait(RECONNECT_FIRST_MS)
    expect(mem.sockets.length).toBe(before + 1)
  })

  it('draws each wait at random under its ceiling (full jitter)', async () => {
    const draws = [0.25, 0]
    const link = await linked({ random: () => draws.shift() ?? 1 })
    mem.down()
    await mem.settle()
    await wait(RECONNECT_FIRST_MS * 0.25 - 1)
    expect(mem.sockets).toHaveLength(1)
    await wait(1)
    expect(mem.sockets).toHaveLength(2)
    // The next draw is 0: it tries again at once.
    await wait(1)
    expect(mem.sockets).toHaveLength(3)
    expect(link.status()).toBe('disconnected')
  })

  it('reconnects after a close the server asks it to come back from', async () => {
    for (const code of [
      SYNC_CLOSE.tokenExpired,
      SYNC_CLOSE.tooManyMessages,
      SYNC_CLOSE.storeFailed,
      SYNC_CLOSE.serverBusy,
      1009,
    ]) {
      const link = await linked()
      const before = mem.sockets.length
      mem.sockets.at(-1)?.closeWith(code)
      await wait(RECONNECT_FIRST_MS)
      expect(mem.sockets.length, `after ${code}`).toBe(before + 1)
      expect(link.status()).toBe('connected')
      link.destroy()
    }
  })

  it.each([
    ['a tab older than the design', SYNC_CLOSE.tabTooOld, null, 'Outdated'],
    ['a deleted design', SYNC_CLOSE.designDeleted, 'designDeleted', 'Deleted'],
    ['another connection taking over', SYNC_CLOSE.replaced, 'replaced', 'Replaced'],
  ])('does not connect again after %s', async (_, code, ended, status) => {
    const link = await linked()
    mem.sockets[0]?.closeWith(code)
    await wait(RECONNECT_LAST_MS * 2)
    expect(mem.sockets).toHaveLength(1)
    expect(link.ended()).toBe(ended)
    expect(link.status()).toBe(status)
    link.connect()
    await wait(RECONNECT_LAST_MS)
    expect(mem.sockets).toHaveLength(1)
  })

  it('is Outdated when the server refuses a tab older than the design at hello', async () => {
    const link = await linked({}, 'old')
    await wait(RECONNECT_LAST_MS)
    expect(link.status()).toBe('Outdated')
    expect(mem.sockets).toHaveLength(1)
  })

  it('stops when the API turns the member away, and tries again when the API only failed', async () => {
    const refused = await linked({ token: () => Promise.reject(new TokenRefused()) })
    await wait(RECONNECT_LAST_MS)
    expect(refused.ended()).toBe('refused')
    expect(refused.status()).toBe('NoAccess')
    expect(mem.sockets).toHaveLength(0)
    const tries: number[] = []
    const flaky = await linked({
      token: () => {
        tries.push(Date.now())
        return tries.length < 3 ? Promise.reject(new Error('the API is down')) : Promise.resolve('ann')
      },
    })
    await wait(RECONNECT_FIRST_MS + 2 * RECONNECT_FIRST_MS)
    expect(tries).toHaveLength(3)
    expect(flaky.status()).toBe('connected')
  })

  it('drops a socket that hears nothing for two pings, and connects again', async () => {
    const link = await linked()
    const first = mem.sockets[0]
    await wait(PING_EVERY_MS)
    expect(first?.sent.at(-1)).toEqual({ type: 'ping' })
    first?.hold()
    await wait(2 * PING_EVERY_MS)
    expect(first?.closed).toBe(false)
    // The next ping finds it silent for more than two pings.
    await wait(PING_EVERY_MS)
    expect(first?.closed).toBe(true)
    await wait(RECONNECT_FIRST_MS)
    expect(mem.sockets).toHaveLength(2)
    expect(link.status()).toBe('connected')
  })

  it('stays on a socket that answers its pings', async () => {
    await linked()
    await wait(10 * PING_EVERY_MS)
    expect(mem.sockets).toHaveLength(1)
  })

  it('connects again when the client cannot place a message', async () => {
    const link = await linked()
    const socket = mem.sockets[0] as LinkSocket
    // A second welcome on one connection is one the client cannot place.
    const welcome = mem.sockets[0]?.got[0] as ServerMessage
    socket.onmessage?.({ data: JSON.stringify(welcome) })
    await mem.settle()
    expect(mem.sockets[0]?.closed).toBe(true)
    await wait(RECONNECT_FIRST_MS)
    expect(mem.sockets).toHaveLength(2)
    expect(link.status()).toBe('connected')
  })

  it('stops connecting while disconnected, and connects at once when asked', async () => {
    const link = await linked()
    link.disconnect()
    await wait(RECONNECT_LAST_MS)
    expect(mem.sockets).toHaveLength(1)
    expect(link.status()).toBe('disconnected')
    link.connect()
    await mem.settle()
    expect(mem.sockets).toHaveLength(2)
    expect(link.status()).toBe('connected')
  })
})

describe('sending', () => {
  it('sends 300 change sets made offline at a pace: 200 at once, then 60 a second', async () => {
    const link = await linked()
    mem.sockets[0]?.cut()
    await mem.settle()
    for (let n = 1; n <= 300; n++) step(link, 'box', `Box ${n}`)
    await wait(RECONNECT_FIRST_MS)
    expect(changeSetsSent()).toHaveLength(200)
    await wait(1000)
    expect(changeSetsSent().length).toBeGreaterThanOrEqual(259)
    expect(changeSetsSent().length).toBeLessThanOrEqual(261)
    await wait(1000)
    expect(changeSetsSent()).toHaveLength(300)
    expect(link.synced()).toBe(true)
    expect(nameOf(link.client() as Client, 'box')).toBe('Box 300')
  })

  it("sends the open step's latest preview, at most every PREVIEW_EVERY_MS, and none offline", async () => {
    const link = await linked()
    const c = link.client() as Client
    const previews = () => (mem.sockets.at(-1)?.sent ?? []).filter((m) => m.type === 'preview')
    c.open()
    for (let n = 1; n <= 10; n++) {
      c.write(rename('box', `Moving ${n}`))
      await wait(PREVIEW_EVERY_MS / 4)
    }
    // Ten writes over two and a half periods: a preview each period, the latest write in each.
    expect(previews().length).toBeLessThanOrEqual(3)
    await wait(PREVIEW_EVERY_MS)
    expect(previews().at(-1)).toMatchObject({ changes: [['s', 'layer', 'box', 'name', null, 'Moving 10']] })
    link.disconnect()
    c.write(rename('box', 'Offline'))
    await wait(PREVIEW_EVERY_MS * 3)
    expect(mem.sockets.flatMap((s) => s.sent).filter((m) => m.type === 'preview').length).toBe(previews().length)
  })

  it('sends the latest presence at most every PRESENCE_EVERY_MS, the last never lost, and again on each welcome', async () => {
    const link = await linked({ random: () => 0.5 })
    const sent = () => mem.sockets.flatMap((s) => s.sent).filter((m) => m.type === 'presence')
    const at = (x: number) => ({ page: 'p1', pointer: [x, 0] as [number, number], selection: [], frame: null })
    link.presence(at(1))
    expect(sent()).toEqual([{ type: 'presence', ...at(1) }])
    for (let x = 2; x <= 10; x++) {
      await wait(PRESENCE_EVERY_MS / 4)
      link.presence(at(x))
    }
    // Ten over two and a quarter periods: one at once, then one each period, the latest in each.
    expect(sent().length).toBeGreaterThanOrEqual(2)
    expect(sent().length).toBeLessThanOrEqual(3)
    await wait(PRESENCE_EVERY_MS)
    expect(sent().at(-1)).toEqual({ type: 'presence', ...at(10) })
    const before = sent().length
    link.presence(at(10))
    await wait(PRESENCE_EVERY_MS)
    // The same again sends nothing.
    expect(sent()).toHaveLength(before)
    mem.sockets[0]?.cut()
    await mem.settle()
    link.presence(at(11))
    await wait(PRESENCE_EVERY_MS)
    expect(sent()).toHaveLength(before)
    await wait(RECONNECT_FIRST_MS)
    expect(sent().at(-1)).toEqual({ type: 'presence', ...at(11) })
    expect(mem.sockets.at(-1)?.sent.filter((m) => m.type === 'presence')).toHaveLength(1)
  })

  it('sends no presence the server would not take', async () => {
    const link = await linked()
    link.presence({ page: '', pointer: [1, 1], selection: [], frame: null })
    await wait(PRESENCE_EVERY_MS * 2)
    expect(mem.sockets.flatMap((s) => s.sent).filter((m) => m.type === 'presence')).toEqual([])
    expect(link.status()).toBe('connected')
  })

  it('sends no presence to a server whose welcome does not say it takes it', async () => {
    const link = await linked({ socket: (url) => withoutPresence(mem.socket(url)) })
    expect(link.status()).toBe('connected')
    link.presence({ page: 'p1', pointer: [1, 1], selection: [], frame: null })
    await wait(PRESENCE_EVERY_MS * 2)
    expect(mem.sockets.flatMap((s) => s.sent).filter((m) => m.type === 'presence')).toEqual([])
  })

  it('answers the server asking for a fresh token', async () => {
    await linked()
    mem.sockets[0]?.deliver({ type: 'token' })
    await mem.settle()
    expect(mem.sockets[0]?.sent.at(-1)).toEqual({ type: 'token', token: 'ann' })
  })

  it('is not synced while a change set waits, a step is open or the client is offline', async () => {
    const link = await linked()
    const c = link.client() as Client
    step(link, 'box', 'Waiting')
    expect(link.synced()).toBe(false)
    await mem.settle()
    expect(link.synced()).toBe(true)
    c.open()
    expect(link.synced()).toBe(false)
    link.send(c.cancel())
    expect(link.synced()).toBe(true)
    link.disconnect()
    expect(link.synced()).toBe(false)
  })
})

describe('the gate', () => {
  it('holds each send until the gate lets it, in order', async () => {
    const link = await linked()
    let open = () => {}
    link.setGate(() => new Promise<void>((resolve) => (open = resolve)))
    step(link, 'box', 'One')
    await mem.settle()
    expect(changeSetsSent()).toHaveLength(0)
    expect(link.synced()).toBe(false)
    open()
    await mem.settle()
    expect(changeSetsSent()).toHaveLength(1)
    expect(mem.nameOf('box')).toBe('One')
  })

  it('sends a token asked for ahead of a long paced queue', async () => {
    const link = await linked()
    mem.sockets[0]?.cut()
    await mem.settle()
    for (let n = 1; n <= 400; n++) step(link, 'box', `Box ${n}`)
    await wait(RECONNECT_FIRST_MS)
    const socket = mem.sockets[1]
    socket?.deliver({ type: 'token' })
    await mem.settle()
    const sent = socket?.sent ?? []
    expect(sent.filter((m) => m.type === 'changes')).toHaveLength(200)
    expect(sent.at(-1)).toEqual({ type: 'token', token: 'ann' })
  })

  it("sends a cancelled step's cleared preview at once, so a later step's preview never comes before it", async () => {
    const link = await linked()
    const c = link.client() as Client
    // A change set held at the gate: whatever goes the paced way waits behind it.
    link.setGate(() => new Promise(() => {}))
    step(link, 'banner-box', 'Held')
    c.open()
    c.write(rename('box', 'First'))
    await wait(PREVIEW_EVERY_MS)
    link.send(c.cancel())
    c.open()
    c.write(rename('headline', 'Second'))
    await wait(PREVIEW_EVERY_MS)
    const previews = (mem.sockets[0]?.sent ?? []).filter((m) => m.type === 'preview')
    expect(previews.map((m) => m.type === 'preview' && m.changes.length)).toEqual([1, 0, 1])
    expect(changeSetsSent()).toHaveLength(0)
  })

  it('backs off a server that closes each connection just after its welcome', async () => {
    await linked()
    const opened: number[] = []
    for (let n = 0; n < 5; n++) {
      mem.sockets.at(-1)?.closeWith(SYNC_CLOSE.storeFailed)
      const before = mem.sockets.length
      let waited = 0
      while (mem.sockets.length === before) {
        await wait(100)
        waited += 100
      }
      opened.push(waited)
    }
    expect(opened).toEqual([1000, 2000, 4000, 8000, 16000])
  })

  it('waits longer for a welcome than for a pong', async () => {
    // A server that takes the hello and says nothing yet: a large design loading.
    const closes: number[] = []
    const silent = (): LinkSocket => {
      const socket: LinkSocket = {
        binaryType: 'blob',
        send: () => {},
        close: (code) => closes.push(code ?? 0),
        onopen: null,
        onmessage: null,
        onclose: null,
      }
      queueMicrotask(() => socket.onopen?.())
      return socket
    }
    await linked({ socket: silent })
    await wait(4 * PING_EVERY_MS)
    expect(closes).toEqual([])
    await wait(5 * PING_EVERY_MS)
    expect(closes).toHaveLength(1)
  })
})

describe('frames', () => {
  it('reads gzipped frames, any message, in order with the text ones', async () => {
    // A welcome borrowed from a tab on the server in memory.
    await linked({}, 'bob')
    const welcome = mem.sockets[0]?.got[0]
    let socket: LinkSocket | undefined
    const fake = (): LinkSocket => {
      socket = { binaryType: 'blob', send: () => {}, close: () => {}, onopen: null, onmessage: null, onclose: null }
      queueMicrotask(() => socket?.onopen?.())
      return socket
    }
    const link = openSyncLink({ url: 'ws://s', designId: 'd1', token: () => Promise.resolve('ann'), socket: fake })
    links.push(link)
    link.connect()
    await mem.settle()
    const zipped = (message: unknown) => {
      const bytes = gzipSync(JSON.stringify(message))
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    }
    socket?.onmessage?.({ data: zipped(welcome) })
    socket?.onmessage?.({ data: JSON.stringify({ type: 'joined', tabId: 9, name: 'Bob' }) })
    socket?.onmessage?.({ data: zipped({ type: 'joined', tabId: 10, name: 'Cy' }) })
    socket?.onmessage?.({ data: JSON.stringify({ type: 'left', tabId: 10 }) })
    await vi.waitFor(() => expect(link.client()?.tabs().get(9)).toBe('Bob'))
    await mem.settle()
    expect([...(link.client()?.tabs().keys() ?? [])]).not.toContain(10)
    expect(link.status()).toBe('connected')
  })

  it("ignores what an old socket hears once it connected again: the server's replaced close among it", async () => {
    const link = await linked()
    const old = mem.sockets[0]
    // The link drops the old socket itself (silence), and connects again before the server notices.
    old?.hold()
    await wait(3 * PING_EVERY_MS + RECONNECT_FIRST_MS)
    expect(mem.sockets).toHaveLength(2)
    old?.onclose?.({ code: SYNC_CLOSE.replaced, reason: '' })
    old?.release()
    await wait(RECONNECT_LAST_MS)
    expect(link.ended()).toBeNull()
    expect(link.status()).toBe('connected')
    expect(mem.sockets).toHaveLength(2)
  })
})
