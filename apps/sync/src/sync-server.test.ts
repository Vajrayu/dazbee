// The new sync server end to end over real sockets and Postgres (D3, D7, D10): its HTTP shell, the
// tabs that join and leave with their members' names, previews, and two tabs on the sync client
// editing, undoing and redoing across each other through a restart, ending on one design.
import { request } from 'node:http'
import { connect } from 'node:net'

import { afterAll, describe, expect, it } from 'vitest'

import { loadDesignRows } from '@dazbee/db'
import { type DesignRecords, SYNC_CLOSE } from '@dazbee/schema'

import { BOB, changes, rename, storeSaved } from './test-saves.ts'
import { closeDatabase, db, pause, tokenFor, until } from './test-sync.ts'
import { clientTab, openTab, quiet, startServer, typesOf, welcomeOf } from './test-tab.ts'

const servers: { destroy(): Promise<void> }[] = []
afterAll(async () => {
  await Promise.all(servers.map((s) => s.destroy()))
  await closeDatabase()
})

async function started(options: Parameters<typeof startServer>[0] = {}) {
  const run = await startServer(options)
  servers.push(run.server)
  return run
}

async function joined(url: string, designId: string, token = tokenFor(designId)) {
  const tab = await openTab(url, designId)
  tab.hello(token)
  await tab.next('welcome')
  return tab
}

/** What a plain HTTP GET to the server answers. */
function get(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    request(url.replace('ws:', 'http:'), (response) => {
      let body = ''
      response.on('data', (chunk: Buffer) => (body += chunk.toString()))
      response.on('end', () => resolve({ status: response.statusCode ?? 0, body }))
    })
      .on('error', reject)
      .end()
  })
}

const preview = (after: number, changes: unknown[] = []) => ({ type: 'preview', after, changes })

describe('the shell', () => {
  it('answers a plain request that it is up, and stays up through a malformed upgrade', async () => {
    const { url } = await started()
    expect(await get(url)).toEqual({ status: 200, body: 'up' })
    const port = new URL(url).port
    await new Promise<void>((resolve) => {
      const socket = connect(Number(port), '127.0.0.1', () => {
        socket.end('GET http://[ HTTP/1.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n')
      })
      socket.on('close', () => resolve())
      socket.on('error', () => resolve())
    })
    expect(await get(url)).toEqual({ status: 200, body: 'up' })
  })

  it('breaks nothing when its log throws: a tab it closes is closed and leaves, and the others go on', async () => {
    const { url } = await started({
      log: () => {
        throw new Error('the log is gone')
      },
    })
    const design = await storeSaved()
    const ann = await joined(url, design)
    const bob = await joined(url, design, tokenFor(design, { userId: BOB.userId }))
    const bobId = welcomeOf(bob).tabId
    bob.socket.send(Buffer.from(JSON.stringify({ type: 'ping' })), { binary: true })
    expect(await bob.whenClosed()).toBe(SYNC_CLOSE.protocol)
    expect(await ann.next('left')).toEqual({ type: 'left', tabId: bobId })
    ann.send(changes(1, 0, [rename('l0', 'Stored anyway')]))
    expect(await ann.next('accepted')).toMatchObject({ changeSetId: 1 })
    ann.close()
  })
})

describe('tabs joining and leaving', () => {
  it("tells the other tabs who joined and left, by the member's name", async () => {
    const { url } = await started()
    const design = await storeSaved()
    const ann = await joined(url, design, tokenFor(design, { name: 'Ann Archer' }))
    const bob = await joined(url, design, tokenFor(design, { userId: BOB.userId, name: 'Bob Baker' }))
    const annId = welcomeOf(ann).tabId
    const bobId = welcomeOf(bob).tabId
    expect(welcomeOf(bob).tabs).toEqual({ [annId]: 'Ann Archer' })
    expect(await ann.next('joined')).toEqual({ type: 'joined', tabId: bobId, name: 'Bob Baker' })
    bob.close()
    expect(await ann.next('left')).toEqual({ type: 'left', tabId: bobId })
    ann.close()
  })
})

describe('previews (D7)', () => {
  it("passes a preview to the other tabs, never back to its sender, and drops a Reviewer's and one too large", async () => {
    const { url } = await started({ host: { limits: { previewBytes: 300 } } })
    const design = await storeSaved()
    const ann = await joined(url, design)
    const bob = await joined(url, design, tokenFor(design, { userId: BOB.userId }))
    const viewer = await joined(url, design, tokenFor(design, { userId: 'user-3', role: 'reviewer' }))
    const moved: unknown[] = [['s', 'layer', 'l0', 'props', 'x', 50]]
    viewer.send(preview(0, moved))
    ann.send(preview(0, [['s', 'layer', 'l0', 'name', null, 'n'.repeat(400)]]))
    ann.send(preview(0, moved))
    const seen = await bob.next('preview')
    expect(seen).toEqual({ type: 'preview', tabId: welcomeOf(ann).tabId, after: 0, changes: moved })
    await pause(100)
    expect(bob.heard.filter((m) => m.type === 'preview')).toHaveLength(1)
    expect(typesOf(ann)).not.toContain('preview')
    for (const tab of [ann, bob, viewer]) tab.close()
  })
})

