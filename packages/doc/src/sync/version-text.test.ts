import { describe, expect, it } from 'vitest'

import type { ServerMessage } from '@dazbee/schema'

import { versionText } from './version-text.ts'

describe('versionText', () => {
  it('writes the stored JSON into the version message as it is, and parses as that message', () => {
    const json = '{"meta":{"designId":"d","name":"D"},"pages":{},"frames":{},"nodes":{"a":{"name":"Ä \\"b\\""}}}'
    const text = versionText({ type: 'storedVersion', id: 'v1', stored: { json, schemaVersion: 6 } })

    expect(text).toContain(`"design":${json}}`)
    expect(JSON.parse(text) as ServerMessage).toEqual({
      type: 'version',
      id: 'v1',
      schemaVersion: 6,
      design: JSON.parse(json) as unknown,
    })
  })

  it('writes no version as nulls', () => {
    expect(JSON.parse(versionText({ type: 'storedVersion', id: 'gone', stored: null }))).toEqual({
      type: 'version',
      id: 'gone',
      schemaVersion: null,
      design: null,
    })
  })
})
