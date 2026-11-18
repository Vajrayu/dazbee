import { CheckIcon, WarningCircleIcon } from '@/components/ui/icons.tsx'
import { cn } from '@/lib/cn.ts'

/** A short note: done, with a tick, or refused, in the danger colour. Long words break inside the panel. */
export function Note({ text, refused = false }: { text: string; refused?: boolean }) {
  return (
    <p
      role={refused ? 'alert' : 'status'}
      className={cn(
        'flex min-w-0 items-center gap-1.5 text-label [overflow-wrap:anywhere]',
        refused ? 'mt-2 text-danger' : 'text-muted',
      )}
    >
      {refused ? (
        <WarningCircleIcon size={16} weight="bold" aria-hidden className="shrink-0" />
      ) : (
        <CheckIcon size={16} weight="bold" aria-hidden className="shrink-0 text-success" />
      )}
      <span className="min-w-0">{text}</span>
    </p>
  )
}
