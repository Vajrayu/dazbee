// The actions run lately from Quick actions, which it lists first: the last five, newest first, an
// action run again moved to the front. They are kept per device in its storage; when the device
// refuses its storage they are kept for the visit only. Keys, menus and bars never record one.
import { type ShortcutAction, SHORTCUTS } from '@dazbee/editor'

/** Where the device keeps them. */
export const RECENT_ACTIONS_KEY = 'dazbee.recentActions'
/** How many are kept. */
const KEPT = 5
const ACTIONS: ReadonlySet<string> = new Set(SHORTCUTS.map(({ action }) => action))

/** A device's storage, as much of it as is read and written. */
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>

export interface RecentActions {
  /** The actions run lately, newest first. */
  list(): ShortcutAction[]
  /** Puts an action run at the front. */
  record(action: ShortcutAction): void
}

/** The actions run lately, kept in the storage `storage` gives, or for the visit while it throws. */
export function recentActions(storage: () => Storage): RecentActions {
  let memory: ShortcutAction[] | null = null
  function list(): ShortcutAction[] {
    if (memory) return memory
    try {
      return namesIn(storage().getItem(RECENT_ACTIONS_KEY))
    } catch {
      return []
    }
  }
  function record(action: ShortcutAction) {
    const next = [action, ...list().filter((one) => one !== action)].slice(0, KEPT)
    try {
      storage().setItem(RECENT_ACTIONS_KEY, JSON.stringify(next))
      memory = null
    } catch {
      memory = next
    }
  }
  return { list, record }
}

/** The actions a stored value names, in order, each once, the first five; whatever names no action is dropped. */
function namesIn(stored: string | null): ShortcutAction[] {
  let value: unknown
  try {
    value = JSON.parse(stored ?? '[]')
  } catch {
    return []
  }
  if (!Array.isArray(value)) return []
  const names = value.filter((one): one is ShortcutAction => typeof one === 'string' && ACTIONS.has(one))
  return [...new Set(names)].slice(0, KEPT)
}
