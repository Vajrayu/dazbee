import { describe, expect, it } from 'vitest'

import { paragraphsOf, pastedText } from './pasted-text.ts'

describe('paragraphsOf', () => {
  it('turns each line break, of any system, into one paragraph break', () => {
    expect(paragraphsOf('a\r\nb\rc\nd')).toBe('a\nb\nc\nd')
  })
})

describe('pastedText', () => {
  it('makes pasted text a text growing with its words in the text tool’s style, its line breaks as paragraphs, named by its first line with a word', () => {
    expect(pastedText(' \r\n  Big sale \r\nToday\ronly')).toEqual({
      type: 'text',
      name: 'Big sale',
      props: {
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        text: ' \n  Big sale \nToday\nonly',
        boxMode: 'autoWidth',
        style: { fontFamily: 'Noto Sans', fontSize: 48, fontWeight: 400, color: '#1F2329FF' },
      },
    })
  })

  it('names it by at most 100 characters of its first line', () => {
    expect(pastedText(`${'é'.repeat(150)}\nmore`)?.name).toBe('é'.repeat(100))
  })

  it('makes nothing of text that is only spaces and line breaks', () => {
    expect(pastedText(' \n\t\r\n ')).toBeNull()
  })
})
