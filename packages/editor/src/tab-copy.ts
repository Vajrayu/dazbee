// The device copy (D9): what this browser keeps of a design so that it opens offline and a reload
// loses nothing. Each tab id has a tab copy in the design's IndexedDB database, written as the sync
// core's entries (`TabCopy`), so a step writes only what it changed, never the whole design (I10);
// a step's change set goes to the server only once its tab copy holds it. A tab holds a Web Lock on
// its tab copy while it is open, and finds it again after a reload by the tab id in the browser
// tab's `sessionStorage`. A tab that opens a design takes up the newest free tab copy of its member;
// once online, it sends each other free tab copy's work on a connection of its own, then deletes it.
// A closing tab keeps its tab copy, since a reload looks the same as a close: the next tab to open
// the design takes it up or clears it. A device that is full stops keeping new steps; a browser
// with no Web Locks or IndexedDB keeps no device copy.
import { type Entries, type Notice, restoreEntries, type SavedClient, TabCopy, type TabCopyWrite } from '@dazbee/doc'
import { type Accepted, type Member, sameMember, type ServerMessage } from '@dazbee/schema'

import type { SyncLink } from './sync-link.ts'

/** What the device copy asks of the browser's Web Locks. */
export type Locks = Pick<LockManager, 'request'>

/** What the device copy asks of the browser tab's `sessionStorage`. */
export type Session = Pick<Storage, 'getItem' | 'setItem'>

export interface TabCopiesDeps {
  designId: string
  /** The member the tab works as: it takes up only their tab copies. */
  member: Member
  indexedDB?: IDBFactory
  /** `navigator.locks`; without it, no device copy is kept. */
  locks?: Locks
  session?: Session
  now?: () => number
}

/** Why a tab copy is no longer written: the device is full, or the browser's storage failed. */
export type KeptStop = 'full' | 'failed'

/** A link's client kept in its tab copy as it changes. */
export interface Kept {
  stopped(): KeptStop | null
  /** Told once when the tab copy is no longer written. */
  onStop(listener: (why: KeptStop) => void): () => void
  /** Told each write: what it put and removed. */
  onWrite(listener: (write: TabCopyWrite) => void): () => void
  /** Writes what is due now, without waiting out the open step's second; resolves once written (or not to be). */
  flushed(): Promise<void>
}

export interface TabCopies {
  /**
   * This tab's tab copy, held from now on: its own after a reload, else the newest free one of its
   * member; undefined when there is none (a first visit, which waits for the server).
   */
  takeUp(): Promise<SavedClient | undefined>
  /**
   * Keeps `link`'s client in this tab's tab copy from now on: one write at a time, and while a step
   * is open at most one a second. The link's sends wait for the write that holds them.
   */
  keep(link: SyncLink): Kept
  /**
   * Sends each other free tab copy's work (its queue and open step), newest first and one at a
   * time, on a link `open` makes for it, then deletes it; deletes one with none at once. A tab copy
   * whose link ends first (a tab older than the design, a deleted design) is left. Resolves, with
   * what their clients had to tell the person, once each is done, or once `close` stops it.
   */
  sendOthers(open: (saved: SavedClient) => SyncLink): Promise<Notice[]>
  /**
   * The tab closes, once its link is destroyed (a link that went on sending would leave its tab
   * copy behind it): what is due is written and every lock let go. The tab copy stays, since a
   * reload looks the same.
   */
  close(): Promise<void>
}

/** A tab copy's row in `tabs`: whose it is, and when it was last written. */
interface TabRow {
  tabId: number
  member: Member
  written: number
}

/** While a step is open, a tab copy is written at most this often (D9). */
export const OPEN_STEP_WRITE_MS = 1000
/** How long a reloaded tab waits for its own tab copy's lock, which the page it replaces may not have let go yet. */
export const RELOAD_LOCK_WAIT_MS = 2000

const ENTRIES = 'entries'
const TABS = 'tabs'

