// The stores tests open: a plain store on a local server, copies of one, and another tab on one.
// A test that needs the sync core's own parts opens them itself (openLocalServer, openClient).
import { type DesignInput, parseDesign } from '@dazbee/schema'

import { type HeldTab, type PlainStore, plainStore } from './plain-store.ts'
import type { DesignStore } from './store.ts'
import { openTestSession, shapesDesign, testDesign } from './test-design.ts'
import { expectInvariants } from './test-invariants.ts'

/**
 * A plain store holding `design`, the test design unless given: a scratch store, so a change set
 * its server rejects faults the command.
 */
export function openTestStore(design: DesignInput = testDesign()): PlainStore {
  const result = parseDesign(design)
  if (!result.success) throw new Error(result.errors.join('\n'))
  return plainStore(result.design, { scratch: true })
}

/** The plain store openTestStore opens, by the name tests of the plain store itself give it. */
export const openPlainStore = openTestStore

/** A store holding what `store` holds now, so a test can run cases on copies of one state. */
export function forkTestStore(store: DesignStore): DesignStore {
  return plainStore(store.snapshot(), { scratch: true })
}

/**
 * Another tab on the design `store` holds, as the sync server joins two. The other tab joins
 * `store`'s server and its sends wait for `deliver`, while what `store` writes reaches it at once.
 */
export function anotherTab(store: DesignStore): { store: HeldTab; deliver: () => void } {
  if (!('server' in store)) throw new Error('another tab joins a plain store on a local server')
  const other = (store as PlainStore).server.join({ held: true })
  return { store: other, deliver: () => other.deliver() }
}

/** A session on a store holding shapesDesign(). */
export function openShapes() {
  const store = openTestStore(shapesDesign())
  return { store, tab: openTestSession(store) }
}

/**
 * Two tabs on one design (the test design unless given), joined to one local server: what the first
 * writes reaches the second at once, and the second's steps reach the first when `sync` delivers
 * them. `sync` checks both tabs' designs after.
 */
export function twoTabs(design?: DesignInput) {
  const a = openTestStore(design)
  const other = anotherTab(a)
  const b = other.store
  const tabA = openTestSession(a)
  const tabB = openTestSession(b)
  const sync = () => {
    other.deliver()
    expectInvariants(tabA.design())
    expectInvariants(tabB.design())
  }
  return { a, b, tabA, tabB, sync }
}
