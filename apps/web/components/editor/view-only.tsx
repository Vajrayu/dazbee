'use client'

// Whether the tab may only view the design (C35): a Reviewer's, or one whose link ended. The stage
// reads it from the editor (`useReadOnly`) and hands it down, so every piece of the editor's page
// reads the same answer, kept current as access changes while the design is open. What only writes
// is left out while it holds; panels and pop-ups still open to show their values, their controls off.
import { createContext, type ReactNode, useContext } from 'react'

import { cn } from '@/lib/cn.ts'

const ViewOnlyContext = createContext(false)

/** Hands the tab's view-only answer down to the editor's page. */
export const ViewOnlyProvider = ViewOnlyContext.Provider

/** Whether the tab may only view the design. */
export function useViewOnly() {
  return useContext(ViewOnlyContext)
}

/**
 * Turns off every native control inside it while the tab may only view, or while `off` (a locked
 * layer's settings), and lays out as if it were not there. While `off`, what is inside reads the tab
 * as view-only too, so a knob's scrub is off with it. A pop-up's content portals out of the page's
 * own fieldsets, so each holds its own.
 */
export function ViewOnlyFieldset({
  off = false,
  className,
  children,
}: {
  off?: boolean
  className?: string
  children: ReactNode
}) {
  const viewOnly = useViewOnly() || off
  return (
    <ViewOnlyProvider value={viewOnly}>
      {/* A control turned off takes no hover or press, so it neither tints nor shows a hand. */}
      <fieldset
        disabled={viewOnly}
        data-view-only={viewOnly || undefined}
        className={cn('contents [&_:disabled]:pointer-events-none [&_:disabled]:cursor-default', className)}
      >
        {children}
      </fieldset>
    </ViewOnlyProvider>
  )
}
