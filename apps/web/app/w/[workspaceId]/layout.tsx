// Every page of a workspace sits under its id (ADR-0016). A workspace the person isn't a member of is
// answered as if it did not exist: the app's not-found page.
import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'

import { ApiFailure, getWorkspace } from '@/lib/server/api.ts'

export default async function WorkspaceIdLayout({
  params,
  children,
}: {
  params: Promise<{ workspaceId: string }>
  children: ReactNode
}) {
  const { workspaceId } = await params
  try {
    await getWorkspace(workspaceId)
  } catch (e) {
    if (e instanceof ApiFailure && e.status === 404) notFound()
    throw e
  }
  return children
}
