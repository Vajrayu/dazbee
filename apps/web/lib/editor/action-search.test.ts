import { describe, expect, it } from 'vitest'

import { type ShortcutAction, SHORTCUTS } from '@dazbee/editor'

import { ar } from '@/lib/i18n/ar.ts'
import { en } from '@/lib/i18n/en.ts'

import { fold, searchActions } from './action-search.ts'

/** Every row of the table by its name in English, as the English UI searches them. */
const ENGLISH = SHORTCUTS.map(({ action }) => ({ action, name: en.editor.actions[action] }))
/** Every row by its Arabic name, with its English one, as the Arabic UI searches them. */
const ARABIC = SHORTCUTS.map(({ action }) => ({
  action,
  name: ar.editor.actions[action],
  english: en.editor.actions[action],
}))

const search = (query: string, recent: readonly ShortcutAction[] = []) => searchActions(ENGLISH, query, recent)
const searchAr = (query: string, recent: readonly ShortcutAction[] = []) => searchActions(ARABIC, query, recent)

describe('fold', () => {
  it('lowers the case and drops Latin accents', () => {
    expect(fold('Zoom To FIT')).toBe('zoom to fit')
    expect(fold('Crème brûlée')).toBe('creme brulee')
  })

  it('drops Arabic tashkeel, the superscript alef and tatweel', () => {
    expect(fold('رتّب')).toBe('رتب')
    expect(fold('مُتساوٍ')).toBe('متساو')
    expect(fold('رحمٰن')).toBe('رحمن')
    expect(fold('تـجـمـيـع')).toBe('تجميع')
  })

  it('writes the alef with hamza or madda, and the wasla alef, as a bare alef', () => {
    expect(fold('أإآٱ')).toBe('اااا')
    expect(fold('إخفاء')).toBe('اخفاء')
  })

  it('writes alef maqsura as ya, ta marbuta as ha, and the waw and ya with hamza bare', () => {
    expect(fold('على')).toBe('علي')
    expect(fold('محاذاة')).toBe('محاذاه')
    expect(fold('مؤقت')).toBe('موقت')
    expect(fold('مائل')).toBe('مايل')
  })

  it('reads Arabic-Indic and Persian digits as 0 to 9', () => {
    expect(fold('٠١٢٣٤٥٦٧٨٩')).toBe('0123456789')
    expect(fold('۰۱۲۳۴۵۶۷۸۹')).toBe('0123456789')
  })

  it('reads punctuation as a space, and one space between words', () => {
    expect(fold('Zoom to 100%')).toBe('zoom to 100')
    expect(fold('  rulers—on / off ')).toBe('rulers on off')
    expect(fold('تكبير إلى 100٪')).toBe('تكبير الي 100')
  })
})

describe('searchActions', () => {
  it('finds nothing for nothing typed, and leaves out what matches nowhere', () => {
    expect(search('')).toEqual([])
    expect(search('   ')).toEqual([])
    expect(search('xyzzy')).toEqual([])
  })

  it('puts a name that starts with the query first, then one whose words start with the words typed', () => {
    // "Zoom to selection" starts with "zoom to s"; no other name does, and nothing else matches.
    expect(search('zoom to s')).toEqual(['zoomToSelection'])
    // "Undo" starts with "un"; "Union", "Ungroup" and "Underline" too, each longer.
    expect(search('un').slice(0, 4)).toEqual(['undo', 'booleanUnion', 'ungroup', 'underline'])
    // "to" starts no name, but starts a word of these, in the table's order after the shorter name.
    expect(search('to f').slice(0, 3)).toEqual(['zoomToFit', 'layoutFree', 'bringToFront'])
  })

  it('takes Align left first for "align l", and leaves out Align top, whose words "l" starts none of', () => {
    const found = search('align l')
    expect(found[0]).toBe('alignLeft')
    expect(found).not.toContain('alignTop')
  })

  it('finds a word inside a name once each word starts none', () => {
    // "ground" is inside no name; "roup" is inside Group, Ungroup and Go out to the group.
    expect(search('roup')).toEqual(['group', 'ungroup', 'goOut'])
    expect(search('ground')).toEqual([])
  })

  it("finds a name by its words' initials, and a word by its letters in order from its first", () => {
    // "Back to Free" and "Bring to front" both start their words with b, t and f; the shorter first.
    expect(search('btf')).toEqual(['layoutFree', 'bringToFront'])
    // "grp" is in Group and in "Go out to the group" by its letters; the shorter name first.
    expect(search('grp')).toEqual(['group', 'goOut'])
    // A word of two letters is never matched by its letters alone.
    expect(search('gp')).toEqual([])
  })

  it('finds Flip horizontal and Flip vertical by flip, in English and in Arabic', () => {
    const both = ['flipHorizontal', 'flipVertical']
    expect(search('flip').sort()).toEqual(both)
    expect(searchAr('قلب').sort()).toEqual(both)
    expect(searchAr('flip').sort()).toEqual(both)
  })

  it('needs every word typed to match', () => {
    expect(search('send back')).toEqual(['sendBackward', 'sendToBack'])
    expect(search('send front')).toEqual([])
  })

  it('puts the actions run lately first among names that match alike, then the shorter name, then the table order', () => {
    expect(search('align')).toEqual([
      'alignTop',
      'alignLeft',
      'alignRight',
      'alignBottom',
      'alignMiddle',
      'alignCentre',
    ])
    expect(search('align', ['alignBottom', 'alignRight'])).toEqual([
      'alignBottom',
      'alignRight',
      'alignTop',
      'alignLeft',
      'alignMiddle',
      'alignCentre',
    ])
    // Being run lately never lifts a row over one that matches better.
    expect(search('group', ['ungroup'])[0]).toBe('group')
  })

  it('finds an Arabic name typed without its hamza, with the article, or with Arabic-Indic digits', () => {
    expect(searchAr('اخفاء')[0]).toBe('hide')
    expect(searchAr('المحاذاة')).toEqual(['alignLeft', 'alignRight', 'alignTop', 'alignBottom'])
    expect(searchAr('١٠٠')).toEqual(['zoomTo100'])
    expect(searchAr('تجميع')[0]).toBe('group')
    // A word with لل in front of it: "للأمام" is found by "امام".
    expect(searchAr('امام')).toEqual(['bringForward'])
  })

  it('finds the English name in the Arabic UI, after every Arabic match', () => {
    expect(searchAr('group')).toEqual(['group', 'goOut', 'ungroup'])
    // "100" starts an Arabic word of one row and the English name of another: the Arabic match first.
    const rows = [
      { action: 'zoomIn' as const, name: 'تكبير', english: '100 zoom' },
      { action: 'zoomTo100' as const, name: 'تكبير 100', english: 'Zoom' },
    ]
    expect(searchActions(rows, '100')).toEqual(['zoomTo100', 'zoomIn'])
  })
})
