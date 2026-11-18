import { describe, expect, it } from 'vitest'

import { copiesOf } from '@dazbee/doc'
import type { DesignInput } from '@dazbee/schema'

import { idsOf, pairsIn } from '../selection.ts'
import { harness } from '../test-actions.ts'

const rect = (parentId: string, index: string, extra: Record<string, unknown> = {}, link = `${parentId}${index}`) => ({
  type: 'graphic' as const,
  parentId,
  index,
  link,
  name: `Rect ${index}`,
  props: { x: 100, y: 100, width: 200, height: 200, shape: { kind: 'rect' as const }, ...extra },
})
const group = (parentId: string, index: string, name: string, extra: Record<string, unknown> = {}) => ({
  type: 'group' as const,
  parentId,
  index,
  link: `${parentId}${index}`,
  name,
  props: { x: 100, y: 100, width: 200, height: 200, ...extra },
})
const mask = { mask: 'alpha' as const }
const text = (parentId: string, index: string) => ({
  type: 'text' as const,
  parentId,
  index,
  link: `${parentId}${index}`,
  name: 'Slow pour Saturdays',
  props: {
    x: 60,
    y: 40,
    width: 600,
    height: 60,
    text: 'Slow pour Saturdays',
    style: { fontFamily: 'Noto Sans', fontSize: 48, color: '#111111FF' },
  },
})

/**
 * The cards' page: a square frame holding, bottom to top, a photo, an ellipse, a second photo and a
 * headline, then a Row box holding two layers; a wide frame linked to it holds copies of the first
 * four; a second page holds a frame of its own.
 */
const CARDS: DesignInput = {
  meta: { designId: 'd', name: 'D' },
  pages: { p1: { name: 'One', order: 'a0' } },
  frames: {
    sq: { pageId: 'p1', name: 'Feed square', width: 1080, height: 1080, x: 0, y: 0, order: 'a0' },
    wide: { pageId: 'p1', name: 'Wide', width: 1200, height: 628, x: 1280, y: 0, order: 'a1' },
  },
  nodes: {
    pourOver: rect('sq', 'a0', {}, 'pourOver'),
    ellipse: { ...rect('sq', 'a1', { shape: { kind: 'ellipse' } }, 'ellipse'), name: 'Ellipse' },
    pouring: rect('sq', 'a2', {}, 'pouring'),
    title: { ...text('sq', 'a3'), link: 'title' },
    row: {
      type: 'box',
      parentId: 'sq',
      index: 'a4',
      link: 'row',
      name: 'Menu card',
      props: { x: 100, y: 600, width: 400, height: 200, layout: { direction: 'row' } },
    },
    inRow: rect('row', 'a0'),
    inRow2: rect('row', 'a1'),
    'wide-pourOver': rect('wide', 'a0', {}, 'pourOver'),
    'wide-ellipse': rect('wide', 'a1', { shape: { kind: 'ellipse' } }, 'ellipse'),
    'wide-pouring': rect('wide', 'a2', {}, 'pouring'),
    'wide-title': { ...text('wide', 'a3'), link: 'title' },
  },
}

/**
 * The release cards' page: in the square, a layer, then a Mask group named Logo holding a layer
 * below its mask, the mask, the layer it masks and one added above, then a top layer; a group with
 * two masks; a loose mask with a layer above; and a Row box holding a Mask group. The wide frame
 * holds a Mask group too.
 */
const RELEASE: DesignInput = {
  ...CARDS,
  nodes: {
    base: rect('sq', 'a0'),
    logo: group('sq', 'a1', 'Logo'),
    below: rect('logo', 'a0'),
    mm: rect('logo', 'a1', mask),
    mp: rect('logo', 'a2'),
    extra: rect('logo', 'a3'),
    top: rect('sq', 'a2'),
    twice: group('sq', 'a3', 'Two masks'),
    tm1: rect('twice', 'a0', mask),
    tm2: rect('twice', 'a1', mask),
    tp: rect('twice', 'a2'),
    loose: rect('sq', 'a4', mask),
    overLoose: rect('sq', 'a5'),
    row: { ...CARDS.nodes.row, index: 'a6' } as NonNullable<DesignInput['nodes']>[string],
    rowGroup: group('row', 'a0', 'Mask group'),
    sm: rect('rowGroup', 'a0', mask),
    sp: rect('rowGroup', 'a1'),
    wideGroup: group('wide', 'a0', 'Mask group'),
    wm: rect('wideGroup', 'a0', mask),
    wp: rect('wideGroup', 'a1'),
  },
}

