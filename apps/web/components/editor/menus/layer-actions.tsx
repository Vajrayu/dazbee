'use client'

// The selected layers' own actions, one list for the small menu's ⋯ (the full menu) and the
// right-click menu: Copy ▸ (the layers, their style, or as PNG) and Paste ▸ (the layers or their
// style), duplicate, Copy to other frames ▸ (style, text or the layer, into the linked frames); Group
// and Box side by side, Ungroup for a group or a box, Use as mask or Release mask; Flip horizontal
// and vertical; and, at the bottom, lock, hide and delete in all frames, acting on the layers and
// their linked copies. Select all with same ▸ selects the page's layers with the first one's fill
// or, for a text, its font. Every row runs the same editor action as its shortcut. An item that never applies is left out; one with nothing to
// do is greyed, its tooltip saying why, as Group and Box are while a layer is locked, a flip while
// one is locked against resizing, and Ungroup while the group or box is locked or its box's layout
// would move what it holds. How the layers sit (order, line up, the turn, text direction) is in
// the edit panel's Arrange and the text's Align.

import {
  type Editor,
  matchable,
  SAME_ACTIONS,
  type StageAction,
  type UngroupState,
  viewAction,
  whyNotWrapped,
  type WrapState,
} from '@dazbee/editor'

import { useTarget } from '@/components/editor/edit-panel/target.ts'
import { useSelectionState } from '@/components/editor/editor-hooks.ts'
import { refusalWords } from '@/components/editor/refusal-words.ts'
import { useViewOnly } from '@/components/editor/view-only.tsx'
import { MenuDivider, MenuItem, MenuSub } from '@/components/ui/menu.tsx'
import { keyOf } from '@/lib/editor/shortcut-keys.ts'
import { useMessages } from '@/lib/i18n/client.tsx'
import { format, type Messages } from '@/lib/i18n/index.ts'

/** Why an item has nothing to do: the reason the linked-copy items give, by its message. */
type Why = keyof Messages['editor']['bar']['linked']['why']

/** Why Ungroup has nothing to do, or null while it has something to do: a lock in the refusals' words. */
const ungroupWhy = (state: UngroupState, messages: Messages['editor']) =>
  state === 'ready' || state === 'none'
    ? null
    : state === 'placedByLayout'
      ? messages.bar.ungroupMoves
      : refusalWords(state, messages)

/** Why Group and Box have nothing to do, or null while they have something to do: in Arrange and the menus. */
export const wrapWhy = (state: WrapState, messages: Messages['editor']) => {
  const why = whyNotWrapped(state)
  return why && refusalWords(why, messages)
}

/**
 * The layers' own actions in short groups with only what applies. Copy fires the same copy event as
 * the keyboard's, so the clipboard and the copy kept for Paste both change; Paste places the layers
 * last copied in Dazbee.
 */
