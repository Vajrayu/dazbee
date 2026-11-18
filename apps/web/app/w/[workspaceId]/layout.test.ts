// The workspace's layout, run in Node with the API stubbed: which workspace it asks the API about,
// and what a workspace the person isn't in shows.
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiFailure, getWorkspace } from '@/lib/server/api.ts'

import WorkspaceIdLayout from './layout.tsx'

vi.mock('server-only', () => ({}))
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('not found')
  }),
}))
vi.mock('@/lib/server/api.ts', async (original) => ({
  ApiFailure: (await original<typeof import('@/lib/server/api.ts')>()).ApiFailure,
  getWorkspace: vi.fn(),
}))

const { notFound } = await import('next/navigation')

const open = (workspaceId: string) => WorkspaceIdLayout({ params: Promise.resolve({ workspaceId }), children: 'page' })

beforeEach(() => {
  vi.mocked(getWorkspace).mockReset()
  vi.mocked(getWorkspace).mockResolvedValue({ id: 'workspace-1', name: 'Harbour' })
  vi.mocked(notFound).mockClear()
})

describe('WorkspaceIdLayout', () => {
  it("shows a member's page", async () => {
    expect(await open('workspace-1')).toBe('page')
    expect(getWorkspace).toHaveBeenCalledWith('workspace-1')
  })

  it("shows the not-found page for a workspace the person isn't in", async () => {
    vi.mocked(getWorkspace).mockRejectedValue(new ApiFailure(404, 'No such workspace'))

    await expect(open('someone-elses')).rejects.toThrow('not found')
    expect(notFound).toHaveBeenCalled()
  })

  it('passes on any other failure', async () => {
    vi.mocked(getWorkspace).mockRejectedValue(new ApiFailure(500, 'The API answered 500'))

    await expect(open('workspace-1')).rejects.toThrow('The API answered 500')
    expect(notFound).not.toHaveBeenCalled()
  })
})
