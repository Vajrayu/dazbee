'use client'

// The flyouts' buttons: Layers, Assets, AI and Brand, each opening and closing its flyout, the open
// one's on the pink blob. On a tablet or desktop they sit at the tool dock's end, after a divider;
// on a phone they start the tab bar.
import { motion } from 'motion/react'

import type { ShortcutAction } from '@dazbee/editor'

import { type Icon, ImagesIcon, PaletteIcon, SparkleIcon, StackIcon } from '@/components/ui/icons.tsx'
import { Tooltip, withShortcut } from '@/components/ui/tooltip.tsx'
import { cn } from '@/lib/cn.ts'
import { keyOf } from '@/lib/editor/shortcut-keys.ts'

import { type Flyout, toggleFlyout } from './edit-store.ts'
import { DOCK_BUTTON, DOCK_OFF } from './styles.ts'

/** Each flyout's button: its icon, and the action whose key opens it too, which its tooltip shows. */
const FLYOUTS: { id: Flyout; icon: Icon; action?: ShortcutAction }[] = [
  { id: 'layers', icon: StackIcon },
  { id: 'assets', icon: ImagesIcon, action: 'assets' },
  { id: 'ai', icon: SparkleIcon },
  { id: 'brand', icon: PaletteIcon },
]

/**
 * How the buttons look in the dock, as its tools do, and in the phone's tab bar: each button's
 * shape, its colours while its flyout is closed, and its icon's size.
 */
const LOOKS = {
  dock: { button: `${DOCK_BUTTON} w-10`, closed: DOCK_OFF, icon: 20 },
  tabBar: {
    button:
      'grid size-11 cursor-pointer place-items-center rounded-full transition-colors duration-[var(--chrome-fast)]',
    closed: 'text-subtle hover:bg-hover hover:text-text active:bg-pressed active:text-text',
    icon: 22,
  },
}
/** The blob, the pink pill under the open flyout's button, slides there on a spring, so it overshoots a little. */
const BLOB = { type: 'spring', stiffness: 520, damping: 34, mass: 0.9 } as const
/** On arrival the blob is stretched along its travel, across the dock or the tab bar, and settles round: the squish. */
const SQUISH = {
  wide: { scaleX: 1.28, scaleY: 0.78 },
  still: { scaleX: 1, scaleY: 1 },
}

/**
 * The four buttons, each showing whether its flyout is open: sized as the dock's tools with their
 * tooltips above, or on a phone (`phone`) as the tab bar's buttons.
 */
export function FlyoutButtons({
  flyout,
  title: flyoutTitle,
  phone,
  rtl,
  reduced,
}: {
  flyout: Flyout | null
  /** A flyout's name, its button's label and tooltip. */
  title: (id: Flyout) => string
  phone: boolean
  rtl: boolean
  reduced: boolean | null
}) {
  const look = LOOKS[phone ? 'tabBar' : 'dock']
  return (
    <>
      {FLYOUTS.map(({ id, icon: FlyoutIcon, action }) => {
        const open = flyout === id
        const ai = id === 'ai'
        return (
          <Tooltip
            key={id}
            label={action ? withShortcut(flyoutTitle(id), keyOf(action)) : flyoutTitle(id)}
            side={phone ? (rtl ? 'left' : 'right') : 'top'}
          >
            <button
              type="button"
              aria-label={flyoutTitle(id)}
              aria-expanded={open}
              aria-controls="editor-flyout"
              data-panel={id}
              onClick={() => {
                toggleFlyout(id, phone)
              }}
              className={cn(
                'relative',
                look.button,
                // Open, its icon is white on the pink blob.
                open ? 'text-on-accent' : look.closed,
                ai && !open && 'text-accent-text',
              )}
            >
              {open && (
                <motion.span
                  layoutId="flyout-blob"
                  transition={reduced ? { duration: 0 } : BLOB}
                  aria-hidden
                  data-testid="flyout-blob"
                  className="absolute inset-0"
                >
                  <motion.span
                    key={id}
                    initial={reduced ? false : 'wide'}
                    animate="still"
                    variants={SQUISH}
                    transition={BLOB}
                    className="blob absolute inset-0 bg-accent-solid"
                  />
                </motion.span>
              )}
              {/* A still gradient: a blur over a sliding one would be redrawn on every frame. */}
              {ai && !open && (
                <span
                  aria-hidden
                  className="absolute inset-1.5 rounded-full bg-[image:var(--ai-gradient)] opacity-20 blur-[6px]"
                />
              )}
              <FlyoutIcon
                size={look.icon}
                weight={ai ? 'duotone' : open ? 'fill' : 'regular'}
                aria-hidden
                className="relative"
              />
            </button>
          </Tooltip>
        )
      })}
    </>
  )
}
