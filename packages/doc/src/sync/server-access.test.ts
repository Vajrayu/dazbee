// The sync core's server on a tab's access (D10) and its previews' rate (D7, D11).
import { describe, expect, it } from 'vitest'

import { openServer } from './server.ts'
import { BOB, editor, fresh, joined, nameOf, send, set, testOptions, to } from './test-server.ts'

describe('openServer', () => {
  describe('previews (D7)', () => {
    it('passes on at most so many previews a second from each tab, and drops the rest', () => {
      const clock = { now: 1000 }
      const server = openServer(fresh(), { ...testOptions(clock), limits: { previewsPerSecond: 3 } })
      const a = joined(server)
      const b = joined(server, editor(BOB))
      const preview = (after: number) => ({ type: 'preview', after, changes: [] })
      const passed = () => [1, 2, 3, 4, 5].filter((n) => to(b.tabId, server.receive(a.tabId, preview(n), 10)).length)
      expect(passed()).toEqual([1, 2, 3])
      // Another tab's previews count on their own.
      expect(to(a.tabId, server.receive(b.tabId, preview(1), 10))).toHaveLength(1)
      clock.now += 999
      expect(passed()).toEqual([])
      clock.now += 1
      expect(passed()).toEqual([1, 2, 3])
    })
  })

  describe('access', () => {
    it('takes a role change at once, and tells the tab when its access changed', () => {
      const server = openServer(fresh(), testOptions())
      const a = joined(server)
      expect(server.setAccess(a.tabId, 'edit')).toEqual([])
      expect(to(a.tabId, server.setAccess(a.tabId, 'view'))).toEqual([{ type: 'access', access: 'view' }])
      expect(send(server, a.tabId, 1, [set(nameOf('badge'), 'B')])).toEqual([
        { type: 'reject', changeSetId: 1, reason: 'viewOnly' },
      ])
      expect(to(a.tabId, server.setAccess(a.tabId, 'edit'))).toEqual([{ type: 'access', access: 'edit' }])
      expect(send(server, a.tabId, 2, [set(nameOf('badge'), 'B')])).toMatchObject([{ type: 'accepted' }])
    })

    it('changes nothing for a tab not connected', () => {
      const server = openServer(fresh(), testOptions())
      const a = joined(server)
      server.leave(a.tabId)
      expect(server.setAccess(a.tabId, 'view')).toEqual([])
      expect(server.setAccess(99, 'view')).toEqual([])
    })
  })
})
