'use client'

// The Brand kit page's form (#200): the kit's whole form, laid out wide, so a brand's colours, fonts,
// logo and voice are set before any design. A change shows in the brief's kit picker at once and is
// saved a moment later. While the kit has nothing in it, Daz says so, and Edit kit shows the form.
import { useEffect, useState } from 'react'

import type { BrandKit } from '@dazbee/schema'

import { Button } from '@/components/ui/button.tsx'
import { EmptyState } from '@/components/ui/empty-state.tsx'
import { useMessages } from '@/lib/i18n/client.tsx'

import { KitEditor, useKitSaver } from './kit-editor.tsx'
import { kitIsEmpty } from './kit-empty.ts'
import { loadKit, useBrandKit } from './use-brand-kit.ts'

export function KitPage({
  workspaceId,
  brandId,
  kit: first,
}: {
  workspaceId: string
  brandId: string
  /** The kit as the page came with it, shown until the shared copy has it. */
  kit: BrandKit
}) {
  const kit = useBrandKit(workspaceId, brandId, first) ?? first
  const { change, error } = useKitSaver(workspaceId, brandId)
  const words = useMessages().library.emptyKit
  // Edit kit was pressed: the form stays once it shows, even while the kit is still empty.
  const [editing, setEditing] = useState(false)
  // Fetched again as the panel opens, for a change made in another tab since the page came.
  useEffect(() => {
    void loadKit(workspaceId, brandId)
  }, [workspaceId, brandId])
  if (!editing && kitIsEmpty(kit))
    return (
      <EmptyState
        pose="palette"
        title={words.title}
        line={words.line}
        action={
          <Button variant="primary" size="lg" onClick={() => setEditing(true)}>
            {words.action}
          </Button>
        }
      />
    )
  return (
    <div data-testid="home-kit">
      <KitEditor workspaceId={workspaceId} brandId={brandId} kit={kit} change={change} error={error} wide />
    </div>
  )
}