/** The square's own layers, bottom to top, and the layers of one parent. */
const kids = (h: ReturnType<typeof harness>, parentId = 'sq') =>
  Object.entries(h.session.design().nodes)
    .filter(([, node]) => node.parentId === parentId)
    .sort(([, a], [, b]) => (a.index < b.index ? -1 : 1))
    .map(([id]) => id)
const masked = (h: ReturnType<typeof harness>, id: string) => h.session.design().nodes[id]?.props.mask

describe('maskPart', () => {
  describe('Use as mask', () => {
    it('U1: wraps one layer and the shown layer directly above it in a Mask group, the layer the mask, the group selected, nothing else changing', () => {
      const h = harness(false, CARDS)
      const before = JSON.parse(JSON.stringify(h.session.design()))
      h.selection.select(['ellipse'], h.frame.id)
      expect(h.actions.maskState()).toEqual({ item: 'use', why: null })
      h.actions.perform('mask')
      const [made = ''] = idsOf(h.selection.current())
      const node = h.session.design().nodes[made]
      expect(node?.type).toBe('group')
      expect(node?.name).toBe('Groupe de masque')
      expect(kids(h, made)).toEqual(['ellipse', 'pouring'])
      expect(masked(h, 'ellipse')).toBe('alpha')
      expect(masked(h, 'pouring')).toBeUndefined()
      expect(kids(h)).toEqual(['pourOver', made, 'title', 'row'])
      h.session.undo()
      expect(h.session.design()).toEqual(before)
    })

    it('U2: wraps a layer with nothing shown above it alone', () => {
      const h = harness(false, CARDS)
      h.session.run('node.reorder', { ids: ['row'], to: 'back' })
      h.selection.select(['title'], h.frame.id)
      h.actions.perform('mask')
      const [made = ''] = idsOf(h.selection.current())
      expect(kids(h, made)).toEqual(['title'])
      expect(masked(h, 'title')).toBe('alpha')
    })

    it('U3: wraps several layers, the bottom one masking the rest', () => {
      const h = harness(false, CARDS)
      h.selection.select(['pouring', 'pourOver'], h.frame.id)
      h.actions.perform('mask')
      const [made = ''] = idsOf(h.selection.current())
      expect(kids(h, made)).toEqual(['pourOver', 'pouring'])
      expect(masked(h, 'pourOver')).toBe('alpha')
      expect(masked(h, 'pouring')).toBeUndefined()
      expect(kids(h)).toEqual(['ellipse', made, 'title', 'row'])
    })

    it('U4: wraps a layer alone when the shown layer above it is a mask', () => {
      const h = harness(false, CARDS)
      h.session.run('node.mask', { ids: ['pouring'], mask: 'alpha' })
      h.selection.select(['ellipse'], h.frame.id)
      h.actions.perform('mask')
      const [made = ''] = idsOf(h.selection.current())
      expect(kids(h, made)).toEqual(['ellipse'])
    })

    it('K5: skips hidden layers above, taking the nearest shown one', () => {
      const h = harness(false, CARDS)
      h.session.run('node.update', { ids: ['pouring'], patch: { visible: false } })
      h.selection.select(['ellipse'], h.frame.id)
      h.actions.perform('mask')
      const [made = ''] = idsOf(h.selection.current())
      expect(kids(h, made)).toEqual(['ellipse', 'title'])
      expect(h.session.design().nodes.pouring?.parentId).toBe('sq')
    })

    it.each([
      ['a box', 'row'],
      ['a group', 'group'],
      ['a boolean', 'boolean'],
      ['a text', 'title'],
    ])('makes %s the mask', (_, kind) => {
      const h = harness(false, CARDS)
      let id = kind
      if (kind === 'group') id = h.session.run('node.group', { ids: ['pourOver'] })
      if (kind === 'boolean') id = h.session.run('node.boolean', { ids: ['pourOver', 'ellipse'], op: 'union' })
      if (kind === 'row') {
        h.selection.select(['row'], h.frame.id)
        h.boxLayout.setLayout('free')
      }
      h.selection.select([id], h.frame.id)
      expect(h.actions.maskState()).toEqual({ item: 'use', why: null })
      h.actions.perform('mask')
      expect(masked(h, id)).toBe('alpha')
      expect(h.session.design().nodes[h.session.design().nodes[id]?.parentId ?? '']?.type).toBe('group')
    })

    it('U6, K3: is greyed for a layer in a Row box, and its key does nothing', () => {
      const h = harness(false, CARDS)
      const before = JSON.parse(JSON.stringify(h.session.design()))
      h.selection.select(['inRow'], h.frame.id)
      expect(h.actions.maskState()).toEqual({ item: 'use', why: 'inAutoLayout' })
      expect(h.actions.perform('mask')).toBe(true)
      expect(h.session.design()).toEqual(before)
      expect(h.session.canUndo()).toBe(false)
    })

    it('U7: is greyed when the layer that would become the mask has its style locked, before any other reason', () => {
      const h = harness(false, CARDS)
      h.session.run('node.lock', { ids: ['ellipse', 'inRow'], lock: { style: true } })
      h.selection.select(['ellipse'], h.frame.id)
      expect(h.actions.maskState()).toEqual({ item: 'use', why: 'maskLocked' })
      h.selection.select(['pouring', 'ellipse'], h.frame.id)
      expect(h.actions.maskState()).toEqual({ item: 'use', why: 'maskLocked' })
      h.selection.select(['inRow'], h.frame.id)
      expect(h.actions.maskState()).toEqual({ item: 'use', why: 'maskLocked' })
      // A locked layer above the mask doesn't grey it.
      h.selection.select(['pourOver', 'ellipse'], h.frame.id)
      expect(h.actions.maskState()).toEqual({ item: 'use', why: null })
    })

    it('is greyed when a layer it would wrap is locked in place, as Group is, and its key does nothing', () => {
      const h = harness(false, CARDS)
      const all = { content: true, delete: true, move: true, resize: true, style: true }
      h.session.run('node.lock', { ids: ['pouring'], lock: all })
      const before = JSON.parse(JSON.stringify(h.session.design()))
      // One layer wraps with the shown layer above it, here the locked one.
      h.selection.select(['ellipse'], h.frame.id)
      expect(h.actions.maskState()).toEqual({ item: 'use', why: 'locked' })
      expect(h.actions.perform('mask')).toBe(true)
      expect(h.session.design()).toEqual(before)
      h.selection.select(['pourOver', 'pouring'], h.frame.id)
      expect(h.actions.maskState()).toEqual({ item: 'use', why: 'locked' })
      // Locked only against style changes, a layer above still goes in.
      h.session.run('node.lock', { ids: ['pouring'], lock: { ...all, move: false } })
      h.selection.select(['ellipse'], h.frame.id)
      expect(h.actions.maskState()).toEqual({ item: 'use', why: null })
    })

    it('is greyed for layers in different groups', () => {
      const h = harness(false, CARDS)
      h.session.run('node.group', { ids: ['pourOver'] })
      h.selection.select(['pourOver', 'title'], h.frame.id)
      expect(h.actions.maskState()).toEqual({ item: 'use', why: 'apart' })
    })

    it('K6: is greyed for a selection mixing masks, Mask groups or masked layers with other layers', () => {
      const h = harness(false, CARDS)
      h.selection.select(['ellipse'], h.frame.id)
      h.actions.perform('mask')
      const [made = ''] = idsOf(h.selection.current())
      for (const ids of [
        [made, 'pourOver', 'title'],
        [made, 'title'],
        ['pourOver', made],
      ]) {
        h.selection.select(ids, h.frame.id)
        expect(h.actions.maskState()).toEqual({ item: 'use', why: 'mixed' })
      }
      const r = harness(false, RELEASE)
      r.selection.select(['loose', 'base'], r.frame.id)
      expect(r.actions.maskState()).toEqual({ item: 'use', why: 'mixed' })
      h.selection.select([made, 'title'], h.frame.id)
      const before = JSON.parse(JSON.stringify(h.session.design()))
      h.actions.perform('mask')
      expect(h.session.design()).toEqual(before)
    })

    it('U9: makes the Mask group in its own frame only, with no linked copy', () => {
      const h = harness(false, CARDS)
      h.selection.select(['ellipse'], h.frame.id)
      h.actions.perform('mask')
      const [made = ''] = idsOf(h.selection.current())
      expect(copiesOf(h.session.design(), made)).toEqual([])
      expect(kids(h, h.wide.id)).toEqual(['wide-pourOver', 'wide-ellipse', 'wide-pouring', 'wide-title'])
      expect(masked(h, 'wide-ellipse')).toBeUndefined()
    })
  })

  describe('Release mask', () => {
    it('U8, K2: reads Release mask on a mask, a Mask group or a masked layer, and a hidden mask is still one', () => {
      const h = harness(false, RELEASE)
      for (const ids of [['mm'], ['logo'], ['mp'], ['tm2'], ['overLoose'], ['mp', 'extra', 'logo']]) {
        h.selection.select(ids, h.frame.id)
        expect(h.actions.maskState()).toEqual({ item: 'release', why: null })
      }
      h.session.run('node.update', { ids: ['mm'], patch: { visible: false } })
      h.selection.select(['mm'], h.frame.id)
      expect(h.actions.maskState()).toEqual({ item: 'release', why: null })
      h.selection.select(['logo'], h.frame.id)
      expect(h.actions.maskState()).toEqual({ item: 'release', why: null })
    })

    it('K2: right after Use as mask, the key again releases the new group, back to how it was', () => {
      const h = harness(false, CARDS)
      h.selection.select(['ellipse'], h.frame.id)
      h.actions.perform('mask')
      expect(h.actions.maskState()).toEqual({ item: 'release', why: null })
      h.actions.perform('mask')
      expect(kids(h)).toEqual(['pourOver', 'ellipse', 'pouring', 'title', 'row'])
      expect(masked(h, 'ellipse')).toBeUndefined()
      expect(idsOf(h.selection.current())).toEqual(['ellipse', 'pouring'])
    })

    it.each([
      ['R1, K2: the Mask group', 'logo'],
      ['the mask', 'mm'],
      ['R9: a masked layer', 'mp'],
    ])(
      'R1, R2, R3, R8: from %s, ungroups the Mask group, whatever its name, every layer coming out in order, all selected, none masked',
      (_, id) => {
        const h = harness(false, RELEASE)
        h.selection.select([id], h.frame.id)
        h.actions.perform('mask')
        expect(h.session.design().nodes.logo).toBeUndefined()
        expect(kids(h).slice(0, 6)).toEqual(['base', 'below', 'mm', 'mp', 'extra', 'top'])
        expect(masked(h, 'mm')).toBeUndefined()
        expect(idsOf(h.selection.current())).toEqual(['below', 'mm', 'mp', 'extra'])
      },
    )

    it("R1, R6: keeps a turned group's turn in its layers and drops the group's own look", () => {
      const h = harness(false, RELEASE)
      h.session.run('node.update', {
        ids: ['logo'],
        patch: {
          rotation: 30,
          opacity: 0.8,
          effects: [{ type: 'dropShadow', x: 0, y: 4, blur: 8, spread: 0, color: '#00000066' }],
        },
      })
      h.selection.select(['logo'], h.frame.id)
      h.actions.perform('mask')
      const mp = h.session.design().nodes.mp?.props
      expect(mp?.rotation).toBe(30)
      expect(mp?.opacity).toBe(1)
      expect(mp?.effects).toEqual([])
    })

    it('R4: turns off only the released mask in a group with a second one, the group staying, the mask selected', () => {
      const h = harness(false, RELEASE)
      h.selection.select(['tm1'], h.frame.id)
      h.actions.perform('mask')
      expect(masked(h, 'tm1')).toBeUndefined()
      expect(masked(h, 'tm2')).toBe('alpha')
      expect(h.session.design().nodes.twice?.type).toBe('group')
      expect(idsOf(h.selection.current())).toEqual(['tm1'])
    })

    it('R5: turns off only the mask of a Mask group in a Row box, the group staying', () => {
      const h = harness(false, RELEASE)
      h.selection.select(['rowGroup'], h.frame.id)
      expect(h.actions.maskState()).toEqual({ item: 'release', why: null })
      h.actions.perform('mask')
      expect(masked(h, 'sm')).toBeUndefined()
      expect(h.session.design().nodes.rowGroup?.type).toBe('group')
      expect(idsOf(h.selection.current())).toEqual(['sm'])
    })

    it('R5: from the masked layer of a Mask group in a Row box, turns off only the mask, the group staying, the mask selected', () => {
      const h = harness(false, RELEASE)
      h.selection.select(['sp'], h.frame.id)
      expect(h.actions.maskState()).toEqual({ item: 'release', why: null })
      h.actions.perform('mask')
      expect(masked(h, 'sm')).toBeUndefined()
      expect(h.session.design().nodes.rowGroup?.type).toBe('group')
      expect(kids(h, 'rowGroup')).toEqual(['sm', 'sp'])
      expect(idsOf(h.selection.current())).toEqual(['sm'])
    })

    it('R7: turns off a loose mask only, from it or from a layer it masks', () => {
      const h = harness(false, RELEASE)
      h.selection.select(['overLoose'], h.frame.id)
      h.actions.perform('mask')
      expect(masked(h, 'loose')).toBeUndefined()
      expect(h.session.design().nodes.loose?.parentId).toBe('sq')
      expect(idsOf(h.selection.current())).toEqual(['loose'])
    })

    it('R10: undoes in one step, back to the Mask group', () => {
      const h = harness(false, RELEASE)
      const before = JSON.parse(JSON.stringify(h.session.design()))
      h.selection.select(['logo'], h.frame.id)
      h.actions.perform('mask')
      h.session.undo()
      expect(h.session.design()).toEqual(before)
      h.session.redo()
      expect(h.session.design().nodes.logo).toBeUndefined()
    })

    it("is greyed while the mask's style is locked, then while the group is locked against deleting, and its key does nothing", () => {
      const h = harness(false, RELEASE)
      h.session.run('node.lock', { ids: ['mm'], lock: { style: true } })
      h.session.run('node.lock', { ids: ['logo'], lock: { delete: true } })
      h.selection.select(['mp'], h.frame.id)
      expect(h.actions.maskState()).toEqual({ item: 'release', why: 'maskLocked' })
      h.session.run('node.lock', { ids: ['mm'], lock: { style: false } })
      expect(h.actions.maskState()).toEqual({ item: 'release', why: 'groupLocked' })
      const before = JSON.parse(JSON.stringify(h.session.design()))
      expect(h.actions.perform('mask')).toBe(true)
      expect(h.session.design()).toEqual(before)
    })

    it("is greyed with the Mask group itself selected while the mask's style is locked, then while the group is locked against deleting", () => {
      const h = harness(false, RELEASE)
      h.session.run('node.lock', { ids: ['mm'], lock: { style: true } })
      h.session.run('node.lock', { ids: ['logo'], lock: { delete: true } })
      h.selection.select(['logo'], h.frame.id)
      expect(h.actions.maskState()).toEqual({ item: 'release', why: 'maskLocked' })
      h.session.run('node.lock', { ids: ['mm'], lock: { style: false } })
      expect(h.actions.maskState()).toEqual({ item: 'release', why: 'groupLocked' })
      const before = JSON.parse(JSON.stringify(h.session.design()))
      h.actions.perform('mask')
      expect(h.session.design()).toEqual(before)
    })
  })

  describe('Ungroup', () => {
    it('K4: turns off the mask of a Mask group it takes apart, in the same step', () => {
      const h = harness(false, RELEASE)
      h.selection.select(['logo'], h.frame.id)
      h.actions.perform('ungroup')
      expect(masked(h, 'mm')).toBeUndefined()
      h.session.undo()
      expect(masked(h, 'mm')).toBe('alpha')
    })
  })
})