/** The design's database, the Web Lock on a tab copy and the `sessionStorage` key of this tab's tab id. */
const databaseOf = (designId: string) => `dazbee-tabs-${designId}`
const lockOf = (designId: string, tabId: number) => `dazbee-tab-${designId}-${tabId}`
const sessionKeyOf = (designId: string) => `dazbee-tab-${designId}`
/** Every key of `tabId`'s entries: `[tabId, key]`, a key being text. */
const rangeOf = (tabId: number) => IDBKeyRange.bound([tabId], [tabId, []])

interface Keeper extends Kept {
  /** Stops writing, and says why. */
  stop(why: KeptStop): void
  /** Writes what is due and stops. */
  end(): Promise<void>
}

/** A move of this tab's tab copy to a new tab id, its lock held: told once the move is written, or failed. */
interface Move {
  /** The tab id it moves from, whose tab copy the move deletes. */
  from: number | undefined
  moved(): void
  failed(): void
}

interface KeeperDeps {
  db: IDBDatabase
  member: Member
  now: () => number
  /** The tab copy it goes on writing, as it was read; none for a tab not yet kept. */
  at?: { tabId: number; entries: Entries } | undefined
  /** Moves the tab copy to a new tab id, its lock taken; null when it is held. Without it, a new tab id stops the writes. */
  move?: (tabId: number) => Promise<Move | null>
}

