// A Reviewer's session (C35): while it is read-only, every write is refused whole and writes
// nothing, while a gesture still opens, so the editor can select and go into texts; changes no one
// undoes run nothing, and the refusals are told so the editor can say View only.
import { describe, expect, it } from 'vitest'

import { CommandError } from './commands/define.ts'
import { VIEW_ONLY } from './session.ts'
import { openTestSession } from './test-design.ts'
import { openTestStore } from './test-store.ts'

/** A session whose read-only state a test sets, with the refusals it told. */
function reviewer() {
  let readOnly = false
  const session = openTestSession(openTestStore(), { readOnly: () => readOnly })
  const told: string[] = []
  session.onReadOnly((refused) => told.push(refused.command))
  return {
    session,
    told,
    set: (to: boolean) => {
      readOnly = to
    },
    name: () => session.design().nodes.box?.name,
  }
}

/** What `call` threw, or undefined. */
function thrown(call: () => unknown): unknown {
  try {
    call()
  } catch (error) {
    return error
  }
  return undefined
}

const viewOnly = (error: unknown) =>
  error instanceof CommandError && error.kind === 'refused' && error.reason === VIEW_ONLY

describe('a read-only session', () => {
  it('refuses a command, a batch, undo and redo, writing nothing, and tells each refusal', () => {
    const r = reviewer()
    r.session.run('node.rename', { id: 'box', name: 'Mine' })
    r.session.undo()
    r.set(true)
    expect(viewOnly(thrown(() => r.session.run('node.rename', { id: 'box', name: 'Card' })))).toBe(true)
    expect(viewOnly(thrown(() => r.session.batch(() => r.session.run('node.rename', { id: 'box', name: 'B' }))))).toBe(
      true,
    )
    expect(viewOnly(thrown(() => r.session.redo()))).toBe(true)
    expect(r.name()).not.toBe('Mine')
    expect(r.session.canRedo()).toBe(true)
    r.set(false)
    r.session.redo()
    expect(r.name()).toBe('Mine')
    r.set(true)
    expect(viewOnly(thrown(() => r.session.undo()))).toBe(true)
    expect(r.name()).toBe('Mine')
    expect(r.told).toEqual(['node.rename', 'batch', 'redo', 'undo'])
  })

  it('opens and ends a gesture, refusing the writes in it, which leave it open and are no fault', () => {
    const r = reviewer()
    const faults: unknown[] = []
    r.session.onFault((fault) => faults.push(fault))
    r.set(true)
    const step = r.session.beginGesture('move')
    expect(r.session.inGesture()).toBe(true)
    expect(viewOnly(thrown(() => r.session.run('node.update', { ids: ['box'], patch: { x: 50 } })))).toBe(true)
    expect(r.session.inGesture()).toBe(true)
    step.end()
    expect(r.session.inGesture()).toBe(false)
    expect(r.session.gesture(() => 'read')).toBe('read')
    expect(faults).toEqual([])
    expect(r.session.canUndo()).toBe(false)
  })

  it('runs no change nobody undoes, and tells no refusal for one', () => {
    const r = reviewer()
    r.set(true)
    let ran = false
    expect(
      r.session.untracked(() => {
        ran = true
        r.session.run('node.rename', { id: 'box', name: 'Kit' })
      }),
    ).toBeUndefined()
    expect(ran).toBe(false)
    expect(r.told).toEqual([])
  })

  it('runs nothing that waited for a gesture during which it turned read-only', () => {
    const r = reviewer()
    const step = r.session.beginGesture('move')
    r.session.run('node.update', { ids: ['box'], patch: { x: 50 } })
    let ran = false
    r.session.untracked(() => {
      ran = true
      r.session.run('node.rename', { id: 'box', name: 'Kit' })
    })
    r.set(true)
    step.end()
    expect(ran).toBe(false)
    expect(r.name()).not.toBe('Kit')
    expect(r.told).toEqual([])
  })

  it('runs commands again once it can edit', () => {
    const r = reviewer()
    r.set(true)
    thrown(() => r.session.run('node.rename', { id: 'box', name: 'Card' }))
    r.set(false)
    r.session.run('node.rename', { id: 'box', name: 'Card' })
    expect(r.name()).toBe('Card')
    expect(r.session.canUndo()).toBe(true)
  })
})
