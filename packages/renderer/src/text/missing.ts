// The characters no font draws in laid-out text, as whole graphemes: a glyph CanvasKit shaped as
// glyph 0 (no font in the text's fallback list has it) names the grapheme it is in. The paragraph's
// `unresolvedCodepoints()` can't say: the font collection remembers a character it found no font
// for, and a later paragraph with it lists nothing.
import type { TextBlock } from './layout.ts'

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
const utf8 = new TextEncoder()
/** Spaces, tabs and the format characters between letters, which draw nothing whatever font has them. */
const BLANK = /^[\s\p{Cc}\p{Cf}]+$/u

/**
 * Each grapheme of a block that holds a character no font draws, once, in the order of the text.
 * Only the lines shown are shaped, so characters a line limit cuts off are not named; the outline
 * pass is the same text and is not read.
 */
export function missingGraphemes({ paragraph, text }: Pick<TextBlock, 'paragraph' | 'text'>): string[] {
  // Where each glyph 0 starts in the paragraph's text, in UTF-8 bytes, as CanvasKit counts.
  const missingAt: number[] = []
  for (const line of paragraph.getShapedLines())
    for (const run of line.runs)
      run.glyphs.forEach((glyph, i) => {
        if (glyph === 0) missingAt.push(run.offsets[i] ?? -1)
      })
  if (missingAt.length === 0) return []
  const found: string[] = []
  let at = 0
  for (const { segment } of graphemeSegmenter.segment(text)) {
    const end = at + utf8.encode(segment).length
    if (!found.includes(segment) && !BLANK.test(segment) && missingAt.some((byte) => byte >= at && byte < end))
      found.push(segment)
    at = end
  }
  return found
}
