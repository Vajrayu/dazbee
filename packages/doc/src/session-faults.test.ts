// A fault in a session: its step put back in every setting a command runs in, what counts as one,
// and how the session's listeners are told of it.
import { describe, expect, it } from 'vitest'

import { CommandError } from './commands/define.ts'
import { CommandFault, type Session } from './session.ts'
import { type DesignStore, readDesign } from './store.ts'
import { type Buggy, registerBuggyCommands } from './test-commands.ts'
import { badge, openTestSession, thrownBy } from './test-design.ts'
import { openTestStore } from './test-store.ts'

describe('a fault', () => {
  registerBuggyCommands()

  const buggy = (session: Session, name: Buggy, id: string) => session.run(name as never, { id } as never)
  /** A session on the test design in `store` after one step, a move of the box, with the design it then has. */
  const moved = (store: DesignStore = openTestStore()) => {
    const session = openTestSession(store)
    const start = readDesign(store)
    session.run('node.update', { ids: ['box'], patch: { x: 11 } })
    return { store, session, start, before: readDesign(store) }
  }
  /** Nothing of a faulted step is left: the design is as before it, and the one step to undo is the move before it. */
  const expectPutBack = ({ store, session, start, before }: ReturnType<typeof moved>) => {
    expect(readDesign(store)).toEqual(before)
    expect(session.design()).toEqual(before)
    expect([session.inGesture(), session.canUndo(), session.canRedo()]).toEqual([false, true, false])
    session.undo()
    expect(readDesign(store)).toEqual(start)
    expect(session.canUndo()).toBe(false)
  }

  it.each(['test.throw', 'test.spoil'] as const)(
    'in a command alone (%s) puts back all it wrote, leaves no step of it, and throws a CommandFault naming it',
    (name) => {
      const tab = moved()
      const fault = thrownBy(() => buggy(tab.session, name, 'box'))
      expect(fault).toBeInstanceOf(CommandFault)
      expect(fault).not.toBeInstanceOf(CommandError)
      expect(fault).toMatchObject({ name: 'CommandFault', command: name, input: { id: 'box' } })
      expect(String((fault as CommandFault).cause)).toMatch(
        name === 'test.throw' ? 'boom' : 'layer "box": props.width: Too small',
      )
      expectPutBack(tab)
    },
  )

  it.each(['test.throw', 'test.spoil'] as const)(
    'inside gesture (%s) puts back all the gesture wrote and closes it',
    (name) => {
      const tab = moved()
      const fault = thrownBy(() =>
        tab.session.gesture(() => {
          tab.session.run('node.update', { ids: ['headline'], patch: { x: 20 } })
          tab.session.run('node.create', { parentId: 'sq', layer: badge })
          buggy(tab.session, name, 'box')
        }),
      )
      expect(fault).toMatchObject({ name: 'CommandFault', command: name })
      expectPutBack(tab)
    },
  )

  it.each(['test.throw', 'test.spoil'] as const)('inside batch (%s) puts back all the batch wrote', (name) => {
    const tab = moved()
    const fault = thrownBy(() =>
      tab.session.batch(() => {
        tab.session.run('node.update', { ids: ['headline'], patch: { x: 20 } })
        tab.session.run('node.rename', { id: 'banner-headline', name: 'Renamed' })
        buggy(tab.session, name, 'box')
        tab.session.run('node.update', { ids: ['banner-box'], patch: { x: 30 } })
      }),
    )
    expect(fault).toBeInstanceOf(CommandFault)
    // A batch's commands are read together after it: when the design no longer reads, the fault names the batch.
    expect((fault as CommandFault).command).toBe(name === 'test.throw' ? name : 'batch')
    expectPutBack(tab)
  })

  it('inside batch is thrown by the batch even when its steps caught it', () => {
    const tab = moved()
    const fault = thrownBy(() =>
      tab.session.batch(() => {
        tab.session.run('node.update', { ids: ['headline'], patch: { x: 20 } })
        thrownBy(() => buggy(tab.session, 'test.throw', 'box'))
      }),
    )
    expect(fault).toMatchObject({ name: 'CommandFault', command: 'test.throw' })
    expectPutBack(tab)
  })

  it.each(['test.throw', 'test.spoil'] as const)(
    "inside a drag's gesture (%s) cancels the gesture: its earlier moves are put back too, and its step does nothing after",
    (name) => {
      const tab = moved()
      const step = tab.session.beginGesture()
      tab.session.run('node.update', { ids: ['headline'], patch: { x: 20 } })
      tab.session.run('node.update', { ids: ['headline'], patch: { x: 30 } })
      expect(thrownBy(() => buggy(tab.session, name, 'box'))).toBeInstanceOf(CommandFault)
      step.end()
      step.cancel()
      expectPutBack(tab)
    },
  )

  it("a command refused in a drag's gesture leaves the gesture open with its earlier moves", () => {
    const tab = moved()
    const step = tab.session.beginGesture()
    tab.session.run('node.update', { ids: ['headline'], patch: { x: 20 } })
    expect(thrownBy(() => tab.session.run('node.update', { ids: ['gone'], patch: { x: 1 } }))).toBeInstanceOf(
      CommandError,
    )
    expect(tab.session.inGesture()).toBe(true)
    tab.session.run('node.update', { ids: ['headline'], patch: { x: 30 } })
    step.end()
    expect(tab.session.design().nodes.headline?.props.x).toBe(30)
    tab.session.undo()
    expect(readDesign(tab.store)).toEqual(tab.before)
  })

  it.each(['test.throw', 'test.spoil'] as const)(
    'inside untracked (%s) puts back the command alone, and the history is as it was',
    (name) => {
      const tab = moved()
      const fault = thrownBy(() =>
        tab.session.untracked(() => {
          tab.session.run('node.update', { ids: ['headline'], patch: { y: 22 } })
          buggy(tab.session, name, 'box')
        }),
      )
      expect(fault).toMatchObject({ name: 'CommandFault', command: name })
      // The untracked command before it stays: each is a step of its own.
      expect(tab.session.design().nodes.headline?.props.y).toBe(22)
      expect(tab.session.design().nodes.box?.props).toMatchObject({ x: 11, width: 200 })
      expect([tab.session.canUndo(), tab.session.canRedo()]).toEqual([true, false])
      tab.session.undo()
      expect(tab.session.design().nodes).toMatchObject({ box: { props: { x: 100 } }, headline: { props: { y: 22 } } })
    },
  )

  it.each([
    ['gesture', (session: Session) => session.gesture],
    ['batch', (session: Session) => session.batch],
  ] as const)('inside %s inside untracked puts back all that step wrote', (_, within) => {
    const tab = moved()
    const fault = thrownBy(() =>
      tab.session.untracked(() =>
        within(tab.session)(() => {
          tab.session.run('node.update', { ids: ['headline'], patch: { y: 22 } })
          buggy(tab.session, 'test.throw', 'box')
        }),
      ),
    )
    expect(fault).toBeInstanceOf(CommandFault)
    expectPutBack(tab)
  })

  it('in a command after which the read has to repair what it did not before is put back', () => {
    const store = openTestStore()
    const tab = moved(store)
    const fault = thrownBy(() => buggy(tab.session, 'test.orphan', 'headline'))
    expect(fault).toMatchObject({ name: 'CommandFault', command: 'test.orphan' })
    expect(String((fault as CommandFault).cause)).toMatch('dropped "headline", which is in no frame')
    expectPutBack(tab)
  })

  it('keeps the steps before it when a listener throws while it is put back, and is thrown with what the listener threw', () => {
    const tab = moved()
    tab.session.run('node.update', { ids: ['box'], patch: { y: 22 } })
    const failed = new Error('listener failed')
    let calls = 0
    tab.session.onHistory(() => {
      if (++calls === 2) throw failed
    })
    const fault = thrownBy(() => buggy(tab.session, 'test.throw', 'box'))
    expect(fault).toBeInstanceOf(CommandFault)
    expect(fault).toMatchObject({ command: 'test.throw', putBackError: failed })
    expect(tab.session.design().nodes.box?.props).toMatchObject({ x: 11, y: 22 })
    expect([tab.session.canUndo(), tab.session.canRedo()]).toEqual([true, false])
    tab.session.undo()
    expect(tab.session.design().nodes.box?.props).toMatchObject({ x: 11, y: 100 })
    tab.session.undo()
    expect(readDesign(tab.store)).toEqual(tab.start)
  })

  it('is told to the listeners once, when the session is at rest: a handler that cancels the drag finds it put back already', () => {
    const tab = moved()
    const told: CommandFault[] = []
    const step = tab.session.beginGesture()
    tab.session.onFault((fault) => {
      told.push(fault)
      expect([tab.store.inTransaction(), tab.session.inGesture()]).toEqual([false, false])
      step.cancel()
    })
    tab.session.batch(() => tab.session.run('node.update', { ids: ['headline'], patch: { x: 20 } }))
    const fault = thrownBy(() => tab.session.batch(() => buggy(tab.session, 'test.throw', 'box')))
    expect(told).toEqual([fault])
    expectPutBack(tab)
  })

  it('is told after untracked has given the session back its history: a command its handler runs is a step to undo', () => {
    const tab = moved()
    tab.session.onFault(() => tab.session.run('node.update', { ids: ['headline'], patch: { y: 5 } }))
    expect(thrownBy(() => tab.session.untracked(() => buggy(tab.session, 'test.throw', 'box')))).toBeInstanceOf(
      CommandFault,
    )
    expect(tab.session.design().nodes).toMatchObject({ box: { props: { x: 11 } }, headline: { props: { y: 5 } } })
    tab.session.undo()
    expect(readDesign(tab.store)).toEqual(tab.before)
    tab.session.undo()
    expect(readDesign(tab.store)).toEqual(tab.start)
  })

  it('is told once though it passes through a batch and a gesture, and is still what the caller gets when a listener throws', () => {
    const tab = moved()
    const told: unknown[] = []
    const off = tab.session.onFault((fault) => {
      told.push(fault)
      throw new Error('listener failed')
    })
    const inside = () => tab.session.gesture(() => tab.session.batch(() => buggy(tab.session, 'test.throw', 'box')))
    const fault = thrownBy(inside)
    expect(fault).toBeInstanceOf(CommandFault)
    expect(told).toEqual([fault])
    off()
    thrownBy(inside)
    expect(told).toHaveLength(1)
    expectPutBack(tab)
  })

  it('in a call to untracked that waited for a gesture (C40) is told once the gesture ends, which throws nothing', () => {
    const tab = moved()
    const told: unknown[] = []
    tab.session.onFault((fault) => told.push(fault))
    const step = tab.session.beginGesture()
    tab.session.run('node.update', { ids: ['headline'], patch: { y: 5 } })
    tab.session.untracked(() => buggy(tab.session, 'test.throw', 'box'))
    tab.session.untracked(() => tab.session.run('node.update', { ids: ['headline'], patch: { x: 7 } }))
    expect(told).toEqual([])
    step.end()
    expect(told).toHaveLength(1)
    expect(told[0]).toBeInstanceOf(CommandFault)
    expect(readDesign(tab.store).nodes).toMatchObject({
      box: { props: { x: 11 } },
      headline: { props: { x: 7, y: 5 } },
    })
  })

  it('in a gesture runs the calls to untracked that waited for it, once the gesture is put back (C40)', () => {
    const tab = moved()
    const step = tab.session.beginGesture()
    tab.session.untracked(() => tab.session.run('node.update', { ids: ['headline'], patch: { x: 7 } }))
    expect(thrownBy(() => buggy(tab.session, 'test.throw', 'box'))).toBeInstanceOf(CommandFault)
    expect([tab.session.inGesture(), readDesign(tab.store).nodes.headline?.props.x]).toEqual([false, 7])
    step.end()
  })

  it('is what a waiting call to untracked throws otherwise, told as a fault of untracked: the gesture’s end throws nothing', () => {
    const tab = moved()
    const told: CommandFault[] = []
    tab.session.onFault((fault) => told.push(fault))
    const step = tab.session.beginGesture()
    tab.session.untracked(() => {
      throw new Error('not a fault')
    })
    tab.session.untracked(() => tab.session.run('node.update', { ids: ['headline'], patch: { x: 7 } }))
    step.end()
    expect(told.map((fault) => [fault.command, fault.message])).toEqual([['untracked', 'untracked: not a fault']])
    expect([tab.session.inGesture(), readDesign(tab.store).nodes.headline?.props.x]).toEqual([false, 7])
  })

  it('in a cancel’s put-back still runs the calls to untracked that waited, and none is left for later', () => {
    const tab = moved()
    const step = tab.session.beginGesture()
    tab.session.run('node.update', { ids: ['box'], patch: { y: 5 } })
    tab.session.untracked(() => tab.session.run('node.update', { ids: ['headline'], patch: { x: 7 } }))
    const stop = tab.store.onChange(() => {
      stop()
      throw new Error('a listener broke')
    })
    expect(String(thrownBy(() => step.cancel()))).toMatch('a listener broke')
    expect([tab.session.inGesture(), readDesign(tab.store).nodes.headline?.props.x]).toEqual([false, 7])
    const later = tab.session.beginGesture()
    tab.session.run('node.update', { ids: ['box'], patch: { y: 9 } })
    later.end()
    expect(readDesign(tab.store).nodes.headline?.props.x).toBe(7)
  })

  it('is told of a fault its steps caught, once the outermost call returns', () => {
    const tab = moved()
    const told: unknown[] = []
    tab.session.onFault((fault) => told.push(fault))
    let caught: unknown
    tab.session.untracked(() => {
      caught = thrownBy(() => buggy(tab.session, 'test.throw', 'box'))
      expect(told).toEqual([])
    })
    expect(told).toEqual([caught])
  })
})

describe('a fault in a gesture after a press of undo or redo that took a step', () => {
  registerBuggyCommands()

  /** The box moved to 5, then 6; with `undone`, the move to 6 is undone. A gesture that writes nothing yet is open. */
  const twoMoves = (undone: boolean) => {
    const session = openTestSession(openTestStore())
    session.run('node.update', { ids: ['box'], patch: { x: 5 } })
    session.run('node.update', { ids: ['box'], patch: { x: 6 } })
    if (undone) session.undo()
    return { session, drag: session.beginGesture() }
  }

  it.each([
    ['undo', false, 5],
    ['redo', true, 6],
  ] as const)('puts back only what came after the %s, which stays', (press, undone, x) => {
    const { session, drag } = twoMoves(undone)
    session[press]()
    expect(session.design().nodes.box?.props.x).toBe(x)
    expect(() => session.run('test.throw' as never, { id: 'box' } as never)).toThrow(CommandFault)
    expect(session.design().nodes.box?.props.x).toBe(x)
    expect(session.inGesture()).toBe(false)
    drag.end()
  })
})
