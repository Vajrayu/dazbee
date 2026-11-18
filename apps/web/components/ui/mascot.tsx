// Daz, Dazbee's bee, in one of its poses: a picture from public/mascot that bobs gently, and holds
// still under reduced motion. It is decoration; the words beside it carry the meaning. It loads
// lazily, so a page that holds it only in a boundary not shown, as every page holds the page not
// found, never preloads it.
import { cn } from '@/lib/cn.ts'

/** Every pose Daz has a picture for, at `/mascot/<pose>.webp`. */
export const MASCOT_POSES = [
  'hello',
  'lost',
  'dizzy',
  'create',
  'search',
  'box',
  'palette',
  'picture',
  'layers',
  'clock',
  'sleep',
  'offline',
  'lock',
  'build',
  'party',
  'frame',
  'shrug',
  'fly',
] as const
export type MascotPose = (typeof MASCOT_POSES)[number]

/** Where a pose's picture is served. */
export const mascotSrc = (pose: MascotPose) => `/mascot/${pose}.webp`

export function Mascot({ pose, size = 136, className }: { pose: MascotPose; size?: number; className?: string }) {
  return (
    <img
      src={mascotSrc(pose)}
      alt=""
      aria-hidden
      width={size}
      height={size}
      draggable={false}
      loading="lazy"
      data-pose={pose}
      className={cn('mascot-bob shrink-0 select-none', className)}
    />
  )
}