/** The device copy of `designId` for this tab's member; `'off'` where the browser has no Web Locks or IndexedDB. */
export async function openTabCopies(deps: TabCopiesDeps): Promise<TabCopies | 'off'> {
  const { designId, member, now = Date.now } = deps
  const locks = deps.locks ?? (globalThis.navigator as Navigator | undefined)?.locks
  const factory = deps.indexedDB ?? globalThis.indexedDB
  const session = deps.session ?? globalThis.sessionStorage
  if (!locks || !factory) return 'off'
  let db: IDBDatabase
  try {
    db = await openDatabase(factory, databaseOf(designId))
  } catch {
    return 'off'
  }
  /** This tab's tab copy, once it has one, and how its lock is let go. */
  let own: { tabId: number; release: () => void } | undefined
  /** The tab copies this tab keeps, and the links sending others' work. */
  const keepers = new Set<Keeper>()
  const sending = new Set<SyncLink>()
  /** Locks held on others' tab copies while their work goes. */
  const held = new Set<() => void>()
  let closed = false
  /** The entries of the tab copy taken up, for its keeper to go on writing it. */
  let takenUp: Entries | undefined
  let keeping = false

  // Another tab deleting the database asks this one to let go of it first: it stops writing.
  db.onversionchange = () => {
    db.close()
    for (const keeper of keepers) keeper.stop('failed')
  }

  /**
   * Holds the lock on `tabId`'s tab copy: at once if it is free, or waiting up to `waitMs`. What
   * lets it go, or null.
   */
  function hold(tabId: number, waitMs = 0): Promise<(() => void) | null> {
    const giveUp = new AbortController()
    const timer = waitMs > 0 ? setTimeout(() => giveUp.abort(), waitMs) : undefined
    const options: LockOptions = waitMs > 0 ? { signal: giveUp.signal } : { ifAvailable: true }
    return new Promise((resolve) => {
      locks
        ?.request(lockOf(designId, tabId), options, (lock) => {
          clearTimeout(timer)
          if (!lock) return resolve(null)
          return new Promise<void>((release) => resolve(() => release()))
        })
        .catch(() => resolve(null))
    })
  }

  /** The tab copies of this tab's member, the newest first. */
  async function ownRows(): Promise<TabRow[]> {
    const rows = await request<TabRow[]>(db.transaction(TABS).objectStore(TABS).getAll())
    return rows.filter((row) => sameMember(row.member, member)).sort((a, b) => b.written - a.written)
  }

  /**
   * `tabId`'s tab copy as a saved client, read under its lock: undefined when another tab deleted
   * it meanwhile, or it isn't this member's; deleted when it doesn't add up.
   */
  async function restore(tabId: number): Promise<{ saved: SavedClient; entries: Entries } | undefined> {
    const row = await request<TabRow | undefined>(db.transaction(TABS).objectStore(TABS).get(tabId))
    if (!row || !sameMember(row.member, member)) return undefined
    const entries = await readEntries(db, tabId)
    try {
      return { saved: restoreEntries(entries), entries }
    } catch {
      await deleteCopy(db, tabId)
      return undefined
    }
  }

  async function takeUp(): Promise<SavedClient | undefined> {
    const rows = await ownRows()
    const mine = Number(session.getItem(sessionKeyOf(designId)))
    // After a reload, its own tab copy first; a browser tab duplicated with it finds that one held.
    const order = [...rows.filter((row) => row.tabId === mine), ...rows.filter((row) => row.tabId !== mine)]
    for (const { tabId } of order) {
      const release = await hold(tabId, tabId === mine ? RELOAD_LOCK_WAIT_MS : 0)
      if (!release) continue
      let found: Awaited<ReturnType<typeof restore>>
      try {
        found = await restore(tabId)
      } catch (error) {
        release()
        throw error
      }
      if (!found || closed) {
        release()
        if (closed) return undefined
        continue
      }
      own = { tabId, release }
      session.setItem(sessionKeyOf(designId), String(tabId))
      takenUp = found.entries
      return found.saved
    }
    return undefined
  }

  function keep(link: SyncLink): Kept {
    // Two keepers of one tab copy would each write it from their own idea of what it holds.
    if (keeping) throw new Error('this tab already keeps its tab copy')
    keeping = true
    const keeper = keeperOf(link, {
      db,
      member,
      now,
      at: own && { tabId: own.tabId, entries: takenUp ?? new Map() },
      async move(tabId) {
        const release = await hold(tabId)
        if (!release) return null
        return {
          from: own?.tabId,
          // Once the tab copy is written under `tabId` (and the old one deleted, in one transaction).
          moved() {
            own?.release()
            own = { tabId, release }
            session.setItem(sessionKeyOf(designId), String(tabId))
          },
          failed: release,
        }
      },
    })
    takenUp = undefined
    keepers.add(keeper)
    link.setGate(keeper.flushed)
    return keeper
  }

  async function sendOthers(open: (saved: SavedClient) => SyncLink): Promise<Notice[]> {
    const notices: Notice[] = []
    for (const { tabId } of await ownRows()) {
      if (closed) break
      if (tabId === own?.tabId) continue
      const release = await hold(tabId)
      if (!release) continue
      held.add(release)
      try {
        const found = await restore(tabId)
        if (!found) continue
        const { saved } = found
        const work = saved.queue.length > 0 || saved.open !== undefined
        if (work && !(await sendWork(open, found, tabId, notices))) continue
        // Deleted before its lock is let go, so no other tab takes it up meanwhile.
        await deleteCopy(db, tabId)
      } finally {
        held.delete(release)
        release()
      }
    }
    return notices
  }

  /** Sends one other tab copy's work on a link of its own; true once its queue is empty, false when the link ended first or the tab closed. */
  async function sendWork(
    open: (saved: SavedClient) => SyncLink,
    { saved, entries }: { saved: SavedClient; entries: Entries },
    tabId: number,
    notices: Notice[],
  ): Promise<boolean> {
    const link = open(saved)
    sending.add(link)
    // Kept in its own tab copy meanwhile, under its own tab id: a new one ends the writes.
    const keeper = keeperOf(link, { db, member, now, at: { tabId, entries } })
    keepers.add(keeper)
    link.setGate(keeper.flushed)
    const sent = await new Promise<boolean>((resolve) => {
      const check = () => {
        const client = link.client()
        if (closed || link.ended() || link.status() === 'Outdated') resolve(false)
        else if (link.status() === 'connected' && client?.queued() === 0 && !client.stepOpen()) resolve(true)
      }
      link.onStatus(check)
      link.connect()
      check()
    })
    await keeper.end()
    keepers.delete(keeper)
    notices.push(...(link.client()?.takeNotices() ?? []))
    sending.delete(link)
    link.destroy()
    return sent
  }

  async function close() {
    closed = true
    for (const link of sending) link.destroy()
    for (const keeper of keepers) await keeper.end()
    for (const release of held) release()
    own?.release()
    own = undefined
    db.close()
  }

  return { takeUp, keep, sendOthers, close }
}