export function LayerActions({ editor, ids, onDone }: { editor: Editor; ids: string[]; onDone: () => void }) {
  const t = useMessages()
  const b = t.editor.bar
  const a = t.editor.actions
  const short = t.editor.shortActions
  const selected = useTarget(editor, ids)
  const ungroup = useSelectionState(editor, ids, 'ungroupState')
  const mask = useSelectionState(editor, ids, 'maskState')
  const wrap = useSelectionState(editor, ids, 'wrapState')
  // A tab that may only view keeps the actions that only look or copy (`viewAction`, C35).
  const viewOnly = useViewOnly()
  if (!selected) return null
  const { target, design } = selected
  const on = { design, ids: target.ids }
  const run = (action: StageAction) => {
    editor.perform(action)
    onDone()
  }
  const shows = (action: StageAction) => !viewOnly || viewAction(action)
  const row = (action: StageAction, label: string) =>
    shows(action) && (
      <MenuItem key={action} action={action} label={label} keys={keyOf(action, on)} onSelect={() => run(action)} />
    )
  const linked = editor.linkedMenu()
  if (!linked) return null
  const l = b.linked
  /** What an item says while it has nothing to do, or null while it has something to do. */
  const whyOf = (state: Why | 'ready' | 'hidden') => (state === 'ready' || state === 'hidden' ? null : l.why[state])
  /** A row that runs an action, greyed with the reason while it has nothing to do. */
  const actionRow = (action: StageAction, label: string, why: string | null, danger = false) =>
    shows(action) && (
      <MenuItem
        key={action}
        action={action}
        label={label}
        keys={keyOf(action, on)}
        why={why}
        danger={danger}
        onSelect={() => run(action)}
      />
    )
  // Select all with same ▸ offers what the first selected layer has to match by: a fill, a text's font.
  const first = design.nodes[target.ids[0] ?? '']
  const same = SAME_ACTIONS.filter(({ by }) => matchable(first, by)).map(({ action }) => action)
  // What only writes: Paste ▸, Copy to other frames ▸, and the dividers between the groups that write.
  const writes = !viewOnly
  return (
    <>
      <MenuSub label={b.copy} testId="more-copy">
        <MenuItem
          action="copy"
          label={a.copy}
          keys={keyOf('copy')}
          onSelect={() => {
            if (!document.execCommand('copy')) editor.copyLayers()
            onDone()
          }}
        />
        {actionRow('copyStyle', a.copyStyle, whyOf(linked.copyStyle))}
        <MenuItem
          action="copyPng"
          label={a.copyPng}
          keys={keyOf('copyPng')}
          why={editor.actionReady('copyPng') ? null : l.why.nothingToCopyPng}
          onSelect={() => {
            editor.copyPng()
            onDone()
          }}
        />
      </MenuSub>
      {writes && (
        <MenuSub label={b.paste} testId="more-paste">
          <MenuItem
            action="paste"
            label={a.paste}
            keys={keyOf('paste')}
            why={editor.canPasteLayers() ? null : l.why.nothingToPaste}
            onSelect={() => {
              editor.pasteLayers()
              onDone()
            }}
          />
          {actionRow('pasteStyle', a.pasteStyle, whyOf(linked.pasteStyle))}
        </MenuSub>
      )}
      {row('duplicate', a.duplicate)}
      {writes && <MenuDivider />}
      {!writes ? null : linked.frames === 0 ? (
        <MenuItem
          action="copyToFrames"
          testId="more-copy-to-frames"
          label={l.copyToFrames}
          why={l.why.noFrames}
          caret
        />
      ) : (
        <MenuSub
          label={l.copyToFrames}
          testId="more-copy-to-frames"
          wide
          heading={linked.reach === 1 ? l.toFrame : format(l.toFrames, { n: linked.reach })}
        >
          {actionRow('styleToLinked', short.styleToLinked, whyOf(linked.style))}
          {linked.text !== 'hidden' && actionRow('textToLinked', short.textToLinked, whyOf(linked.text))}
          {actionRow('layerToLinked', short.layerToLinked, whyOf(linked.layer))}
        </MenuSub>
      )}
      {actionRow(
        'selectLinkedCopies',
        short.selectLinkedCopies,
        linked.select === 'ready'
          ? null
          : l.why[linked.select === 'copiesLocked' ? 'copiesLockedApart' : linked.select],
      )}
      {same.length > 0 && (
        <MenuSub label={b.selectSame} testId="more-select-same">
          {same.map((action) =>
            actionRow(action, short[action], editor.actionReady(action) ? null : b.everyMatchSelected),
          )}
        </MenuSub>
      )}
      {writes && <MenuDivider />}
      {actionRow('group', a.group, wrapWhy(wrap, t.editor))}
      {actionRow('boxSelection', a.boxSelection, wrapWhy(wrap, t.editor))}
      {target.types.every((type) => type === 'group' || type === 'box') &&
        actionRow('ungroup', a.ungroup, ungroupWhy(ungroup, t.editor))}
      {mask &&
        actionRow('mask', mask.item === 'use' ? a.mask : b.releaseMask, mask.why && refusalWords(mask.why, t.editor))}
      {writes && <MenuDivider />}
      {actionRow('flipHorizontal', a.flipHorizontal, editor.actionReady('flipHorizontal') ? null : b.lockedRow)}
      {actionRow('flipVertical', a.flipVertical, editor.actionReady('flipVertical') ? null : b.lockedRow)}
      {writes && <MenuDivider />}
      {actionRow('lockLinked', linked.lock === 'lock' ? l.lockAll : l.unlockAll, null)}
      {actionRow('hideLinked', linked.hide === 'hide' ? l.hideAll : l.showAll, null)}
      {actionRow('deleteLinked', a.deleteLinked, whyOf(linked.delete), true)}
    </>
  )
}
