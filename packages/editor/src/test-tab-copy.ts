// The device copy's tests' browser: fake-indexeddb, the Web Locks stand-in and links to the core's
// design host in memory, with pages of the design in browser tabs. A browser tab is a
// `sessionStorage` of its own; a reload is a new page on the same one, after the old page let go of
// its locks. IndexedDB's own scheduling (setImmediate) runs on real time, the links' on fake time.
import 'fake-indexeddb/auto'

import { IDBFactory } from 'fake-indexeddb'
import { vi } from 'vitest'

import type { Client, SavedClient } from '@dazbee/doc'
import type { Change, Member, TabMessage } from '@dazbee/schema'

import { openSyncLink, type SyncLink } from './sync-link.ts'
import { type Kept, openTabCopies, type TabCopies } from './tab-copy.ts'
import { type MemorySync, memorySync } from './test-link.ts'
import { type TestLocks, testLocks } from './test-locks.ts'

export const ANN: Member = { userId: 'ann', workspaceId: 'w1' }
export const BOB: Member = { userId: 'bob', workspaceId: 'w1' }
export const rename = (id: string, to: string): Change => ({ op: 'set', value: { part: 'layer', id, key: 'name' }, to })

/** A browser tab's `sessionStorage`. */
export function session() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    values,
  }
}
export type Session = ReturnType<typeof session>

export interface Page {
  copies: TabCopies
  link: SyncLink
  kept: Kept
  saved: SavedClient | undefined
  client(): Client
  /** One step that renames `id`. */
  step(id: string, to: string): void
  /** The page goes: its link is destroyed, what is due written, and its locks let go. */
  unload(): Promise<void>
  /** The page dies at once: nothing more is written. */
  crash(): void
}

/** One browser, and the sync server its pages connect to. */
export interface TestBrowser {
  /** The sync server: a test may put a new one in its place. */
  mem: MemorySync
  factory: IDBFactory
  locks: TestLocks
  /**
   * Lets `ms` of fake time pass, and what it set going run: deliveries, writes, IndexedDB's turns.
   * A timer set for 0 ms while fake time runs is due 1 ms later, so each turn lets 1 ms pass.
   */
  settle(ms?: number): Promise<void>
  /** A link as the tab copies' `sendOthers` opens one for another tab copy, or as another tab. */
  linkFor(token: string, start?: SavedClient): SyncLink
  /** A page of the design in a browser tab (`tab`), as `member`, connected. */
  page(tab: Session, member?: Member): Promise<Page>
  /** The same, still connecting. */
  openPage(tab: Session, member?: Member): Promise<Page>
  /** The tab copies' rows in the database, by tab id. */
  rows(): Promise<number[]>
  /** The change sets sent on the sockets of tab `tabId`. */
  changeSetsOf(tabId: number): TabMessage[]
  /** Destroys every link made. */
  destroy(): void
}

export function testBrowser(): TestBrowser {
  const open: SyncLink[] = []
  const b: TestBrowser = {
    mem: memorySync(),
    factory: new IDBFactory(),
    locks: testLocks(),
    async settle(ms = 0) {
      await vi.advanceTimersByTimeAsync(ms)
      for (let n = 0; n < 30; n++) {
        await b.mem.settle()
        await new Promise((resolve) => setImmediate(resolve))
        await vi.advanceTimersByTimeAsync(1)
      }
    },
    linkFor(token, start) {
      const link = openSyncLink({
        url: 'ws://s',
        designId: 'd1',
        token: () => Promise.resolve(token),
        socket: (url) => b.mem.socket(url),
        random: () => 0.001,
        ...(start ? { start } : {}),
      })
      open.push(link)
      return link
    },
    async page(tab, member = ANN) {
      const p = await b.openPage(tab, member)
      await b.settle()
      return p
    },
    async openPage(tab, member = ANN) {
      const pageLocks = b.locks.tab()
      const copies = await openTabCopies({
        designId: 'd1',
        member,
        indexedDB: b.factory,
        locks: pageLocks,
        session: tab,
      })
      if (copies === 'off') throw new Error('no device copy')
      const saved = await copies.takeUp()
      const link = b.linkFor(member.userId, saved)
      const kept = copies.keep(link)
      link.connect()
      const client = () => link.client() as Client
      return {
        copies,
        link,
        kept,
        saved,
        client,
        step(id, to) {
          client().open()
          client().write(rename(id, to))
          link.send(client().end('Rename'))
        },
        async unload() {
          link.destroy()
          await copies.close()
          b.locks.dropAll(pageLocks)
          await b.settle()
        },
        crash() {
          link.destroy()
          b.locks.dropAll(pageLocks)
        },
      }
    },
    async rows() {
      const db = await new Promise<IDBDatabase>((resolve) => {
        const req = b.factory.open('dazbee-tabs-d1')
        req.onsuccess = () => resolve(req.result)
      })
      const keys = await new Promise<IDBValidKey[]>((resolve) => {
        const req = db.transaction('tabs').objectStore('tabs').getAllKeys()
        req.onsuccess = () => resolve(req.result)
      })
      db.close()
      return (keys as number[]).sort()
    },
    changeSetsOf: (tabId) =>
      b.mem.sockets.flatMap((s) =>
        s.sent.some((m) => m.type === 'hello' && m.resume?.tabId === tabId) ||
        s.got.some((m) => m.type === 'welcome' && m.tabId === tabId)
          ? s.sent.filter((m) => m.type === 'changes')
          : [],
      ),
    destroy() {
      for (const link of open.splice(0)) link.destroy()
    },
  }
  return b
}
