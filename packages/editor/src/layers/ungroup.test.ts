import { describe, expect, it } from 'vitest'

import { idsOf } from '../selection.ts'
import { FLOW, harness } from '../test-actions.ts'

describe('ungroupStateOf', () => {
  it('is ready for a box or a group whose layers stay where they are drawn once it comes apart', () => {
    const { actions, selection, frame } = harness(false, FLOW)
    selection.select(['row'], frame.id)
    expect(actions.ungroupState()).toBe('ready')
    selection.select(['fixed', 'filling'], frame.id)
    actions.perform('group')
    expect(actions.ungroupState()).toBe('ready')
  })

  it('says auto layout places what a box in a flow holds elsewhere, and nothing changes', () => {
    const { actions, session, selection, frame, drawn } = harness(false, FLOW)
    const before = drawn()
    selection.select(['hugging'], frame.id)
    expect(actions.ungroupState()).toBe('placedByLayout')
    expect(drawn()).toEqual(before)
    expect(session.canUndo()).toBe(false)
  })

  it('is ready while one of the selected boxes comes apart, and none with no group or box selected', () => {
    const { actions, selection, frame } = harness(false, FLOW)
    selection.select(['hugging', 'row'], frame.id)
    expect(actions.ungroupState()).toBe('ready')
    selection.select(['a'], frame.id)
    expect(actions.ungroupState()).toBe('none')
    selection.select([], frame.id)
    expect(actions.ungroupState()).toBe('none')
  })

  it('says a group or box locked against deleting is locked, in a flow or not, and its key does nothing', () => {
    const { actions, session, selection, frame, log } = harness(false, FLOW)
    selection.select(['fixed', 'filling'], frame.id)
    actions.perform('group')
    const [group = ''] = idsOf(selection.current())
    session.run('node.lock', { ids: [group, 'row'], lock: { delete: true } })
    for (const id of [group, 'row']) {
      selection.select([id], frame.id)
      expect(actions.ungroupState()).toBe('locked')
      expect(actions.perform('ungroup')).toBe(true)
      expect(session.design().nodes[id]).toBeDefined()
    }
    expect(log).not.toContain('placedByLayout')
  })

  it("says a mask it would free has its style locked, its key does nothing, and an unlocked one's ungroup turns the mask off", () => {
    const { actions, session, selection, frame } = harness()
    selection.select(['a', 'b'], frame.id)
    actions.perform('group')
    const [group = ''] = idsOf(selection.current())
    session.run('node.mask', { ids: ['a'], mask: 'alpha' })
    session.run('node.lock', { ids: ['a'], lock: { style: true } })
    selection.select([group], frame.id)
    expect(actions.ungroupState()).toBe('maskLocked')
    actions.perform('ungroup')
    expect(session.design().nodes[group]).toBeDefined()
    session.run('node.lock', { ids: ['a'], lock: { style: false } })
    expect(actions.ungroupState()).toBe('ready')
    actions.perform('ungroup')
    expect(session.design().nodes[group]).toBeUndefined()
    expect(session.design().nodes.a?.props.mask).toBeUndefined()
  })

  it('says locked before a freed mask’s locked style, and that before auto layout, whichever is selected first', () => {
    const { actions, session, selection, frame } = harness(false, FLOW)
    selection.select(['a', 'b'], frame.id)
    actions.perform('group')
    const [masked = ''] = idsOf(selection.current())
    session.run('node.mask', { ids: ['a'], mask: 'alpha' })
    session.run('node.lock', { ids: ['a'], lock: { style: true } })
    session.run('node.lock', { ids: ['row'], lock: { delete: true } })
    selection.select([masked, 'row'], frame.id)
    expect(actions.ungroupState()).toBe('locked')
    selection.select(['hugging', masked], frame.id)
    expect(actions.ungroupState()).toBe('maskLocked')
    selection.select(['hugging', 'row'], frame.id)
    expect(actions.ungroupState()).toBe('locked')
  })

  it('takes the unlocked one apart from a selection with a locked one, saying nothing', () => {
    const { actions, session, selection, frame, log } = harness(false, FLOW)
    selection.select(['fixed', 'filling'], frame.id)
    actions.perform('group')
    const [group = ''] = idsOf(selection.current())
    session.run('node.lock', { ids: ['row'], lock: { delete: true } })
    selection.select([group, 'row'], frame.id)
    expect(actions.ungroupState()).toBe('ready')
    actions.perform('ungroup')
    expect(session.design().nodes[group]).toBeUndefined()
    expect(session.design().nodes.row).toBeDefined()
    expect(log).not.toContain('placedByLayout')
  })
})
