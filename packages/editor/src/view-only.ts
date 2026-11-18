// A Reviewer's editor (C35): the session refuses every write while the tab may only view the
// design, and here the editor says so once (not at all once the tab's link ended, which the page
// shows), ends what was open on the stage, and keeps the refusal from reaching the page, which only
// selects, pans, zooms and exports there.
import { CommandError, type Session, VIEW_ONLY } from '@dazbee/doc'

import type { NoticeDetail, PageSession, TabAccess } from './core-interface.ts'
import type { KeyAnswer, KeyInput } from './gestures/inputs.ts'

interface ViewOnlyDeps {
  session: Session
  access: TabAccess
  /** Ends all that is open on the stage: the drag held, typing and the pen's path. */
  endOpen: () => void
  notify: (...told: NoticeDetail<'viewOnly'>) => void
  /** Aborted when the editor ends: nothing is told after. */
  signal: AbortSignal
}

/** Whether `error` is a read-only session's refusal of a write. */
export function isViewOnly(error: unknown): error is CommandError {
  return error instanceof CommandError && error.kind === 'refused' && error.reason === VIEW_ONLY
}

/**
 * Hears the session's refusals. Once the call that was refused is over, what is open on the stage
 * ends, so a drag's later moves are not each refused, and the page is told View only: once, and
 * again only after the tab could edit in between. `guard` wraps a member the page or the browser
 * calls, so a refusal in it, or in the promise it gives, ends there.
 */
export function editorViewOnly({ session, access, endOpen, notify, signal }: ViewOnlyDeps) {
  /** Whether the page was told since the tab last could edit. */
  let told = false
  /** Whether the end of the refused call is awaited. */
  let ending = false

  signal.addEventListener(
    'abort',
    access.onChange(() => {
      if (!access.readOnly()) told = false
    }),
  )
  session.onReadOnly(() => {
    if (ending) return
    ending = true
    // The refused call is still on its way out: what it held ends once it is over.
    void Promise.resolve().then(() => {
      ending = false
      if (signal.aborted) return
      endOpen()
      tell()
    })
  })

  /** Tells the page View only, once until the tab could edit again; never once its link ended. */
  function tell() {
    if (told || access.quiet?.() || signal.aborted) return
    told = true
    notify('viewOnly')
  }

  /** Gives undefined for a refusal, and throws anything else on. */
  function quiet(error: unknown): undefined {
    if (isViewOnly(error)) return undefined
    throw error
  }

  /** `call`, where a refusal, thrown or in the promise it gives, ends as `refused` (undefined unless given). */
  function guard<A extends unknown[], R>(call: (...args: A) => R, refused?: R): (...args: A) => R {
    return (...args: A) => {
      try {
        const result = call(...args)
        return (result instanceof Promise ? result.catch(quiet) : result) as R
      } catch (error) {
        quiet(error)
        return refused as R
      }
    }
  }

  /**
   * The key input, whose answer carries what a key's action threw, to be thrown once the browser is
   * kept from the key: a refusal is not thrown on.
   */
  function guardKeys(key: (input: KeyInput) => KeyAnswer): (input: KeyInput) => KeyAnswer {
    return guard(
      (input: KeyInput) => {
        const answer = key(input)
        return isViewOnly(answer.thrown) ? { handled: answer.handled } : answer
      },
      { handled: true },
    )
  }

  /** `members` with each of its functions guarded. */
  function guardAll<T extends object>(members: T): T {
    return Object.fromEntries(
      Object.entries(members).map(([key, value]) => [
        key,
        typeof value === 'function' ? guard(value as (...args: unknown[]) => unknown) : value,
      ]),
    ) as T
  }

  /** The session the page runs commands through: its writes guarded. */
  function pageSession(): PageSession {
    return {
      ...session,
      run: guard(session.run) as PageSession['run'],
      batch: guard(session.batch) as PageSession['batch'],
      undo: guard(session.undo),
      redo: guard(session.redo),
    }
  }

  return { guard, guardAll, guardKeys, quiet, pageSession, tell }
}
