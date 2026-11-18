import { describe, expect, it } from 'vitest'

import { styleOf } from '@dazbee/schema'

import { readDesign } from '../store.ts'
import { linkedDesign, openTestSession } from '../test-design.ts'
import { openTestStore } from '../test-store.ts'

const navy = '#14213DFF'

function open() {
  const store = openTestStore(linkedDesign())
  return { store, tab: openTestSession(store) }
}

describe('node.style', () => {
  it('sets a style on layers, leaving their linked copies, place and size, in one undo step', () => {
    const { store, tab } = open()
    const from = readDesign(store).nodes.badge
    if (!from) throw new Error('no badge')
    const style = {
      ...styleOf(from),
      fills: [{ type: 'solid' as const, color: navy }],
      opacity: 0.4,
      bindings: { fill: 'brand:primary' as const },
    }

    tab.run('node.style', { ids: ['bg', 'badge'], style })

    const design = readDesign(store)
    for (const id of ['bg', 'badge']) {
      expect(design.nodes[id]).toMatchObject({
        props: { fills: [{ color: navy }], opacity: 0.4 },
        bindings: { fill: 'brand:primary' },
      })
    }
    expect(design.nodes.bg?.props).toMatchObject({ x: 0, y: 0, width: 1080, height: 1080 })
    expect(design.nodes['wide-bg']?.props).toMatchObject({ fills: [{ color: '#FF5A36FF' }], opacity: 1 })

    tab.undo()
    expect(readDesign(store).nodes.bg?.props).toMatchObject({ fills: [{ color: '#FF5A36FF' }], opacity: 1 })
    expect(readDesign(store).nodes.bg?.bindings).toBeUndefined()
  })

  it('sets a text’s look and clears spacing the style leaves out, keeping its font size', () => {
    const { store, tab } = open()
    tab.run('node.update', { ids: ['wide-title'], patch: { paragraphSpacing: 8 } })
    const title = readDesign(store).nodes.title
    if (!title) throw new Error('no title')
    const style = styleOf(title)

    tab.run('node.style', {
      ids: ['wide-title'],
      style: { ...style, text: style.text && { ...style.text, fontWeight: 800 } },
    })

    const props = readDesign(store).nodes['wide-title']?.props as Record<string, unknown>
    expect(props.style).toMatchObject({ fontWeight: 800, fontSize: 40 })
    expect(props).not.toHaveProperty('paragraphSpacing')
  })

  it('refuses a layer whose style is locked', () => {
    const { store, tab } = open()
    tab.run('node.lock', { ids: ['badge'], lock: { style: true } })
    const bg = readDesign(store).nodes.bg
    if (!bg) throw new Error('no background')
    const style = styleOf(bg)
    expect(() => tab.run('node.style', { ids: ['badge'], style })).toThrow(/locked \(style\)/)
  })
})
