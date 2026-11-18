// The name a new group, Mask group or box takes, in the app's words.
import type { Messages } from '@/lib/i18n/index.ts'

export function layerName(t: Messages, kind: 'group' | 'maskGroup' | 'box'): string {
  return t.editor.names[kind]
}
