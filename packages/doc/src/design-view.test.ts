import { describe, expect, it } from 'vitest'

import { designView } from './design-view.ts'
import type { Session } from './session.ts'
import { openTestSession } from './test-design.ts'
import { openTestStore, twoTabs } from './test-store.ts'

describe("a session's design view", () => {
  it('is current inside a transaction: read in a batch, it shows what the batch has written so far', () => {
    const { tabA } = twoTabs()
    tabA.batch(() => {
      tabA.run('node.update', { ids: ['box'], patch: { x: 7 } })
      expect(tabA.design().nodes.box?.props.x).toBe(7)
      expect(tabA.design().nodes.headline).toBeDefined()
    })
  })

  it('hands out a live design: one read before an edit shows the edit, and a layer kept from before stays as it was', () => {
    const { tabA, tabB, sync } = twoTabs()
    const design = tabA.design()
    const box = design.nodes.box
    tabA.run('node.update', { ids: ['box'], patch: { x: 7 } })
    tabB.run('page.add', {
      id: 'p2',
      name: 'Page 2',
      frame: { id: 'p2-sq', name: 'Square', width: 1080, height: 1080 },
    })
    sync()
    expect(design.nodes.box?.props.x).toBe(7)
    expect(design.frames['p2-sq']).toMatchObject({ pageId: 'p2', x: 0, y: 0 })
    expect(box?.props.x).toBe(100)
    tabA.run('node.delete', { ids: ['box'] })
    expect(Object.keys(design.nodes)).not.toContain('box')
  })

  it('hands out a design that cannot be changed, so no caller can corrupt what later reads reuse', () => {
    const { tabA } = twoTabs()
    const design = tabA.design()
    expect(() => {
      ;(design.nodes.box as { props: { width: number } }).props.width = -50
    }).toThrow()
    expect(() => {
      ;(design.nodes as Record<string, unknown>).ghost = {}
    }).toThrow()
    expect(() => {
      ;(design.frames as Record<string, unknown>).ghost = {}
    }).toThrow()
    expect(tabA.design().nodes.box?.props.width).toBe(200)
  })

  it('keeps every frame, page and meta an edit of one frame leaves as it was the same object, so what is built from them is kept', () => {
    const { tabA } = twoTabs()
    const before = tabA.design()
    const [banner, pages, meta] = [before.frames.banner, before.pages, before.meta]
    tabA.run('frame.update', { frameId: 'sq', width: 1000 })
    const after = tabA.design()
    expect(after.frames.sq?.width).toBe(1000)
    expect(after.frames.banner).toBe(banner)
    expect(after.pages).toBe(pages)
    expect(after.meta).toBe(meta)
  })

  it("counts the changes to the document, the tab's own and another tab's, and no read", () => {
    const { tabA, tabB, sync } = twoTabs()
    const opened = tabA.changes() ?? NaN
    tabA.design()
    expect(tabA.changes()).toBe(opened)
    tabA.run('node.update', { ids: ['box'], patch: { x: 7 } })
    const own = tabA.changes() ?? NaN
    expect(own).toBeGreaterThan(opened)
    tabB.run('node.update', { ids: ['box'], patch: { y: 9 } })
    sync()
    expect(tabA.changes()).toBeGreaterThan(own)
  })

  it('knows no count while a transaction is open, the batch it reads the writes of included, and one more after it', () => {
    const { tabA } = twoTabs()
    const before = tabA.changes()
    const inside: unknown[] = []
    tabA.batch(() => {
      inside.push(tabA.changes())
      tabA.run('node.update', { ids: ['box'], patch: { x: 7 } })
      inside.push(tabA.design().nodes.box?.props.x, tabA.changes())
      tabA.run('node.update', { ids: ['box'], patch: { y: 9 } })
    })
    expect(inside).toEqual([null, 7, null])
    expect(tabA.changes()).toBe((before ?? NaN) + 1)
  })

  it('is current for every listener of the store, added before the session opened or after', () => {
    const store = openTestStore()
    const seen: string[] = []
    const opened: Session[] = []
    const look = (who: string) => () => {
      const design = (opened[0] as Session).design()
      seen.push(`${who}: x ${design.nodes.box?.props.x}, ${design.nodes.c1 ? 'has' : 'no'} c1`)
    }
    store.onChange(look('before'))
    const tab = openTestSession(store)
    opened.push(tab)
    tab.design()
    store.onChange(look('after'))
    tab.run('node.update', { ids: ['box'], patch: { x: 7 } })
    tab.run('node.create', {
      id: 'c1',
      parentId: 'sq',
      layer: { type: 'group', name: 'G', props: { x: 0, y: 0, width: 1, height: 1 } },
    })
    expect(seen).toEqual(['before: x 7, no c1', 'after: x 7, no c1', 'before: x 7, has c1', 'after: x 7, has c1'])
  })
})

describe('designView, its revision', () => {
  /** A view on the test design's store, read once, and a session on it. */
  const viewed = () => {
    const store = openTestStore()
    const view = designView(store)
    view.read()
    return { store, view, session: openTestSession(store) }
  }

  it('stays as it was after a value set to what it was', () => {
    const { store, view } = viewed()
    view.read()
    const before = view.revision()
    store.transact(() => store.setProp('box', 'x', store.prop('box', 'x')))
    view.read()
    expect(view.revision()).toBe(before)
  })

  it.each([
    [
      'a layer that comes back',
      ({ session }: ReturnType<typeof viewed>) => {
        session.run('node.delete', { ids: ['box'] })
        return () => session.undo()
      },
    ],
    [
      'a frame renamed',
      ({ store }: ReturnType<typeof viewed>) =>
        () =>
          store.transact(() => store.set('frame', 'sq', 'name', 'Renamed')),
    ],
    [
      'a meta field changed',
      ({ store }: ReturnType<typeof viewed>) =>
        () =>
          store.transact(() => store.setMeta('name', 'Renamed')),
    ],
  ] as const)('goes up after %s', (_, setUp) => {
    const tab = viewed()
    const write = setUp(tab)
    tab.view.read()
    const before = tab.view.revision()
    write()
    tab.view.read()
    expect(tab.view.revision()).toBeGreaterThan(before)
  })
})
