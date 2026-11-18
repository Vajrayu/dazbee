import { describe, expect, it } from 'vitest'

import { FALLBACK_FAMILIES, FONT_FACES } from './index.ts'
import { EMOJI_FAMILY, SCRIPT_FONTS, scriptFamilies } from './scripts.ts'

describe('SCRIPT_FONTS', () => {
  it('names each family once, none of them shipped, with the emoji font last', () => {
    const names = SCRIPT_FONTS.map((f) => f.family)
    expect(new Set(names).size).toBe(names.length)
    expect(names.filter((name) => FONT_FACES.some((face) => face.family === name))).toEqual([])
    expect(names.at(-1)).toBe(EMOJI_FAMILY)
  })

  it('names none of the shipped fallbacks', () => {
    expect(SCRIPT_FONTS.filter((f) => FALLBACK_FAMILIES.includes(f.family))).toEqual([])
  })
})

describe('scriptFamilies', () => {
  it('needs nothing for the scripts we ship: Latin, Greek, Cyrillic, Devanagari, Arabic, digits and signs', () => {
    expect(scriptFamilies('Fresh roast, 20% off! Ελλάδα Привет नमस्ते مرحبا 0123 © ® ™ ‼ ↔ € •')).toEqual([])
  })

  it('needs the emoji font for an emoji, a flag, a skin tone, a joined sequence and a keycap', () => {
    for (const text of ['Sale 😀', '🇮🇳', '👍🏽', '🏽', '👨‍👩‍👧', 'Call 1️⃣', '#️⃣'])
      expect(scriptFamilies(text), text).toEqual([EMOJI_FAMILY])
  })

  it('needs the emoji font for a pictograph from U+2300 on, and one before it asked to be an emoji', () => {
    for (const text of ['I ❤️ it', 'I ❤ it', '☀', '✔ done', '⭐', '⌚', '©️', '‼️'])
      expect(scriptFamilies(text), text).toEqual([EMOJI_FAMILY])
  })

  it('takes Japanese for kana, with the Han beside it, and Chinese for Han alone', () => {
    expect(scriptFamilies('日本語です')).toEqual(['Noto Sans JP'])
    expect(scriptFamilies('カタカナ')).toEqual(['Noto Sans JP'])
    expect(scriptFamilies('新品上市')).toEqual(['Noto Sans SC'])
  })

  it('takes the CJK font of the text for CJK punctuation, full-width forms and Bopomofo', () => {
    expect(scriptFamilies('（新品）。')).toEqual(['Noto Sans SC'])
    expect(scriptFamilies('「セール」')).toEqual(['Noto Sans JP'])
    expect(scriptFamilies('「세일」')).toEqual(['Noto Sans KR'])
    for (const text of ['。', '（）', 'ＳＡＬＥ', 'ㄅㄆㄇ'])
      expect(scriptFamilies(text), text).toEqual(['Noto Sans SC'])
  })

  it('takes Korean for Hangul, with any Hanja beside it', () => {
    expect(scriptFamilies('한국어')).toEqual(['Noto Sans KR'])
    expect(scriptFamilies('大韓民國 한국')).toEqual(['Noto Sans KR'])
  })

  it('takes each other script its own family', () => {
    const cases: [string, string][] = [
      ['สวัสดี', 'Noto Sans Thai'],
      ['שלום', 'Noto Sans Hebrew'],
      ['বাংলা', 'Noto Sans Bengali'],
      ['ગુજરાતી', 'Noto Sans Gujarati'],
      ['ਪੰਜਾਬੀ', 'Noto Sans Gurmukhi'],
      ['ಕನ್ನಡ', 'Noto Sans Kannada'],
      ['മലയാളം', 'Noto Sans Malayalam'],
      ['ଓଡ଼ିଆ', 'Noto Sans Oriya'],
      ['தமிழ்', 'Noto Sans Tamil'],
      ['తెలుగు', 'Noto Sans Telugu'],
      ['සිංහල', 'Noto Sans Sinhala'],
      ['ქართული', 'Noto Sans Georgian'],
      ['Հայերեն', 'Noto Sans Armenian'],
      ['ខ្មែរ', 'Noto Sans Khmer'],
      ['ລາວ', 'Noto Sans Lao'],
      ['မြန်မာ', 'Noto Sans Myanmar'],
      ['አማርኛ', 'Noto Sans Ethiopic'],
    ]
    for (const [text, family] of cases) expect(scriptFamilies(text), text).toEqual([family])
  })

  it('lists several in the table order, each once', () => {
    expect(scriptFamilies('😀 שלום 新品 สวัสดี 😀 新')).toEqual([
      'Noto Sans SC',
      'Noto Sans Thai',
      'Noto Sans Hebrew',
      EMOJI_FAMILY,
    ])
  })
})