describe('presence', () => {
  it("passes a tab's presence to the other members' tabs, a Reviewer's too, and gives a tab joining the latest", async () => {
    const { url } = await started()
    const design = await storeSaved()
    const ann = await joined(url, design, tokenFor(design, { name: 'Ann Archer' }))
    const annAgain = await joined(url, design, tokenFor(design, { name: 'Ann Archer' }))
    const bob = await joined(url, design, tokenFor(design, { userId: BOB.userId }))
    expect(welcomeOf(ann).presence).toBe(true)
    const here = { page: 'p1', pointer: [12.5, 40], selection: ['l0'], frame: null }
    ann.send({ type: 'presence', ...here })
    expect(await bob.next('presence')).toEqual({
      type: 'presence',
      tabId: welcomeOf(ann).tabId,
      person: 1,
      colour: 0,
      presence: here,
    })
    const viewer = await joined(url, design, tokenFor(design, { userId: 'user-3', role: 'reviewer' }))
    expect(await viewer.next('presence')).toMatchObject({ tabId: welcomeOf(ann).tabId, presence: here })
    viewer.send({ type: 'presence', ...here, pointer: null })
    expect(await ann.next('presence')).toMatchObject({ tabId: welcomeOf(viewer).tabId, colour: 2 })
    await pause(100)
    // Ann's own other tab never hears her presence.
    expect(annAgain.heard.filter((m) => m.type === 'presence').map((m) => m.type === 'presence' && m.tabId)).toEqual([
      welcomeOf(viewer).tabId,
    ])
    for (const tab of [ann, annAgain, bob, viewer]) tab.close()
  })
})

describe('previews to a tab that is behind', () => {
  it("sends a tab that reads slowly only each sender's latest preview", async () => {
    const { url } = await started({ host: { limits: { previewsPerSecond: 1_000 } } })
    const design = await storeSaved()
    const slow = await joined(url, design)
    const ann = await joined(url, design, tokenFor(design, { userId: BOB.userId }))
    const paused = (slow.socket as unknown as { _socket: { pause(): void; resume(): void } })._socket
    paused.pause()
    // Fill the network's buffers first, so the server holds what comes next.
    for (let n = 1; n <= 200; n += 10) {
      for (let k = n; k < n + 10; k++)
        ann.send({ type: 'changes', id: k, base: 0, kind: 'edit', changes: [rename('l0', 'n'.repeat(30_000))] })
      await until(() => typesOf(ann).filter((t) => t === 'accepted').length >= n + 9)
    }
    for (let after = 1; after <= 20; after++)
      ann.send(preview(200 + after, [['s', 'layer', 'l1', 'props', 'x', after]]))
    await pause(100)
    paused.resume()
    await until(() => slow.heard.filter((m) => m.type === 'accepted').length === 200)
    await pause(200)
    const previews = slow.heard.flatMap((m) => (m.type === 'preview' ? [m.after] : []))
    expect(previews).toEqual([220])
    for (const tab of [slow, ann]) tab.close()
  }, 30_000)

  it('passes on at most so many previews a second from a tab', async () => {
    const { url } = await started({ host: { limits: { previewsPerSecond: 3 } } })
    const design = await storeSaved()
    const ann = await joined(url, design)
    const bob = await joined(url, design, tokenFor(design, { userId: BOB.userId }))
    for (let after = 1; after <= 5; after++) ann.send(preview(0, [['s', 'layer', 'l1', 'props', 'x', after]]))
    await bob.next('preview')
    await pause(200)
    expect(bob.heard.filter((m) => m.type === 'preview')).toHaveLength(3)
    for (const tab of [ann, bob]) tab.close()
  })
})

const names = (design: DesignRecords) =>
  Object.fromEntries(Object.entries(design.nodes).map(([id, node]) => [id, (node as { name: string }).name]))

describe('two tabs end to end', () => {
  it('edit, undo and redo across each other, through a restart, and end on the design stored', async () => {
    const first = await started()
    const design = await storeSaved()
    const ann = await clientTab(first.url, design, tokenFor(design, { name: 'Ann' }))
    const bob = await clientTab(first.url, design, tokenFor(design, { userId: BOB.userId, name: 'Bob' }))
    // Crossing edits: each sent before the other's comes back.
    ann.edit(rename('l0', 'Ann 1'))
    bob.edit(rename('l1', 'Bob 1'))
    await quiet(ann, bob)
    ann.send(ann.client().undo())
    bob.edit(rename('l0', 'Bob 2'))
    await quiet(ann, bob)
    bob.send(bob.client().undo())
    ann.send(ann.client().redo())
    await quiet(ann, bob)
    // The server restarts: a new one on the same database, and both tabs come back.
    await first.server.destroy()
    const second = await started()
    await ann.reconnect(second.url)
    await bob.reconnect(second.url)
    ann.edit(rename('l1', 'Ann 3'))
    bob.edit(rename('l0', 'Bob 3'))
    await quiet(ann, bob)
    bob.send(bob.client().undo())
    await quiet(ann, bob)
    const shown = ann.client().working().toRecords()
    expect(bob.client().working().toRecords()).toEqual(shown)
    // Which of the crossing steps landed first is the network's to say: the last edit to l1 is not.
    expect(names(shown).l1).toBe('Ann 3')
    expect(second.server.designs.host(design)?.server()?.state().toRecords()).toEqual(shown)
    // Stopping folds the design: what is stored is what both tabs show.
    await second.server.destroy()
    const rows = await loadDesignRows(db, design)
    if (!rows) throw new Error('no rows')
    expect(rows.journal).toEqual([])
    expect(rows.saved.state).toEqual(shown)
    ann.close()
    bob.close()
  }, 30_000)
})
