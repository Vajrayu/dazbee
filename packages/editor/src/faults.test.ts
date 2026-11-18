import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'

import { CommandError, CommandFault, openSession, readDesign } from '@dazbee/doc'
import { openTestStore } from '@dazbee/doc/test-store'

import { design } from './canvas/test-design.ts'
import type { NoticeDetail } from './core-interface.ts'
import { watchFaults } from './faults.ts'
import { pointerInput } from './gestures/test-inputs.ts'
import { runQuietly } from './run-quietly.ts'
import { faultOn, registerFaultyCommand, withFaulty } from './test-faults.ts'
import { stage } from './test-stage.ts'

const shape = {
  type: 'graphic',
  name: 'Shape',
  props: { x: 0, y: 0, width: 10, height: 10, shape: { kind: 'rect' } },
} as const

/**
 * A session on the test design with one layer, its faults watched: `stage.endOpen` is what a
 * fault asks of the stage, and the log holds that and what the page is told.
 */
function watched() {
  const log: string[] = []
  const store = openTestStore(design)
  const session = openSession(store)
  const stage = { endOpen: () => {} }
  watchFaults({
    session,
    endOpen: () => {
      log.push('end what is open')
      stage.endOpen()
    },
    notify: (...told: NoticeDetail) => log.push(`notice ${told[0]}`),
  })
  const id = session.run('node.create', { parentId: 'one-sq', layer: shape })
  const faulty = () => {
    throw faultOn(session, [id])
  }
  const x = () => readDesign(store).nodes[id]?.props.x
  return { session, id, log, stage, faulty, x }
}

/** What a run throws. */
const thrownBy = (run: () => unknown): unknown => {
  try {
    run()
  } catch (error) {
    return error
  }
  throw new Error('nothing was thrown')
}

describe('watchFaults', () => {
  const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
  registerFaultyCommand()
  afterEach(() => logged.mockClear())
  afterAll(() => logged.mockRestore())

  /** One fault was handled: the stage ended what was open, the page was told once, and the command and its cause were logged. */
  const expectHandledOnce = (log: string[], fault: unknown) => {
    expect(fault).toBeInstanceOf(CommandFault)
    expect(log).toEqual(['end what is open', 'notice notApplied'])
    expect(logged.mock.calls).toEqual([
      ['A command could not be applied:', 'test.throw', (fault as CommandFault).cause],
    ])
  }

  it('ends what is open once the step is put back: a drag whose move in a batch faults leaves nothing of the drag', () => {
    const { session, id, log, stage, faulty, x } = watched()
    const step = session.beginGesture()
    stage.endOpen = () => step.cancel()
    session.batch(() => runQuietly(() => session.run('node.update', { ids: [id], patch: { x: 20 } })))
    const fault = thrownBy(() => session.batch(() => runQuietly(faulty)))
    expectHandledOnce(log, fault)
    expect(x()).toBe(0)
    expect([session.inGesture(), session.canRedo()]).toEqual([false, false])
    // The one step left to undo is the layer's making.
    session.undo()
    expect([x(), session.canUndo()]).toEqual([undefined, false])
  })

  it('ends what is open after untracked is over: a command the stage runs then is a step to undo', () => {
    const { session, id, log, stage, faulty, x } = watched()
    stage.endOpen = () => session.run('node.update', { ids: [id], patch: { x: 5 } })
    expectHandledOnce(
      log,
      thrownBy(() => session.untracked(faulty)),
    )
    expect(x()).toBe(5)
    session.undo()
    expect(x()).toBe(0)
  })

  it('logs a fault raised while one is being handled, and handles it no further', () => {
    const { session, id, log, stage, faulty } = watched()
    stage.endOpen = () => session.run('test.throw' as never, { ids: [id] } as never)
    const fault = thrownBy(faulty)
    expect(fault).toBeInstanceOf(CommandFault)
    expect(log).toEqual(['end what is open', 'notice notApplied'])
    expect(logged.mock.calls.map(([, command]) => command)).toEqual(['test.throw', 'test.throw'])
  })

  it('logs what was thrown while the step was put back, too', () => {
    const { session, faulty } = watched()
    const failed = new Error('listener failed')
    let calls = 0
    session.onHistory(() => {
      if (++calls === 2) throw failed
    })
    const fault = thrownBy(faulty) as CommandFault
    expect(logged.mock.calls).toEqual([['A command could not be applied:', 'test.throw', fault.cause, failed]])
  })

  it('handles once a fault from a key, whose action runs its commands in a gesture', () => {
    const { session, log, faulty } = watched()
    const fault = thrownBy(() =>
      session.gesture(() => {
        runQuietly(faulty)
      }),
    )
    expectHandledOnce(log, fault)
  })

  it('handles once a fault from a call of the page, alone or in a batch', () => {
    const alone = watched()
    expectHandledOnce(alone.log, thrownBy(alone.faulty))
    logged.mockClear()
    const batched = watched()
    expectHandledOnce(
      batched.log,
      thrownBy(() => batched.session.batch(batched.faulty)),
    )
  })

  it('leaves a refusal, and what a command gives back, as they are', () => {
    const { session, id, log } = watched()
    expect(thrownBy(() => session.run('node.update', { ids: ['gone'], patch: { x: 1 } }))).toBeInstanceOf(CommandError)
    expect(session.run('node.duplicate', { ids: [id] })).toHaveLength(1)
    expect(session.batch(() => 'given back')).toBe('given back')
    expect(log).toEqual([])
    expect(logged).not.toHaveBeenCalled()
  })

  describe('with the real pointer, select press and move', () => {
    /** A pointer input of the main button at a stage point. */
    const event = (x: number, y: number) => pointerInput({ at: { x, y } })

    it('a move whose node.update faults drops the drag: the layer is where the press found it, and later moves reach no drag', () => {
      const { session, pointer, told, send, x } = stage()
      send('pointerdown', event(150, 150))
      send('pointermove', event(200, 150))
      expect([x(), pointer.gesture()?.kind, session.inGesture()]).toEqual([150, 'move', true])
      const fault = thrownBy(() => withFaulty('node.update', () => send('pointermove', event(260, 150))))
      expect(fault).toMatchObject({ name: 'CommandFault', command: 'node.update' })
      expect([x(), pointer.gesture(), session.inGesture()]).toEqual([100, null, false])
      expect([session.canUndo(), session.canRedo()]).toEqual([false, false])
      expect(told).toEqual(['notApplied'])
      send('pointermove', event(300, 150))
      send('pointerup', event(300, 150))
      expect([x(), session.canUndo()]).toEqual([100, false])
    })
  })
})
