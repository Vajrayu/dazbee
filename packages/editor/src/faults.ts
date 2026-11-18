import type { Session } from '@dazbee/doc'

import type { NoticeDetail } from './core-interface.ts'

interface FaultsDeps {
  session: Pick<Session, 'onFault'>
  /** Ends all that is open on the stage: the drag held, typing and the pen's path. */
  endOpen: () => void
  notify: (...told: NoticeDetail<'notApplied'>) => void
}

/**
 * Handles the faults of the session every module and the page run their commands through. The
 * session tells of a fault once it is at rest, with the fault's step put back, so here is where
 * each is handled, once, whoever ran the command: the command, its cause and what was thrown
 * while it was put back are logged; what is open on the stage ends, so a drag's later moves are
 * not each an undo step; and the page is told the change could not be applied. A fault raised
 * by what ends the stage is logged and handled no further.
 */
export function watchFaults({ session, endOpen, notify }: FaultsDeps) {
  /** Whether a fault is being handled. */
  let handling = false

  return session.onFault((fault) => {
    const also = fault.putBackError === undefined ? [] : [fault.putBackError]
    console.error('A command could not be applied:', fault.command, fault.cause, ...also)
    if (handling) return
    handling = true
    try {
      endOpen()
    } finally {
      handling = false
      notify('notApplied')
    }
  })
}
