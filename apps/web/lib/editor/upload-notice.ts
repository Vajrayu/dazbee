// The notice a drop, an SVG's pictures and pasted images share while they upload: one count of
// every file and picture still uploading, after what the drop said, lasting until nothing uploads;
// then what the drop said, as a notice that goes.
import { format, type Messages } from '@/lib/i18n/index.ts'

/** What is uploading from drops and SVG files, and what the last drop said. */
export interface Uploading {
  /** The names of the dropped files still uploading. */
  files: readonly string[]
  /** The names of the SVG files' pictures and the pasted images still uploading. */
  pictures: readonly string[]
  /** What the last drop said: the files left out, and once it ended, what didn't upload or wasn't placed. */
  said: string
}

/** The uploads named, one by its name and more by their number; nothing for none. */
export function uploadingWords(words: Messages['editor']['droppedFiles'], names: readonly string[]): string {
  if (names.length === 0) return ''
  return names.length === 1
    ? format(words.uploading, { name: names[0] ?? '' })
    : format(words.uploadingMany, { n: names.length })
}

/**
 * The notice for what uploads: what the drop said and the count of every upload, lasting, while
 * anything uploads; what the drop said, not lasting, once nothing does; null with nothing to say.
 */
export function uploadNotice(
  words: Messages['editor']['droppedFiles'],
  { files, pictures, said }: Uploading,
): { text: string; lasting: boolean } | null {
  const uploading = uploadingWords(words, [...files, ...pictures])
  if (uploading) return { text: [said, uploading].filter(Boolean).join(' '), lasting: true }
  return said ? { text: said, lasting: false } : null
}
