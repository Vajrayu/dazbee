import { describe, expect, it } from 'vitest'

import { harness } from '../test-actions.ts'

describe('wrapStateOf', () => {
  it('is ready for layers that share a parent, and none with nothing selected', () => {
    const { actions, selection, frame } = harness()
    selection.select(['a', 'b'], frame.id)
    expect(actions.wrapState()).toBe('ready')
    selection.select(['a'], frame.id)
    expect(actions.wrapState()).toBe('ready')
    selection.select([], frame.id)
    expect(actions.wrapState()).toBe('none')
  })

  it('says layers in different boxes or groups are apart', () => {
    const { actions, selection, frame } = harness()
    selection.select(['a', 'inRow'], frame.id)
    expect(actions.wrapState()).toBe('apart')
  })

  it('says a layer locked in place is locked, and Group and the Box action change nothing', () => {
    const { actions, session, selection, frame } = harness()
    session.run('node.lock', { ids: ['b'], lock: { move: true } })
    selection.select(['a', 'b'], frame.id)
    expect(actions.wrapState()).toBe('locked')
    const before = session.design().nodes
    for (const action of ['group', 'boxSelection'] as const) {
      actions.perform(action)
      expect(session.design().nodes).toEqual(before)
    }
  })

  it('says layers a boolean holds are held, and Group and the Box action change nothing', () => {
    const { actions, session, selection, frame } = harness()
    session.run('node.boolean', { ids: ['a', 'b'], op: 'union' })
    selection.select(['a', 'b'], frame.id)
    expect(actions.wrapState()).toBe('held')
    const before = session.design().nodes
    for (const action of ['group', 'boxSelection'] as const) {
      actions.perform(action)
      expect(session.design().nodes).toEqual(before)
    }
  })

  it('is the reason the Group, Box and Shift+A keys give for changing nothing', () => {
    const { actions, session, selection, frame, log } = harness()
    session.run('node.boolean', { ids: ['b', 'c'], op: 'union', id: 'joined' })
    const selections = [
      ['a', 'pin'],
      ['a', 'inRow'],
      ['b', 'c'],
    ]
    for (const ids of selections) {
      selection.select(ids, frame.id)
      const why = actions.wrapState()
      const before = session.design()
      for (const action of ['group', 'boxSelection', 'autoLayout'] as const) {
        actions.perform(action)
        expect(session.design(), `${action} on ${ids.join()}`).toEqual(before)
        expect(
          log.splice(0).filter((line) => line.startsWith('refused')),
          `${action} on ${ids.join()}`,
        ).toEqual([`refused ${why}`])
      }
    }
    expect(selections.map((ids) => (selection.select(ids, frame.id), actions.wrapState()))).toEqual([
      'locked',
      'apart',
      'held',
    ])
  })
})
