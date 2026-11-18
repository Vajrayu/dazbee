// One tab's connection to the sync server (D4, D10): the socket from its first hello to its end,
// around the tab's sync client. It makes the client from the first welcome, or opens it offline at
// once from the tab copy a reload found; hands it every message, in order, and sends what it
// answers at a pace (60 a second in bursts of 200), once the tab copy holds it, and the open step's
// preview and the tab's presence each at most 30 times a second, the latest presence never lost and
// sent again on each welcome, to a server whose welcome says it takes presence. A dropped connection comes back after a backoff from 1 s doubling to 30 s, with full
// jitter, and resumes as the same tab. A tab older than the design, a deleted design, a tab taken
// over by another connection or a member the API turns away is not connected again. A version of
// the design is asked for on the connection and answered on it alone.
import {
  type Client,
  type ClientOptions,
  openClient,
  Paced,
  type SavedClient,
  SyncBroken,
  type TabOutgoing,
} from '@dazbee/doc'
import {
  DESIGN_PARAM,
  type DesignRecords,
  Presence,
  PROTOCOL,
  type ServerMessage,
  SYNC_CLOSE,
  SYNC_LIMITS,
} from '@dazbee/schema'

import { type Link, type LinkEnd, type LinkStatus, STOPPED_BY_END, syncUrl } from './save-state.ts'
import { TokenRefused } from './token-source.ts'

/** The part of the browser's WebSocket the link uses: a test gives one on a server in memory. */
export interface LinkSocket {
  binaryType: BinaryType
  send(data: string): void
  close(code?: number, reason?: string): void
  onopen: (() => void) | null
  onmessage: ((event: { data: unknown }) => void) | null
  onclose: ((event: { code: number; reason: string }) => void) | null
}

export interface SyncLinkOptions {
  /** The sync server's URL, without the tab's version and design, which the link adds. */
  url: string
  designId: string
  /** A fresh token for each connection and each renewal: `token-source.ts`'s. */
  token: () => Promise<string>
  /** The tab copy a reload found: the client opens from it at once, offline. */
  start?: SavedClient
  /** The client's own options: its recompute, its limits. */
  client?: Omit<ClientOptions, 'onTokenRequest'>
  /** Opens a socket: the browser's WebSocket unless given. */
  socket?: (url: string) => LinkSocket
  now?: () => number
  random?: () => number
}

export interface SyncLink extends Link {
  /** The tab's client: from the start, or from the first welcome on a first visit. */
  client(): Client | undefined
  /** Told once the client is made; at once when it already is. */
  onClient(listener: (client: Client) => void): () => void
  /** Told each message from the server once the client took it in: what the tab copy logs. */
  onHeard(listener: (message: ServerMessage) => void): () => void
  /**
   * Sends what a step of the client gives, at the pace; nothing goes while offline (the client keeps
   * it). Tells the status listeners either way: the step that ended changed `synced()`.
   */
  send(messages: readonly TabOutgoing[]): void
  /**
   * The tab's presence from now on: sent at most every `PRESENCE_EVERY_MS`, the latest waiting for
   * its turn, and sent again on each welcome; none to a server that takes none.
   */
  presence(presence: Presence): void
  /** Why the link no longer connects, if it doesn't. */
  ended(): LinkEnd | null
  /**
   * What each send waits for before it goes, in order: the tab copy writing the step first, so a
   * reload never finds a step the server took still open in it.
   */
  setGate(gate: () => Promise<void>): void
  /**
   * Asks the server for version `id` of the design: its records and the schema version they were
   * stored under, or null for no such version. Rejects with `VersionUnanswered` while not connected,
   * or when the connection ends before the answer.
   */
  askVersion(id: string): Promise<StoredVersion | null>
  destroy(): void
}

/** A version of the design as the server stores it: its records, unread, and the schema version they were stored under. */
export interface StoredVersion {
  design: DesignRecords
  schemaVersion: number
}

/** A version asked for got no answer: the tab was not connected, or the connection ended first. */
export class VersionUnanswered extends Error {}

/** The first wait before connecting again, and the longest, each a ceiling the wait is drawn under (full jitter). */
export const RECONNECT_FIRST_MS = 1000
export const RECONNECT_LAST_MS = 30_000
/** How often the tab pings; a socket that hears nothing for two pings is dropped (a half-open socket the browser never notices). */
export const PING_EVERY_MS = 15_000
/** The least time between two previews: the server passes on at most `previewsPerSecond`. */
export const PREVIEW_EVERY_MS = Math.ceil(1000 / SYNC_LIMITS.previewsPerSecond)
/** The least time between two presences: 30 a second, as previews. */
export const PRESENCE_EVERY_MS = PREVIEW_EVERY_MS

