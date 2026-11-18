// Opening a design: how long the flying bee stays over the editor, how it leaves, and which bee and
// way on a design that fails to open shows.
import type { MascotPose } from '@/components/ui/mascot.tsx'

/** Where the bee over an opening design is: over it, flying off, or gone. */
export type BeePhase = 'shown' | 'leaving' | 'gone'

/** What moves the bee on: the design failing to open, its time to leave coming, or its flight off ending. */
export type BeeEvent = 'failed' | 'leave' | 'flown'

/**
 * Why a design is not open: a state the sync server stopped the tab in, a start that could not reach
 * the server, or any other start that failed.
 */
export type OpenFailure = 'Deleted' | 'NoAccess' | 'Outdated' | 'Replaced' | 'offline' | 'error'

/** The bee stays over the editor at least this long, so it is seen even when the design opens fast. */
export const BEE_STAYS_MS = 800
/**
 * The bee flies off in 300 ms (app/styles/mascot.css); it is gone when that flight ends, or this long
 * after it starts when no flight runs, as in a hidden tab.
 */
export const BEE_GONE_BY_MS = 1000
/** How long a first visit waits to connect with no network before it says it is offline. */
export const OFFLINE_GRACE_MS = 1000

/** The bee each failure shows, and its way on: back to the brand's designs, a reload, or trying again. */
export const FAILURE_LOOK: Record<OpenFailure, { pose: MascotPose; then: 'back' | 'reload' | 'tryAgain' }> = {
  Deleted: { pose: 'lock', then: 'back' },
  NoAccess: { pose: 'lock', then: 'back' },
  Outdated: { pose: 'dizzy', then: 'reload' },
  Replaced: { pose: 'dizzy', then: 'reload' },
  offline: { pose: 'offline', then: 'tryAgain' },
  error: { pose: 'dizzy', then: 'tryAgain' },
}
/** Every pose a design opening may show: the flying bee and each failure's. */
export const OPENING_POSES: readonly MascotPose[] = [
  ...new Set<MascotPose>(['fly', ...Object.values(FAILURE_LOOK).map(({ pose }) => pose)]),
]

const STOPPED: ReadonlySet<string> = new Set(['Deleted', 'NoAccess', 'Outdated', 'Replaced'])
/** What each browser's fetch says when it reaches no server. */
const UNREACHED = /failed to fetch|networkerror|load failed|network error/i

/**
 * How long after `now` the bee starts to leave: 800 ms after it showed, or once the design is ready
 * if that is later; 0 when that time has passed, and null while the design isn't ready.
 */
export function leaveWait(
  { shownAt, readyAt }: { shownAt: number; readyAt: number | null },
  now: number,
): number | null {
  if (readyAt === null) return null
  return Math.max(0, Math.max(shownAt + BEE_STAYS_MS, readyAt) - now)
}

/**
 * The bee's phase after an event: a failure takes it away at once; its time to leave starts its
 * flight off, however late it comes; and it is gone once that flight ends, never before.
 */
export function beeAfter(phase: BeePhase, event: BeeEvent): BeePhase {
  if (event === 'failed') return 'gone'
  if (event === 'leave') return phase === 'shown' ? 'leaving' : phase
  return phase === 'leaving' ? 'gone' : phase
}

/**
 * Why the design is not open, from the editor's status, or null while it opens or is open. A start
 * error is offline when no server answered or the browser has no network; a first visit still
 * connecting is offline once it has had no network for the grace (`stuckOffline`).
 */
export function failureOf(status: string, { online, stuckOffline }: { online: boolean; stuckOffline: boolean }) {
  if (STOPPED.has(status)) return status as OpenFailure
  if (status.startsWith('Error')) return !online || UNREACHED.test(status) ? 'offline' : 'error'
  if (status === 'Connecting' && !online && stuckOffline) return 'offline'
  return null
}
