import { describe, expect, it } from 'vitest'

import { type Design, type DesignInput, parseDesign } from '@dazbee/schema'

import {
  boxModeSizing,
  boxWithout,
  boxWraps,
  fillApplies,
  fillFixesBox,
  fillStretches,
  flowLayoutOf,
  flowWraps,
  hugApplies,
  sizingOf,
} from './flow.ts'

const PADDING = { top: 0, right: 0, bottom: 0, left: 0 }
const tile = (index: string, parentId: string, rotation = 0, more: Record<string, unknown> = {}) => ({
  type: 'graphic' as const,
  parentId,
  link: `${parentId}-${index}`,
  index,
  name: 'Tile',
  props: { x: 0, y: 0, width: 100, height: 60, rotation, shape: { kind: 'rect' as const }, ...more },
})
const box = (
  index: string,
  layout?: { direction: 'row' | 'column' | 'grid'; gap: number; padding: typeof PADDING },
  sizing?: { width: 'hug'; height: 'hug' | 'fixed' },
) => ({
  type: 'box' as const,
  parentId: 'sq',
  link: index,
  index,
  name: 'Box',
  props: { x: 0, y: 0, width: 400, height: 100, ...(layout ? { layout } : {}), ...(sizing ? { sizing } : {}) },
})

/**
 * A Fit row, a fixed row, a Fit column, a Fit grid, a Free box and a row that fits its width only,
 * each holding a tile; a tile turned 90° in the fixed row, a tile kept in place in the Fit row, a
 * group of two tiles, and a text.
 */
const design = (): Design => {
  const input: DesignInput = {
    meta: { designId: 'd1', name: 'Fill' },
    pages: { p1: { name: 'Page 1', order: 'a0' } },
    frames: { sq: { pageId: 'p1', name: 'Square', width: 1080, height: 1080, x: 0, y: 0, order: 'a0' } },
    nodes: {
      fitRow: box('a0', { direction: 'row', gap: 0, padding: PADDING }, { width: 'hug', height: 'hug' }),
      fixedRow: box('a1', { direction: 'row', gap: 0, padding: PADDING }),
      fitColumn: box('a2', { direction: 'column', gap: 0, padding: PADDING }, { width: 'hug', height: 'hug' }),
      fitGrid: box('a3', { direction: 'grid', gap: 0, padding: PADDING }, { width: 'hug', height: 'hug' }),
      free: box('a4'),
      inFitRow: tile('a0', 'fitRow'),
      inFixedRow: tile('a0', 'fixedRow'),
      turned: tile('a1', 'fixedRow', 90),
      halfTurned: tile('a2', 'fixedRow', 180),
      inFitColumn: tile('a0', 'fitColumn'),
      inFitGrid: tile('a0', 'fitGrid'),
      inFree: tile('a0', 'free'),
      wideRow: box('a5', { direction: 'row', gap: 0, padding: PADDING }, { width: 'hug', height: 'fixed' }),
      inWideRow: tile('a0', 'wideRow'),
      kept: tile('a1', 'fitRow', 0, { absolute: true }),
      group: { ...box('a6'), type: 'group' },
      g1: tile('a0', 'group'),
      g2: tile('a1', 'group', 0, { x: 200, y: 40 }),
      words: {
        type: 'text',
        parentId: 'sq',
        link: 'words',
        index: 'a7',
        name: 'Words',
        props: {
          x: 0,
          y: 0,
          width: 100,
          height: 24,
          text: 'Hi',
          boxMode: 'autoWidth',
          style: { fontFamily: 'Noto Sans', fontSize: 20, color: '#000000FF' },
        },
      },
    },
  }
  const parsed = parseDesign(input)
  if (!parsed.success) throw new Error(parsed.errors.join('\n'))
  return parsed.design
}

describe('flowLayoutOf', () => {
  it('gives the layout of the box whose flow places the first of the layers a flow places, and none where no flow places any', () => {
    const d = design()
    expect(flowLayoutOf(d, ['inFitRow'])).toBe('row')
    expect(flowLayoutOf(d, ['inFitColumn'])).toBe('column')
    expect(flowLayoutOf(d, ['inFitGrid'])).toBe('grid')
    expect(flowLayoutOf(d, ['inFree', 'fitRow', 'gone', 'inFitColumn', 'inFitRow'])).toBe('column')
    expect(flowLayoutOf(d, ['inFree', 'fitRow', 'gone'])).toBeUndefined()
    expect(flowLayoutOf(d, [])).toBeUndefined()
  })
})

