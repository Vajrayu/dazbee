// The names of a session's undo steps: what a lone command, a gesture and a batch are called, and
// that the name of the step the next undo or redo reverts is the one the session gives, however
// commands, undos and redos and another tab's edits follow one another.
import { describe, expect, it } from 'vitest'

import type { Design } from '@dazbee/schema'

import type { StepName } from './commands/step-names.ts'
import type { Session } from './session.ts'
import { openTestSession } from './test-design.ts'
import { openTestStore, twoTabs } from './test-store.ts'

/** The names undo and redo would revert now. */
const names = (session: Session) => [session.undoName(), session.redoName()]

describe('undoName and redoName', () => {
  it('name a lone command’s step by the command, and nothing with no step', () => {
    const session = openTestSession(openTestStore())
    expect(names(session)).toEqual([null, null])
    session.run('node.rename', { id: 'box', name: 'Card' })
    expect(names(session)).toEqual(['rename', null])
    session.run('node.duplicate', { ids: ['box'] })
    expect(names(session)).toEqual(['duplicate', null])
  })

  it('name a gesture by the name it opened with, whatever its commands are', () => {
    const session = openTestSession(openTestStore())
    session.gesture('align', () => {
      session.run('node.rename', { id: 'box', name: 'Card' })
      session.run('node.update', { ids: ['box'], patch: { x: 5 } })
    })
    expect(names(session)).toEqual(['align', null])
    const step = session.beginGesture('move')
    session.run('node.update', { ids: ['box'], patch: { x: 6 } })
    session.run('node.update', { ids: ['box'], patch: { x: 7 } })
    step.end()
    expect(names(session)).toEqual(['move', null])
  })

  it('name a gesture opened without a name by its first command', () => {
    const session = openTestSession(openTestStore())
    session.gesture(() => {
      session.run('node.rename', { id: 'box', name: 'Card' })
      session.run('node.update', { ids: ['box'], patch: { x: 5 } })
    })
    expect(names(session)).toEqual(['rename', null])
    const step = session.beginGesture()
    session.run('node.update', { ids: ['box'], patch: { x: 6 } })
    session.run('node.rename', { id: 'box', name: 'Card 2' })
    step.end()
    expect(names(session)).toEqual(['edit', null])
  })

  it('name a batch by its own name, else its first command; inside a gesture, the gesture’s', () => {
    const session = openTestSession(openTestStore())
    session.batch('paste', () => {
      session.run('node.update', { ids: ['box'], patch: { x: 5 } })
    })
    expect(names(session)).toEqual(['paste', null])
    session.batch(() => {
      session.run('node.rename', { id: 'box', name: 'Card' })
      session.run('node.update', { ids: ['box'], patch: { x: 6 } })
    })
    expect(names(session)).toEqual(['rename', null])
    session.gesture('align', () => {
      session.batch('paste', () => session.run('node.update', { ids: ['box'], patch: { x: 7 } }))
      session.gesture('delete', () => session.run('node.update', { ids: ['box'], patch: { x: 8 } }))
    })
    expect(names(session)).toEqual(['align', null])
    const drag = session.beginGesture()
    session.batch('paste', () => session.run('node.rename', { id: 'box', name: 'Card 3' }))
    drag.end()
    expect(names(session)).toEqual(['rename', null])
  })

  it('carry each step’s name through undo and redo', () => {
    const session = openTestSession(openTestStore())
    session.run('node.rename', { id: 'box', name: 'Card' })
    session.gesture('align', () => session.run('node.update', { ids: ['box'], patch: { x: 5 } }))
    session.undo()
    expect(names(session)).toEqual(['rename', 'align'])
    session.undo()
    expect(names(session)).toEqual([null, 'rename'])
    session.redo()
    expect(names(session)).toEqual(['rename', 'align'])
    session.redo()
    expect(names(session)).toEqual(['align', null])
    session.undo()
    session.run('node.duplicate', { ids: ['box'] })
    expect(names(session)).toEqual(['duplicate', null])
  })

  it('list only this tab’s steps, with another tab’s edits between them', () => {
    const { tabA, tabB, sync } = twoTabs()
    tabA.run('node.rename', { id: 'box', name: 'Card' })
    sync()
    tabB.gesture('align', () => tabB.run('node.update', { ids: ['headline'], patch: { x: 9 } }))
    sync()
    tabA.gesture('move', () => tabA.run('node.update', { ids: ['box'], patch: { x: 5 } }))
    sync()
    tabB.run('node.duplicate', { ids: ['headline'] })
    sync()
    expect([names(tabA), names(tabB)]).toEqual([
      ['move', null],
      ['duplicate', null],
    ])
    tabA.undo()
    sync()
    expect([names(tabA), names(tabB)]).toEqual([
      ['rename', 'move'],
      ['duplicate', null],
    ])
    tabA.undo()
    sync()
    tabB.undo()
    sync()
    expect([names(tabA), names(tabB)]).toEqual([
      [null, 'rename'],
      ['align', 'duplicate'],
    ])
  })

  it('name the step on top, which a press drops for the step below when another tab overwrote all it wrote', () => {
    const { tabA, tabB, sync } = twoTabs()
    tabA.run('node.rename', { id: 'box', name: 'Card' })
    tabA.gesture('move', () => tabA.run('node.update', { ids: ['box'], patch: { x: 500 } }))
    sync()
    tabB.run('node.update', { ids: ['box'], patch: { x: 9 } })
    sync()
    expect(names(tabA)).toEqual(['move', null])
    tabA.undo()
    expect([tabA.design().nodes.box?.name, tabA.design().nodes.box?.props.x]).toEqual(['Box', 9])
    expect(names(tabA)).toEqual([null, 'rename'])
  })

  it('stay as they were after a refused step, which leaves no step', () => {
    const session = openTestSession(openTestStore())
    session.run('node.rename', { id: 'box', name: 'Card' })
    expect(() =>
      session.gesture('align', () => {
        session.run('node.update', { ids: ['box'], patch: { x: 5 } })
        session.run('node.update', { ids: ['gone'], patch: { x: 1 } })
      }),
    ).toThrow()
    expect(names(session)).toEqual(['rename', null])
  })
})

