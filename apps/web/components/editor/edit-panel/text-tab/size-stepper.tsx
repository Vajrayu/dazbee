'use client'

import { type ComponentProps, useState } from 'react'

import { type Target, textStyle } from '@/components/editor/edit-panel/target.ts'
import { NumberInput, numberKeyDown, useNumberInput } from '@/components/editor/number-input.tsx'
import { MinusIcon, PlusIcon } from '@/components/ui/icons.tsx'
import { Tooltip } from '@/components/ui/tooltip.tsx'
import { fontSizeChange, parseTyped, type Typed } from '@/lib/editor/size.ts'
import { useMessages } from '@/lib/i18n/client.tsx'

/**
 * The text's size in the Font section: smaller, the size as a number input, bigger; Mixed where the
 * selected texts differ, the field growing to fit the word. What is typed is read as every number field reads
 * it (`parseTyped`): a sum sets the size, and a leading `+`, `*` or `/` shifts or scales each text's
 * own. The size takes the number input's press and caret, selected in the stronger tint as it lies
 * on the panel's glass, and the stepper's edge is the accent while it is typed in.
 */
export function SizeStepper({ target }: { target: Target }) {
  const t = useMessages()
  const { style, changeStyle } = textStyle(target)
  const size = style('fontSize') as number | 'mixed'
  const shown = size === 'mixed' ? '' : String(Math.round(size * 10) / 10)
  // What is being typed, until Enter, leaving the field or Esc; the size shows otherwise.
  const [draft, setDraft] = useState<string | null>(null)
  const entry = useNumberInput()
  /** Sets, shifts or scales each text's size through the one write: held between 1 and the largest size, in tenths. */
  const write = (typed: Typed) => changeStyle('fontSize', fontSizeChange(typed))
  const commit = (text: string) => {
    const asked = parseTyped(text)
    if (asked) write(asked)
    setDraft(null)
  }
  return (
    <div
      role="group"
      aria-label={t.editor.props.fontSize}
      data-testid="bar-size"
      data-typing={entry.typing ? '' : undefined}
      // On a phone smaller, the size and bigger are three 44 px targets 8 px apart, the size boxed.
      className="flex h-[30px] shrink-0 items-center rounded-row border border-line transition-colors duration-[var(--chrome-fast)] data-typing:border-accent max-sm:h-[44px] max-sm:gap-[8px] max-sm:border-0"
    >
      <StepButton
        label={t.editor.bar.smaller}
        onClick={() => write({ shift: -1 })}
        className="grid h-full w-6 cursor-pointer place-items-center rounded-s-row text-muted hover:bg-hover hover:text-text"
      >
        <MinusIcon size={12} aria-hidden />
      </StepButton>
      <div
        {...entry.knob}
        className="flex h-full min-w-10 cursor-text items-center justify-center overflow-hidden px-1 max-sm:min-w-[44px] max-sm:rounded-row max-sm:border max-sm:border-line max-sm:in-data-typing:border-accent"
      >
        <NumberInput
          entry={entry}
          text={draft ?? shown}
          hint={t.editor.props.mixed}
          strong
          name="font-size"
          aria-label={t.editor.props.fontSize}
          data-testid="bar-size-field"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) =>
            numberKeyDown(event, entry, {
              editor: target.editor,
              typed: draft !== null,
              commit,
              discard: () => setDraft(null),
              step: (sign, keys) => write({ shift: sign * (keys.shiftKey ? 10 : 1) }),
            })
          }
          onBlur={(event) => draft !== null && commit(event.currentTarget.value)}
        />
      </div>
      <StepButton
        label={t.editor.bar.bigger}
        onClick={() => write({ shift: 1 })}
        className="grid h-full w-6 cursor-pointer place-items-center rounded-e-row text-muted hover:bg-hover hover:text-text"
      >
        <PlusIcon size={12} aria-hidden />
      </StepButton>
    </div>
  )
}

/** A button named by `label` and showing `children`, its icon. */
function StepButton({
  label,
  children,
  ...button
}: Omit<ComponentProps<'button'>, 'type' | 'aria-label' | 'title'> & {
  /** The button's name: its accessible name and its tooltip. */
  label: string
}) {
  return (
    <Tooltip label={label} side="bottom" plain>
      <button {...button} type="button" aria-label={label}>
        {children}
      </button>
    </Tooltip>
  )
}
