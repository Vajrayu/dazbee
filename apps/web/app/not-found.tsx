// A link that leads to no page, or to a brand or design that isn't there: Daz, lost, with the way home.
import Link from 'next/link'

import { buttonStyles } from '@/components/ui/button.tsx'
import { EmptyState } from '@/components/ui/empty-state.tsx'
import { getMessages } from '@/lib/i18n/server.ts'

export default async function NotFound() {
  const words = (await getMessages()).pages.notFound
  return (
    <main className="grid min-h-dvh place-items-center bg-bg">
      <EmptyState
        pose="lost"
        titleAs="h1"
        title={words.title}
        line={words.line}
        action={
          <Link href="/" className={buttonStyles({ variant: 'primary', size: 'lg' })}>
            {words.action}
          </Link>
        }
      />
    </main>
  )
}
