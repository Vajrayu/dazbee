import { describe, expect, it } from 'vitest'

import { readSessionToken, signSessionToken } from './index.ts'

const secret = 'test-session-secret-'.padEnd(32, 'x')

describe('session tokens', () => {
  const session = { userId: 'u', workosSessionId: null }

  it('round-trip the person and their WorkOS session without a workspace, even one a token was signed with', () => {
    const person = { userId: 'u', workosSessionId: 'session_1' }
    const { token, expiresAt } = signSessionToken(secret, person)
    expect(readSessionToken(secret, token)).toEqual({ ...person, expiresAt })
    const withWorkspace = { ...person, workspaceId: 'w' }
    const signed = signSessionToken(secret, withWorkspace)
    expect(readSessionToken(secret, signed.token)).toEqual({ ...person, expiresAt: signed.expiresAt })
  })

  it('reads back what was signed, until it expires', () => {
    const { token, expiresAt } = signSessionToken(secret, session, 1_000)
    expect(readSessionToken(secret, token, 2_000)).toEqual({ ...session, expiresAt })
    expect(readSessionToken(secret, token, expiresAt)).toBeNull()
  })

  it('refuses a token signed with another secret, changed, or malformed', () => {
    const { token } = signSessionToken(secret, session)
    expect(readSessionToken('another-secret-'.padEnd(32, 'y'), token)).toBeNull()
    const [text, signature] = token.split('.')
    const changed = Buffer.from(
      JSON.stringify({ ...session, userId: 'other', expiresAt: Date.now() + 60_000 }),
    ).toString('base64url')
    expect(readSessionToken(secret, `${changed}.${signature}`)).toBeNull()
    expect(readSessionToken(secret, text ?? '')).toBeNull()
    expect(readSessionToken(secret, `${token}.more`)).toBeNull()
  })
})
