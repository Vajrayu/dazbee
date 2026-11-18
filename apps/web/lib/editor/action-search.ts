// Finding an action by its name, as Quick actions lists it: both the name and what was typed are
// folded (case, accents, Arabic's marks and letter forms, digits, punctuation), every word typed
// must match, and a match ranks by how well it matches: the name starting with what was typed, each
// word starting a word of the name, each word inside it, the words' initials, then a word's letters
// in order. An Arabic UI also finds the English name, after every Arabic match. No stemming: a
// broken plural (مسطرة, المساطر) is not found.

/** An action as it is searched: its name in the UI's language, and in an Arabic UI its English one. */
export interface Searchable<A extends string> {
  action: A
  name: string
  english?: string
}

/** The Arabic letters written another way as they are typed, each to the letter it is found by. */
const LETTERS: Record<string, string> = {
  أ: 'ا',
  إ: 'ا',
  آ: 'ا',
  ٱ: 'ا',
  ى: 'ي',
  ة: 'ه',
  ؤ: 'و',
  ئ: 'ي',
}
/** The marks dropped: Latin accents, Arabic tashkeel with the hamza and madda above and below, the superscript alef, tatweel. */
const MARKS = /[̀-ًͯ-ٰٟـ]/g
/** Punctuation and symbols, such as % and ٪, read as a space. */
const PUNCTUATION = /[\p{P}\p{S}]/gu
/** The Arabic article and "for the" in front of a word, which a word typed may leave out or keep. */
const ARTICLE = /^(?:ال|لل)/
/** How many tiers a name's matches take; an English match ranks after all of them. */
const TIERS = 5

/**
 * A text as it is compared: NFKD, lower case, no Latin accents, Arabic tashkeel, superscript alef
 * or tatweel, أ إ آ ٱ as ا, ى as ي, ة as ه, ؤ as و, ئ as ي, Arabic-Indic and Persian digits as 0 to 9
 * (by hand: NFKD maps neither), punctuation as a space, one space between words.
 */
export function fold(text: string): string {
  return [...text.normalize('NFKD').toLowerCase().replace(MARKS, '')]
    .map((char) => LETTERS[char] ?? digitOf(char) ?? char)
    .join('')
    .replace(MARKS, '')
    .replace(PUNCTUATION, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * The actions whose names match what was typed, best first: by tier, then an action in `recent`
 * (the newest first), then the shorter name, then the order given. Nothing typed matches nothing.
 */
export function searchActions<A extends string>(
  rows: readonly Searchable<A>[],
  query: string,
  recent: readonly A[] = [],
): A[] {
  const typed = fold(query)
  if (!typed) return []
  const found = rows.flatMap((row, order) => {
    const own = tierOf(fold(row.name), typed)
    const english = row.english === undefined ? null : tierOf(fold(row.english), typed)
    const tier = own ?? (english === null ? null : TIERS + english)
    if (tier === null) return []
    const at = recent.indexOf(row.action)
    return [{ action: row.action, tier, recent: at < 0 ? recent.length : at, length: row.name.length, order }]
  })
  return found
    .sort((a, b) => a.tier - b.tier || a.recent - b.recent || a.length - b.length || a.order - b.order)
    .map(({ action }) => action)
}

/** How well a folded name matches the folded words typed, 0 the best; null for no match. */
function tierOf(name: string, typed: string): number | null {
  const words = typed.split(' ')
  const nameWords = name.split(' ')
  if (name.startsWith(typed)) return 0
  if (words.every((word) => startsAWord(word, nameWords))) return 1
  if (words.every((word) => (word.length >= 2 ? name.includes(word) : startsAWord(word, nameWords)))) return 2
  const letters = words.join('')
  if (letters.length >= 2 && nameWords.map((word) => word[0]).join('') === letters) return 3
  if (words.every((word) => word.length >= 3 && nameWords.some((one) => lettersIn(word, one)))) return 4
  return null
}

/** Whether a word typed starts one of the name's words, either with an Arabic article taken off. */
function startsAWord(word: string, nameWords: readonly string[]) {
  const typed = bare(word)
  return nameWords.some((one) => {
    const own = bare(one)
    return [one, own].some((form) => form.startsWith(word) || form.startsWith(typed))
  })
}

/** A word with the Arabic article, or لل, taken off, while two letters or more are left. */
function bare(word: string) {
  const without = word.replace(ARTICLE, '')
  return without.length >= 2 ? without : word
}

/** Whether a word's letters are in a name's word in order, the name's word starting with its first. */
function lettersIn(word: string, nameWord: string) {
  if (nameWord[0] !== word[0]) return false
  let at = 0
  for (const char of nameWord) if (char === word[at]) at++
  return at >= word.length
}

/** The digit an Arabic-Indic (U+0660–0669) or Persian (U+06F0–06F9) digit stands for. */
function digitOf(char: string): string | undefined {
  const code = char.charCodeAt(0)
  if (code >= 0x660 && code <= 0x669) return String(code - 0x660)
  if (code >= 0x6f0 && code <= 0x6f9) return String(code - 0x6f0)
  return undefined
}
