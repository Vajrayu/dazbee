// A simulated session for tests, as FigCraft's sim.rs: the real design host (host.ts) over a journal
// in memory, several tabs, and a link each way per tab that delivers in order (like a WebSocket)
// after a seeded random delay, so messages on different links interleave differently for every
// seed. Every message goes through JSON on its way.
//
// The journal's loads and writes answer when the simulator's clock reaches them: at once, or with
// `storage` 1 to `maxLatency` ticks later, some failing (the host drops the design and its tabs come
// back) and some stored with the server stopping before its answers go out. The server also stops
// and opens again at random, gracefully or not. Tabs drop their connection and come back, and
// reload from what they saved, or with `tabCopies` from their tab copies, written as entries after
// each step of theirs and checked to add up to what the tab saves. The ledger (test-sim-ledger.ts)
// checks what the journal stores as it is stored. Each tab keeps a mirror fed only by its change
// listeners, which must match its working design (I3).
// What a tab sends goes through a pacer (D4), as its transport sends it, emptied when it disconnects.
// Previews go down links of their own that hold the latest per sender, as the server's relay does
// for a slow tab (D7), so one can arrive after the change set that ended its step: a preview never
// changes a working or confirmed design (I4), one that comes late is ignored, and once everyone is
// caught up no tab shows one.
import {
  type Accepted,
  type DesignInput,
  type DesignRecords,
  PROTOCOL,
  type ServerMessage,
  SYNC_CLOSE,
} from '@dazbee/schema'

import { sameValue } from '../same-value.ts'
import { testDesign } from '../test-design.ts'
import { differenceOf, seeded } from '../test-walk.ts'
import type { Rec, RecordKey } from './changes.ts'
import { utf8Length } from './checks.ts'
import { type Client, type ClientOptions, openClient, type Outgoing as TabOutgoing } from './client.ts'
import type { Recompute } from './follow-up.ts'
import { type Connection, type HostOptions, openHost } from './host.ts'
import { firstSaved, type Journal, type Write } from './journal.ts'
import { memoryJournal, memoryRows } from './memory-journal.ts'
import { Paced } from './pacer.ts'
import type { ServerLimits, Who } from './server.ts'
import { type ReadState, recordKeys } from './state.ts'
import { type Entries, putEntries, restoreEntries, TabCopy } from './tab-copy.ts'
import { testServerOptions, wire } from './test-session.ts'
import type { Dice } from './test-sim-edits.ts'
import { openLedger } from './test-sim-ledger.ts'
import { versionText } from './version-text.ts'

export interface SimOptions {
  tabs: number
  seed: number
  /** Each message arrives 1 to this many ticks after it is sent, never before one sent earlier on its link. */
  maxDelay: number
  limits?: Partial<ServerLimits>
  design?: DesignInput
  /** Parse the stored design after each change set, check the structure check against the schema, and check each mirror after each delivery. */
  checkEach?: boolean
  /**
   * Writes that take time and fail: each answers 1 to `maxLatency` ticks after it starts, fails with
   * chance `lostWrite`, or is stored and the server stops before it answers (`crashAfterStore`).
   * The host folds past `foldEntries` accepted entries.
   */
  storage?: { lostWrite: number; crashAfterStore: number; maxLatency: number; foldEntries: number }
  /** The tabs' derived values, brought up to date with follow-ups (D6). */
  recompute?: Recompute
  /** Each tab writes its tab copy as entries after every step, and reloads from them (D9). */
  tabCopies?: boolean
}

export interface Counts {
  delivered: number
  rejected: number
  /** Undos and redos the journal stored. */
  undos: number
  /** Tabs that came back to a whole design. */
  wholeDesigns: number
  /** Change sets a tab learned were accepted only from its catch-up: their answer was lost. */
  answersLost: number
  /** Server restarts, writes that failed, folds, appends, and the most entries one append stored. */
  restarts: number
  lostWrites: number
  folds: number
  appends: number
  mostInOneWrite: number
  /** "Lost" notices: a tab that had to start over. */
  lost: number
  reloads: number
  /** The most messages one tab's pacer held. */
  mostPaced: number
  /** Previews delivered, and the follow-ups the journal stored. */
  previews: number
  followUps: number
}

