import { describe, expect, it } from 'vitest'

import { childrenOf } from '@dazbee/doc'

import { FLOW, harness } from './test-actions.ts'

describe('the arrow keys', () => {
  it('move a hidden layer in a flow by its stored place, as the flow places no hidden layer, its order kept', () => {
    const { actions, session, selection, frame, log } = harness(false, FLOW)
    session.run('node.update', { ids: ['fixed'], patch: { visible: false } })
    const order = () => childrenOf(session.design(), 'flow').map(([id]) => id)
    const before = order()
    selection.select(['fixed'], frame.id)
    actions.perform('nudgeRight')
    expect(order()).toEqual(before)
    expect(session.design().nodes.fixed?.props).toMatchObject({ x: 1, y: 0 })
    expect(log).not.toContain('placedByLayout')
  })
})
