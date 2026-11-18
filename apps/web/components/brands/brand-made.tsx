'use client'

// Over the brand home right after the brand is made: Daz celebrating, saying the brand is ready. It
// takes the just-made mark off the address as it shows, so a reload opens the home without it.
import { useEffect } from 'react'

import { EmptyState } from '@/components/ui/empty-state.tsx'
import { withoutMade } from '@/lib/brand-start.ts'
import { useMessages } from '@/lib/i18n/client.tsx'
import { format } from '@/lib/i18n/index.ts'

export function BrandMade({ brandName }: { brandName: string }) {
  const words = useMessages().library.made
  useEffect(() => {
    window.history.replaceState(null, '', withoutMade(window.location.href))
  }, [])
  return (
    <EmptyState
      pose="party"
      title={format(words.title, { brand: brandName })}
      line={words.line}
      titleAs="p"
      className="pt-0 pb-10 md:pb-14"
    />
  )
}
