import { describe, expect, it } from 'vitest'

import { type ShortcutAction } from '@dazbee/editor'

import { ar } from '@/lib/i18n/ar.ts'
import { en } from '@/lib/i18n/en.ts'

import { groupOf, LISTED_ACTIONS, type ListedFrom, quickActionsList } from './quick-actions-list.ts'

const HEADINGS = { recent: en.editor.quickActions.recent, groups: en.editor.shortcuts.groups }
/** What can run with two layers selected, as a few rows of the table. */
const READY: ShortcutAction[] = ['undo', 'copy', 'delete', 'toolSelect', 'group', 'alignLeft', 'zoomIn', 'shortcuts']

const list = (from: Partial<ListedFrom>) =>
  quickActionsList({ ready: READY, recent: [], query: '', names: en.editor.actions, headings: HEADINGS, ...from })
const parts = (from: Partial<ListedFrom>) => list(from).map(({ id, heading, rows }) => [id, heading, rows])

describe('LISTED_ACTIONS', () => {
  it('holds every action of the table but Select layer and Quick actions', () => {
    expect(LISTED_ACTIONS).not.toContain('selectLayer')
    expect(LISTED_ACTIONS).not.toContain('quickActions')
    expect(LISTED_ACTIONS).toEqual(expect.arrayContaining(['undo', 'group', 'paste', 'pickColour', 'shortcuts']))
    expect(LISTED_ACTIONS).toHaveLength(Object.keys(en.editor.actions).length - 2)
  })
})

describe('quickActionsList', () => {
  it('lists, with nothing typed, the ready actions under their groups in the shortcuts list’s order, an empty group left out', () => {
    expect(parts({})).toEqual([
      ['edit', 'Edit', ['undo', 'copy', 'delete']],
      ['tools', 'Tools', ['toolSelect']],
      ['arrange', 'Arrange', ['group']],
      ['align', 'Align and distribute', ['alignLeft']],
      ['view', 'View', ['zoomIn', 'shortcuts']],
    ])
  })

  it('puts the ready actions run lately first under Recent, newest first, and doesn’t repeat them in their groups', () => {
    expect(parts({ recent: ['group', 'paste', 'undo'] }).slice(0, 2)).toEqual([
      ['recent', 'Recent', ['group', 'undo']],
      ['edit', 'Edit', ['copy', 'delete']],
    ])
    expect(list({ recent: ['group'] }).map(({ id }) => id)).not.toContain('arrange')
  })

  it('lists, with something typed, only the ready matches in one part without a heading, best first', () => {
    expect(parts({ query: 'grp' })).toEqual([['found', null, ['group']]])
    expect(parts({ query: 'al l' })).toEqual([['found', null, ['alignLeft']]])
    expect(parts({ query: 'paste' })).toEqual([['found', null, []]])
    // Spaces and punctuation alone are nothing typed.
    expect(parts({ query: ' ' })[0]?.[0]).toBe('edit')
  })

  it('finds Copy as PNG, an Edit action, as png in English and in Arabic', () => {
    const ready: ShortcutAction[] = ['copy', 'copyPng', 'paste']
    expect(list({ ready, query: 'png' })[0]?.rows).toEqual(['copyPng'])
    expect(list({ ready, names: ar.editor.actions, english: en.editor.actions, query: 'png' })[0]?.rows).toEqual([
      'copyPng',
    ])
    expect(groupOf('copyPng')).toBe('edit')
  })

  it('lists Save version under Edit and Show versions under View for an Editor, and Show versions alone for a Reviewer', () => {
    expect(LISTED_ACTIONS).toEqual(expect.arrayContaining(['saveVersion', 'showVersions']))
    // What can run in each tab, as the editor's actionReady answers it there.
    expect(parts({ ready: ['undo', 'saveVersion', 'zoomIn', 'showVersions'] })).toEqual([
      ['edit', 'Edit', ['undo', 'saveVersion']],
      ['view', 'View', ['zoomIn', 'showVersions']],
    ])
    expect(parts({ ready: ['zoomIn', 'showVersions'] })).toEqual([['view', 'View', ['zoomIn', 'showVersions']]])
    expect(list({ ready: ['saveVersion', 'showVersions'], query: 'version' })[0]?.rows).toEqual([
      'saveVersion',
      'showVersions',
    ])
  })

  it('breaks a tie for the action run lately', () => {
    const ready: ShortcutAction[] = ['zoomIn', 'zoomOut']
    expect(list({ ready, query: 'zoom' })[0]?.rows).toEqual(['zoomIn', 'zoomOut'])
    expect(list({ ready, query: 'zoom', recent: ['zoomOut'] })[0]?.rows).toEqual(['zoomOut', 'zoomIn'])
  })

  it('finds, in Arabic, by the Arabic name and then by the English one', () => {
    const arabic = { names: ar.editor.actions, english: en.editor.actions }
    expect(list({ ...arabic, query: 'تجميع' })[0]?.rows).toContain('group')
    expect(list({ ...arabic, query: 'group' })[0]?.rows).toEqual(['group'])
    expect(list({ query: 'تجميع' })[0]?.rows).toEqual([])
  })
})

describe('groupOf', () => {
  it('gives the group the shortcuts list shows an action in', () => {
    expect(groupOf('group')).toBe('arrange')
    expect(groupOf('quickActions')).toBe('view')
  })
})
