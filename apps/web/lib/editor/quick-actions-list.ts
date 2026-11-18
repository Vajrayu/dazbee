// What Quick actions lists, from the actions that can run now: with nothing typed, Recent and then
// the shortcuts list's groups in their order, each action once and an empty part left out; with
// something typed, the matches in one list without a heading, best first.
import { SHORTCUT_GROUPS, type ShortcutAction, type ShortcutGroup, SHORTCUTS } from '@dazbee/editor'

import { fold, searchActions } from './action-search.ts'

/** A part of the list: Recent or a group of the shortcuts list, or, with something typed, every match unheaded. */
export interface ActionSection {
  id: 'recent' | 'found' | ShortcutGroup
  heading: string | null
  rows: readonly ShortcutAction[]
}

/** What the list is made from. */
export interface ListedFrom {
  /** The actions that can run now, in the shortcut table's order. */
  ready: readonly ShortcutAction[]
  /** The actions run lately from Quick actions, newest first. */
  recent: readonly ShortcutAction[]
  /** What was typed in the search. */
  query: string
  /** The actions' names in the UI's language. */
  names: Readonly<Record<ShortcutAction, string>>
  /** In an Arabic UI, the actions' English names, matched after every Arabic match. */
  english?: Readonly<Record<ShortcutAction, string>>
  /** The headings: Recent's, and each group's as the shortcuts list names it. */
  headings: { recent: string; groups: Readonly<Record<ShortcutGroup, string>> }
}

/** The actions it can list: every action of the table but Select layer, which needs a layer named, and Quick actions. */
export const LISTED_ACTIONS: readonly ShortcutAction[] = SHORTCUTS.flatMap(({ action }) =>
  action === 'selectLayer' || action === 'quickActions' ? [] : [action],
)

const GROUP_OF = new Map<ShortcutAction, ShortcutGroup>(SHORTCUTS.map(({ action, group }) => [action, group]))

/** The parts of the list, in order, each with its rows. */
export function quickActionsList({ ready, recent, query, names, english, headings }: ListedFrom): ActionSection[] {
  if (fold(query) !== '') {
    const rows = ready.map((action) => ({ action, name: names[action], ...(english && { english: english[action] }) }))
    return [{ id: 'found', heading: null, rows: searchActions(rows, query, recent) }]
  }
  const lately = recent.filter((action) => ready.includes(action))
  const groups = SHORTCUT_GROUPS.map((group) => ({
    id: group,
    heading: headings.groups[group],
    rows: ready.filter((action) => GROUP_OF.get(action) === group && !lately.includes(action)),
  }))
  return [{ id: 'recent' as const, heading: headings.recent, rows: lately }, ...groups].filter(
    ({ rows }) => rows.length > 0,
  )
}

/** The group of the shortcuts list an action is shown in. */
export function groupOf(action: ShortcutAction): ShortcutGroup | undefined {
  return GROUP_OF.get(action)
}
