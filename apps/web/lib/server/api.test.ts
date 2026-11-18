// The server's API client, run in Node with the session cookie and the API's answers stubbed: the
// paths it asks the API for.
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getRole, getWorkspace, listDesigns, signInLink } from './api.ts'

/** The person `/me` answers with: the Owner of one workspace and an Editor in another. */
const ME = {
  id: 'user-1',
  name: 'Ada',
  email: 'ada@example.com',
  workspaces: [
    { id: 'workspace-1', name: 'Harbour', role: 'owner' },
    { id: 'workspace-2', name: 'Agency', role: 'editor' },
  ],
  open: 'workspace-1',
}

vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: () => undefined })),
}))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))

/** The paths the client asked the API for, in order. */
let asked: string[]
/** The same paths with their queries. */
let askedWithQuery: string[]

beforeEach(() => {
  asked = []
  askedWithQuery = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const { pathname: path, search } = new URL(url)
      asked.push(path)
      askedWithQuery.push(path + search)
      const body =
        path === '/me'
          ? ME
          : path === '/auth/sign-in-url'
            ? { url: 'https://auth.example.com/authorize' }
            : path.endsWith('/designs')
              ? []
              : { id: 'workspace-1', name: 'Harbour' }
      return new Response(JSON.stringify(body), { status: 200 })
    }),
  )
})

describe('signInLink', () => {
  it('asks for the sign-in link with the state alone when no invite brought the person', async () => {
    expect(await signInLink('a-state-of-sixteen-or-more')).toBe('https://auth.example.com/authorize')

    expect(askedWithQuery).toEqual(['/auth/sign-in-url?state=a-state-of-sixteen-or-more'])
  })

  it("passes on the token of the invite the person came from, so WorkOS's sign-in accepts it", async () => {
    await signInLink('a-state-of-sixteen-or-more', 'invite_Token-1')

    expect(askedWithQuery).toEqual([
      '/auth/sign-in-url?state=a-state-of-sixteen-or-more&invitationToken=invite_Token-1',
    ])
  })

  it('leaves out a token that no invite could have, so a mangled link still signs in', async () => {
    await signInLink('a-state-of-sixteen-or-more', 'not a token&x=1')

    expect(askedWithQuery).toEqual(['/auth/sign-in-url?state=a-state-of-sixteen-or-more'])
  })
})

describe('getRole', () => {
  it("gives the person's role in the workspace, typed in any case", async () => {
    expect(await getRole('WORKSPACE-2')).toBe('editor')
    expect(await getRole('workspace-1')).toBe('owner')
  })

  it("gives a Reviewer's role for a workspace that isn't theirs", async () => {
    expect(await getRole('workspace-3')).toBe('reviewer')
  })
})

describe('getWorkspace', () => {
  it('asks for the workspace by its id, in lower case as ids are, so a link typed in upper case opens it', async () => {
    await getWorkspace('Workspace-1')

    expect(asked).toEqual(['/workspaces/workspace-1'])
  })
})

describe('listDesigns', () => {
  it("asks for the brand's designs under its workspace", async () => {
    await listDesigns('WORKSPACE-1', 'brand-1')

    expect(asked).toEqual(['/workspaces/workspace-1/brands/brand-1/designs'])
  })
})
