import { describe, expect, it } from 'vitest'

import { RECENT_ACTIONS_KEY, recentActions } from './recent-actions.ts'

/** A device's storage, as a Map, which `throws` makes refuse every read and write. */
function storage(initial: Record<string, string> = {}, throws = false) {
  const kept = new Map(Object.entries(initial))
  return {
    kept,
    getItem(key: string) {
      if (throws) throw new Error('storage refused')
      return kept.get(key) ?? null
    },
    setItem(key: string, value: string) {
      if (throws) throw new Error('storage refused')
      kept.set(key, value)
    },
  }
}

describe('recentActions', () => {
  it('keeps the last five actions run, newest first, on the device', () => {
    const device = storage()
    const recent = recentActions(() => device)
    expect(recent.list()).toEqual([])
    for (const action of ['group', 'alignLeft', 'hide', 'lock', 'duplicate', 'toolRect'] as const) recent.record(action)
    expect(recent.list()).toEqual(['toolRect', 'duplicate', 'lock', 'hide', 'alignLeft'])
    expect(JSON.parse(device.kept.get(RECENT_ACTIONS_KEY) ?? '')).toEqual(recent.list())
    expect(RECENT_ACTIONS_KEY).toBe('dazbee.recentActions')
  })

  it('moves an action run again to the front, never listing it twice', () => {
    const device = storage()
    const recent = recentActions(() => device)
    for (const action of ['group', 'alignLeft', 'hide', 'group'] as const) recent.record(action)
    expect(recent.list()).toEqual(['group', 'hide', 'alignLeft'])
  })

  it('reads what another visit kept, dropping names that are no action and what is not a list of names', () => {
    const kept = (value: string) => recentActions(() => storage({ [RECENT_ACTIONS_KEY]: value })).list()
    expect(kept('["hide","noSuchAction",7,"group","hide"]')).toEqual(['hide', 'group'])
    expect(kept('{"hide":true}')).toEqual([])
    expect(kept('not json')).toEqual([])
    expect(kept('["a","b","c","d","e","f","group"]')).toEqual(['group'])
    expect(kept('["undo","redo","copy","cut","paste","lock","hide"]')).toEqual(['undo', 'redo', 'copy', 'cut', 'paste'])
  })

  it('keeps them for the visit when the device refuses its storage, or has none', () => {
    const refusing = recentActions(() => storage({}, true))
    refusing.record('group')
    refusing.record('hide')
    expect(refusing.list()).toEqual(['hide', 'group'])
    const none = recentActions(() => {
      throw new Error('no storage here')
    })
    none.record('lock')
    expect(none.list()).toEqual(['lock'])
  })
})
