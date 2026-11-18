// Where a page has nothing to show: Daz in a pose, a title, a line under it and, where there is one,
// a button, centred. Every such place in the app draws it, so they all look alike; a panel draws it
// tight, and a search that finds nothing draws Daz searching.
import type { ReactNode } from 'react'

import { cn } from '@/lib/cn.ts'
import { useMessages } from '@/lib/i18n/client.tsx'
import { format } from '@/lib/i18n/index.ts'

import { Mascot, type MascotPose } from './mascot.tsx'

export function EmptyState({
  pose,
  tight = false,
  size = tight ? 96 : 136,
  title,
  line,
  action,
  titleAs = tight ? 'p' : 'h2',
  className,
}: {
  pose: MascotPose
  /** The bee's width and height in pixels: 136, or 96 when tight. */
  size?: number
  title: string
  line?: string
  /** The one thing to do from here: a link or a button. */
  action?: ReactNode
  /** What the title is: an h1 where it is the page's only heading, a paragraph above a page's own h1 or under a panel's heading. */
  titleAs?: 'h1' | 'h2' | 'p'
  /**
   * A panel's layout: less room round it, smaller words, the title a paragraph under the panel's
   * heading, and a smaller bee on a phone, where a panel is a short sheet.
   */
  tight?: boolean
  className?: string | undefined
}) {
  const Title = titleAs
  return (
    <div
      data-empty-state={pose}
      data-tight={tight ? '' : undefined}
      className={cn(
        'flex min-w-0 flex-col items-center text-center text-balance',
        tight ? 'gap-1.5 px-4 py-6' : 'gap-3 px-6 py-10',
        className,
      )}
    >
      <Mascot pose={pose} size={size} className={tight ? 'mb-1 max-sm:size-16' : 'mb-1'} />
      <Title
        className={cn(
          'max-w-full font-display font-bold tracking-tight text-text [overflow-wrap:anywhere]',
          tight ? 'text-card' : 'text-heading',
        )}
      >
        {title}
      </Title>
      {line && (
        <p className={cn('max-w-md text-muted [overflow-wrap:anywhere]', tight ? 'text-label' : 'text-label')}>
          {line}
        </p>
      )}
      {action && <div className={tight ? 'mt-1.5' : 'mt-2'}>{action}</div>}
    </div>
  )
}

/** A panel's search that finds nothing for `query`: Daz searching, and a shorter word to try. */
export function NoMatch({ query, className }: { query: string; className?: string | undefined }) {
  const t = useMessages().editor.noMatch
  return <EmptyState pose="search" tight title={format(t.title, { query })} line={t.line} className={className} />
}
