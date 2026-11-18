// The designs the sync server holds (#677, D8, D11). Each loaded design is the doc's design
// host on its Postgres journal; this keeps them under the byte budget and brings them in and out:
//
// - A design not loaded is admitted by what its stored rows hold, one admission at a time. Past the
//   budget, idle designs unload first; a design that still does not fit is refused with
//   `serverBusy`. Everything for a design that is being admitted or unloaded waits, in order.
// - A design whose last tab leaves stays loaded `idleMs` (idle.ts), then unloads with a fold.
// - A host that drops its design (a failed write: `storeFailed`; rows gone: `designDeleted`) is
//   forgotten; the next connect admits the design again.
// - Whole-design jobs of every design (an open, a welcome, a fold) take turns of one event loop.
// - Every `autosaveCheckMs`, each open design that has changed for `VERSION_LIMITS.autosaveMs` takes
//   an Autosave; the check keeps no process alive and stops as the server stops.
import { createHash } from 'node:crypto'

import { type Db, storedBytes } from '@dazbee/db'
import {
  type Connection,
  type DesignHost,
  type HostOptions,
  type Journal,
  openHost,
  type VersionAnswer,
  type Who,
} from '@dazbee/doc/sync'
import { type Access, type ServerMessage, SYNC_CLOSE, VERSION_LIMITS } from '@dazbee/schema'

import { idleDesigns } from './idle.ts'
import { LIMITS, type Limits } from './limits.ts'
import { type Data, encode, inOrder, type WelcomeCache } from './outgoing.ts'
import { pgJournal } from './pg-journal.ts'
import { turns } from './turns.ts'

/** A tab's socket, as its connection (connection.ts) gives it. */
export interface Socket {
  /** Sends `message`, written as `data`: the message says what it is (a preview is held per sender). */
  send(data: Data, message: ServerMessage | VersionAnswer): void
  close(code: number, reason: string): void
}

export interface DesignsOptions {
  db: Db
  /** The check for an Autosave runs every `autosaveCheckMs`, `LIMITS`' unless given. */
  limits: Pick<Limits, 'idleMs' | 'idleDesigns' | 'loadedBytes'> & Partial<Pick<Limits, 'autosaveCheckMs'>>
  log?: (line: string) => void
  /** What each design's host opens with beyond these: a test's smaller limits, ids or clock. */
  host?: Partial<HostOptions>
  /** A design's journal: on Postgres unless a test wraps it. */
  journal?: (designId: string, turn: () => Promise<void>) => Journal
}

export interface Designs {
  connect(designId: string, socket: Socket, hello: unknown, who: Who): void
  message(designId: string, socket: Socket, message: unknown, wireBytes: number): void
  close(designId: string, socket: Socket): void
  /** The socket's access from now on, as its renewed token gives it: in order with its messages. */
  access(designId: string, socket: Socket, access: Access): void
  /** The host of a loaded design (for tests and tools). */
  host(designId: string): DesignHost | undefined
  /** The bytes of design loaded, a design being opened counted by its stored rows. */
  loadedBytes(): number
  /** Resolves once every admission, unload and host has nothing waiting. */
  settled(): Promise<void>
  /** Closes every socket and unloads every design with a fold, as the server stops. */
  closeAll(): Promise<void>
}

/** What comes for a design whose host is not open, kept in order until it is. */
type Waiting =
  | { type: 'connect'; socket: Socket; hello: unknown; who: Who }
  | { type: 'message'; socket: Socket; message: unknown; wireBytes: number }
  | { type: 'close'; socket: Socket }
  | { type: 'access'; socket: Socket; access: Access }

/** A design the server holds: being admitted, open, or unloading. */
interface Slot {
  state: 'admitting' | 'open' | 'unloading'
  waiting: Waiting[]
  host?: DesignHost
  /** What its stored rows held when admitted: its size until its host opens. */
  reserved: number
  /** Each socket joined through it, and the connection its host knows it by. */
  sockets: Map<Socket, Connection>
  cache: WelcomeCache
  /** Each message's data, made once however many of its sockets it goes to. */
  encoded: WeakMap<ServerMessage | VersionAnswer, Data | Promise<Data>>
  /** Data still being made for its sockets (a welcome's design JSON, a gzip). */
  sending: Set<Promise<void>>
  /** Resolves once the slot is admitted, refused or unloaded. */
  done: Promise<void>
}

/** A message and its data, as they go to a socket. */
interface Out {
  data: Data
  message: ServerMessage | VersionAnswer
}

