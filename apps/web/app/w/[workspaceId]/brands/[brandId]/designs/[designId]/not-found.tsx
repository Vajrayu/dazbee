'use client'

// A design link the API gives nothing for, deleted or out of the member's reach: Daz with a lock, as
// the editor shows a design it can't open, with the way back to the brand's designs.
import Link from 'next/link'
import { useParams } from 'next/navigation'

import { FAILURE_LOOK } from '@/components/editor/design-opening.ts'
import { buttonStyles } from '@/components/ui/button.tsx'
import { EmptyState } from '@/components/ui/empty-state.tsx'
import { brandPath } from '@/lib/brand-routes.ts'
import { useMessages } from '@/lib/i18n/client.tsx'

export default function DesignNotFound() {
  const { workspaceId, brandId } = useParams<{ workspaceId: string; brandId: string }>()
  const notices = useMessages().editor.notices
  return (
    <main className="grid min-h-dvh place-items-center bg-bg">
      <EmptyState
        pose={FAILURE_LOOK.NoAccess.pose}
        titleAs="h1"
        title={notices.opening.outOfReach}
        line={notices.noAccess}
        action={
          <Link
            href={brandPath(workspaceId, brandId, 'designs')}
            className={buttonStyles({ variant: 'primary', size: 'lg' })}
          >
            {notices.backToDesigns}
          </Link>
        }
      />
    </main>
  )
}
