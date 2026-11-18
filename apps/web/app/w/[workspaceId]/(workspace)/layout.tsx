// The workspace's pages outside the editor (the Brands page and Settings) share one frame, so its
// capsule stays as they change.
import type { ReactNode } from 'react'

import { LibraryFrame } from '@/components/library/library-shell.tsx'
import { brandWords } from '@/lib/i18n/index.ts'
import { getMessages } from '@/lib/i18n/server.ts'

export default async function WorkspaceLayout({
  params,
  children,
}: {
  params: Promise<{ workspaceId: string }>
  children: ReactNode
}) {
  const [{ workspaceId }, t] = await Promise.all([params, getMessages()])
  return (
    <LibraryFrame t={t} words={brandWords(t)} workspaceId={workspaceId}>
      {children}
    </LibraryFrame>
  )
}
