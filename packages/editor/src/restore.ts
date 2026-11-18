// Restoring a version in the tab: what is open ends as it does before Undo, the design becomes the
// version's records in one undo step (`design.restore`), the selection is let go, and a page the
// version has is shown.
import { type DesignStore, sameValue, type Session } from '@dazbee/doc'
import { type Design, inOrder, type RestoreMark } from '@dazbee/schema'

import type { EditorView } from './canvas/view.ts'
import type { EditorSelection } from './selection.ts'

export interface RestoreDeps {
  session: Session
  /** The tab's store: whether the restore wrote, and the records it left. */
  store: Pick<DesignStore, 'snapshot' | 'onChange'>
  view: Pick<EditorView, 'page'>
  selection: Pick<EditorSelection, 'select'>
  /** Shows a page, as the editor's `showPage` does. */
  showPage: (pageId: string) => void
  /** Ends the drag, typing and the pen's path, as they end before Undo. */
  endOpen: () => void
}

/**
 * How a restore went: done; put back because its change set was past a change set's limits (C39),
 * with nothing sent; or nothing to write, the design being the version already, with no undo step
 * (the selection let go and the page shown as for a restore done).
 */
export type Restored = 'restored' | 'tooBig' | 'same'

export interface EditorRestore {
  /**
   * Makes the design `design`'s pages, frames and layers, its own meta kept, as one undo step
   * carrying `mark` to the other tabs. Then shows `page` when the version has it, else the page
   * shown when the version has it, else the version's first page.
   */
  restore(design: Design, mark: RestoreMark, page?: string): Promise<Restored>
}

export function editorRestore({ session, store, view, selection, showPage, endOpen }: RestoreDeps): EditorRestore {
  async function restore(design: Design, mark: RestoreMark, page?: string): Promise<Restored> {
    endOpen()
    const before = store.snapshot()
    let wrote = false
    const stop = store.onChange(() => (wrote = true))
    try {
      session.run('design.restore', { design, mark })
    } finally {
      stop()
    }
    // A restore that wrote, yet left the records as they were, had its step put back as too big to send.
    if (wrote && sameValue(store.snapshot(), before)) return 'tooBig'
    selection.select([], null)
    const shown = [page, view.page()].find((id) => id !== undefined && Object.hasOwn(design.pages, id))
    const target = shown ?? inOrder(design.pages)[0]?.[0]
    if (target !== undefined && target !== view.page()) showPage(target)
    return wrote ? 'restored' : 'same'
  }

  return { restore }
}