/** Writes `link`'s client into its tab copy as it changes. */
function keeperOf(link: SyncLink, { db, member, now, at, move }: KeeperDeps): Keeper {
  let tabId = at?.tabId
  let copy = new TabCopy(at?.entries)
  /** The change sets the confirmed design took since the last write, in order. */
  let heard: Accepted[] = []
  let stopped: KeptStop | null = null
  let ended = false
  /** The write on its way, and whether another is due once it is done: soon, or at once (`urgent`, a flush waits). */
  let writing: Promise<void> | undefined
  let again = false
  let urgent = false
  /** Writes started and finished, counted: a flush waits for the first write that starts after it. */
  let started = 0
  const flushes: { upTo: number; resolve: () => void }[] = []
  /** Once stopped: resolves once the tab copy is deleted, never when it can't be (sends then wait for good). */
  let deleted: Promise<void> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  /** When the write `timer` starts is due. */
  let timerAt = 0
  let lastWrite = -Infinity
  const stopListeners = new Set<(why: KeptStop) => void>()
  const writeListeners = new Set<(write: TabCopyWrite) => void>()
  const unlisten: (() => void)[] = []
  unlisten.push(
    link.onHeard((message) => {
      // Another member's presence changes nothing a tab copy keeps.
      if (stopped || ended || message.type === 'presence') return
      heard.push(...acceptedIn(message))
      schedule()
    }),
    link.onStatus(schedule),
    link.onClient((client) => {
      unlisten.push(client.onChange(schedule))
      schedule()
    }),
  )

  /** A write soon; while a step is open, no sooner than a second after the last. */
  function schedule() {
    if (stopped || ended || !link.client()) return
    if (writing) {
      again = true
      return
    }
    // A step that ended is written at once, though its open step's second hadn't run out.
    const at = link.client()?.stepOpen() ? Math.max(now(), lastWrite + OPEN_STEP_WRITE_MS) : now()
    if (timer !== undefined && timerAt <= at) return
    clearTimeout(timer)
    timerAt = at
    timer = setTimeout(startWrite, at - now())
  }

  function startWrite() {
    clearTimeout(timer)
    timer = undefined
    again = false
    urgent = false
    const n = ++started
    writing = write()
      .catch(() => stop('failed'))
      .finally(() => {
        writing = undefined
        settleFlushes(n)
        if (urgent) startWrite()
        else if (again) schedule()
      })
  }

  /** Lets go the flushes the writes up to `n` cover; once stopped, only the tab copy's delete does. */
  function settleFlushes(n: number) {
    if (stopped && n !== Infinity) return
    for (const flush of flushes.filter((f) => f.upTo <= n)) {
      flushes.splice(flushes.indexOf(flush), 1)
      flush.resolve()
    }
  }

  async function write() {
    const client = link.client()
    if (!client || stopped) return
    let moving: Move | null = null
    if (client.tabId() !== tabId) {
      // A first visit's welcome, or a server that no longer knew the tab: a tab copy under the new
      // id, written whole, and the old one deleted in the same transaction.
      const next = client.tabId()
      moving = move ? await move(next) : null
      if (!moving) return stop('failed')
      tabId = next
      copy = new TabCopy()
      heard = []
    }
    const written = copy.write(client.save(), heard.splice(0))
    // Nothing changed (a status the tab was told of): the row keeps when the tab copy last changed.
    if (!moving && written.put.size === 0 && written.remove.length === 0) return
    lastWrite = now()
    try {
      await putWrite(db, { tabId: tabId as number, member, written: lastWrite }, written, moving?.from)
    } catch (error) {
      moving?.failed()
      // What the tab copy remembers writing no longer matches the device: no more writes.
      return stop(error instanceof DOMException && error.name === 'QuotaExceededError' ? 'full' : 'failed')
    }
    moving?.moved()
    for (const listener of writeListeners) listener(written)
  }

  /**
   * Stops writing. What the tab copy holds no longer follows the client: its open step, sent once
   * no longer held, would come back older after a reload. So it is deleted; a device that can't
   * even delete keeps every send waiting.
   */
  function stop(why: KeptStop) {
    if (stopped) return
    stopped = why
    clearTimeout(timer)
    timer = undefined
    deleted = tabId === undefined ? Promise.resolve() : deleteCopy(db, tabId).catch(() => new Promise<void>(() => {}))
    void deleted.then(() => settleFlushes(Infinity))
    for (const listener of stopListeners) listener(why)
  }

  /** Writes what is due at once; resolves once the first write that starts from now is done. */
  function flushed(): Promise<void> {
    if (deleted) return deleted
    if (ended) return Promise.resolve()
    let upTo: number
    if (writing) {
      urgent = true
      upTo = started + 1
    } else if (timer !== undefined) {
      startWrite()
      upTo = started
    } else return Promise.resolve()
    return new Promise((resolve) => flushes.push({ upTo, resolve }))
  }

  return {
    stopped: () => stopped,
    onStop(listener) {
      stopListeners.add(listener)
      return () => stopListeners.delete(listener)
    },
    onWrite(listener) {
      writeListeners.add(listener)
      return () => writeListeners.delete(listener)
    },
    flushed,
    stop,
    async end() {
      schedule()
      await flushed()
      ended = true
      for (const off of unlisten.splice(0)) off()
    },
  }
}

