// Text from outside the editor: its line breaks as paragraphs, and the text layer plain text
// pasted on the canvas becomes.
import { newText } from './gestures/drawing/draw-tools.ts'

/** A text layer of pasted text, as node.create takes it, its top start corner at 0, 0. */
export interface PastedText {
  type: 'text'
  name: string
  props: ReturnType<typeof newText>['props']
}

/** Text with each line break, whichever system wrote it, as the one break that starts a paragraph. */
export const paragraphsOf = (text: string) => text.replace(/\r\n?/g, '\n')

/** The most characters of its first line a pasted text's name takes. */
const NAME_LENGTH = 100

/**
 * A text layer for plain text pasted from outside, its top start corner at 0, 0: as the text tool
 * makes one, growing with its words, its line breaks as paragraphs, named by its first line that
 * holds a word (at most NAME_LENGTH characters). Null for text that is only spaces.
 */
export function pastedText(text: string): PastedText | null {
  const typed = paragraphsOf(text)
  const first = typed
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line !== '')
  if (first === undefined) return null
  const made = newText(0, 0, null)
  return { ...made, name: Array.from(first).slice(0, NAME_LENGTH).join(''), props: { ...made.props, text: typed } }
}
