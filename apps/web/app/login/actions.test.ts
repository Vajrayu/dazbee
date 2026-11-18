// Sign-in's start action, run in Node with the browser's cookies held in a map and the API's answers
// stubbed: the sign-in link it asks for, and the cookies it keeps for WorkOS's answer.
import { redirect } from 'next/navigation'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { INVITATION_COOKIE, STATE_COOKIE } from '@/lib/server/sign-in.ts'

import { start } from './actions.ts'

vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({
  cookies: vi.fn(),
  headers: vi.fn(async () => ({ get: () => 'http://localhost:3000' })),
}))
// Next's redirect ends the action by throwing; this one throws where it would send the person.
vi.mock('next/navigation', () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`redirect ${to}`)
  }),
}))

const { cookies } = await import('next/headers')

/** The browser's cookies as the action leaves them, by name, with the options each was set with. */
let jar: Map<string, { value: string; options: unknown }>
/** The queries the action asked the API's sign-in link with. */
let asked: string[]

const form = (fields: Record<string, string>) => {
  const data = new FormData()
  for (const [name, value] of Object.entries(fields)) data.set(name, value)
  return data
}

beforeEach(() => {
  jar = new Map()
  asked = []
  vi.mocked(redirect).mockClear()
  vi.mocked(cookies).mockResolvedValue({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)?.value } : undefined),
    set: (name: string, value: string, options: unknown) => void jar.set(name, { value, options }),
    delete: (name: string) => void jar.delete(name),
  } as unknown as Awaited<ReturnType<typeof cookies>>)
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      asked.push(new URL(url).search)
      return new Response(JSON.stringify({ url: 'https://auth.example.com/authorize' }), { status: 200 })
    }),
  )
})

describe('start', () => {
  it("passes the form's invitation token on to the sign-in link, and keeps it for a sign-in that fails", async () => {
    await expect(start(form({ invitation_token: 'invite_Token-1' }))).rejects.toThrow(
      'redirect https://auth.example.com/authorize',
    )

    expect(new URLSearchParams(asked[0]).get('invitationToken')).toBe('invite_Token-1')
    expect(jar.get(INVITATION_COOKIE)).toEqual({
      value: 'invite_Token-1',
      options: expect.objectContaining({ httpOnly: true, maxAge: 600 }),
    })
    expect(jar.has(STATE_COOKIE)).toBe(true)
  })

  it('keeps no token when the form brings none, forgetting one an earlier sign-in kept', async () => {
    jar.set(INVITATION_COOKIE, { value: 'an-older-token', options: {} })

    await expect(start(form({}))).rejects.toThrow('redirect https://auth.example.com/authorize')

    expect(new URLSearchParams(asked[0]).has('invitationToken')).toBe(false)
    expect(jar.has(INVITATION_COOKIE)).toBe(false)
  })

  it('keeps no token that no invite could have', async () => {
    await expect(start(form({ invitation_token: 'not a token' }))).rejects.toThrow('redirect')

    expect(jar.has(INVITATION_COOKIE)).toBe(false)
  })
})
