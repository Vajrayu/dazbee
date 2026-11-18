// A brand's pages outside the editor (home, Recent, Templates, Brand kit) share one frame, so its
// capsule stays as they change and its blob slides from page to page.
import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'

import { LibraryFrame } from '@/components/library/library-shell.tsx'
import { brandWords } from '@/lib/i18n/index.ts'
import { getMessages } from '@/lib/i18n/server.ts'
import { listBrands, listDesigns } from '@/lib/server/api.ts'

export default async function BrandLibraryLayout({
  params,
  children,
}: {
  params: Promise<{ workspaceId: string; brandId: string }>
  children: ReactNode
}) {
  const { workspaceId, brandId } = await params
  const [t, brands] = await Promise.all([getMessages(), listBrands(workspaceId)])
  if (!brands.some((brand) => brand.id === brandId)) notFound()
  const designs = await listDesigns(workspaceId, brandId)
  return (
    <LibraryFrame t={t} words={brandWords(t)} workspaceId={workspaceId} brandId={brandId} recentCount={designs.length}>
      {children}
    </LibraryFrame>
  )
}