export interface Sim {
  readonly tabs: readonly Client[]
  readonly dice: Dice
  readonly counts: Counts
  /** Undos and redos that broke what someone else wrote, and anything else the checks found as it happened. */
  readonly violations: string[]
  isOnline(i: number): boolean
  /** Sends what tab `i` returned (a step's end, an undo) up its link. */
  send(i: number, messages: readonly TabOutgoing[]): void
  /** Delivers the next message or journal answer due; false when nothing is in flight. */
  step(): Promise<boolean>
  /** Delivers until nothing is in flight. */
  settle(maxSteps?: number): Promise<void>
  disconnect(i: number): void
  reconnect(i: number): void
  /** The server stops and opens again from its journal: `graceful`, once its writes are stored; else the write in flight stored or not. */
  restart(graceful: boolean): Promise<void>
  /** Tab `i` reloads: it saves, closes, and a new tab comes back from what it saved (online if it was). */
  reload(i: number): void
  /** The design the server holds. */
  design(): ReadState
  /** Why the session hasn't converged (every tab online, caught up, holding the server's design, nothing lost), if it hasn't. */
  converged(): string | undefined
}

/** How long a tick is, in milliseconds, for the pacer. */
const TICK_MS = 10

/** One direction of one connection: messages in order, each due at a tick. */
type Link = { due: number; text: string }[]

/** A load or write of the journal, answered at its tick. */
interface Op {
  due: number
  /** The host it is for: one that stopped never gets its answer. */
  host: number
  write?: Write
  run(): Promise<unknown>
  resolve(value: unknown): void
  reject(error: unknown): void
}

/** A simulated tab: its client (once welcomed), its connection, its links and its mirror. */
interface Tab {
  client?: Client
  conn?: Connection | undefined
  /** What the tab sends waits here for its turn (D4), as its transport paces it; emptied when the connection goes. */
  paced: Paced<TabOutgoing>
  up: Link
  down: Link
  /** The previews held back for the tab: the latest per sender, each due at a tick of its own. */
  previews: { due: number; sender: number; text: string }[]
  mirror: Map<RecordKey, Rec | undefined>
  /** Its tab copy, its entries, and the change sets it took since the copy was last written. */
  copy: TabCopy
  entries: Entries
  heard: Accepted[]
}

type PreviewMessage = Extract<ServerMessage, { type: 'preview' }>

