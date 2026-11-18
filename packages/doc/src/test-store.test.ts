// The stores tests open: a plain store, copies of one, and another tab on one.
import { describe, expect, it } from 'vitest'

import { readDesign } from './store.ts'
import { openTestSession } from './test-design.ts'
import { anotherTab, forkTestStore, openTestStore } from './test-store.ts'

describe('the test store', () => {
  it('copies a store whole, and the copy is edited on its own', () => {
    const store = openTestStore()
    const copy = forkTestStore(store)
    expect(readDesign(copy)).toEqual(readDesign(store))
    openTestSession(copy).run('node.update', { ids: ['box'], patch: { x: 7 } })
    expect(readDesign(store).nodes.box?.props.x).not.toBe(7)
  })

  it('gives another tab on a store, whose writes reach the store only when delivered', () => {
    const store = openTestStore()
    const tab = openTestSession(store)
    const other = anotherTab(store)
    openTestSession(other.store).run('node.update', { ids: ['box'], patch: { x: 7 } })
    expect(readDesign(store).nodes.box?.props.x).not.toBe(7)
    other.deliver()
    expect(readDesign(store).nodes.box?.props.x).toBe(7)
    // Another tab's write is not this tab's to undo.
    expect(tab.canUndo()).toBe(false)
  })
})
