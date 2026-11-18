import { describe, expect, it } from 'vitest'

import type { Design } from '@dazbee/schema'

import { editorReach, goInAction, layerBeside, typingAllOf } from './reach.ts'
import { pairsIn } from './selection.ts'
import { graphic, harness as selectionHarness } from './test-selection.ts'
import type { TextRange } from './text/text-edit.ts'

/** A layer in order among its siblings by `index`, with more of its own. */
const at = (parentId: string, index: string, type: string, more: Record<string, unknown> = {}) => ({
  ...(type === 'graphic' ? graphic('rect', parentId) : { type, parentId, props: {} }),
  index,
  ...more,
})
/**
 * One frame holding, back to front, a box `box` holding `a` and the boolean `bool` of `s1` and `s2`,
 * a text `words`, a text locked against edits `fixed` and an empty group `empty`.
 */
const DESIGN = {
  pages: { p1: { name: 'One' } },
  frames: { 'p1-f1': { pageId: 'p1' }, 'p1-f2': { pageId: 'p1' } },
  nodes: {
    box: at('p1-f1', 'a0', 'box'),
    a: at('box', 'a0', 'graphic'),
    bool: at('box', 'a1', 'boolean'),
    s1: at('bool', 'a0', 'graphic'),
    s2: at('bool', 'a1', 'graphic'),
    words: at('p1-f1', 'a1', 'text', { props: { text: 'Big sale' } }),
    fixed: at('p1-f1', 'a2', 'text', { props: { text: 'Kept' }, lock: { content: true } }),
    empty: at('p1-f1', 'a3', 'group'),
  },
} as unknown as Design

/**
 * One frame holding a hidden text, a text locked in place, a group locked in place holding a text,
 * and a hidden group holding a text.
 */
const HIDDEN_AND_LOCKED = {
  ...DESIGN,
  nodes: {
    ghost: at('p1-f1', 'a0', 'text', { props: { text: 'Gone', visible: false } }),
    pinned: at('p1-f1', 'a1', 'text', { props: { text: 'Pinned' }, lock: { move: true } }),
    shut: at('p1-f1', 'a2', 'group', { lock: { move: true } }),
    inShut: at('shut', 'a0', 'text', { props: { text: 'In shut' } }),
    veil: at('p1-f1', 'a3', 'group', { props: { visible: false } }),
    inVeil: at('veil', 'a0', 'text', { props: { text: 'In veil' } }),
  },
} as unknown as Design

/** A photo's props: a rect with an image fill, with more of its own. */
const photo = (more: Record<string, unknown> = {}) => ({
  props: { shape: { kind: 'rect' }, fills: [{ type: 'image', assetId: 'a1' }], ...more },
})
/**
 * One frame holding a photo, a photo box holding a rect, a path, a text, a group holding a rect, a
 * hidden photo, a photo locked in place, a photo with its style locked and a second photo.
 */
const PHOTOS = {
  ...DESIGN,
  nodes: {
    photo: at('p1-f1', 'a0', 'graphic', photo()),
    framed: at('p1-f1', 'a1', 'box', photo()),
    inFramed: at('framed', 'a0', 'graphic'),
    zig: at('p1-f1', 'a2', 'graphic', { props: { shape: { kind: 'path' } } }),
    words: at('p1-f1', 'a3', 'text', { props: { text: 'Big sale' } }),
    group: at('p1-f1', 'a4', 'group'),
    inGroup: at('group', 'a0', 'graphic'),
    hiddenPhoto: at('p1-f1', 'a5', 'graphic', photo({ visible: false })),
    lockedPhoto: at('p1-f1', 'a6', 'graphic', { ...photo(), lock: { move: true } }),
    styledPhoto: at('p1-f1', 'a7', 'graphic', { ...photo(), lock: { style: true } }),
    photo2: at('p1-f1', 'a8', 'graphic', photo()),
  },
} as unknown as Design

const one = (...ids: string[]) => pairsIn('p1-f1', ids)

