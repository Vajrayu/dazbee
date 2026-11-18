'use client'

// The bee over a design while it opens, and the bee and words of a design that can't be opened, or
// that the sync server stopped while it was open.
import Link from 'next/link'
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'

import { buttonStyles } from '@/components/ui/button.tsx'
import { EmptyState } from '@/components/ui/empty-state.tsx'
import { Mascot } from '@/components/ui/mascot.tsx'
import { brandPath } from '@/lib/brand-routes.ts'
import { useValue, type ValueStore } from '@/lib/editor/value-store.ts'
import { useMessages } from '@/lib/i18n/client.tsx'
import type { Messages } from '@/lib/i18n/index.ts'

import {
  BEE_GONE_BY_MS,
  beeAfter,
  type BeePhase,
  FAILURE_LOOK,
  failureOf,
  leaveWait,
  OFFLINE_GRACE_MS,
  type OpenFailure,
} from './design-opening.ts'

/** The title and line each failure shows. */
const failureWords = (t: Messages, failure: OpenFailure): { title: string; line: string } => {
  const notices = t.editor.notices
  const states = t.editor.statusText
  switch (failure) {
    case 'Deleted':
      return { title: notices.opening.outOfReach, line: notices.designDeleted }
    case 'NoAccess':
      return { title: notices.opening.outOfReach, line: notices.noAccess }
    case 'Outdated':
      return { title: states.Outdated ?? failure, line: notices.reloadToUpdate }
    case 'Replaced':
      return { title: states.Replaced ?? failure, line: notices.openElsewhere }
    case 'offline':
      return notices.opening.offline
    case 'error':
      return t.pages.error
  }
}

const subscribeOnline = (changed: () => void) => {
  window.addEventListener('online', changed)
  window.addEventListener('offline', changed)
  return () => {
    window.removeEventListener('online', changed)
    window.removeEventListener('offline', changed)
  }
}

/** Whether the browser has a network, re-rendering the caller when that changes. */
const useOnline = () =>
  useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  )

/** Why the design is not open, from the editor's status and the network, or null while it opens or is open. */
function useOpenFailure(status: ValueStore<string>) {
  const state = useValue(status)
  const online = useOnline()
  const waiting = state === 'Connecting' && !online
  // Set once a first visit has waited the grace with no network, so a kept copy opening offline never flashes it.
  const [stuckOffline, setStuckOffline] = useState(false)
  useEffect(() => {
    if (!waiting) {
      setStuckOffline(false)
      return
    }
    const timer = setTimeout(() => setStuckOffline(true), OFFLINE_GRACE_MS)
    return () => clearTimeout(timer)
  }, [waiting])
  return failureOf(state, { online, stuckOffline })
}

/**
 * The bee's phase over an opening design: it shows at once, starts to fly off at 800 ms or once the
 * design is ready, and is gone when its flight ends (`flown`), or at once when the design fails.
 */
function useBeePhase(ready: boolean, failed: boolean): { phase: BeePhase; flown: () => void } {
  const [shownAt] = useState(() => performance.now())
  const [readyAt, setReadyAt] = useState<number | null>(null)
  const [phase, setPhase] = useState<BeePhase>('shown')
  const flown = useCallback(() => setPhase((now) => beeAfter(now, 'flown')), [])
  useEffect(() => {
    if (ready) setReadyAt((at) => at ?? performance.now())
  }, [ready])
  useEffect(() => {
    if (failed) setPhase((now) => beeAfter(now, 'failed'))
  }, [failed])
  useEffect(() => {
    if (phase !== 'shown') return
    const wait = leaveWait({ shownAt, readyAt }, performance.now())
    if (wait === null) return
    const timer = setTimeout(() => setPhase((now) => beeAfter(now, 'leave')), wait)
    return () => clearTimeout(timer)
  }, [phase, shownAt, readyAt])
  useEffect(() => {
    if (phase !== 'leaving') return
    const timer = setTimeout(flown, BEE_GONE_BY_MS)
    return () => clearTimeout(timer)
  }, [phase, flown])
  return { phase, flown }
}

/**
 * The flying bee over the whole editor as a design opens: it stays at least 800 ms, or until the
 * design is ready, then flies off while the editor fades in under it. A design that fails to open
 * takes it away at once, for its failure to show.
 */
export function OpeningBee({ status, ready }: { status: ValueStore<string>; ready: boolean }) {
  const failed = useOpenFailure(status) !== null
  const { phase, flown } = useBeePhase(ready, failed)
  if (phase === 'gone') return null
  return <FlyingIn phase={phase} onFlown={flown} />
}

/** How the bee over an opening design looks, in its phase: also the design page's loading screen. */
export function FlyingIn({ phase, onFlown }: { phase: Exclude<BeePhase, 'gone'>; onFlown?: () => void }) {
  const t = useMessages()
  return (
    <div
      role="status"
      data-phase={phase}
      // Every part's leaving animation ends together, at the end of the flight.
      onAnimationEnd={(e) => {
        if (e.animationName.startsWith('opening-')) onFlown?.()
      }}
      data-testid="opening-bee"
      className="opening-bee fixed inset-0 z-[70] grid place-items-center"
    >
      <div aria-hidden className="opening-bee-fades absolute inset-0 bg-bg" />
      <div className="relative flex flex-col items-center gap-3 px-6 text-center">
        <div className="opening-bee-flies">
          {/* It faces the way it flies off: to the end side, so left in Arabic. */}
          <Mascot pose="fly" className="rtl:-scale-x-100" />
        </div>
        <p className="opening-bee-fades font-display text-heading font-bold tracking-tight text-text">
          {t.editor.notices.opening.flying}
        </p>
      </div>
    </div>
  )
}

/**
 * Over the stage while the design can't be opened, or the sync server stopped it: the failure's bee,
 * its words, and its way on.
 */
export function OpenFailureState({
  status,
  workspaceId,
  brandId,
}: {
  status: ValueStore<string>
  workspaceId: string
  brandId: string
}) {
  const t = useMessages()
  const failure = useOpenFailure(status)
  if (!failure) return null
  const { pose, then } = FAILURE_LOOK[failure]
  const words = failureWords(t, failure)
  const looks = buttonStyles({ variant: 'primary', size: 'lg' })
  return (
    <div
      data-testid="open-failure"
      className="canvas-dots absolute inset-0 z-[6] grid place-items-center overflow-y-auto"
      role="alert"
    >
      <EmptyState
        pose={pose}
        title={words.title}
        line={words.line}
        action={
          then === 'back' ? (
            <Link href={brandPath(workspaceId, brandId, 'designs')} className={looks}>
              {t.editor.notices.backToDesigns}
            </Link>
          ) : (
            <button type="button" className={looks} onClick={() => window.location.reload()}>
              {then === 'reload' ? t.editor.notices.reload : t.pages.error.action}
            </button>
          )
        }
      />
    </div>
  )
}
