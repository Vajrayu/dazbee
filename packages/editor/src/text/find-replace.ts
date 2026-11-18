// Find and replace, as FigCraft's: the texts of the shown page holding a string, matched whatever
// its case, selected, or every match in them replaced as one undo step, each text fitted to its
// words again.
import { descendants, matchesIn, type Session } from '@dazbee/doc'
import { type Design, framesOf } from '@dazbee/schema'

import type { EditorView } from '../canvas/view.ts'
import { runQuietly } from '../run-quietly.ts'
import type { EditorSelection, Picked } from '../selection.ts'
import type { EditorTyping } from './typing.ts'

/** The shown page's texts holding a string, in the page's order, and how many matches they hold. */
export interface FoundText {
  layers: string[]
  matches: number
}

export interface FindReplaceDeps {
  session: Session
  view: Pick<EditorView, 'page'>
  selection: Pick<EditorSelection, 'selectAcross'>
  typing: Pick<EditorTyping, 'fitText' | 'stop'>
}

export interface EditorFindReplace {
  /** The shown page's texts holding `find`, whatever its case, frame by frame, hidden ones too; none for nothing to find. */
  found(find: string): FoundText
  /** Selects the texts `found` gives but those locked in place, as select all leaves them out, ending typing first; gives how many. */
  selectFound(find: string): number
  /**
   * Replaces every match of `find` with `replace` in the texts `found` gives that aren't locked
   * against content changes, as one undo step, each text fitted to its words and its groups to it;
   * then selects them. Gives how many texts it changed: none when none could, or the step was refused.
   */
  replaceAll(find: string, replace: string): number
}

export function editorFindReplace({ session, view, selection, typing }: FindReplaceDeps): EditorFindReplace {
  /** The texts of the shown page holding `find`, each with its frame, and the number of matches. */
  function textsWith(find: string, design: Design = session.design()) {
    const picks: Picked[] = []
    let matches = 0
    if (find.length === 0) return { picks, matches }
    for (const [frameId] of framesOf(design, view.page())) {
      for (const id of descendants(design, frameId)) {
        const node = design.nodes[id]
        const count = node?.type === 'text' ? matchesIn(node.props.text, find).length : 0
        if (count === 0) continue
        picks.push({ id, frameId })
        matches += count
      }
    }
    return { picks, matches }
  }

  function found(find: string): FoundText {
    const { picks, matches } = textsWith(find)
    return { layers: picks.map(({ id }) => id), matches }
  }

  function selectFound(find: string) {
    typing.stop()
    const design = session.design()
    const picks = textsWith(find, design).picks.filter(({ id }) => !design.nodes[id]?.lock?.move)
    selection.selectAcross(picks)
    return picks.length
  }

  function replaceAll(find: string, replace: string) {
    typing.stop()
    const now = session.design()
    const picks = textsWith(find, now).picks.filter(({ id }) => !now.nodes[id]?.lock?.content)
    const ids = picks.map(({ id }) => id)
    if (ids.length === 0) return 0
    // The texts as they were: the session's design is a view that changes as the step writes.
    const before = new Map(ids.map((id) => [id, textOf(now, id)]))
    const done = runQuietly(() =>
      session.gesture('editText', () => {
        session.run('text.replace', { ids, find, replace })
        // Fitting a text fits the groups it is in too.
        for (const id of ids) typing.fitText(id)
      }),
    )
    if (!done) return 0
    selection.selectAcross(picks)
    const after = session.design()
    return ids.filter((id) => textOf(after, id) !== before.get(id)).length
  }

  return {
    found,
    selectFound,
    replaceAll,
  }
}

/** A text layer's characters, undefined for any other layer. */
function textOf(design: Design, id: string) {
  const node = design.nodes[id]
  return node?.type === 'text' ? node.props.text : undefined
}
