// A tab's message as the sync server reads it (D10): its JSON, refused unparsed when it nests deeper
// than a change's value may (`SYNC_LIMITS.valueDepth`) plus the message around the value.
import { SYNC_LIMITS } from '@dazbee/schema'

/**
 * How deep a tab's message may nest: a value's limit plus the three levels around it (the message,
 * its list of changes, and a change or a preview's tuple). A created record sits at the value's level
 * itself, so its own values may nest one less: a design's deepest is 5 below its record.
 */
export const MESSAGE_DEPTH = SYNC_LIMITS.valueDepth + 3

const OPEN_ARRAY = 0x5b
const OPEN_OBJECT = 0x7b
const CLOSE_ARRAY = 0x5d
const CLOSE_OBJECT = 0x7d
const QUOTE = 0x22
const BACKSLASH = 0x5c

/** The message `text` holds, or undefined when it is not JSON or nests deeper than `MESSAGE_DEPTH`. */
export function readMessage(text: string): unknown {
  if (tooDeep(text)) return undefined
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

/** Whether `text` opens more than `MESSAGE_DEPTH` brackets at once outside its strings. */
function tooDeep(text: string): boolean {
  let depth = 0
  let inString = false
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (inString) {
      if (c === BACKSLASH) i++
      else if (c === QUOTE) inString = false
    } else if (c === QUOTE) inString = true
    else if (c === OPEN_ARRAY || c === OPEN_OBJECT) {
      if (++depth > MESSAGE_DEPTH) return true
    } else if (c === CLOSE_ARRAY || c === CLOSE_OBJECT) depth--
  }
  return false
}
