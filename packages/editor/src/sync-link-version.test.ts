// The sync link asking the core's sync server in memory for a version of the design: the answer
// for that version, none for one the design lacks, and no answer once the connection ends.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SCHEMA_VERSION } from '@dazbee/schema'

import { openSyncLink, type SyncLink, VersionUnanswered } from './sync-link.ts'
import { type MemorySync, memorySync } from './test-link.ts'

let mem: MemorySync
const links: SyncLink[] = []

beforeEach(() => {
  vi.useFakeTimers()
  mem = memorySync()
})
afterEach(() => {
  for (const link of links.splice(0)) link.destroy()
  vi.useRealTimers()
})

/** A link to the server in memory as the token's member, connected. */
async function linked(token = 'ann') {
  const link = openSyncLink({
    url: 'ws://sync.test',
    designId: 'd1',
    token: () => Promise.resolve(token),
    socket: mem.socket,
    random: () => 1,
  })
  links.push(link)
  link.connect()
  await mem.settle()
  return link
}

describe('askVersion', () => {
  /** Keeps the design as the server holds it now as version `v1`, with layer `box` named `name`. */
  const keepVersion = (name: string) => {
    const records = mem.state()
    const layer = records.nodes.box as { name: string } | undefined
    if (layer) layer.name = name
    mem.journal.rows.versions.push({
      id: `v${mem.journal.rows.versions.length + 1}`,
      kind: 'named',
      name: 'Kept',
      description: '',
      savedBy: 'ann',
      syncId: 's0',
      seq: 0,
      schemaVersion: SCHEMA_VERSION,
      records,
      keep: null,
    })
    return records
  }

  it('resolves with the version’s records and the schema version they were stored under, and null for none of the design', async () => {
    const records = keepVersion('Kept title')
    const link = await linked('viewer')
    const asked = link.askVersion('v1')
    const twice = link.askVersion('v1')
    const none = link.askVersion('v9')
    await mem.settle()
    expect(await asked).toEqual({ design: records, schemaVersion: SCHEMA_VERSION })
    expect(await twice).toEqual(await asked)
    expect(await none).toBeNull()
    // The two asks for one version went as one message.
    expect(mem.sockets[0]?.sent.filter((m) => m.type === 'version')).toEqual([
      { type: 'version', id: 'v1' },
      { type: 'version', id: 'v9' },
    ])
  })

  it('rejects when the connection drops before the answer comes, and at once while not connected', async () => {
    keepVersion('Kept title')
    const link = await linked()
    mem.sockets[0]?.hold()
    const asked = link.askVersion('v1')
    await mem.settle()
    mem.sockets[0]?.cut()
    await expect(asked).rejects.toThrow(VersionUnanswered)
    link.disconnect()
    await expect(link.askVersion('v1')).rejects.toThrow(VersionUnanswered)
  })
})