/** The close codes after which the link does not connect again, and what it says. */
const ENDED_BY: Record<number, LinkEnd> = {
  [SYNC_CLOSE.designDeleted]: 'designDeleted',
  [SYNC_CLOSE.replaced]: 'replaced',
}
/** What the link closes a socket with when it drops it itself: a message it can't place, or silence. */
const DROPPED = 4000
/** How many pings a socket may stay silent for before its welcome. */
const SILENT_PINGS = 8

export function openSyncLink(options: SyncLinkOptions): SyncLink {
  const {
    designId,
    token,
    now = Date.now,
    random = Math.random,
    socket: openSocket = (url) => new WebSocket(url) as unknown as LinkSocket,
  } = options
  const url = `${syncUrl(options.url)}&${DESIGN_PARAM}=${encodeURIComponent(designId)}`
  const clientOptions: ClientOptions = { ...options.client, onTokenRequest: renew }
  let client: Client | undefined
  /** The socket open or opening, and whether the server welcomed the tab on it. */
  let socket: LinkSocket | undefined
  let welcomed = false
  /** Counts the connections tried: an event of an earlier one is ignored. */
  let generation = 0
  /** Whether the tab wants to be connected: false after `disconnect` until `connect`. */
  let wanted = false
  let outdated = false
  let end: LinkEnd | null = null
  let destroyed = false
  /** Connections tried since the last welcome: the backoff's exponent. */
  let attempt = 0
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  const pacer = new Paced<TabOutgoing>(now())
  let paceTimer: ReturnType<typeof setTimeout> | undefined
  let previewTimer: ReturnType<typeof setTimeout> | undefined
  let previewAt = -Infinity
  /** The tab's latest presence, the one the server last got on this connection, and the wait for its turn. */
  let presence: Presence | undefined
  let presenceSent: string | undefined
  let presenceTimer: ReturnType<typeof setTimeout> | undefined
  let presenceAt = -Infinity
  let pingTimer: ReturnType<typeof setInterval> | undefined
  let stableTimer: ReturnType<typeof setTimeout> | undefined
  /** When the socket last heard from the server, when it last pinged, and the pings in a row that heard nothing back. */
  let heardAt = 0
  let pingedAt = 0
  let unanswered = 0
  /** Messages are taken in one at a time, in order: a gzipped one is never overtaken. */
  let inbox: Promise<void> = Promise.resolve()
  /** What sends wait for before they go, in order: the tab copy holding them (`setGate`). */
  let gate: (() => Promise<void>) | undefined
  let outbox: Promise<void> = Promise.resolve()
  let followUpTimer: ReturnType<typeof setTimeout> | undefined
  const statusListeners = new Set<() => void>()
  const clientListeners = new Set<(client: Client) => void>()
  const heardListeners = new Set<(message: ServerMessage) => void>()
  /** The asks for each version waiting for the server's answer, by the version's id. */
  const versionAsks = new Map<
    string,
    { answer: (version: StoredVersion | null) => void; fail: (error: Error) => void }[]
  >()
  const unlisten: (() => void)[] = []

  if (options.start) made(openClient(options.start, clientOptions))

  function made(next: Client) {
    client = next
    unlisten.push(
      next.onChange(() => {
        schedulePreview()
        tell()
      }),
      next.onAccess(tell),
    )
    for (const listener of clientListeners) listener(next)
  }

  function tell() {
    for (const listener of statusListeners) listener()
  }

  function connect() {
    if (destroyed || outdated || end) return
    wanted = true
    if (socket || retryTimer !== undefined) return
    open()
  }

  /** Fetches a token, then opens a socket and says hello with it. */
  function open() {
    retryTimer = undefined
    const gen = ++generation
    token().then(
      (fresh) => {
        if (gen !== generation || !wanted) return
        const s = openSocket(url)
        socket = s
        s.binaryType = 'arraybuffer'
        s.onopen = () => {
          if (gen !== generation) return
          heardAt = now()
          pingedAt = 0
          unanswered = 0
          const hello = client
            ? client.reconnect(fresh)
            : { type: 'hello', protocol: PROTOCOL, token: fresh, waiting: 0 }
          s.send(JSON.stringify(hello))
          pingTimer = setInterval(ping, PING_EVERY_MS)
        }
        s.onmessage = ({ data }) => {
          if (gen === generation) take(gen, data)
        }
        s.onclose = ({ code }) => {
          if (gen === generation) closed(code)
        }
      },
      (error: unknown) => {
        if (gen !== generation || !wanted) return
        // The API said the member may not have the design: asking again gets the same answer.
        if (error instanceof TokenRefused) {
          end = 'refused'
          tell()
        } else retry()
      },
    )
  }

  function take(gen: number, data: unknown) {
    inbox = inbox
      .then(async () => {
        const text = typeof data === 'string' ? data : await gunzip(data as ArrayBuffer)
        if (gen === generation) receive(JSON.parse(text) as ServerMessage)
      })
      .catch(() => {
        if (gen === generation) drop()
      })
  }

  function receive(message: ServerMessage) {
    heardAt = now()
    let out: TabOutgoing[] = []
    if (!client) {
      // A first visit's client is made from the welcome; nothing else comes before it.
      if (message.type !== 'welcome') return
      made(openClient(message, clientOptions))
    } else {
      try {
        out = client.receive(message)
      } catch (error) {
        if (error instanceof SyncBroken) return drop()
        throw error
      }
    }
    if (message.type === 'welcome') {
      welcomed = true
      // The backoff starts again from 1 s only once the connection has held a while: a server that
      // closes each one just after its welcome is not tried twice a second for good.
      stableTimer = setTimeout(() => (attempt = 0), RECONNECT_LAST_MS)
      // The server knows nothing of the tab's presence on a new connection.
      presenceSent = undefined
      schedulePresence()
    }
    if (message.type === 'version') answerVersion(message)
    for (const listener of heardListeners) listener(message)
    // Another member's presence asks nothing back and changes no status.
    if (message.type === 'presence') return
    send(out)
  }

  /** Closes the socket for a reason of the link's own, and connects again. */
  function drop() {
    const s = socket
    closed(DROPPED)
    s?.close(DROPPED)
  }

  /** The socket closed with `code`: the client goes offline, and the link connects again unless the code says not to. */
  function closed(code: number) {
    generation++
    socket = undefined
    welcomed = false
    clearInterval(pingTimer)
    clearTimeout(stableTimer)
    clearTimeout(paceTimer)
    clearTimeout(previewTimer)
    clearTimeout(presenceTimer)
    paceTimer = previewTimer = presenceTimer = pingTimer = undefined
    pacer.clear()
    client?.disconnect()
    failVersionAsks()
    if (code === SYNC_CLOSE.tabTooOld) outdated = true
    else if (ENDED_BY[code]) end = ENDED_BY[code]
    else if (wanted) retry()
    tell()
  }

  function retry() {
    const ceiling = Math.min(RECONNECT_LAST_MS, RECONNECT_FIRST_MS * 2 ** attempt)
    attempt++
    retryTimer = setTimeout(open, random() * ceiling)
  }

  /**
   * Pings, and drops a socket that heard nothing back from two pings in a row; until the welcome,
   * which a large design takes a while to give and before which the server answers no ping, from
   * `SILENT_PINGS`. It counts pings, not time, so a hidden tab whose timers the browser slows is
   * not dropped for its own slowness.
   */
  function ping() {
    unanswered = heardAt < pingedAt ? unanswered + 1 : 0
    if (unanswered >= (welcomed ? 2 : SILENT_PINGS)) return drop()
    pingedAt = now()
    socket?.send(JSON.stringify({ type: 'ping' }))
  }

  /**
   * The server asked for a fresh token: it goes at once, ahead of the paced queue, on the connection
   * it was asked on (a long queue at the pace would outlast the token).
   */
  function renew() {
    const gen = generation
    token().then(
      (fresh) => {
        if (gen === generation && welcomed) socket?.send(JSON.stringify({ type: 'token', token: fresh }))
      },
      () => {},
    )
  }

  /**
   * Previews go at once, so a later one never overtakes the one that clears; the rest at the pace,
   * once the gate (the tab copy holding them) lets them.
   */
  function send(messages: readonly TabOutgoing[]) {
    const gen = generation
    const paced = messages.filter((message) => {
      if (message.type !== 'preview') return true
      if (socket && welcomed) socket.send(JSON.stringify(message))
      return false
    })
    if (paced.length > 0 && socket && welcomed) {
      const push = () => {
        if (gen !== generation) return
        for (const message of paced) pacer.push(message)
        pump()
      }
      if (gate) outbox = outbox.then(gate).then(push, push)
      else push()
    }
    followUpsDue()
    tell()
  }

  /** Works out the owed follow-ups again once their wait runs out (D6, 6), and sends them. */
  function followUpsDue() {
    const deadline = client?.followUpDeadline()
    if (deadline === undefined || followUpTimer !== undefined) return
    followUpTimer = setTimeout(
      () => {
        followUpTimer = undefined
        if (client) send(client.retryFollowUps())
      },
      Math.max(0, deadline - now()),
    )
  }

  /** Sends what is due, and waits for the next to come due. */
  function pump() {
    const s = socket
    if (!s) return
    for (let message = pacer.takeDue(now()); message; message = pacer.takeDue(now())) s.send(JSON.stringify(message))
    const due = pacer.due()
    if (due === undefined || paceTimer !== undefined) return
    paceTimer = setTimeout(
      () => {
        paceTimer = undefined
        pump()
      },
      Math.max(0, due - now()),
    )
  }

  /** The open step's latest preview, at most every `PREVIEW_EVERY_MS`. */
  function schedulePreview() {
    if (!welcomed || !client?.stepOpen() || previewTimer !== undefined) return
    previewTimer = setTimeout(
      () => {
        previewTimer = undefined
        const preview = client?.preview()
        if (!preview || !socket || !welcomed) return
        previewAt = now()
        socket.send(JSON.stringify(preview))
      },
      Math.max(0, previewAt + PREVIEW_EVERY_MS - now()),
    )
  }

  function setPresence(next: Presence) {
    presence = next
    schedulePresence()
  }

  /**
   * The latest presence, unless the server has it already, at most every `PRESENCE_EVERY_MS`: at
   * once when its turn has come (a hidden page's timers are slowed), else when it comes.
   */
  function schedulePresence() {
    if (!welcomed || presenceTimer !== undefined) return
    const wait = presenceAt + PRESENCE_EVERY_MS - now()
    if (wait <= 0) return sendPresence()
    presenceTimer = setTimeout(() => {
      presenceTimer = undefined
      sendPresence()
    }, wait)
  }

  function sendPresence() {
    // One the server would not take would close the connection, and go again on the next.
    const message = presence && Presence.safeParse(presence).success ? client?.presenceMessage(presence) : undefined
    const text = message && JSON.stringify(message)
    if (!text || text === presenceSent || !socket || !welcomed) return
    presenceAt = now()
    presenceSent = text
    socket.send(text)
  }

  function askVersion(id: string): Promise<StoredVersion | null> {
    const s = socket
    if (!s || !welcomed) return Promise.reject(new VersionUnanswered('not connected'))
    return new Promise((answer, fail) => {
      const waiting = versionAsks.get(id) ?? []
      // One ask on the wire for each version: the answer settles every ask waiting for it.
      if (waiting.length === 0) s.send(JSON.stringify({ type: 'version', id }))
      versionAsks.set(id, [...waiting, { answer, fail }])
    })
  }

  function answerVersion(message: Extract<ServerMessage, { type: 'version' }>) {
    const waiting = versionAsks.get(message.id) ?? []
    versionAsks.delete(message.id)
    const { design, schemaVersion } = message
    for (const ask of waiting) ask.answer(design && schemaVersion !== null ? { design, schemaVersion } : null)
  }

  function failVersionAsks() {
    const waiting = [...versionAsks.values()].flat()
    versionAsks.clear()
    for (const ask of waiting) ask.fail(new VersionUnanswered('the connection ended before the answer'))
  }

  function disconnect() {
    wanted = false
    clearTimeout(retryTimer)
    retryTimer = undefined
    const s = socket
    if (s) closed(1000)
    else {
      generation++
      tell()
    }
    s?.close(1000)
  }

  function status(): LinkStatus {
    if (outdated) return 'Outdated'
    if (end) return STOPPED_BY_END[end]
    return welcomed ? 'connected' : 'disconnected'
  }

  return {
    status,
    viewOnly: () => client?.access() === 'view',
    synced: () => welcomed && client !== undefined && client.queued() === 0 && !client.owes() && !client.stepOpen(),
    onStatus(listener) {
      statusListeners.add(listener)
      return () => statusListeners.delete(listener)
    },
    connect,
    disconnect,
    client: () => client,
    onClient(listener) {
      if (client) listener(client)
      clientListeners.add(listener)
      return () => clientListeners.delete(listener)
    },
    onHeard(listener) {
      heardListeners.add(listener)
      return () => heardListeners.delete(listener)
    },
    send,
    presence: setPresence,
    ended: () => end,
    setGate(next) {
      gate = next
    },
    askVersion,
    destroy() {
      disconnect()
      destroyed = true
      clearTimeout(followUpTimer)
      clearTimeout(stableTimer)
      clearTimeout(presenceTimer)
      for (const off of unlisten.splice(0)) off()
      statusListeners.clear()
      clientListeners.clear()
      heardListeners.clear()
    },
  }
}

/** A gzipped frame's text: a welcome over 1 MiB comes so. */
async function gunzip(data: ArrayBuffer): Promise<string> {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Response(stream).text()
}
