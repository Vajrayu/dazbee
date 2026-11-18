import { describe, expect, it } from 'vitest'

import { MASCOT_POSES } from '@/components/ui/mascot.tsx'

import { BEE_STAYS_MS, beeAfter, FAILURE_LOOK, failureOf, leaveWait, OPENING_POSES } from './design-opening.ts'

const SHOWN = 1000

describe('FAILURE_LOOK', () => {
  it('shows a lock for a design out of reach, the offline bee offline, and the dizzy bee for the rest', () => {
    expect(FAILURE_LOOK.Deleted.pose).toBe('lock')
    expect(FAILURE_LOOK.NoAccess.pose).toBe('lock')
    expect(FAILURE_LOOK.offline.pose).toBe('offline')
    expect(FAILURE_LOOK.Outdated.pose).toBe('dizzy')
    expect(FAILURE_LOOK.Replaced.pose).toBe('dizzy')
    expect(FAILURE_LOOK.error.pose).toBe('dizzy')
    for (const { pose } of Object.values(FAILURE_LOOK)) expect(MASCOT_POSES).toContain(pose)
  })

  it('keeps each failure its way on: back to the designs, a reload, or trying again', () => {
    expect(FAILURE_LOOK.Deleted.then).toBe('back')
    expect(FAILURE_LOOK.NoAccess.then).toBe('back')
    expect(FAILURE_LOOK.Outdated.then).toBe('reload')
    expect(FAILURE_LOOK.Replaced.then).toBe('reload')
    expect(FAILURE_LOOK.offline.then).toBe('tryAgain')
    expect(FAILURE_LOOK.error.then).toBe('tryAgain')
  })
})

describe('OPENING_POSES', () => {
  it('is the flying bee and the bee of each failure, once each, for the offline worker to keep', () => {
    expect([...OPENING_POSES].sort()).toEqual(['dizzy', 'fly', 'lock', 'offline'])
  })
})

describe('leaveWait', () => {
  it('waits for the design while it is not ready, however long that takes', () => {
    expect(leaveWait({ shownAt: SHOWN, readyAt: null }, SHOWN + 60_000)).toBeNull()
  })

  it('leaves at 800 ms when the design is ready sooner', () => {
    expect(leaveWait({ shownAt: SHOWN, readyAt: SHOWN + 100 }, SHOWN + 100)).toBe(BEE_STAYS_MS - 100)
  })

  it('leaves when the design is ready, when that is after 800 ms', () => {
    expect(leaveWait({ shownAt: SHOWN, readyAt: SHOWN + 2500 }, SHOWN + 2500)).toBe(0)
  })

  it('leaves at once when its time has passed by the time it is asked', () => {
    expect(leaveWait({ shownAt: SHOWN, readyAt: SHOWN + 100 }, SHOWN + 5000)).toBe(0)
  })
})

describe('beeAfter', () => {
  it('flies off when its time comes, however late, and is gone only once the flight ends', () => {
    expect(beeAfter('shown', 'flown')).toBe('shown')
    const leaving = beeAfter('shown', 'leave')
    expect(leaving).toBe('leaving')
    expect(beeAfter(leaving, 'leave')).toBe('leaving')
    expect(beeAfter(leaving, 'flown')).toBe('gone')
  })

  it('is gone at once when the design fails to open, and never comes back', () => {
    expect(beeAfter('shown', 'failed')).toBe('gone')
    expect(beeAfter('leaving', 'failed')).toBe('gone')
    expect(beeAfter('gone', 'leave')).toBe('gone')
  })
})

describe('failureOf', () => {
  it('is null while the design opens or is open', () => {
    for (const status of ['Starting', 'Loading renderer', 'Connecting', 'Saved', 'Saving', 'Offline', 'ViewOnly'])
      expect(failureOf(status, { online: true, stuckOffline: false })).toBeNull()
  })

  it('names each state the sync server stopped the tab in', () => {
    for (const status of ['Deleted', 'NoAccess', 'Outdated', 'Replaced'] as const)
      expect(failureOf(status, { online: true, stuckOffline: false })).toBe(status)
  })

  it('reads a start that could not reach the server, or failed offline, as offline', () => {
    const online = { online: true, stuckOffline: false }
    expect(failureOf('Error: Failed to fetch', online)).toBe('offline')
    expect(failureOf('Error: NetworkError when attempting to fetch resource.', online)).toBe('offline')
    expect(failureOf('Error: Load failed', online)).toBe('offline')
    expect(failureOf('Error: the font did not load', { online: false, stuckOffline: false })).toBe('offline')
  })

  it('reads any other start error as an error', () => {
    expect(failureOf('Error: the font did not load', { online: true, stuckOffline: false })).toBe('error')
  })

  it('reads a first visit still connecting with no network as offline', () => {
    expect(failureOf('Connecting', { online: false, stuckOffline: true })).toBe('offline')
    expect(failureOf('Connecting', { online: false, stuckOffline: false })).toBeNull()
  })
})
