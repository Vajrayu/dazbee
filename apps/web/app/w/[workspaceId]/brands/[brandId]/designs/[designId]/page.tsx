import { cookies } from 'next/headers'
import { notFound, redirect } from 'next/navigation'

import { AccountMenu } from '@/components/library/account-menu.tsx'
import { brandPath } from '@/lib/brand-routes.ts'
import { brandWords } from '@/lib/i18n/index.ts'
import { getMessages } from '@/lib/i18n/server.ts'
import { findDesign, getMe } from '@/lib/server/api.ts'
import { SESSION_COOKIE } from '@/lib/server/sign-in.ts'

import { EditorStage } from './stage.tsx'

export const metadata = { title: 'Dazbee editor' }

export default async function EditPage({
  params,
}: {
  params: Promise<{ workspaceId: string; brandId: string; designId: string }>
}) {
  const { workspaceId, brandId, designId } = await params
  // Ids are lower case, so a link typed or pasted in upper case opens the same design.
  if (
    workspaceId !== workspaceId.toLowerCase() ||
    brandId !== brandId.toLowerCase() ||
    designId !== designId.toLowerCase()
  )
    redirect(brandPath(workspaceId.toLowerCase(), brandId.toLowerCase(), 'designs', designId.toLowerCase()))
  const [found, me, t, jar] = await Promise.all([
    findDesign(workspaceId, brandId, designId),
    getMe(),
    getMessages(),
    cookies(),
  ])
  if (!found) notFound()
  return (
    <EditorStage
      designId={found.design.id}
      designName={found.design.name}
      member={found.design.member}
      brandId={found.brand.id}
      brandName={found.brand.name}
      everyBrand={brandWords(t).all}
      syncUrl={process.env.NEXT_PUBLIC_SYNC_URL ?? 'ws://localhost:1234'}
      account={
        <AccountMenu
          workspaceId={workspaceId}
          brandId={found.brand.id}
          name={me.name || me.email}
          signedIn={jar.has(SESSION_COOKIE)}
        />
      }
    />
  )
}
