'use client'

// The library's floating capsule: Home, Recent, Templates and Brand kit, each a page, with the
// editor capsule's blob, the pink pill, under the lit entry; Settings is in the account menu, as in
// the final mock. A layout renders it, so it stays as its pages change and the blob slides between
// entries.
import { animate, useReducedMotion } from 'motion/react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { type MouseEvent, useCallback, useLayoutEffect, useRef, useState } from 'react'

import { ClockIcon, HouseIcon, type Icon, PaletteIcon, SquaresFourIcon } from '@/components/ui/icons.tsx'
import { cn } from '@/lib/cn.ts'

export type CapsuleEntry = 'home' | 'recent' | 'templates' | 'kit'

export type CapsuleLink = { entry: CapsuleEntry; href: string; label: string; badge?: number | undefined }

const ICONS: Record<CapsuleEntry, Icon> = {
  home: HouseIcon,
  recent: ClockIcon,
  templates: SquaresFourIcon,
  kit: PaletteIcon,
}

/** The spring of the editor's flyout blob (components/editor/flyout-buttons.tsx). */
const BLOB = { type: 'spring', stiffness: 520, damping: 34, mass: 0.9 } as const

/** On arrival the blob is stretched along its travel and settles round: the squish. */
const SQUISH = { tall: [0.78, 1.28], wide: [1.28, 0.78] } as const

export function LibraryCapsule({
  label,
  links,
}: {
  /** The capsule's accessible name. */
  label: string
  /** The entries; the one whose page is shown is lit, and none on a page that has none, as Settings. */
  links: CapsuleLink[]
}) {
  const reduced = useReducedMotion()
  const pathname = usePathname()
  const current = links.find((link) => link.href === pathname)?.entry ?? null
  // A click that leaves the page lights its entry at once, before the next page comes; the page
  // that comes, or any other, ends it.
  const [leaving, setLeaving] = useState<CapsuleEntry | null>(null)
  const [shown, setShown] = useState(pathname)
  if (shown !== pathname) {
    setShown(pathname)
    setLeaving(null)
  }
  const lit = leaving ?? current
  const nav = useRef<HTMLElement>(null)
  const blob = useRef<HTMLSpanElement>(null)
  const fill = useRef<HTMLSpanElement>(null)
  const last = useRef<CapsuleEntry | null>(null)

  const rectOf = (entry: CapsuleEntry) =>
    nav.current?.querySelector(`[data-entry="${entry}"]`)?.getBoundingClientRect() ?? null

  const slideFrom = useCallback(
    (from: DOMRect | null) => {
      const element = blob.current
      if (!from || !element || reduced) return
      const to = element.getBoundingClientRect()
      const x = from.left - to.left
      const y = from.top - to.top
      if (!x && !y) return
      const [scaleX, scaleY] = Math.abs(x) > Math.abs(y) ? SQUISH.wide : SQUISH.tall
      animate(element, { x: [x, 0], y: [y, 0] }, BLOB)
      if (fill.current) animate(fill.current, { scaleX: [scaleX, 1], scaleY: [scaleY, 1] }, BLOB)
    },
    [reduced],
  )

  // The blob slides from the entry lit before.
  useLayoutEffect(() => {
    const from = last.current
    if (from && from !== lit) slideFrom(rectOf(from))
    last.current = lit
  }, [lit, slideFrom])

  const onClick = (entry: CapsuleEntry) => (event: MouseEvent) => {
    // A new tab or window keeps this page as it is.
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    if (entry !== lit) setLeaving(entry)
  }

  return (
    <nav
      ref={nav}
      aria-label={label}
      data-testid="library-capsule"
      className={cn(
        'fixed z-40 flex gap-2 rounded-full surface-frost p-2 md:p-2.5',
        // A vertical capsule at the start edge, as in the editor; on phones a tab bar at the bottom.
        'start-5 top-1/2 -translate-y-1/2 flex-col max-md:start-1/2 max-md:top-auto max-md:bottom-3 max-md:translate-y-0 max-md:flex-row max-md:-translate-x-1/2 max-md:rtl:translate-x-1/2',
      )}
    >
      {links.map(({ entry, href, label: name, badge }) => {
        const LinkIcon = ICONS[entry]
        const on = entry === lit
        return (
          <Link
            key={entry}
            href={href}
            aria-label={name}
            title={name}
            aria-current={entry === current ? 'page' : undefined}
            data-entry={entry}
            data-lit={on || undefined}
            onClick={onClick(entry)}
            className={cn(
              'relative grid size-11 place-items-center rounded-full transition-colors duration-[var(--chrome-fast)] md:size-13',
              // Lit, its icon is white on the pink blob, as the editor's open flyout's button is.
              on ? 'text-on-accent' : 'text-subtle hover:bg-hover hover:text-text active:bg-pressed active:text-text',
            )}
          >
            {on && (
              <span ref={blob} aria-hidden data-testid="capsule-blob" className="absolute inset-0">
                <span ref={fill} className="blob absolute inset-0 bg-accent-solid" />
              </span>
            )}
            <LinkIcon size={22} weight={on ? 'fill' : 'regular'} aria-hidden className="relative" />
            {badge !== undefined && badge > 0 && !on && (
              <span
                aria-hidden
                className="absolute -end-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-accent-solid px-1 text-micro font-bold text-on-accent tabular-nums"
              >
                {badge > 99 ? '99+' : badge}
              </span>
            )}
          </Link>
        )
      })}
    </nav>
  )
}
