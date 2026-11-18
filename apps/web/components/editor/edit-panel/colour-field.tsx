'use client'

// A colour field, its swatch, eyedropper, hex and opacity, and an opacity field on its own.
import { useRef } from 'react'

import type { Editor } from '@dazbee/editor'
import { alphaOf } from '@dazbee/schema'

import { rememberColour } from '@/components/editor/paint/recent-swatches.tsx'
import { FACE_SIZE, FIELD, SQUARE_SWATCH_TARGET } from '@/components/editor/styles.ts'
import { TOUCH_GAP } from '@/components/ui/looks.ts'
import { cn } from '@/lib/cn.ts'
import { alphaChange, hexChange, hexOf, typedHexChange } from '@/lib/colour.ts'
import { useMessages } from '@/lib/i18n/client.tsx'
import { format } from '@/lib/i18n/index.ts'

import { EyedropperButton } from './eyedropper.tsx'
import { clamp, NumberField, useDraft } from './number-field.tsx'

/**
 * A colour: a swatch that opens the system picker and an eyedropper that picks from the design
 * (unless `swatch` is off, where a swatch beside it does more and the editor it opens has both), the
 * hex, and its opacity as a percentage, a number field. A change gives `onSet` the
 * colour to build from the one the document holds then, so a hex and an opacity committed one after
 * the other each keep the other's change, and an opacity stepped or dragged across layers whose
 * colours differ moves each from its own. With `editor`, a drag of the opacity is one undo step.
 * A colour picked, a hex typed and committed, and the system picker's last colour once the focus
 * leaves it go first in `brandId`'s recent colours; a hex left as it was and an opacity don't.
 */
export function ColorField({
  name,
  value,
  swatch = true,
  editor,
  brandId,
  onSet,
}: {
  name: string
  value: string | 'mixed' | undefined
  swatch?: boolean
  editor?: Editor | undefined
  brandId: string
  onSet: (to: (now: string | undefined) => string) => void
}) {
  const t = useMessages()
  const p = t.editor.props
  const hex = value && value !== 'mixed' ? hexOf(value).toUpperCase() : ''
  /** An opacity in whole percents, as the field shows it. */
  const percents = (color: string) => Math.round(alphaOf(color) * 100) / 100
  const opacity = value === 'mixed' ? 'mixed' : value ? percents(value) : undefined
  const [draft, setDraft, typedNow] = useDraft()
  const commitHex = (text: string) => {
    const typed = typedNow.current !== null
    setDraft(null)
    const change = typedHexChange(text)
    if (!change) return
    // The list keeps the #RRGGBB; an 8-digit hex sets the opacity too, in the same step.
    if (typed) rememberColour(brandId, text)
    if (!value || value === 'mixed' || change(value) !== value) onSet(change)
  }
  // The system picker writes as it moves (React's change is the input event); the colour it last
  // wrote is kept once, when the focus leaves its field, as when and whether its native change event
  // comes differs by platform. The field may show the document's colour a frame late meanwhile, so
  // it is not read from the field.
  const moved = useRef<string | null>(null)
  return (
    // Its hex and opacity are fields, 44 px tall and 8 px apart on a phone or a touch screen.
    <div className={cn('flex min-w-0 flex-1 items-center gap-1', TOUCH_GAP)}>
      {swatch && (
        // The label is the box's target: on a phone a press round the box opens the picker too.
        <label className={SQUARE_SWATCH_TARGET}>
          <input
            name="colour"
            type="color"
            aria-label={format(p.colourOf, { name })}
            value={hex || '#000000'}
            onChange={(event) => {
              moved.current = event.target.value.toUpperCase()
              onSet(hexChange(moved.current))
            }}
            onBlur={() => {
              if (moved.current) rememberColour(brandId, moved.current)
              moved.current = null
            }}
            className={cn(FACE_SIZE, 'size-7 cursor-pointer rounded-row border border-field-line bg-field p-0.5')}
          />
        </label>
      )}
      {/* A colour picked writes as its hex typed would, keeping the opacity. */}
      {swatch && editor && (
        <EyedropperButton
          editor={editor}
          name={name}
          onPick={(h) => {
            rememberColour(brandId, h)
            onSet(hexChange(h))
          }}
        />
      )}
      {/* A hex reads left to right in every language, with its # first. */}
      <input
        name="colour-hex"
        dir="ltr"
        aria-label={format(p.hexOf, { name })}
        value={draft ?? hex}
        placeholder={value === 'mixed' ? p.mixed : ''}
        spellCheck={false}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={(event) => typedNow.current !== null && commitHex(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commitHex(event.currentTarget.value)
          event.stopPropagation()
        }}
        className={cn(FIELD, 'uppercase')}
      />
      <OpacityField
        name={format(p.alpha, { name })}
        value={opacity}
        editor={editor}
        testId="colour-opacity"
        onSet={(to) => opacity !== undefined && onSet(alphaChange(to))}
        onEach={(change) =>
          opacity !== undefined && onSet((now) => alphaChange(clamp(change(percents(now || '#000000')), 0, 1))(now))
        }
      />
    </div>
  )
}

/**
 * An opacity as a percentage, its digits then %: a colour's beside its hex, and a paint's in its
 * row of the fill list. `value` runs from 0 to 1. Its fill shows the value with no line at its end,
 * which in a field this narrow would cross the digits.
 */
export function OpacityField({
  name,
  value,
  editor,
  testId,
  onSet,
  onEach,
}: {
  name: string
  value: number | 'mixed' | undefined
  editor?: Editor | undefined
  testId?: string
  onSet: (value: number) => void
  onEach: (change: (now: number) => number) => void
}) {
  // On a touch screen a little narrower, so a row's 44 px swatch target leaves its hex whole.
  return (
    <div className="w-[4.5rem] shrink-0 [@media(hover:none)]:w-[4rem]">
      <NumberField
        label=""
        name={name}
        value={value}
        scale={100}
        min={0}
        max={1}
        unit="%"
        line={false}
        editor={editor}
        {...(testId ? { testId } : {})}
        onSet={onSet}
        onEach={onEach}
      />
    </div>
  )
}
