import { describe, expect, it } from 'vitest'

import { idsOf, pairsIn } from './selection.ts'
import { COPIES, everyCopy, harness } from './test-actions.ts'
import { testEditor } from './test-editor.ts'

describe('editorActions', () => {
  describe('perform', () => {
    describe('across frames', () => {
      it("selects the linked copies of the selection in the page's other frames, after it", () => {
        const { actions, selection, frame, wide } = harness()
        expect(actions.perform('selectLinkedCopies')).toBe(false)
        selection.select(['a', 'b'], frame.id)
        expect(actions.perform('selectLinkedCopies')).toBe(true)
        expect(selection.current()).toEqual([...pairsIn(frame.id, ['a', 'b']), ...pairsIn(wide.id, ['wide-a'])])
        // Again, nothing more to add.
        actions.perform('selectLinkedCopies')
        expect(selection.current()).toEqual([...pairsIn(frame.id, ['a', 'b']), ...pairsIn(wide.id, ['wide-a'])])
      })

      it("selects every layer of the page with the first selected layer's fill, or every text in its font", async () => {
        const { core, end } = await testEditor(COPIES)
        const red = [{ type: 'solid', color: '#E5484DFF' }]
        core.select(['wide-badge', 'mark', 'story-dot'])
        expect(core.setProps(core.selection(), () => ({ fills: red }))).toBe(true)
        core.select(['wide-badge', 'badge'])
        expect(core.actionReady('selectSameFill')).toBe(true)
        expect(core.actionReady('selectSameFont')).toBe(false)
        core.perform('selectSameFill')
        expect(core.selection()).toEqual(['wide-badge', 'mark', 'story-dot'])
        // Again, nothing changes.
        expect(core.actionReady('selectSameFill')).toBe(false)
        core.select(['story-cta'])
        expect(core.actionReady('selectSameFill')).toBe(false)
        core.perform('selectSameFont')
        expect(core.selection()).toEqual([
          'story-cta',
          'cta',
          'headline',
          'story-headline',
          'wide-cta',
          'wide-headline',
        ])
        end()
      })

      it('nudges every copy by the same amount, each press one undo step', () => {
        const { actions, session, selection, frame, wide, at } = harness()
        selection.selectAcross([...pairsIn(frame.id, ['a']), ...pairsIn(wide.id, ['wide-a'])])
        actions.perform('nudgeRight')
        actions.perform('nudgeDownFar')
        expect(at('a')).toEqual({ x: 101, y: 110 })
        expect(at('wide-a')).toEqual({ x: 101, y: 110 })
        session.undo()
        expect(at('a')).toEqual({ x: 101, y: 100 })
        expect(at('wide-a')).toEqual({ x: 101, y: 100 })
        session.redo()
        expect(at('wide-a')).toEqual({ x: 101, y: 110 })
      })

      it("nudges a group's layer in every frame, each group fitting what it holds again, and a size set on the texts of laid-out boxes in every frame is one undo step", async () => {
        const { core, press, end } = await testEditor(COPIES)
        /** A number of each copy's props, or of its style. */
        const each = (id: string, key: string) =>
          everyCopy(id).map((one) => {
            const props = core.design().nodes[one]?.props as Record<string, unknown>
            return (key === 'fontSize' ? (props.style as Record<string, unknown>) : props)[key]
          })
        core.select(['mark'])
        press('selectLinkedCopies')
        expect(core.selection()).toEqual(everyCopy('mark'))
        press('nudgeLeft')
        expect(each('mark', 'x')).toEqual([699, 699, 699])
        expect([each('logo', 'x'), each('logo', 'width')]).toEqual([
          [699, 699, 699],
          [251, 251, 251],
        ])
        core.select(['cta'])
        press('selectLinkedCopies')
        expect(core.selection()).toEqual(everyCopy('cta'))
        expect(
          core.setProps(core.selection(), (_, now) => ({ style: { ...(now.style as object), fontSize: 30 } })),
        ).toBe(true)
        expect(each('cta', 'fontSize')).toEqual([30, 30, 30])
        press('undo')
        expect(each('cta', 'fontSize')).toEqual([40, 40, 34])
        end()
      })

      it('deletes the selected layers in every frame as one undo step', () => {
        const { actions, session, selection, frame, wide } = harness()
        selection.selectAcross([...pairsIn(frame.id, ['a', 'b']), ...pairsIn(wide.id, ['wide-a'])])
        expect(actions.perform('delete')).toBe(true)
        expect(['a', 'b', 'wide-a'].map((id) => session.design().nodes[id])).toEqual([undefined, undefined, undefined])
        expect(selection.current()).toBeNull()
        session.undo()
        expect(['a', 'b', 'wide-a'].every((id) => session.design().nodes[id])).toBe(true)
      })

      it("groups each frame's selected layers in that frame, as one undo step, selecting every group", () => {
        const { actions, session, selection, frame, wide } = harness()
        selection.selectAcross([...pairsIn(frame.id, ['a', 'b']), ...pairsIn(wide.id, ['wide-a'])])
        actions.perform('group')
        const groups = selection.current() ?? []
        expect(groups.map((layer) => layer.frameId)).toEqual([frame.id, wide.id])
        const nodes = session.design().nodes
        expect(groups.map((layer) => nodes[layer.id]?.type)).toEqual(['group', 'group'])
        expect([nodes.a?.parentId, nodes.b?.parentId, nodes['wide-a']?.parentId]).toEqual([
          groups[0]?.id,
          groups[0]?.id,
          groups[1]?.id,
        ])
        session.undo()
        expect(session.design().nodes['wide-a']?.parentId).toBe(wide.id)
        expect(session.design().nodes.a?.parentId).toBe(frame.id)
      })

      it("lines up each frame's layers in that frame, as one undo step", () => {
        const { actions, session, selection, frame, wide, at } = harness()
        selection.selectAcross([...pairsIn(frame.id, ['a', 'c']), ...pairsIn(wide.id, ['wide-a'])])
        actions.perform('alignRight')
        expect(at('a')).toEqual({ x: 700, y: 100 })
        // One layer lines up with its frame.
        expect(at('wide-a')).toEqual({ x: 1100, y: 100 })
        session.undo()
        expect([at('a'), at('wide-a')]).toEqual([
          { x: 100, y: 100 },
          { x: 100, y: 100 },
        ])
      })

      it("keeps a frame's layers selected when its change selects nothing new: a frame's greyed part stays as it is", () => {
        const { actions, session, selection, frame, wide } = harness()
        session.run('node.lock', { ids: ['wide-a'], lock: { style: true } })
        selection.selectAcross([...pairsIn(frame.id, ['a', 'b']), ...pairsIn(wide.id, ['wide-a'])])
        actions.perform('mask')
        const [group, ...rest] = selection.current() ?? []
        expect(session.design().nodes[group?.id ?? '']?.type).toBe('group')
        expect(rest).toEqual(pairsIn(wide.id, ['wide-a']))
        expect(session.design().nodes['wide-a']?.props.mask).toBeUndefined()
      })

      it('U2: puts a lone layer in a Mask group, never a loose mask, and selects the group', () => {
        const { actions, session, selection, wide } = harness()
        selection.select(['wide-a'], wide.id)
        actions.perform('mask')
        const [group = ''] = idsOf(selection.current())
        expect(session.design().nodes[group]?.type).toBe('group')
        expect(session.design().nodes['wide-a']?.parentId).toBe(group)
        expect(session.design().nodes['wide-a']?.props.mask).toBe('alpha')
      })

      it('moves the copies a lock leaves free, the one locked in place staying', () => {
        const { actions, session, selection, frame, wide, at } = harness()
        session.run('node.lock', { ids: ['a'], lock: { move: true } })
        selection.selectAcross([...pairsIn(wide.id, ['wide-a']), ...pairsIn(frame.id, ['a'])])
        actions.perform('nudgeRight')
        expect([at('wide-a'), at('a')]).toEqual([
          { x: 101, y: 100 },
          { x: 100, y: 100 },
        ])
      })

      it('duplicates the selected layers in their own frames, selecting the new ones', () => {
        const { actions, session, selection, frame, wide } = harness()
        selection.selectAcross([...pairsIn(frame.id, ['a']), ...pairsIn(wide.id, ['wide-a'])])
        actions.perform('duplicate')
        const copies = selection.current() ?? []
        expect(copies.map((layer) => layer.frameId)).toEqual([frame.id, wide.id])
        expect(copies.map((layer) => session.design().nodes[layer.id]?.parentId)).toEqual([frame.id, wide.id])
        expect(copies.some((layer) => ['a', 'wide-a'].includes(layer.id))).toBe(false)
      })
    })
  })
})