/** The keys over a selection of a design, the one above unless given, logging what they ask of typing. */
function harness(design = DESIGN) {
  const { selection, world } = selectionHarness()
  world.design = design
  const log: string[] = []
  let typingIn: { id: string; frameId: string } | null = null
  let range: TextRange | null = null
  /** Selects a range of the text typed in, as a drag across its words does. */
  const selectText = (selected: TextRange) => {
    range = selected
    log.push(`select ${selected.start}-${selected.end}`)
  }
  const reach = editorReach({
    session: { design: () => design },
    selection,
    typing: {
      editing: () => typingIn,
      selectedText: () => (typingIn && range ? { id: typingIn.id, range } : null),
      start: (id, frame, offset) => {
        typingIn = { id, frameId: frame }
        range = null
        log.push(`type ${id} in ${frame} at ${offset}`)
      },
      selectText,
    },
  })
  return { reach, selection, log, selectText }
}

describe('editorReach', () => {
  describe('goIn', () => {
    it('selects what is directly in the selected box or boolean, going into it', () => {
      const { reach, selection } = harness()
      selection.select(['box'], 'p1-f1')
      expect(reach.goIn()).toBe(true)
      expect(selection.current()).toEqual(one('a', 'bool'))
      expect(selection.entered()).toBe('box')
      selection.select(['bool'], 'p1-f1')
      expect(reach.goIn()).toBe(true)
      expect(selection.current()).toEqual(one('s1', 's2'))
      expect(selection.entered()).toBe('bool')
    })

    it('starts typing in one selected text with all its words selected', () => {
      const { reach, selection, log } = harness()
      selection.select(['words'], 'p1-f1')
      expect(reach.goIn()).toBe(true)
      expect(log).toEqual(['type words in p1-f1 at 0', 'select 0-8'])
      expect(selection.current()).toEqual(one('words'))
    })

    it('selects all the words of the text already typed in, starting no typing again, and does nothing once they are', () => {
      const { reach, selection, log, selectText } = harness()
      selection.select(['words'], 'p1-f1')
      reach.goIn()
      selectText({ start: 1, end: 3 })
      expect(reach.goIn()).toBe(true)
      expect(reach.goIn()).toBe(false)
      expect(log).toEqual(['type words in p1-f1 at 0', 'select 0-8', 'select 1-3', 'select 0-8'])
    })

    it('does nothing for a text locked against edits, an empty group, a shape or nothing selected', () => {
      const { reach, selection, log } = harness()
      for (const id of ['fixed', 'empty', 'a']) {
        selection.select([id], 'p1-f1')
        expect(reach.goIn(), id).toBe(false)
        expect(selection.current(), id).toEqual(one(id))
      }
      selection.select([], null)
      expect(reach.goIn()).toBe(false)
      expect(log).toEqual([])
    })

    it('types into no text that is hidden or locked in place, itself or in what holds it', () => {
      const { reach, selection, log } = harness(HIDDEN_AND_LOCKED)
      for (const id of ['ghost', 'pinned', 'inShut', 'inVeil']) {
        selection.select([id], 'p1-f1')
        expect(reach.goIn(), id).toBe(false)
        expect(selection.current(), id).toEqual(one(id))
      }
      expect(log).toEqual([])
    })

    it('types into no text while another layer is selected with it', () => {
      const { reach, selection, log } = harness()
      selection.select(['words', 'a'], 'p1-f1')
      expect(reach.goIn()).toBe(false)
      expect(log).toEqual([])
    })
  })

  describe('goOut', () => {
    it('selects the group the selection is in, going into the one that holds it', () => {
      const { reach, selection } = harness()
      selection.select(['s1'], 'p1-f1')
      reach.goOut()
      expect(selection.current()).toEqual(one('bool'))
      expect(selection.entered()).toBe('box')
      reach.goOut()
      expect(selection.current()).toEqual(one('box'))
      expect(selection.entered()).toBeNull()
    })

    it('does nothing at the top level', () => {
      const { reach, selection } = harness()
      selection.select(['words'], 'p1-f1')
      reach.goOut()
      expect(selection.current()).toEqual(one('words'))
    })
  })

  describe('step', () => {
    it("selects the layer beside the selection in the layers panel's order, wrapping round", () => {
      const { reach, selection } = harness()
      // The panel lists the frame's layers empty, fixed, words, box.
      selection.select(['fixed'], 'p1-f1')
      reach.step(1)
      expect(selection.current()).toEqual(one('words'))
      reach.step(1)
      reach.step(1)
      expect(selection.current()).toEqual(one('empty'))
      reach.step(-1)
      expect(selection.current()).toEqual(one('box'))
      expect(selection.entered()).toBeNull()
    })

    it('selects a hidden text and one locked in place as any other layer, and steps on from them', () => {
      const { reach, selection } = harness(HIDDEN_AND_LOCKED)
      // The panel lists the frame's layers veil, shut, pinned, ghost.
      selection.select(['shut'], 'p1-f1')
      reach.step(1)
      expect(selection.current()).toEqual(one('pinned'))
      reach.step(1)
      expect(selection.current()).toEqual(one('ghost'))
      reach.step(-1)
      reach.step(-1)
      expect(selection.current()).toEqual(one('shut'))
    })

    it('does nothing on a layer alone in what holds it, going into nothing', () => {
      const { reach, selection } = harness(HIDDEN_AND_LOCKED)
      selection.select(['inShut'], 'p1-f1')
      reach.step(1)
      reach.step(-1)
      expect(selection.current()).toEqual(one('inShut'))
      expect(selection.entered()).toBeNull()
      expect(layerBeside(selection.current(), HIDDEN_AND_LOCKED, 1)).toBeNull()
      selection.select(['shut'], 'p1-f1')
      expect(layerBeside(selection.current(), HIDDEN_AND_LOCKED, 1)).toEqual({ id: 'pinned', frameId: 'p1-f1' })
    })

    it('stays in the group the selection is in', () => {
      const { reach, selection } = harness()
      selection.select(['a'], 'p1-f1')
      reach.step(1)
      expect(selection.current()).toEqual(one('bool'))
      expect(selection.entered()).toBe('box')
    })
  })
})

