// What the sync server's tests share: designs stored as the sync server keeps them, sockets that read
// back the frames they are sent, and a tab's messages.
import { randomUUID } from 'node:crypto'
import { gunzipSync } from 'node:zlib'

import { brands, createDesignSave, designs, migrateDatabase, workspaces } from '@dazbee/db'
import { firstSaved } from '@dazbee/doc/sync'
import {
  type Change,
  type DesignRecords,
  type Member,
  PROTOCOL,
  type Resume,
  SCHEMA_VERSION,
  type ServerMessage,
} from '@dazbee/schema'

import type { Socket } from './design-host.ts'
import { db, run, who } from './test-sync.ts'

/** A socket as the design host sees it: every frame it was sent, read back, and how it was closed. */
export interface TestSocket extends Socket {
  frames: (string | Uint8Array)[]
  heard(): ServerMessage[]
  closed?: { code: number; reason: string }
}

export const ANN: Member = { userId: 'user-1', workspaceId: who.workspaceId }
export const BOB: Member = { userId: 'user-2', workspaceId: who.workspaceId }
export const editor = (member: Member = ANN) => ({ member, name: member.userId, access: 'edit' as const })

/** A design of one page holding frame `f`, which holds `layers` boxes `l0`, `l1` …. */
export function records(layers = 2): DesignRecords {
  const nodes: Record<string, unknown> = {}
  for (let i = 0; i < layers; i++) {
    nodes[`l${i}`] = {
      type: 'graphic',
      parentId: 'f',
      link: `l${i}`,
      index: `a${i}`,
      name: 'Box',
      props: { x: 10, y: 10, width: 40, height: 40, shape: { kind: 'rect' } },
    }
  }
  return {
    meta: { designId: 'design', name: 'Stored' },
    pages: { p1: { name: 'Page 1', order: 'a0' } },
    frames: { f: { pageId: 'p1', name: 'Square', width: 100, height: 100, x: 0, y: 0, fills: [], order: 'a0' } },
    nodes,
  }
}

/** A design stored with its first state, as the API will write it at create: its id. */
export async function storeSaved(state: DesignRecords = records()): Promise<string> {
  await migrateDatabase(db)
  await db.insert(workspaces).values({ id: who.workspaceId, name: 'Workspace' }).onConflictDoNothing()
  await db
    .insert(brands)
    .values({ id: `brand-${run}`, workspaceId: who.workspaceId, name: 'Brand' })
    .onConflictDoNothing()
  const id = `design-${randomUUID().slice(0, 8)}`
  await db.insert(designs).values({
    id,
    workspaceId: who.workspaceId,
    brandId: `brand-${run}`,
    name: 'New',
    schemaVersion: SCHEMA_VERSION,
  })
  await createDesignSave(db, id, firstSaved(state, `sync-${randomUUID().slice(0, 8)}`))
  return id
}

export function socket(): TestSocket {
  const s: TestSocket = {
    frames: [],
    heard: () =>
      s.frames.map(
        (frame) => JSON.parse(typeof frame === 'string' ? frame : gunzipSync(frame).toString('utf8')) as ServerMessage,
      ),
    send: (frame) => {
      if (s.closed) throw new Error(`sent after the socket closed with ${s.closed.code}`)
      s.frames.push(frame)
    },
    close: (code, reason) => {
      // The first close is the one a tab sees.
      s.closed ??= { code, reason }
    },
  }
  return s
}

export const hello = (resume?: Resume, waiting = 0) => ({
  type: 'hello',
  protocol: PROTOCOL,
  token: 't',
  waiting,
  ...(resume ? { resume } : {}),
})

export const rename = (id: string, to: string): Change => ({ op: 'set', value: { part: 'layer', id, key: 'name' }, to })

export const changes = (id: number, base: number, list: Change[]) => ({
  type: 'changes',
  id,
  base,
  kind: 'edit',
  changes: list,
})

/** The welcome a socket heard. */
export function welcomeOf(s: TestSocket) {
  const welcome = s.heard().find((m) => m.type === 'welcome')
  if (!welcome || welcome.type !== 'welcome') throw new Error('no welcome')
  return welcome
}

/** The types of the messages a socket heard. */
export const typesOf = (s: TestSocket) => s.heard().map((m) => m.type)

/** A resume of the tab `s` was welcomed as, at sequence number `seq`. */
export function resumeOf(s: TestSocket, seq: number): Resume {
  const { syncId, tabId, secret } = welcomeOf(s)
  return { syncId, tabId, seq, secret }
}

/** Deletes a design, as the API does: its stored rows go with it. */
export async function deleteDesign(designId: string) {
  if (!/^[\w-]+$/.test(designId)) throw new Error('not a test design id')
  await db.execute(`delete from designs where id = '${designId}'`)
}
