// What the sync server's socket tests share: the server on a free port over the test database, and a
// stand-in tab, a WebSocket that says hello and sends and reads the protocol's JSON.
import type { AddressInfo } from 'node:net'
import { gunzipSync } from 'node:zlib'

import { WebSocket } from 'ws'

import { type Client, openClient } from '@dazbee/doc'
import {
  type Change,
  DESIGN_PARAM,
  PROTOCOL,
  type Resume,
  SCHEMA_VERSION,
  type ServerMessage,
  TAB_VERSION_PARAM,
} from '@dazbee/schema'

import { LIMITS } from './limits.ts'
import { openSyncServer, type OpenSyncServerOptions } from './sync-server.ts'
import { db, secret, until } from './test-sync.ts'

/** The sync server for a test on a free port, with what it logged. */
export async function startServer(options: Partial<OpenSyncServerOptions> = {}) {
  const lines: string[] = []
  const server = openSyncServer({
    db,
    secret,
    port: 0,
    limits: { ...LIMITS, idleMs: 0 },
    log: (line) => lines.push(line),
    ...options,
  })
  await server.listen()
  return { server, lines, url: `ws://127.0.0.1:${(server.httpServer.address() as AddressInfo).port}` }
}

/** A stand-in tab: what it heard, how it closed, and ways to talk. */
export interface TestTab {
  socket: WebSocket
  heard: ServerMessage[]
  /** The close code and reason, once closed. */
  closed?: { code: number; reason: string }
  /** Told each message as it comes, after it is in `heard`. */
  onMessage?: (message: ServerMessage) => void
  send(message: unknown): void
  /** Says hello with `token`, as a new tab or resuming. */
  hello(token: string, resume?: Resume, waiting?: number): void
  /** Resolves to the first message of `type` heard, or the first after `from` messages heard. */
  next<T extends ServerMessage['type']>(type: T, from?: number): Promise<Extract<ServerMessage, { type: T }>>
  /** Resolves once the socket has closed, to its code. */
  whenClosed(): Promise<number>
  close(): void
}

export interface TabOptions {
  /** The schema version the tab says it was built with; `null` sends none. */
  version?: number | string | null
  /** The design the URL names; `null` names none. */
  design?: string | null
  /** The socket answers the server's pings itself (`ws`' default). */
  autoPong?: boolean
}

/** Opens a stand-in tab on `designId` and resolves once its socket is open. */
export function openTab(url: string, designId: string, options: TabOptions = {}): Promise<TestTab> {
  const params = new URLSearchParams()
  const design = options.design === undefined ? designId : options.design
  const version = options.version === undefined ? SCHEMA_VERSION : options.version
  if (design !== null) params.set(DESIGN_PARAM, design)
  if (version !== null) params.set(TAB_VERSION_PARAM, String(version))
  const socket = new WebSocket(`${url}/?${params}`, { autoPong: options.autoPong ?? true })
  const tab: TestTab = {
    socket,
    heard: [],
    send: (message) => socket.send(typeof message === 'string' ? message : JSON.stringify(message)),
    hello: (token, resume, waiting = 0) =>
      tab.send({ type: 'hello', protocol: PROTOCOL, token, waiting, ...(resume ? { resume } : {}) }),
    async next(type, from = 0) {
      const found = () => tab.heard.slice(from).find((m) => m.type === type)
      if (!(await until(() => found() !== undefined || tab.closed !== undefined))) throw new Error(`no ${type} came`)
      const message = found()
      if (!message) throw new Error(`closed with ${tab.closed?.code} (${tab.closed?.reason}) before a ${type}`)
      return message as never
    },
    async whenClosed() {
      if (!(await until(() => tab.closed !== undefined))) throw new Error('the socket stayed open')
      return tab.closed?.code as number
    },
    close: () => socket.close(),
  }
  // Past 1 MiB a message comes gzipped, as binary.
  socket.on('message', (data, binary) => {
    const message = JSON.parse(binary ? gunzipSync(data as Buffer).toString() : String(data)) as ServerMessage
    tab.heard.push(message)
    tab.onMessage?.(message)
  })
  socket.on('close', (code, reason) => (tab.closed = { code, reason: reason.toString() }))
  return new Promise((resolve, reject) => {
    socket.once('open', () => resolve(tab))
    socket.once('error', reject)
  })
}

/** The welcome a tab heard. */
export function welcomeOf(tab: TestTab) {
  const welcome = tab.heard.find((m) => m.type === 'welcome')
  if (!welcome || welcome.type !== 'welcome') throw new Error('no welcome')
  return welcome
}

/** The types of what a tab heard. */
export const typesOf = (tab: TestTab) => tab.heard.map((m) => m.type)

/** A tab on the sync client, as the editor will run one: every message to the client, every answer sent. */
export async function clientTab(url: string, design: string, token: string) {
  let client: Client | undefined
  let tab: TestTab
  const wire = (t: TestTab) => {
    t.onMessage = (message) => {
      if (!client) {
        if (message.type === 'welcome') client = openClient(message)
        return
      }
      for (const out of client.receive(message)) t.send(out)
    }
  }
  tab = await openTab(url, design)
  wire(tab)
  tab.hello(token)
  await tab.next('welcome')
  const driven = {
    client: () => client as Client,
    send: (outs: readonly unknown[]) => outs.forEach((out) => tab.send(out)),
    /** One step: the changes written and sent as one change set. */
    edit(...changes: Change[]) {
      const c = driven.client()
      c.open()
      for (const change of changes) c.write(change)
      driven.send(c.end('Rename'))
    },
    async reconnect(to: string) {
      driven.client().disconnect()
      tab.close()
      tab = await openTab(to, design)
      wire(tab)
      tab.send(driven.client().reconnect(token))
      await tab.next('welcome')
    },
    close: () => tab.close(),
  }
  return driven
}

export type Driven = Awaited<ReturnType<typeof clientTab>>

/** Waits until every tab has nothing in its queue and all are at one sequence number. */
export async function quiet(...tabs: Driven[]) {
  const ok = await until(() => {
    const seqs = new Set(tabs.map((t) => t.client().seq()))
    return seqs.size === 1 && tabs.every((t) => t.client().queued() === 0)
  })
  if (!ok) throw new Error(`tabs did not settle: ${tabs.map((t) => `${t.client().seq()}/${t.client().queued()}`)}`)
}
