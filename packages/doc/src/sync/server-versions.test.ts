// The sync core's server on the design's versions: when the design counts as changed, the versions
// it takes, and a tab's ask for a version.
import { describe, expect, it } from 'vitest'

import type { RestoreMark } from '@dazbee/schema'

import { openServer } from './server.ts'
import { changes, fresh, joined, nameOf, send, set, testOptions, viewer } from './test-server.ts'

const MARK: RestoreMark = { versionId: 'v1', kind: 'named', name: 'Sent', takenAt: '2026-11-16T14:30:00.000Z' }

describe('openServer', () => {
  describe('versions', () => {
    it('counts the design changed from its first change set after a version, takes one only while changed, and saves the mark', () => {
      const clock = { now: 1000 }
      const server = openServer(fresh(), testOptions(clock))
      const a = joined(server)
      expect(server.changedSince()).toBeUndefined()
      server.takeAutosave()
      expect(server.takeVersions()).toEqual([])
      clock.now = 2000
      send(server, a.tabId, 1, [set(nameOf('badge'), 'One')])
      clock.now = 3000
      send(server, a.tabId, 2, [set(nameOf('badge'), 'Two')])
      expect(server.changedSince()).toBe(2000)
      server.takeAutosave()
      expect(server.takeVersions()).toMatchObject([{ kind: 'auto', seq: 2, records: server.state().toRecords() }])
      expect([server.changedSince(), server.save().versioned]).toEqual([undefined, 2])
    })

    it('takes the design as it was before an accepted restore, and counts it unchanged after', () => {
      const server = openServer(fresh(), testOptions())
      const a = joined(server)
      send(server, a.tabId, 1, [set(nameOf('badge'), 'Changed')])
      const before = server.state().toRecords()
      server.receive(a.tabId, { ...changes(2, 1, [set(nameOf('badge'), 'Old')]), restore: MARK }, 100)
      expect(server.takeVersions()).toMatchObject([{ kind: 'beforeRestore', seq: 1, keep: 'v1', records: before }])
      expect([server.changedSince(), server.save().versioned]).toEqual([undefined, 2])
    })

    it('opens unchanged at its fold’s mark or its newest version’s under its sync id, and changed otherwise', () => {
      const at = (lastVersion: { syncId: string; seq: number } | null, versioned = 0) => {
        const loaded = fresh()
        const server = openServer(
          { ...loaded, saved: { ...loaded.saved, seq: 3, versioned }, lastVersion },
          testOptions(),
        )
        return server.changedSince()
      }
      expect([at(null, 3), at({ syncId: 's0', seq: 3 }), at({ syncId: 'other', seq: 3 }), at(null)]).toEqual([
        undefined,
        undefined,
        1000,
        1000,
      ])
    })

    it('hands the host a version asked for, by any tab, a Reviewer’s too', () => {
      const server = openServer(fresh(), testOptions())
      const v = joined(server, viewer())
      expect(server.receive(v.tabId, { type: 'version', id: 'v1' }, 30)).toEqual([])
      expect(server.takeReads()).toEqual([{ tabId: v.tabId, id: 'v1' }])
      expect(server.takeReads()).toEqual([])
    })
  })
})
