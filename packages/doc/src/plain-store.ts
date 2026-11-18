// A design kept as plain records by the sync core, on a sync server in memory (D4): the scratch
// store a trial runs on, and the store tests open. One store is one tab, a client of the local
// server; another tab joins the same server. The server delivers every message at once, in order,
// through JSON, so a call returns with every tab caught up.
import { nanoid } from 'nanoid'

import { PROTOCOL, type ServerMessage } from '@dazbee/schema'

import { type ClientStore, clientStore } from './client-store.ts'
import type { Snapshot } from './repair.ts'
import { utf8Length } from './sync/checks.ts'
import { type Client, type ClientOptions, openClient, type Outgoing as TabOutgoing } from './sync/client.ts'
import { firstSaved } from './sync/journal.ts'
import { openServer, type Outgoing, type Who } from './sync/server.ts'

/** A tab on the local server it joined. */
export interface PlainStore extends ClientStore {
  /** The server this tab is on: another tab joins it. */
  // eslint-disable-next-line @typescript-eslint/no-use-before-define -- the types refer to each other
  readonly server: LocalServer
  /** Sends the open step's preview to the other tabs now, as a tab's connection does at its pace (D7). */
  preview(): void
}

/** A tab whose sends wait until `deliver`, so a test can order its writes against another tab's. */
export interface HeldTab extends PlainStore {
  /** Sends what the tab wrote since the last call, and everything that follows from it. */
  deliver(): void
}

/** A sync server in memory, delivering every message at once, in order, through JSON. */
export interface LocalServer {
  /** Another tab on the design: a store of its own, joined to this server; held, its sends wait for `deliver`. */
  join(): PlainStore
  join(options: { held: true }): HeldTab
}

export interface LocalServerOptions {
  /** Every tab is a scratch store: a change set the server rejects throws `ScratchRejected`. */
  scratch?: boolean
  /** Each tab's client's options, such as its recompute. */
  client?: ClientOptions
}

/** Who every tab of a local server is: an editor; the server keeps nothing it could name. */
const LOCAL: Who = { member: { userId: 'local', workspaceId: 'local' }, name: 'local', access: 'edit' }

/** A plain store holding `design`: the one tab of a local server of its own. */
export function plainStore(design: Snapshot, options: LocalServerOptions = {}): PlainStore {
  return openLocalServer(design, options).join()
}

/** A local server for the design `design`, which must keep every rule. */
export function openLocalServer(design: Snapshot, options: LocalServerOptions = {}): LocalServer {
  // A local server keeps nothing after it: it opens on `design` under a new sync id, and its
  // journal is taken and dropped.
  const server = openServer(
    { saved: firstSaved(design, nanoid()), journal: [], lastEntry: 0 },
    { hashSecret: (secret) => secret },
  )
  /** Each tab's client and store, by tab id. */
  const tabs = new Map<number, { client: Client; store: ClientStore }>()
  /** Messages to deliver, in order: each tab's as it sent them. */
  const queue: { from: number; messages: readonly TabOutgoing[] }[] = []
  let delivering = false

  /** Delivers what tab `from` sent, and everything that follows from it, before returning. */
  function send(from: number, messages: readonly TabOutgoing[]) {
    if (messages.length > 0) queue.push({ from, messages })
    drain()
  }

  /**
   * Delivers what is queued, and what follows from it; a tab that sends meanwhile is queued behind
   * it. Once every tab is caught up, each settles: the first thing thrown on the way (a rejection of
   * a scratch tab's step, a listener's error) is thrown then, from the call that began the delivery.
   */
  function drain() {
    if (delivering) return
    delivering = true
    let failed: { error: unknown } | undefined
    try {
      for (let next = queue.shift(); next; next = queue.shift()) {
        for (const message of next.messages) {
          const text = JSON.stringify(message)
          const out = server.receive(next.from, JSON.parse(text), utf8Length(text))
          server.takeJournal()
          if ('close' in out) throw new Error(`the local server closed tab ${next.from}: ${out.reason}`)
          for (const error of route(out)) failed ??= { error }
        }
      }
    } finally {
      queue.length = 0
      delivering = false
    }
    for (const { store } of tabs.values()) {
      try {
        store.settle()
      } catch (error) {
        failed ??= { error }
      }
    }
    if (failed) throw failed.error
  }

  /** Gives each tab what in `out` is for it, and queues what it sends back; gives what a tab threw. */
  function route(out: readonly Outgoing[]): unknown[] {
    const errors: unknown[] = []
    for (const { to, except, message } of out) {
      const text = JSON.stringify(message)
      for (const [tabId, { client }] of tabs) {
        if ((to !== 'all' && to !== tabId) || except === tabId) continue
        try {
          const reply = client.receive(JSON.parse(text) as ServerMessage)
          if (reply.length > 0) queue.push({ from: tabId, messages: reply })
        } catch (error) {
          errors.push(error)
        }
      }
    }
    return errors
  }

  const local: LocalServer = { join: ((options?: { held?: boolean }) => join(options)) as LocalServer['join'] }

  function join({ held = false }: { held?: boolean } = {}): PlainStore | HeldTab {
    const joined = server.join({ type: 'hello', protocol: PROTOCOL, token: 'local', waiting: 0 }, LOCAL)
    server.takeJournal()
    if ('close' in joined) throw new Error(`the local server refused a tab: ${joined.reason}`)
    const { tabId } = joined
    const welcome = joined.out.find(({ to }) => to === tabId)
    if (!welcome) throw new Error('the local server sent no welcome')
    const client = openClient(JSON.parse(JSON.stringify(welcome.message)) as ServerMessage, options.client)
    const store = clientStore(client, (messages) => send(tabId, messages), {
      scratch: options.scratch ?? false,
      held,
    })
    // The others hear of the new tab before it is one of them.
    const errors = route(joined.out.filter((out) => out !== welcome))
    drain()
    if (errors.length > 0) throw errors[0]
    tabs.set(tabId, { client, store })
    const preview = () => {
      const message = client.preview()
      if (message) send(tabId, [message])
    }
    const tab: PlainStore = Object.assign(store, { server: local, preview })
    return held ? Object.assign(tab, { deliver: store.release }) : tab
  }

  return local
}