describe('maskStateOf', () => {
  it("runs in the frames whose part can, while another frame's is greyed", () => {
    const h = harness(false, CARDS)
    h.session.run('node.lock', { ids: ['wide-ellipse'], lock: { style: true } })
    h.selection.selectAcross([...pairsIn(h.frame.id, ['ellipse']), ...pairsIn(h.wide.id, ['wide-ellipse'])])
    expect(h.actions.maskState()).toEqual({ item: 'use', why: null })
    h.actions.perform('mask')
    expect(masked(h, 'ellipse')).toBe('alpha')
    expect(h.session.design().nodes['wide-ellipse']?.parentId).toBe('wide')
    h.selection.selectAcross([...pairsIn(h.wide.id, ['wide-ellipse'])])
    expect(h.actions.maskState()).toEqual({ item: 'use', why: 'maskLocked' })
  })

  it('shows the first reason in the decided order across frames, whichever frame is selected first', () => {
    const h = harness(false, CARDS)
    h.session.run('node.lock', { ids: ['wide-ellipse'], lock: { style: true } })
    h.session.run('node.group', { ids: ['pourOver'] })
    const square = pairsIn(h.frame.id, ['pourOver', 'title'])
    const wide = pairsIn(h.wide.id, ['wide-ellipse'])
    h.selection.selectAcross([...square, ...wide])
    expect(h.actions.maskState()).toEqual({ item: 'use', why: 'maskLocked' })
    h.selection.selectAcross([...wide, ...square])
    expect(h.actions.maskState()).toEqual({ item: 'use', why: 'maskLocked' })
  })

  it("is greyed, mixed, while one frame's part reads Release and another's Use", () => {
    const h = harness(false, RELEASE)
    h.selection.selectAcross([...pairsIn(h.frame.id, ['base']), ...pairsIn(h.wide.id, ['wideGroup'])])
    expect(h.actions.maskState()).toEqual({ item: 'use', why: 'mixed' })
  })

  it('is the reason the mask key gives for changing nothing, each one', () => {
    const cards = harness(false, CARDS)
    cards.session.run('node.lock', { ids: ['pouring'], lock: { move: true } })
    cards.session.run('node.lock', { ids: ['pourOver'], lock: { style: true } })
    cards.session.run('node.group', { ids: ['title'], id: 'titled' })
    const release = harness(false, RELEASE)
    release.session.run('node.lock', { ids: ['logo'], lock: { delete: true } })
    const cases: [ReturnType<typeof harness>, string[], string][] = [
      [cards, ['pourOver'], 'maskLocked'],
      [cards, ['ellipse'], 'locked'],
      [release, ['mp'], 'groupLocked'],
      [cards, ['inRow'], 'inAutoLayout'],
      [cards, ['ellipse', 'title'], 'apart'],
      [release, ['base', 'loose'], 'mixed'],
    ]
    for (const [h, ids, why] of cases) {
      h.selection.select(ids, h.frame.id)
      expect(h.actions.maskState()?.why, ids.join()).toBe(why)
      const before = JSON.parse(JSON.stringify(h.session.design()))
      h.log.splice(0)
      expect(h.actions.perform('mask')).toBe(true)
      expect(h.session.design()).toEqual(before)
      expect(
        h.log.filter((line) => line.startsWith('refused')),
        ids.join(),
      ).toEqual([`refused ${why}`])
    }
  })

  it('is left out for a layer inside a boolean, and with nothing selected', () => {
    const h = harness(false, CARDS)
    h.session.run('node.boolean', { ids: ['pourOver', 'ellipse'], op: 'union' })
    h.selection.select(['ellipse'], h.frame.id)
    expect(h.actions.maskState()).toBeNull()
    expect(h.actions.perform('mask')).toBe(false)
    h.selection.select([], h.frame.id)
    expect(h.actions.maskState()).toBeNull()
  })
})

