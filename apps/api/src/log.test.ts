// The API's log lines: one JSON line on stdout each, with no email address or query values.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { logError, logEvent } from './log.ts'

/** The lines written, parsed. */
let lines: unknown[]

beforeEach(() => {
  lines = []
  vi.spyOn(console, 'log').mockImplementation((line: string) => void lines.push(JSON.parse(line)))
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('logEvent', () => {
  it('writes the event and its fields as one JSON line on stdout', () => {
    logEvent('sign-in-refused', { reason: 'early-access' })

    expect(lines).toEqual([{ event: 'sign-in-refused', reason: 'early-access' }])
  })
})

describe('logError', () => {
  it('writes the error’s kind, message, cause and stack, with emails and a failed query’s values left out', () => {
    const query = new Error('Failed query: select * from users where email = $1\nparams: ada@example.com', {
      cause: new Error('no reply from bo@example.com'),
    })

    logError('unexpected-error', query, { route: '/me' })

    expect(lines).toEqual([
      {
        event: 'unexpected-error',
        route: '/me',
        error: 'Error: Failed query: select * from users where email = $1\nparams: <left out>',
        cause: 'Error: no reply from <email>',
        stack: expect.stringContaining('log.test.ts'),
      },
    ])
    expect(JSON.stringify(lines)).not.toContain('example.com')
  })

  it('writes a thrown value that is not an error as its text', () => {
    logError('invite-unread', 'WorkOS is down for carol@example.com')

    expect(lines).toEqual([{ event: 'invite-unread', error: 'WorkOS is down for <email>' }])
  })
})
