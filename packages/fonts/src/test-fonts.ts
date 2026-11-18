// Font files only tests read: a few glyphs of Noto Color Emoji, with the tables Google serves
// (COLRv1 and SVG), so a test can draw colour emoji and copy the file as Google's; and Noto Sans
// as one variable font named Vary Sans, its weight axis 100 to 900, for printable ASCII.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** The emoji it has: 😀 🎉 👍🏽 🇮🇳 ❤️ 1️⃣, and their parts. */
export const TEST_EMOJI = '😀🎉👍🏽🇮🇳❤️1️⃣'

const TEST_FILES_DIR = join(import.meta.dirname, '..', 'test-files')

/** The emoji subset's bytes, a new array each call. */
export function emojiTestFont(): Uint8Array {
  return new Uint8Array(readFileSync(join(TEST_FILES_DIR, 'NotoColorEmoji-subset.ttf')))
}

/** Vary Sans, Noto Sans variable renamed so it is no shipped family: its bytes (`wght` 100–900, default 400), a new array each call. */
export function variableTestFont(): Uint8Array {
  return new Uint8Array(readFileSync(join(TEST_FILES_DIR, 'VarySans-VF-ascii.ttf')))
}