describe('onHistory', () => {
  it('tells its listeners once a step’s name is there to read', () => {
    const session = openTestSession(openTestStore())
    const heard: (StepName | null)[][] = []
    session.onHistory(() => heard.push(names(session)))
    session.run('node.rename', { id: 'box', name: 'Card' })
    session.undo()
    expect(heard.at(0)).toEqual(['rename', null])
    expect(heard.at(-1)).toEqual([null, 'rename'])
  })

  it('tells its listeners once, with the names then, after a press that dropped the only step and reverted nothing', () => {
    const { tabA, tabB, sync } = twoTabs()
    tabA.run('node.update', { ids: ['box'], patch: { x: 500 } })
    sync()
    tabB.run('node.update', { ids: ['box'], patch: { x: 9 } })
    sync()
    const heard: (StepName | null)[][] = []
    tabA.onHistory(() => heard.push(names(tabA)))
    tabA.undo()
    expect(tabA.design().nodes.box?.props.x).toBe(9)
    expect(heard).toEqual([[null, null]])
  })
})

describe('a walk of steps, undos and redos', () => {
  /** One of the first tab's steps: its name, and what it wrote, as read from a design. */
  interface Taken {
    name: StepName
    read: (design: Design) => unknown
    wrote: unknown
  }
  /** A step on the walk's own account of a stack, with what an undo or redo of it would leave. */
  interface Held extends Taken {
    leaves?: unknown
  }
  const box = (design: Design) => design.nodes.box
  /** The steps the first tab takes, each named as the session should name it. */
  const STEPS: ((session: Session, n: number) => Taken)[] = [
    (session, n) => {
      session.run('node.rename', { id: 'box', name: `A${n}` })
      return { name: 'rename', read: (d) => box(d)?.name, wrote: `A${n}` }
    },
    (session, n) => {
      session.run('node.update', { ids: ['headline'], patch: { x: n } })
      return { name: 'edit', read: (d) => d.nodes.headline?.props.x, wrote: n }
    },
    (session, n) => {
      session.gesture('align', () => session.run('node.update', { ids: ['box'], patch: { y: n } }))
      return { name: 'align', read: (d) => box(d)?.props.y, wrote: n }
    },
    (session) => {
      const [id] = session.gesture(() => session.run('node.duplicate', { ids: ['headline'] }))
      return { name: 'duplicate', read: (d) => id !== undefined && id in d.nodes, wrote: true }
    },
    (session, n) => {
      const step = session.beginGesture('move')
      session.run('node.update', { ids: ['box'], patch: { x: n } })
      session.run('node.update', { ids: ['box'], patch: { x: n + 1 } })
      step.end()
      return { name: 'move', read: (d) => box(d)?.props.x, wrote: n + 1 }
    },
  ]
  /** The second tab's writes, to the layers and properties the first tab writes. */
  const OVERWRITES: ((session: Session, n: number) => void)[] = [
    (session, n) => session.run('node.rename', { id: 'box', name: `B${n}` }),
    (session, n) => session.run('node.update', { ids: ['headline'], patch: { x: 10_000 + n } }),
    (session, n) => session.run('node.update', { ids: ['box'], patch: { y: 10_000 + n } }),
    (session, n) => session.run('node.update', { ids: ['box'], patch: { x: 10_000 + n } }),
  ]

  it('names before each press the step on top, takes back the topmost with something to take back, and hands the listeners the new top’s name', () => {
    let seed = 7
    const next = (below: number) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31
      return seed % below
    }
    const { tabA, tabB, sync } = twoTabs()
    let heard: (StepName | null)[] = []
    tabA.onHistory(() => (heard = names(tabA)))
    // What undo and redo would take back, as a stack each: the walk's own account of the steps.
    const done: Held[] = []
    const undone: Held[] = []
    let presses = 0
    /** The presses that dropped a step another tab overwrote. */
    let dropping = 0
    /** A press: the name shown before it is the top step's; it takes back the topmost step that still shows what it left. */
    const press = (which: 'undo' | 'redo', n: number) => {
      const [stack, other] = which === 'undo' ? [done, undone] : [undone, done]
      const shown = which === 'undo' ? tabA.undoName() : tabA.redoName()
      expect(shown, `before ${which} ${n}`).toBe(stack.at(-1)?.name ?? null)
      const design = tabA.design()
      const shows = (held: Held) => held.read(design) === (which === 'undo' ? held.wrote : held.leaves)
      if (stack.length > 0 && !shows(stack.at(-1) as Held)) dropping++
      while (stack.length > 0 && !shows(stack.at(-1) as Held)) stack.pop()
      const taken = stack.pop()
      tabA[which]()
      if (!taken) return
      const left = taken.read(tabA.design())
      expect(left, `${which} ${n} took back ${taken.name}`).not.toBe(which === 'undo' ? taken.wrote : taken.leaves)
      other.push(which === 'undo' ? { ...taken, leaves: left } : taken)
    }
    for (let n = 1; n <= 400; n++) {
      const pick = next(6)
      if (pick === 0 && done.length > 0) {
        press('undo', n)
        presses++
      } else if (pick === 1 && undone.length > 0) {
        press('redo', n)
        presses++
      } else if (pick === 2 || pick === 3) {
        ;(OVERWRITES[next(OVERWRITES.length)] as (typeof OVERWRITES)[number])(tabB, n)
        sync()
      } else {
        done.push((STEPS[next(STEPS.length)] as (typeof STEPS)[number])(tabA, n))
        undone.length = 0
      }
      sync()
      expect(names(tabA), `after step ${n}`).toEqual([done.at(-1)?.name ?? null, undone.at(-1)?.name ?? null])
      expect(heard, `heard after step ${n}`).toEqual(names(tabA))
    }
    expect([presses > 100, dropping > 10]).toEqual([true, true])
  })
})
