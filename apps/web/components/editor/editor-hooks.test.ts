import { describe, expect, it } from 'vitest'

import { readOnlyStore } from '@/components/editor/editor-hooks.ts'

/** An editor's access as `useReadOnly` reads it, with a way to change it as a link that ends does. */
function access() {
  let readOnly = false
  const listeners = new Set<() => void>()
  return {
    editor: {
      readOnly: () => readOnly,
      onAccess: (listener: () => void) => {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },
    },
    flip: (to: boolean) => {
      readOnly = to
      for (const listener of listeners) listener()
    },
    listening: () => listeners.size,
  }
}

describe('readOnlyStore', () => {
  it('reads the access and tells its subscriber each time it changes, until it lets go', () => {
    const { editor, flip, listening } = access()
    const store = readOnlyStore(editor)
    let told = 0
    const stop = store.subscribe(() => told++)
    expect(store.read()).toBe(false)
    flip(true)
    expect([told, store.read()]).toEqual([1, true])
    stop()
    expect(listening()).toBe(0)
  })

  it('reads an editor not yet running as able to edit, and follows nothing', () => {
    const store = readOnlyStore(null)
    expect(store.read()).toBe(false)
    expect(() => store.subscribe(() => undefined)()).not.toThrow()
  })
})