describe('runMaskPart', () => {
  it('makes a Mask group in each frame of a selection across frames, as one undo step, selecting every one', () => {
    const h = harness(false, CARDS)
    h.selection.selectAcross([...pairsIn(h.frame.id, ['ellipse']), ...pairsIn(h.wide.id, ['wide-ellipse'])])
    h.actions.perform('mask')
    const picked = h.selection.current() ?? []
    expect(picked.map((p) => h.session.design().nodes[p.id]?.type)).toEqual(['group', 'group'])
    expect(masked(h, 'wide-ellipse')).toBe('alpha')
    h.session.undo()
    expect(h.session.design().nodes.ellipse?.parentId).toBe('sq')
    expect(h.session.design().nodes['wide-ellipse']?.parentId).toBe('wide')
  })

  it('releases nested Mask groups both, each the way its own mask says', () => {
    const h = harness(false, CARDS)
    const inner = h.session.run('node.group', { ids: ['pouring', 'title'] })
    h.session.run('node.mask', { ids: ['pouring'], mask: 'alpha' })
    const outer = h.session.run('node.group', { ids: ['ellipse', inner] })
    h.session.run('node.mask', { ids: ['ellipse'], mask: 'alpha' })
    h.selection.select(['title', 'ellipse'], h.frame.id)
    expect(h.actions.maskState()).toEqual({ item: 'release', why: null })
    h.actions.perform('mask')
    expect(h.session.design().nodes[inner]).toBeUndefined()
    expect(h.session.design().nodes[outer]).toBeUndefined()
    expect(kids(h)).toEqual(['pourOver', 'ellipse', 'pouring', 'title', 'row'])
    expect([masked(h, 'ellipse'), masked(h, 'pouring')]).toEqual([undefined, undefined])
  })
})
