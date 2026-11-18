// Other tabs' previews as a tab's store gives them to the canvas (D7), on two tabs of a local server.
import { describe, expect, it } from 'vitest'

import { previewedDesign } from './previewed-design.ts'
import type { DesignStore, StorePreviews } from './store.ts'
import { twoTabs } from './test-store.ts'

const previewsOf = (store: DesignStore) => store.previews as StorePreviews
const xOf = (layer: unknown) => (layer as { props: { x: number } } | undefined)?.props.x

describe("a store's previews", () => {
  it("shows another tab's open drag to the canvas, never to the design, and drops it once the step lands", () => {
    const { a, b, tabA, tabB, sync } = twoTabs()
    const told: number[] = []
    previewsOf(a).onChange(() => told.push(previewsOf(a).revision()))
    const drag = tabB.beginGesture()
    tabB.run('node.update', { ids: ['box'], patch: { x: 300 } })
    b.preview()
    expect(xOf(previewsOf(a).layers().get('box'))).toBe(300)
    expect(tabA.design().nodes.box?.props.x).toBe(100)
    expect(previewedDesign(tabA.design(), previewsOf(a).layers()).nodes.box?.props.x).toBe(300)
    expect(told).toEqual([1])
    drag.end()
    sync()
    expect(previewsOf(a).layers().size).toBe(0)
    expect(tabA.design().nodes.box?.props.x).toBe(300)
    expect(told.length).toBe(2)
  })

  it("draws the tab's own open step over another tab's preview of the same layer (C41)", () => {
    const { a, b, tabA, tabB } = twoTabs()
    tabB.beginGesture()
    tabB.run('node.update', { ids: ['box'], patch: { x: 300 } })
    b.preview()
    tabA.beginGesture()
    tabA.run('node.update', { ids: ['box'], patch: { x: 50 } })
    expect(xOf(previewsOf(a).layers().get('box'))).toBe(50)
  })

  it('names the tabs typing in a text, and only that text', () => {
    const { a, b, tabB } = twoTabs()
    tabB.beginGesture()
    tabB.run('text.edit', { id: 'headline', op: { kind: 'insert', at: 0, text: 'Hot ' } })
    b.preview()
    expect(previewsOf(a).typingIn('headline')).toEqual(['local'])
    expect(previewsOf(a).typingIn('banner-headline')).toEqual([])
    expect(previewsOf(a).typingIn('box')).toEqual([])
  })

  it("keeps a listener's error for the call that delivered the preview, and tells the other listeners", () => {
    const { a, b, tabB } = twoTabs()
    const heard: string[] = []
    previewsOf(a).onChange(() => {
      throw new Error('a listener broke')
    })
    previewsOf(a).onChange(() => heard.push('told'))
    tabB.beginGesture()
    tabB.run('node.update', { ids: ['box'], patch: { x: 300 } })
    expect(() => b.preview()).toThrow('a listener broke')
    expect(heard).toEqual(['told'])
  })
})