describe('fillStretches', () => {
  it('stretches across the flow always, and along it only where the box does not fit its content, or in a grid', () => {
    const fits = { width: true, height: true }
    const fixed = { width: false, height: false }
    expect(fillStretches('row', fits, 0, 'width')).toBe(false)
    expect(fillStretches('row', fits, 0, 'height')).toBe(true)
    expect(fillStretches('row', fixed, 0, 'width')).toBe(true)
    expect(fillStretches('column', fits, 0, 'height')).toBe(false)
    expect(fillStretches('column', fits, 0, 'width')).toBe(true)
    expect(fillStretches('grid', fits, 0, 'width')).toBe(true)
  })

  it('never stretches a layer turned by other than a half turn', () => {
    const fixed = { width: false, height: false }
    expect(fillStretches('row', fixed, 90, 'height')).toBe(false)
    expect(fillStretches('row', fixed, 30, 'width')).toBe(false)
    expect(fillStretches('row', fixed, 180, 'width')).toBe(true)
  })
})

describe('flowWraps', () => {
  it('wraps a row or a column set to wrap while it keeps its length along the flow; never a grid', () => {
    expect(flowWraps({ direction: 'row', wrap: true }, false)).toBe(true)
    expect(flowWraps({ direction: 'column', wrap: true }, false)).toBe(true)
    expect(flowWraps({ direction: 'row', wrap: true }, true)).toBe(false)
    expect(flowWraps({ direction: 'grid', wrap: true }, false)).toBe(false)
    expect(flowWraps({ direction: 'row' }, false)).toBe(false)
  })
})

describe('boxWraps', () => {
  it('wraps a laid-out row or column set to wrap that keeps its length along the flow, or that holds nothing yet', () => {
    const wrapping = (direction: 'row' | 'column' | 'grid', sizing: 'hug' | 'fixed', holds = true) => {
      const input: DesignInput = {
        meta: { designId: 'd1', name: 'Wrap' },
        pages: { p1: { name: 'Page 1', order: 'a0' } },
        frames: { sq: { pageId: 'p1', name: 'Square', width: 1080, height: 1080, x: 0, y: 0, order: 'a0' } },
        nodes: {
          w: {
            ...box('a0'),
            props: {
              ...box('a0').props,
              sizing: { width: sizing, height: sizing },
              layout: { direction, wrap: true, gap: 0, padding: PADDING },
            },
          },
          ...(holds ? { t: tile('a0', 'w') } : {}),
        },
      }
      const parsed = parseDesign(input)
      if (!parsed.success) throw new Error(parsed.errors.join('; '))
      return boxWraps(parsed.design, 'w')
    }
    expect(wrapping('row', 'fixed')).toBe(true)
    expect(wrapping('column', 'fixed')).toBe(true)
    expect(wrapping('row', 'hug')).toBe(false)
    expect(wrapping('row', 'hug', false)).toBe(true)
    expect(wrapping('grid', 'fixed')).toBe(false)
    expect(boxWraps(design(), 'fixedRow')).toBe(false)
    expect(boxWraps(design(), 'inFixedRow')).toBe(false)
  })
})

describe('fillApplies', () => {
  it('applies on both sides of an unturned layer in a laid-out box, along the flow of a box that fits it too', () => {
    const d = design()
    expect(fillApplies(d, 'inFitRow', 'width')).toBe(true)
    expect(fillApplies(d, 'inFitRow', 'height')).toBe(true)
    expect(fillApplies(d, 'inFixedRow', 'width')).toBe(true)
    expect(fillApplies(d, 'inFitColumn', 'height')).toBe(true)
    expect(fillApplies(d, 'inFitColumn', 'width')).toBe(true)
    expect(fillApplies(d, 'inFitGrid', 'width')).toBe(true)
    expect(fillApplies(d, 'turned', 'width')).toBe(false)
    expect(fillApplies(d, 'halfTurned', 'width')).toBe(true)
  })

  it('never applies outside a laid-out box', () => {
    const d = design()
    expect(fillApplies(d, 'inFree', 'width')).toBe(false)
    expect(fillApplies(d, 'fitRow', 'width')).toBe(false)
  })
})

