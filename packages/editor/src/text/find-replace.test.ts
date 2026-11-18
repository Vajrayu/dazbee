import { describe, expect, it } from 'vitest'

import { COPIES, everyCopy } from '../test-actions.ts'
import { testEditor } from '../test-editor.ts'

/** A text's characters in the design as it is now. */
const textOf = (design: { nodes: Record<string, { props: object } | undefined> }, id: string) =>
  (design.nodes[id]?.props as { text?: string } | undefined)?.text

describe('editorFindReplace', () => {
  describe('found', () => {
    it("finds the shown page's texts holding a string, whatever its case, frame by frame, with how many matches", async () => {
      const { core, end } = await testEditor(COPIES)
      expect(core.findText('SALE')).toEqual({ layers: everyCopy('headline'), matches: 3 })
      expect(core.findText('o')).toEqual({ layers: everyCopy('cta'), matches: 6 })
      expect(core.findText('nothing here')).toEqual({ layers: [], matches: 0 })
      expect(core.findText('')).toEqual({ layers: [], matches: 0 })
      end()
    })
  })

  describe('selectFound', () => {
    it('selects the texts holding a match across the frames, ending typing first', async () => {
      const { core, modules, end } = await testEditor(COPIES)
      core.select(['cta'])
      core.perform('goIn')
      expect(modules.typing.editing()).not.toBeNull()
      expect(core.selectFound('summer')).toBe(3)
      expect(modules.typing.editing()).toBeNull()
      expect(core.selection()).toEqual(everyCopy('headline'))
      // A text locked in place is left out, as select all leaves it out.
      core.setLocked(['story-headline'], true)
      expect(core.selectFound('summer')).toBe(2)
      expect(core.selection()).toEqual(['headline', 'wide-headline'])
      end()
    })
  })

  describe('replaceText', () => {
    it('replaces every match in the texts as one undo step, fits them to their words and selects them', async () => {
      const { core, end } = await testEditor(COPIES)
      const before = JSON.stringify(core.design().nodes)
      const height = (core.design().nodes.headline?.props as { height: number }).height
      expect(core.replaceText('sale', 'clearance event for everyone this summer')).toBe(3)
      for (const id of everyCopy('headline'))
        expect(textOf(core.design(), id)).toBe('Summer clearance event for everyone this summer')
      // The longer words wrap onto more lines, and the text's box grows to hold them.
      expect((core.design().nodes.headline?.props as { height: number }).height).toBeGreaterThan(height)
      expect(core.selection()).toEqual(everyCopy('headline'))
      expect(core.undoName()).toBe('editText')
      core.perform('undo')
      expect(JSON.stringify(core.design().nodes)).toBe(before)
      end()
    })

    it('leaves out a text locked against content changes, and changes nothing with nothing to find', async () => {
      const { core, end } = await testEditor(COPIES)
      core.setLocked(['story-headline'], true)
      expect(core.replaceText('Sale', 'Deals')).toBe(2)
      expect(['headline', 'story-headline', 'wide-headline'].map((id) => textOf(core.design(), id))).toEqual([
        'Summer Deals',
        'Summer sale',
        'Summer Deals',
      ])
      expect(core.replaceText('missing', 'x')).toBe(0)
      expect(core.replaceText('', 'x')).toBe(0)
      // Matched whatever its case, a replacement that changes nothing counts no text.
      expect(core.replaceText('DEALS', 'Deals')).toBe(0)
      end()
    })

    it('ends typing first, so the text typed in takes the replacement too', async () => {
      const { core, modules, end } = await testEditor(COPIES)
      core.select(['headline'])
      core.perform('goIn')
      expect(modules.typing.editing()).not.toBeNull()
      expect(core.replaceText('summer', 'Winter')).toBe(3)
      expect(modules.typing.editing()).toBeNull()
      expect(textOf(core.design(), 'headline')).toBe('Winter sale')
      end()
    })
  })
})
