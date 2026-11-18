'use client'

// A page that threw while it was made: Daz, dizzy, with Try again, which fetches and draws the page again.
import { Button } from '@/components/ui/button.tsx'
import { EmptyState } from '@/components/ui/empty-state.tsx'
import { useMessages } from '@/lib/i18n/client.tsx'

export default function PageError({ retry }: { error: unknown; retry: () => void }) {
  const words = useMessages().pages.error
  return (
    <main className="grid min-h-dvh place-items-center bg-bg">
      <EmptyState
        pose="dizzy"
        titleAs="h1"
        title={words.title}
        line={words.line}
        action={
          <Button variant="primary" size="lg" onClick={() => retry()}>
            {words.action}
          </Button>
        }
      />
    </main>
  )
}