/** The change sets a message gives the confirmed design, in order: what the tab copy's log takes. */
function acceptedIn(message: ServerMessage): Accepted[] {
  if (message.type === 'accepted') {
    const { seq, author, changeSetId, changes } = message
    return [{ seq, author, changeSetId, changes }]
  }
  if (message.type === 'welcome' && 'changeSets' in message.catchUp) return message.catchUp.changeSets
  return []
}

function openDatabase(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  const opening = factory.open(name, 1)
  opening.onupgradeneeded = () => {
    opening.result.createObjectStore(ENTRIES)
    opening.result.createObjectStore(TABS, { keyPath: 'tabId' })
  }
  return request(opening)
}

/** Every entry of `tabId`'s tab copy, by its key. */
async function readEntries(db: IDBDatabase, tabId: number): Promise<Entries> {
  const store = db.transaction(ENTRIES).objectStore(ENTRIES)
  const range = rangeOf(tabId)
  const [keys, values] = await Promise.all([request(store.getAllKeys(range)), request(store.getAll(range))])
  return new Map(keys.map((key, at) => [(key as [number, string])[1], values[at]]))
}

/** Puts one write of a tab copy and its row, in one transaction; deletes the tab copy of `replacing` in it too. */
function putWrite(db: IDBDatabase, row: TabRow, written: TabCopyWrite, replacing?: number): Promise<void> {
  const tx = db.transaction([ENTRIES, TABS], 'readwrite')
  const done = committed(tx)
  try {
    const entries = tx.objectStore(ENTRIES)
    if (replacing !== undefined) {
      entries.delete(rangeOf(replacing))
      tx.objectStore(TABS).delete(replacing)
    }
    for (const key of written.remove) entries.delete([row.tabId, key])
    for (const [key, value] of written.put) entries.put(value, [row.tabId, key])
    tx.objectStore(TABS).put(row)
  } catch (error) {
    done.catch(() => {})
    tx.abort()
    return Promise.reject(error instanceof Error ? error : new Error(String(error)))
  }
  return done
}

/** Deletes `tabId`'s tab copy. */
function deleteCopy(db: IDBDatabase, tabId: number): Promise<void> {
  const tx = db.transaction([ENTRIES, TABS], 'readwrite')
  tx.objectStore(ENTRIES).delete(rangeOf(tabId))
  tx.objectStore(TABS).delete(tabId)
  return committed(tx)
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'))
  })
}

function committed(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    const fail = () => reject(tx.error ?? new DOMException('the transaction was aborted', 'AbortError'))
    tx.onerror = fail
    tx.onabort = fail
  })
}