/** The WebSocket's own close code for a server going away: its tabs reconnect. */
export const GOING_AWAY = 1001

/** The designs the server holds, stored in `db`. */
export function openDesigns(options: DesignsOptions): Designs {
  const { db, limits } = options
  const log = options.log ?? (() => {})
  const slots = new Map<string, Slot>()
  const idle = idleDesigns<string>(limits)
  const turn = turns()
  const journalOf = options.journal ?? ((designId, t) => pgJournal(db, designId, t))
  let admissions = Promise.resolve()
  let closing = false
  const now = options.host?.now ?? Date.now
  const autosaves = setInterval(autosaveChanged, limits.autosaveCheckMs ?? LIMITS.autosaveCheckMs)
  autosaves.unref()

  function route(designId: string, event: Waiting) {
    if (closing && event.type === 'connect') return event.socket.close(GOING_AWAY, 'the server is restarting')
    let slot = slots.get(designId)
    if (!slot) {
      if (event.type === 'message') event.socket.close(SYNC_CLOSE.protocol, 'say hello first')
      if (event.type !== 'connect') return
      slot = admit(designId)
    }
    if (slot.state === 'open') deliver(designId, slot, event)
    else slot.waiting.push(event)
  }

  /** A slot for a design not loaded, admitted after those before it. */
  function admit(designId: string): Slot {
    let admitted = () => {}
    const slot: Slot = {
      state: 'admitting',
      waiting: [],
      reserved: 0,
      sockets: new Map(),
      cache: {},
      encoded: new WeakMap(),
      sending: new Set(),
      done: new Promise<void>((resolve) => (admitted = resolve)),
    }
    slots.set(designId, slot)
    admissions = admissions.then(() =>
      admission(designId, slot)
        .catch((error: unknown) => {
          log(`design ${designId}: could not be admitted: ${String(error)}`)
          refuse(designId, slot, SYNC_CLOSE.storeFailed, "the server couldn't load the design; reconnecting")
        })
        .finally(admitted),
    )
    return slot
  }

  async function admission(designId: string, slot: Slot) {
    let bytes: number | null
    try {
      bytes = await storedBytes(db, designId)
    } catch (error) {
      log(`design ${designId}: could not be sized: ${String(error)}`)
      return refuse(designId, slot, SYNC_CLOSE.storeFailed, "the server couldn't load the design; reconnecting")
    }
    if (bytes === null) {
      log(`design ${designId}: designDeleted: it has no stored rows`)
      return refuse(designId, slot, SYNC_CLOSE.designDeleted, 'the design was deleted')
    }
    slot.reserved = bytes
    // Idle designs unload first, longest idle first, until this one fits.
    while (loaded(slot) + bytes > limits.loadedBytes) {
      if (!unloading().length && !idle.releaseLongest()) break
      await Promise.all(unloading())
    }
    if (loaded(slot) + bytes > limits.loadedBytes) {
      log(`design ${designId}: serverBusy: ${bytes} bytes past the ${limits.loadedBytes} loaded`)
      return refuse(designId, slot, SYNC_CLOSE.serverBusy, 'the server holds too many designs; try again soon')
    }
    slot.host = openHost(journalOf(designId, turn), {
      hashSecret: (secret) => createHash('sha256').update(secret).digest('hex'),
      log: (line) => log(`design ${designId}: ${line}`),
      turn,
      ...options.host,
      dropped: () => forget(designId, slot),
    })
    open(designId, slot)
  }

  /** The bytes loaded, but for `except`. */
  function loaded(except?: Slot): number {
    let bytes = 0
    for (const slot of slots.values()) if (slot !== except) bytes += slot.host?.bytes() || slot.reserved
    return bytes
  }

  function unloading(): Promise<void>[] {
    return [...slots.values()].filter((s) => s.state === 'unloading').map((s) => s.done)
  }

  /** Closes every connect waiting on `slot` with `code`, and forgets the design. */
  function refuse(designId: string, slot: Slot, code: number, reason: string) {
    for (const event of slot.waiting) if (event.type === 'connect') event.socket.close(code, reason)
    slot.waiting = []
    remove(designId, slot)
  }

  /** The slot's host is open: what waited is delivered, in order. */
  function open(designId: string, slot: Slot) {
    slot.state = 'open'
    for (const event of slot.waiting.splice(0)) deliver(designId, slot, event)
    leftIdle(designId, slot)
  }

  function deliver(designId: string, slot: Slot, event: Waiting) {
    const host = slot.host as DesignHost
    if (event.type === 'connect') {
      idle.wake(designId)
      return host.connect(connectionOf(slot, event.socket), event.hello, event.who)
    }
    if (event.type === 'message') {
      return host.message(connectionOf(slot, event.socket), event.message, event.wireBytes)
    }
    const conn = slot.sockets.get(event.socket)
    if (!conn) return
    if (event.type === 'access') return host.access(conn, event.access)
    slot.sockets.delete(event.socket)
    host.close(conn)
    leftIdle(designId, slot)
  }

  /** The connection the host knows `socket` by: its messages encoded, in order. */
  function connectionOf(slot: Slot, socket: Socket): Connection {
    const known = slot.sockets.get(socket)
    if (known) return known
    const send = inOrder<Out>(
      ({ data, message }) => socket.send(data, message),
      (error) => {
        log(`a message could not be encoded: ${String(error)}`)
        socket.close(SYNC_CLOSE.storeFailed, "the server couldn't encode a message; reconnecting")
      },
    )
    const conn: Connection = {
      send: (message) => {
        let data = slot.encoded.get(message)
        if (data === undefined) {
          data = encode(message, slot.cache, turn)
          slot.encoded.set(message, data)
        }
        const pending = send(data instanceof Promise ? data.then((d) => ({ data: d, message })) : { data, message })
        if (!pending) return
        slot.sending.add(pending)
        void pending.then(() => slot.sending.delete(pending))
      },
      close: (code, reason) => socket.close(code, reason),
    }
    slot.sockets.set(socket, conn)
    return conn
  }

  /** A design with no socket left is kept idle, then unloaded. */
  function leftIdle(designId: string, slot: Slot) {
    if (slot.sockets.size > 0 || slot.state !== 'open') return
    if (idle.mayUnload(designId, () => unload(designId, slot))) unload(designId, slot)
  }

  function unload(designId: string, slot: Slot) {
    if (slots.get(designId) !== slot || slot.state !== 'open' || slot.sockets.size > 0) return
    slot.state = 'unloading'
    slot.done = (async () => {
      const closed = await (slot.host as DesignHost).unload()
      if (!closed) {
        // A tab joined after all: the design stays.
        open(designId, slot)
        return
      }
      remove(designId, slot)
      // What came meanwhile admits the design again.
      const waiting = slot.waiting.splice(0)
      for (const event of waiting) route(designId, event)
    })()
  }

  /** Asks each open design that has changed for `VERSION_LIMITS.autosaveMs` for an Autosave. */
  function autosaveChanged() {
    for (const slot of slots.values()) {
      const since = slot.state === 'open' ? slot.host?.changedSince() : undefined
      if (since !== undefined && now() - since >= VERSION_LIMITS.autosaveMs) slot.host?.autosave()
    }
  }

  /** A host dropped its design: the next connect admits it again. */
  function forget(designId: string, slot: Slot) {
    // An unload under way removes the slot itself once its fold settles, then routes what waited.
    if (slot.state !== 'unloading') remove(designId, slot)
  }

  function remove(designId: string, slot: Slot) {
    if (slots.get(designId) !== slot) return
    slots.delete(designId)
    idle.wake(designId)
    idle.forget(designId)
  }

  async function settled() {
    for (;;) {
      const before = admissions
      await before
      const all = [...slots.values()]
      await Promise.all(all.map((s) => (s.state === 'open' ? s.host?.settled() : s.done)))
      await Promise.all(all.flatMap((s) => [...s.sending]))
      const now = [...slots.values()]
      if (admissions === before && now.every((s) => s.state === 'open' && s.sending.size === 0)) return
    }
  }

  return {
    connect: (designId, socket, hello, who) => route(designId, { type: 'connect', socket, hello, who }),
    message: (designId, socket, message, wireBytes) => route(designId, { type: 'message', socket, message, wireBytes }),
    close: (designId, socket) => route(designId, { type: 'close', socket }),
    access: (designId, socket, access) => route(designId, { type: 'access', socket, access }),
    host: (designId) => slots.get(designId)?.host,
    loadedBytes: () => loaded(),
    settled,
    async closeAll() {
      closing = true
      clearInterval(autosaves)
      await settled()
      for (const [designId, slot] of slots) {
        for (const socket of [...slot.sockets.keys()]) {
          socket.close(GOING_AWAY, 'the server is restarting')
          route(designId, { type: 'close', socket })
        }
      }
      idle.releaseAll()
      await settled()
    },
  }
}
