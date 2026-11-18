'use client'

// The text's Bold, Italic, Underline and Strikethrough, as four toggles in a row, each on, off or
// mixed for the selected texts, or the selected run while one is being edited. Each toggle does what
// its key does (`editor.perform`), and shows the editor's state for it, read again as font files
// arrive: Bold sets each family's weight nearest Bold, and is greyed where a family has none.
import type { StyleToggle } from '@dazbee/editor'

import { type Target } from '@/components/editor/edit-panel/target.ts'
import { useFontArrivals } from '@/components/editor/editor-hooks.ts'
import { BAR_TOGGLE } from '@/components/editor/styles.ts'
import { TextBIcon, TextItalicIcon, TextStrikethroughIcon, TextUnderlineIcon } from '@/components/ui/icons.tsx'
import { cn } from '@/lib/cn.ts'
import { useMessages } from '@/lib/i18n/client.tsx'

/** One of the four text styles: whether it is on for the selection, whether it can be set, and setting it. */
interface TextStyleToggle {
  id: StyleToggle
  on: boolean | 'mixed'
  disabled: boolean
  onToggle: () => void
}

/** Each style's icon, drawn bold; the four toggles in order. */
const ICONS = {
  bold: TextBIcon,
  italic: TextItalicIcon,
  underline: TextUnderlineIcon,
  strikethrough: TextStrikethroughIcon,
}

/** The four toggles, in order. */
export function TextStyles({ target }: { target: Target }) {
  useFontArrivals(target.editor)
  const state = target.editor.textStyles()
  const toggles: TextStyleToggle[] = (Object.keys(ICONS) as StyleToggle[]).map((id) => ({
    id,
    on: state?.[id].on ?? false,
    disabled: state?.[id].disabled ?? true,
    onToggle: () => target.editor.perform(id),
  }))
  const t = useMessages()
  return (
    <div role="group" aria-label={t.editor.bar.textStyle} className="flex gap-1 max-sm:gap-[8px]">
      {toggles.map(({ id, on: pressed, disabled, onToggle }) => {
        const Icon = ICONS[id]
        return (
          <button
            key={id}
            type="button"
            aria-label={t.editor.actions[id]}
            title={t.editor.actions[id]}
            aria-pressed={pressed}
            disabled={disabled}
            onClick={onToggle}
            data-testid={`text-${id}`}
            className={cn(BAR_TOGGLE, 'max-sm:size-[44px]')}
          >
            <Icon size={16} weight="bold" aria-hidden />
          </button>
        )
      })}
    </div>
  )
}