/** A session on `options.design` (the test design unless given) with its tabs joined. */
export async function openSim(options: SimOptions): Promise<Sim> {
  const random = seeded(options.seed)
  const dice: Dice = {
    below: (n) => Math.floor(random() * n),
    chance: (p) => random() < p,
    pick: (items) => items[Math.floor(random() * items.length)],
  }
  const { storage } = options
  const start = (options.design ?? testDesign()) as unknown as DesignRecords
  const rows = memoryRows(firstSaved(start, 's0'))
  const stored = memoryJournal(rows)
  const hostOptions: HostOptions = {
    ...testServerOptions({ limits: options.limits ?? {} }),
    ...(storage ? { foldEntries: storage.foldEntries } : {}),
  }
  const counts: Counts = {
    delivered: 0,
    rejected: 0,
    undos: 0,
    wholeDesigns: 0,
    answersLost: 0,
    restarts: 0,
    lostWrites: 0,
    folds: 0,
    appends: 0,
    mostInOneWrite: 0,
    lost: 0,
    reloads: 0,
    mostPaced: 0,
    previews: 0,
    followUps: 0,
  }
  const violations: string[] = []
  const clientOptions: ClientOptions = options.recompute ? { recompute: options.recompute } : {}
  const tabs: Tab[] = []
  let ops: Op[] = []
  let now = 0
  let hostNumber = 0
  let host = openHost(tickJournal(hostNumber), hostOptions)
  /** No fault comes until every tab has its welcome. */
  let opening = true
  /** Tabs whose connection the host closed, to come back once the tick is over. */
  const rejoin: number[] = []
  /** What each tab sent, what the host got and what the journal stored, checked as it is stored. */
  const ledger = openLedger(start, options.checkEach ?? false, counts, violations)
  /** Per tab, the last change set id of each author it saw accepted: an older preview is late. */
  const lastAccepted = Array.from({ length: options.tabs }, () => new Map<number, number>())

  /** A journal whose answers wait for the clock, for host number `n`. */
  function tickJournal(n: number): Journal {
    const op = <T>(run: () => Promise<T>, write?: Write) =>
      new Promise<T>((resolve, reject) => {
        const due = now + (storage ? 1 + dice.below(storage.maxLatency) : 0)
        ops.push({ due, host: n, run, resolve: resolve as (v: unknown) => void, reject, ...(write ? { write } : {}) })
      })
    return {
      load: () => op(() => stored.load()),
      append: (entries, expected) =>
        op(() => stored.append(entries, expected), { type: 'append', entries: [...entries], expected }),
      fold: (saved, expected) => op(() => stored.fold(saved, expected), { type: 'fold', saved, expected }),
      bury: (saved, expected, from, reason) =>
        op(() => stored.bury(saved, expected, from, reason), { type: 'bury', saved, expected, from, reason }),
      version: (version) => op(() => stored.version(version), { type: 'version', version, expected: 0 }),
      readVersion: (id) => op(() => stored.readVersion(id)),
    }
  }

  /** Whether a storage fault of chance `p` comes now. */
  const fault = (p: (s: NonNullable<SimOptions['storage']>) => number) =>
    storage !== undefined && !opening && dice.chance(p(storage))

  for (let i = 0; i < options.tabs; i++) {
    const copy = { copy: new TabCopy(), entries: new Map(), heard: [] }
    tabs.push({ paced: new Paced(0), up: [], down: [], previews: [], mirror: new Map(), ...copy })
    connect(i, { type: 'hello', protocol: PROTOCOL, token: 't', waiting: 0 })
  }
  while (tabs.some((tab) => !tab.client)) {
    if (!(await step())) throw new Error('a tab was never welcomed')
  }
  opening = false

  function who(i: number): Who {
    return { member: { userId: `u${i % 2}`, workspaceId: 'w1' }, name: `u${i % 2}`, access: 'edit' }
  }

  function clientOf(i: number): Client {
    const client = tabs[i]?.client
    if (!client) throw new Error(`tab ${i} has no client yet`)
    return client
  }

  /** Tab `i` opens a connection and says `hello`; what the host sends on it goes down its link. */
  function connect(i: number, hello: unknown) {
    const tab = tabs[i] as Tab
    const conn: Connection = {
      send: (sent) => {
        if (tab.conn !== conn) return
        const message = sent.type === 'storedVersion' ? (JSON.parse(versionText(sent)) as ServerMessage) : sent
        if (message.type === 'left') tab.previews = tab.previews.filter((held) => held.sender !== message.tabId)
        if (message.type !== 'preview') return post(tab.down, message)
        // The latest per sender, sent after a delay of its own.
        const due = now + 1 + dice.below(options.maxDelay)
        tab.previews = tab.previews.filter((held) => held.sender !== message.tabId)
        tab.previews.push({ due, sender: message.tabId, text: JSON.stringify(message) })
      },
      close: (code, reason) => {
        if (tab.conn !== conn) return
        if (code !== SYNC_CLOSE.storeFailed) violations.push(`tab ${i} was closed: ${code} ${reason}`)
        goOffline(i)
        rejoin.push(i)
      },
    }
    tab.conn = conn
    host.connect(conn, wire(hello), who(i))
  }

  /** Keeps tab `i`'s mirror from what its change listeners are told. */
  function watch(i: number) {
    const tab = tabs[i] as Tab
    const client = clientOf(i)
    tab.mirror.clear()
    for (const key of recordKeys(client.working())) tab.mirror.set(key, client.working().getKey(key))
    client.onChange((changed) => {
      for (const key of changed) tab.mirror.set(key, client.working().getKey(key))
    })
  }

  function post(link: Link, message: unknown) {
    const due = Math.max(now + 1 + dice.below(options.maxDelay), link.at(-1)?.due ?? 0)
    link.push({ due, text: JSON.stringify(message) })
  }

  function send(i: number, messages: readonly TabOutgoing[]) {
    const tab = tabs[i] as Tab
    for (const message of messages) {
      if (message.type === 'changes' && message.kind === 'edit') ledger.sent(`${clientOf(i).tabId()}:${message.id}`)
      if (tab.conn) tab.paced.push(message)
    }
    counts.mostPaced = Math.max(counts.mostPaced, tab.paced.size)
    pace(i)
  }

  /** Puts on tab `i`'s link what its pacer lets go now. */
  function pace(i: number) {
    const tab = tabs[i] as Tab
    for (let message = tab.paced.takeDue(now * TICK_MS); message; message = tab.paced.takeDue(now * TICK_MS))
      post(tab.up, message)
  }

  async function step(): Promise<boolean> {
    let next: { due: number; op?: Op; i?: number; upward?: boolean; paced?: boolean; preview?: number } | undefined
    for (const op of ops) if (!next || op.due < next.due) next = { due: op.due, op }
    for (const [i, tab] of tabs.entries()) {
      for (const [at, held] of tab.previews.entries()) {
        if (!next || held.due < next.due) next = { due: held.due, i, preview: at }
      }
      const turn = tab.paced.due()
      const due = turn === undefined ? undefined : Math.max(now, Math.ceil(turn / TICK_MS))
      if (due !== undefined && (!next || due < next.due)) next = { due, i, paced: true }
      for (const upward of [true, false]) {
        const due = (upward ? tab.up : tab.down)[0]?.due
        if (due !== undefined && (!next || due < next.due)) next = { due, i, upward }
      }
    }
    if (!next) return false
    now = Math.max(now, next.due)
    if (next.op) await land(next.op, true)
    else if (next.paced) pace(next.i as number)
    else if (next.preview !== undefined) {
      const [held] = (tabs[next.i as number] as Tab).previews.splice(next.preview, 1)
      takePreview(next.i as number, JSON.parse((held as { text: string }).text) as PreviewMessage)
    } else {
      counts.delivered++
      const i = next.i as number
      const tab = tabs[i] as Tab
      if (next.upward) {
        const text = (tab.up.shift() as Link[number]).text
        hostTakes(i, text)
      } else deliver(i, JSON.parse((tab.down.shift() as Link[number]).text) as ServerMessage)
    }
    await flush()
    for (const i of rejoin.splice(0)) reconnect(i)
    // The tab a message came to or went from writes its copy: an op of the journal touches no tab's.
    if (options.tabCopies && next.i !== undefined) writeCopy(next.i)
    if (options.checkEach) {
      for (const i of tabs.keys()) {
        const missed = mirrorIssue(i)
        if (missed !== undefined) throw new Error(missed)
      }
    }
    return true
  }

  /** The host takes a message tab `i` sent. */
  function hostTakes(i: number, text: string) {
    const message = JSON.parse(text) as TabOutgoing
    if (message.type === 'changes') {
      const key = `${clientOf(i).tabId()}:${message.id}`
      ledger.got(key, { kind: message.kind, base: message.base, changes: message.changes })
    }
    host.message((tabs[i] as Tab).conn as Connection, message, utf8Length(text))
  }

  /** Tab `i` took change set `changeSet` on its confirmed design. */
  function noteAccepted(i: number, changeSet: Accepted) {
    const { seq, author, changeSetId, changes } = changeSet
    const seen = lastAccepted[i] as Map<number, number>
    seen.set(author, Math.max(changeSetId, seen.get(author) ?? 0))
    ;(tabs[i] as Tab).heard.push({ seq, author, changeSetId, changes })
  }

  /** Writes tab `i`'s tab copy: only the entries that changed. */
  function writeCopy(i: number) {
    const tab = tabs[i] as Tab
    if (!tab.client) return
    putEntries(tab.entries, tab.copy.write(wire(tab.client.save()), tab.heard))
    tab.heard = []
  }

  /** Tab `i` gets a message from the server: its welcome, when it has no client yet. */
  function deliver(i: number, message: ServerMessage) {
    const tab = tabs[i] as Tab
    if (!tab.client) {
      tab.client = openClient(message, clientOptions)
      watch(i)
      return
    }
    const client = tab.client
    if (message.type === 'reject') counts.rejected++
    if (message.type === 'accepted') noteAccepted(i, message)
    if (message.type === 'welcome' && 'changeSets' in message.catchUp) {
      for (const changeSet of message.catchUp.changeSets) noteAccepted(i, changeSet)
    }
    if (message.type === 'welcome' && 'changeSets' in message.catchUp) {
      counts.answersLost += message.catchUp.changeSets.filter((c) => c.author === message.tabId).length
    }
    if (message.type === 'welcome' && 'design' in message.catchUp) {
      counts.wholeDesigns++
      ledger.gap(message.tabId, client.seq(), message.seq)
    }
    send(i, client.receive(message))
    counts.lost += client.takeNotices().filter((n) => n.kind === 'lost').length
  }

  /**
   * Tab `i` gets a preview: it never changes the working or confirmed design (I4), and one older
   * than its sender's last accepted change set is ignored.
   */
  function takePreview(i: number, message: PreviewMessage) {
    const client = tabs[i]?.client
    if (!client) return
    counts.previews++
    const held = client.previews().get(message.tabId)
    const late = message.after < (lastAccepted[i]?.get(message.tabId) ?? 0)
    const [seq, queued] = [client.seq(), client.queued()]
    const before = options.checkEach ? [client.working().toRecords(), client.confirmed().toRecords()] : undefined
    let told = false
    const stop = client.onChange(() => (told = true))
    send(i, client.receive(message))
    stop()
    if (late && client.previews().get(message.tabId) !== held) {
      violations.push(`tab ${i} showed a preview from tab id ${message.tabId} that came after its change set`)
    }
    const after = before ? [client.working().toRecords(), client.confirmed().toRecords()] : undefined
    if (told || client.seq() !== seq || client.queued() !== queued || !sameValue(before, after)) {
      violations.push(`a preview from tab id ${message.tabId} changed tab ${i}'s working or confirmed design`)
    }
  }

  /** A journal load or write answers: stored and resolved, or failed when `faults` lets one come. */
  async function land(op: Op, faults: boolean) {
    ops = ops.filter((o) => o !== op)
    const fails = faults && op.write !== undefined && fault((s) => s.lostWrite)
    if (fails) stored.failNext()
    try {
      const value = await op.run()
      if (op.write) ledger.record(op.write)
      if (faults && op.write && fault((s) => s.crashAfterStore)) return await reopen()
      op.resolve(value)
    } catch (error) {
      // A write that fails with nothing planted is a bug in what the host wrote: the session stops there.
      if (!fails) throw new Error(`a write failed with nothing planted: ${String(error)}`)
      counts.lostWrites++
      op.reject(error)
    }
  }

  /** The server stops, and opens again from its journal; the tabs that were connected come back. */
  async function reopen() {
    counts.restarts++
    hostNumber++
    ops = []
    const back = [...tabs.keys()].filter((i) => tabs[i]?.conn !== undefined)
    for (const i of back) goOffline(i)
    host = openHost(tickJournal(hostNumber), hostOptions)
    for (const i of back) reconnect(i)
    await flush()
  }

  async function restart(graceful: boolean) {
    if (graceful) {
      for (let op = ops[0]; op; op = ops[0]) {
        await land(op, false)
        await flush()
      }
    } else {
      const flying = ops.find((op) => op.write)
      if (flying && dice.chance(0.5)) {
        await flying.run()
        ledger.record(flying.write as Write)
      }
    }
    await reopen()
  }

  /** Tab `i`'s connection is gone: what is in flight either way is lost. */
  function goOffline(i: number) {
    const tab = tabs[i] as Tab
    tab.paced.clear()
    tab.up.length = 0
    tab.down.length = 0
    tab.previews = []
    tab.conn = undefined
    tab.client?.disconnect()
  }

  function disconnect(i: number) {
    const conn = tabs[i]?.conn
    if (!conn) return
    goOffline(i)
    host.close(conn)
  }

  function reconnect(i: number) {
    if (tabs[i]?.conn) return
    connect(i, clientOf(i).reconnect('t'))
  }

  function reload(i: number) {
    const tab = tabs[i] as Tab
    const old = clientOf(i)
    counts.lost += old.takeNotices().filter((n) => n.kind === 'lost').length
    let saved = wire(old.save())
    if (options.tabCopies) {
      writeCopy(i)
      const restored = restoreEntries(tab.entries)
      if (!sameValue(restored, saved)) violations.push(`tab ${i}'s tab copy doesn't add up to what it saves`)
      saved = restored
      tab.copy = new TabCopy(tab.entries)
    }
    const wasOnline = tab.conn !== undefined
    disconnect(i)
    tab.client = openClient(saved, clientOptions)
    watch(i)
    counts.reloads++
    if (wasOnline) reconnect(i)
  }

  /** The first record tab `i`'s working design shows otherwise than its listeners were told, if any. */
  function mirrorIssue(i: number): string | undefined {
    const tab = tabs[i] as Tab
    if (!tab.client) return undefined
    const working = tab.client.working()
    for (const key of new Set([...tab.mirror.keys(), ...recordKeys(working)])) {
      if (!sameValue(tab.mirror.get(key), working.getKey(key))) {
        return `tab ${i}'s listeners were not told of ${key}: ${JSON.stringify(tab.mirror.get(key))} vs ${JSON.stringify(working.getKey(key))}`
      }
    }
    return undefined
  }

  async function settle(maxSteps = 100_000) {
    for (let n = 0; n < maxSteps; n++) if (!(await step())) return
    throw new Error(`still busy after ${maxSteps} steps`)
  }

  function serverState(): ReadState {
    const server = host.server()
    if (!server) throw new Error('the design is not open')
    return server.state()
  }

  function converged(): string | undefined {
    if (ops.length > 0) return 'the journal is busy'
    const server = host.server()
    if (!server) return 'the design is not open'
    const design = server.state().toRecords()
    for (const [i, tab] of tabs.entries()) {
      const client = tab.client
      if (!tab.conn || !client?.isOnline()) return `tab ${i} is offline`
      if (client.queued() > 0 || client.seq() !== server.seq() || client.stepOpen()) {
        return `tab ${i} at seq ${client.seq()} with ${client.queued()} queued; server at ${server.seq()}`
      }
      if (client.previews().size > 0) return `tab ${i} still shows a preview of tab ${[...client.previews().keys()][0]}`
      const differs =
        differenceOf(client.working().toRecords(), design) ??
        differenceOf(client.confirmed().toRecords(), design) ??
        mirrorIssue(i)
      if (differs !== undefined) return `tab ${i}: ${differs}`
    }
    if (counts.lost > 0) return `${counts.lost} tab(s) had to start over`
    return ledger.issue() ?? ledger.journalIssue(rows, server.seq(), design)
  }

  return {
    get tabs() {
      return tabs.map((_, i) => clientOf(i))
    },
    dice,
    counts,
    violations,
    isOnline: (i) => tabs[i]?.conn !== undefined,
    send,
    step,
    settle,
    disconnect,
    reconnect,
    restart,
    reload,
    design: serverState,
    converged,
  }
}

/** Lets every answer already given run its callbacks. */
function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}
