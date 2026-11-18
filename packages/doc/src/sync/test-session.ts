// A sync server and tabs wired by hand, for tests that order each message themselves (the
// simulator orders them at random). Every message goes through JSON on its way.
import type { Change, DesignInput, DesignRecords, Member, ServerMessage } from '@dazbee/schema'
import { PROTOCOL } from '@dazbee/schema'

import { testDesign } from '../test-design.ts'
import { utf8Length } from './checks.ts'
import { type Client, type ClientOptions, openClient, type Outgoing as TabOutgoing } from './client.ts'
import { firstSaved } from './journal.ts'
import { openServer, type Outgoing, type Server, type ServerOptions, type Who } from './server.ts'

/** The member every test tab is for, unless given. */
export const ANN: Member = { userId: 'ann', workspaceId: 'w1' }

/** The options a test server opens with: a readable hash, counted secrets and sync ids. */
export function testServerOptions(more: Partial<ServerOptions> = {}): ServerOptions {
  let secrets = 0
  let syncIds = 0
  return {
    hashSecret: (secret) => `hash:${secret}`,
    newSecret: () => `secret${++secrets}`,
    newSyncId: () => `sync${++syncIds}`,
    now: () => 1000,
    ...more,
  }
}

/** A server on `design` (the test design unless given), never opened before. */
export function testServer(design: DesignInput = testDesign(), options: Partial<ServerOptions> = {}): Server {
  const saved = firstSaved(design as unknown as DesignRecords, 's0')
  return openServer({ saved, journal: [], lastEntry: 0 }, testServerOptions(options))
}

/** Who a test tab is: an editor for `member` unless told otherwise. */
export function who(member: Member = ANN, access: Who['access'] = 'edit'): Who {
  return { member, name: member.userId, access }
}

/** A tab that joined `server` as new. */
export function joinClient(server: Server, as: Who = who(), options: ClientOptions = {}): Client {
  const joined = server.join(wire({ type: 'hello', protocol: PROTOCOL, token: 't', waiting: 0 }), as)
  if ('close' in joined) throw new Error(joined.reason)
  return openClient(wire(joined.out[0]?.message as ServerMessage), options)
}

/** Runs one step on `c` that writes `changes`, named `name`; returns what it sends. */
export function edit(c: Client, name: string | null, ...changes: Change[]): TabOutgoing[] {
  c.open()
  for (const change of changes) c.write(change)
  return c.end(name)
}

/** Sends `messages` from `c` to the server; returns what the server sends back. */
export function up(server: Server, c: Client, messages: readonly TabOutgoing[]): Outgoing[] {
  return messages.flatMap((message) => {
    const text = JSON.stringify(message)
    const out = server.receive(c.tabId(), JSON.parse(text), utf8Length(text))
    if ('close' in out) throw new Error(out.reason)
    return out
  })
}

/** Delivers to `c` what in `out` is for it; returns what it sends then. */
export function down(c: Client, out: readonly Outgoing[]): TabOutgoing[] {
  return out.flatMap(({ to, except, message }) =>
    (to === 'all' || to === c.tabId()) && except !== c.tabId() ? c.receive(wire(message)) : [],
  )
}

/** Sends `messages` from `c` and delivers the server's answers to every tab given, until nothing more is sent. */
export function exchange(server: Server, c: Client, messages: readonly TabOutgoing[], everyone: readonly Client[]) {
  let waiting: [Client, TabOutgoing[]][] = [[c, [...messages]]]
  while (waiting.length > 0) {
    const next: [Client, TabOutgoing[]][] = []
    for (const [from, sent] of waiting) {
      const out = up(server, from, sent)
      for (const other of everyone) next.push([other, down(other, out)])
    }
    waiting = next.filter(([, sent]) => sent.length > 0)
  }
}

/** `c` comes back after a dropped connection, as `as`: it says hello again and gets its welcome. Returns what it sends then. */
export function comeBack(server: Server, c: Client, as: Who = who()): TabOutgoing[] {
  server.leave(c.tabId())
  c.disconnect()
  const joined = server.join(wire(c.reconnect('t')), as)
  if ('close' in joined) throw new Error(joined.reason)
  return joined.out.flatMap(({ to, message }) => (to === joined.tabId ? c.receive(wire(message)) : []))
}

/** A message as it arrives after its trip through JSON. */
export function wire<T>(message: T): T {
  return JSON.parse(JSON.stringify(message)) as T
}
