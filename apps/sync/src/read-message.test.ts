// A tab's message as the sync server reads it: JSON, nested no deeper than a change's value may be
// plus the message around it, so a frame nested past that is never parsed (D10).
import { describe, expect, it } from 'vitest'

import { SYNC_LIMITS } from '@dazbee/schema'

import { MESSAGE_DEPTH, readMessage } from './read-message.ts'

/** A value nested `depth` deep: an array is one level more than its deepest member. */
const nested = (depth: number): unknown => (depth === 0 ? 1 : [nested(depth - 1)])

/** A change set setting a value nested `depth` deep, as its text. */
const changeSet = (depth: number) =>
  JSON.stringify({
    type: 'changes',
    id: 1,
    base: 0,
    kind: 'edit',
    changes: [{ op: 'set', value: { part: 'layer', id: 'l', key: 'k' }, to: nested(depth) }],
  })

describe('readMessage', () => {
  it('reads a change set whose value is as deep as a value may be, and refuses one level more', () => {
    expect(MESSAGE_DEPTH).toBe(SYNC_LIMITS.valueDepth + 3)
    expect(readMessage(changeSet(SYNC_LIMITS.valueDepth))).toMatchObject({ type: 'changes' })
    expect(readMessage(changeSet(SYNC_LIMITS.valueDepth + 1))).toBeUndefined()
  })

  it('counts no bracket inside a string, nor an escaped quote as its end', () => {
    const text = JSON.stringify({ type: 'preview', after: 0, changes: [], note: `[[[{{{"\\\\"${'['.repeat(50)}` })
    expect(readMessage(text)).toMatchObject({ type: 'preview' })
  })

  it('refuses what is not JSON, and a frame nested far past the limit without parsing it', () => {
    expect(readMessage('{"type":')).toBeUndefined()
    expect(readMessage('')).toBeUndefined()
    const deep = `${'['.repeat(1_000_000)}${']'.repeat(1_000_000)}`
    expect(readMessage(deep)).toBeUndefined()
  })
})