describe('goInAction', () => {
  it('is editPoints for one photo that holds no layers and for one path', () => {
    expect(goInAction(PHOTOS, ['photo'])).toBe('editPoints')
    expect(goInAction(PHOTOS, ['zig'])).toBe('editPoints')
  })

  it('is nothing for a photo box holding layers and a group, which Enter goes into', () => {
    expect(goInAction(PHOTOS, ['framed'])).toBeNull()
    expect(goInAction(PHOTOS, ['group'])).toBeNull()
  })

  it('is nothing for a text, which Enter types into', () => {
    expect(goInAction(PHOTOS, ['words'])).toBeNull()
  })

  it('is nothing for a photo hidden, locked in place or with its style locked, which Enter leaves alone', () => {
    for (const id of ['hiddenPhoto', 'lockedPhoto', 'styledPhoto']) expect(goInAction(PHOTOS, [id]), id).toBeNull()
  })

  it('is nothing for two photos selected, or none', () => {
    expect(goInAction(PHOTOS, ['photo', 'photo2'])).toBeNull()
    expect(goInAction(PHOTOS, [])).toBeNull()
  })
})

describe('typingAllOf', () => {
  const typing = (id: string | null, range: { start: number; end: number } | null) => ({
    editing: () => (id === null ? null : { id, frameId: 'p1-f1' }),
    selectedText: () => (id === null || range === null ? null : { id, range }),
  })

  it('finds the text typed in with all its words selected', () => {
    expect(typingAllOf(DESIGN, 'words', typing('words', { start: 0, end: 8 }))).toBe(true)
  })

  it('finds nothing for part of its words, a caret, another text or no typing', () => {
    expect(typingAllOf(DESIGN, 'words', typing('words', { start: 1, end: 8 }))).toBe(false)
    expect(typingAllOf(DESIGN, 'words', typing('words', null))).toBe(false)
    expect(typingAllOf(DESIGN, 'words', typing('fixed', { start: 0, end: 4 }))).toBe(false)
    expect(typingAllOf(DESIGN, 'words', typing(null, null))).toBe(false)
  })
})
