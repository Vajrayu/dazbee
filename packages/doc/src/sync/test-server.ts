// What the sync core's server tests share: members, a fresh design, a tab's messages, and reading
// what the server sends each tab.
import type { Change, ChangeSetKind, DesignRecords, Member, Resume, ServerMessage, Target } from '@dazbee/schema'
import { PROTOCOL } from '@dazbee/schema'

import { linkedDesign } from '../test-design.ts'
import { firstSaved, type Loaded } from './journal.ts'
import { type Closing, openServer, type Outgoing, type Server, type ServerOptions, type Who } from './server.ts'

export const ANN: Member = { userId: 'ann', workspaceId: 'w1' }
export const BOB: Member = { userId: 'bob', workspaceId: 'w1' }
export const editor = (member: Member = ANN): Who => ({ member, name: member.userId, access: 'edit' })
export const viewer = (member: Member = BOB): Who => ({ member, name: member.userId, access: 'view' })

export const nameOf = (id: string): Target => ({ part: 'layer', id, key: 'name' })
export const parentOf = (id: string): Target => ({ part: 'layer', id, key: 'parentId' })
export const set = (value: Target, to: unknown): Change => ({ op: 'set', value, to })

/** The options a test server opens with: a readable hash, counted secrets and sync ids, a clock to move. */
export function testOptions(clock = { now: 1000 }): ServerOptions {
  let secrets = 0
  let syncIds = 0
  return {
    hashSecret: (secret) => `hash:${secret}`,
    newSecret: () => `secret${++secrets}`,
    newSyncId: () => `sync${++syncIds}`,
    now: () => clock.now,
  }
}

/** What a design no server has opened yet loads as. */
export function fresh(design: DesignRecords = linkedDesign() as unknown as DesignRecords): Loaded {
  return { saved: firstSaved(design, 's0'), journal: [], lastEntry: 0 }
}

export function hello(resume?: Resume, waiting = 0) {
  return resume
    ? { type: 'hello', protocol: PROTOCOL, token: 't', resume, waiting }
    : { type: 'hello', protocol: PROTOCOL, token: 't', waiting }
}

export function changes(id: number, base: number, list: Change[], kind: ChangeSetKind = 'edit') {
  return { type: 'changes', id, base, kind, changes: list }
}

/** Joins a tab, failing the test when it is closed instead: its id, welcome and secret. */
export function joined(server: Server, who: Who = editor(), resume?: Resume, waiting = 0) {
  const result = server.join(hello(resume, waiting), who)
  if ('close' in result) throw new Error(result.reason)
  const welcome = result.out[0]?.message as Extract<ServerMessage, { type: 'welcome' }>
  return { tabId: result.tabId, welcome, out: result.out }
}

/** The messages to tab `tabId` among `out`. */
export function to(tabId: number, out: Outgoing[] | Closing): ServerMessage[] {
  if ('close' in out) throw new Error(out.reason)
  return out.filter((o) => (o.to === 'all' || o.to === tabId) && o.except !== tabId).map((o) => o.message)
}

/** Sends a change set from `tabId` and gives what the tab hears back. */
export function send(server: Server, tabId: number, id: number, list: Change[], kind: ChangeSetKind = 'edit') {
  return to(tabId, server.receive(tabId, changes(id, server.seq(), list, kind), 100))
}

/** Reopens a server from what it saved and journaled, as after a restart. */
export function restart(server: Server, options = testOptions(), saved = server.save()): Server {
  return openServer({ saved, journal: server.takeJournal(), lastEntry: server.save().entry }, options)
}