describe('fillFixesBox', () => {
  it('fixes the box only along the flow of a box that fits what it holds, where Fill has no room to take', () => {
    const d = design()
    expect(fillFixesBox(d, 'inFitRow', 'width')).toBe(true)
    expect(fillFixesBox(d, 'inFitRow', 'height')).toBe(false)
    expect(fillFixesBox(d, 'inFitColumn', 'height')).toBe(true)
    expect(fillFixesBox(d, 'inFitColumn', 'width')).toBe(false)
    expect(fillFixesBox(d, 'inFixedRow', 'width')).toBe(false)
    expect(fillFixesBox(d, 'inFitGrid', 'width')).toBe(false)
  })

  it('never fixes a box for a layer Fill can’t apply to', () => {
    const d = design()
    expect(fillFixesBox(d, 'turned', 'width')).toBe(false)
    expect(fillFixesBox(d, 'inFree', 'width')).toBe(false)
  })
})

describe('sizingOf', () => {
  it('reads a layer’s own sizing, else fixed', () => {
    const { nodes } = design()
    expect(nodes.fitRow && sizingOf(nodes.fitRow)).toEqual({ width: 'hug', height: 'hug' })
    expect(nodes.inFree && sizingOf(nodes.inFree)).toEqual({ width: 'fixed', height: 'fixed' })
  })
})

describe('hugApplies', () => {
  it('lets a laid-out box and a text fit their content, and nothing else', () => {
    const d = design()
    expect(hugApplies(d, 'fitRow')).toBe(true)
    expect(hugApplies(d, 'words')).toBe(true)
    expect(hugApplies(d, 'free')).toBe(false)
    expect(hugApplies(d, 'inFitRow')).toBe(false)
  })
})

describe('boxWithout', () => {
  const boxOf = (d: Design) => (id: string) => {
    const p = d.nodes[id]?.props as { x: number; y: number; width: number; height: number } | undefined
    return p && { x: p.x, y: p.y, width: p.width, height: p.height, rotation: 0 }
  }
  const none = { width: false, height: false }

  it('is a group’s box around the layers left in it, following none of them, and none with none left', () => {
    const d = design()
    expect(boxWithout(d, 'group', boxOf(d), ['g2'])).toEqual({
      box: { x: 0, y: 0, width: 100, height: 60, rotation: 0 },
      follows: none,
    })
    expect(boxWithout(d, 'group', boxOf(d), ['g1', 'g2'])).toBeNull()
  })

  it('is a laid-out box as it is, following a layer its flow places on each side it fits its layers on', () => {
    const d = design()
    const row = { x: 0, y: 0, width: 400, height: 100, rotation: 0 }
    expect(boxWithout(d, 'fitRow', boxOf(d), ['inFitRow'])).toEqual({
      box: row,
      follows: { width: true, height: true },
    })
    expect(boxWithout(d, 'wideRow', boxOf(d), ['inWideRow'])?.follows).toEqual({ width: true, height: false })
    expect(boxWithout(d, 'fitColumn', boxOf(d), ['inFitColumn'])?.follows).toEqual({ width: true, height: true })
    expect(boxWithout(d, 'fixedRow', boxOf(d), ['inFixedRow'])).toEqual({ box: row, follows: none })
    expect(boxWithout(d, 'free', boxOf(d), ['inFree'])?.follows).toEqual(none)
  })

  it('follows no layer kept in place in a box that fits its layers, nor one held elsewhere', () => {
    const d = design()
    expect(boxWithout(d, 'fitRow', boxOf(d), ['kept'])?.follows).toEqual(none)
    expect(boxWithout(d, 'fitRow', boxOf(d), ['inFitColumn'])?.follows).toEqual(none)
    expect(boxWithout(d, 'fitRow', boxOf(d), [])?.follows).toEqual(none)
  })

  it('is none for what has no box', () => {
    const d = design()
    expect(boxWithout(d, 'sq', boxOf(d), ['fitRow'])).toBeNull()
  })
})

describe('boxModeSizing', () => {
  it('gives the sizing each text box mode means', () => {
    expect(boxModeSizing('autoWidth')).toEqual({ width: 'hug', height: 'hug' })
    expect(boxModeSizing('autoHeight')).toEqual({ width: 'fixed', height: 'hug' })
    expect(boxModeSizing('fixed')).toEqual({ width: 'fixed', height: 'fixed' })
  })
})
