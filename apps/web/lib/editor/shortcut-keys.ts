// How a shortcut's keys read on this computer, for every menu, tooltip and the shortcuts list: ⌘ ⌥ ⇧
// on a Mac, Ctrl Alt Shift elsewhere, and the keys the shortcut table names by their code as they
// are printed on them. A shortcut is spelled as the table spells it, such as `Mod+Shift+BracketRight`.
import { goInAction, onMac, type ShortcutAction, SHORTCUTS } from '@dazbee/editor'
import type { Design } from '@dazbee/schema'

/** The selected layers of a design, which say what Enter runs on them. */
export interface SelectedLayers {
  design: Design
  ids: readonly string[]
}

/** The keys spelled otherwise than they read, apart from the modifiers, which read by the computer. */
const PRINTED: Record<string, string> = {
  BracketRight: ']',
  BracketLeft: '[',
  Equal: '=',
  Minus: '-',
  NumpadAdd: 'Num +',
  NumpadSubtract: 'Num −',
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  Escape: 'Esc',
  Backspace: '⌫',
}

/**
 * An action's first shortcut as one label (`Ctrl+]`, or `⌘+]` on a Mac). An action with no key of
 * its own reads as Enter's while Enter runs it on the selected layers `on` (`goInAction`); otherwise
 * it is empty, as for an action only a menu runs.
 */
export function keyOf(action: ShortcutAction, on?: SelectedLayers, mac = onMac()) {
  return keyLabel(firstKeyOf(action, on) ?? '', mac)
}

/**
 * An action's first shortcut as the shortcut table spells it (`Mod+BracketRight`); for an action with
 * no key of its own, Enter's while Enter runs it on the selected layers `on`; else none.
 */
export function firstKeyOf(action: ShortcutAction, on?: SelectedLayers) {
  const own = tableKey(action)
  const enter = !own && on !== undefined && goInAction(on.design, on.ids) === action
  return enter ? tableKey('goIn') : own
}

/** A shortcut as one label, its keys joined by +. */
export function keyLabel(spec: string, mac = onMac()) {
  return keysOf(spec, mac).join('+')
}

/** Each key of a shortcut as it reads on this computer, in order. */
export function keysOf(spec: string, mac = onMac()) {
  const modifiers: Record<string, string> = {
    Mod: mac ? '⌘' : 'Ctrl',
    Alt: mac ? '⌥' : 'Alt',
    Shift: mac ? '⇧' : 'Shift',
  }
  return spec.split('+').map((key) => modifiers[key] ?? PRINTED[key] ?? key.replace(/^Digit/, ''))
}

/** An action's own first shortcut in the table, if it has one. */
function tableKey(action: ShortcutAction): string | undefined {
  return SHORTCUTS.find((s) => s.action === action)?.keys[0]
}
