'use client'

// The Shape switcher tab's sections: a shape's own settings, a combined shape's operation, and
// combining several shapes. The Shape tab names them, so only one beside another shows a heading. A
// locked layer's are turned off, saying why.
import type { ReactNode } from 'react'

import { BooleanOp, type Design, LineEnd, type Shape } from '@dazbee/schema'

import { COMBINE } from '@/components/editor/arrange-actions.ts'
import { PanelAction } from '@/components/editor/edit-panel/arrange/panel-action.tsx'
import type { SectionProps } from '@/components/editor/edit-panel/tabs/tabs.ts'
import { FIELD_LABEL, KNOBS, PANEL_PART } from '@/components/editor/styles.ts'
import { ViewOnlyFieldset } from '@/components/editor/view-only.tsx'
import { SEGMENT, SEGMENTS } from '@/components/ui/looks.ts'
import { Radio, RadioGroup } from '@/components/ui/radio-group.tsx'
import { cn } from '@/lib/cn.ts'
import { tidy } from '@/lib/editor/size.ts'
import { useMessages } from '@/lib/i18n/client.tsx'
import { type Messages } from '@/lib/i18n/index.ts'

import { RadiusField } from './corner-fields.tsx'
import { Choice, PanelPart } from './fields.tsx'
import { clamp, NumberField } from './number-field.tsx'
import { factsOf, set, shared, type Target } from './target.ts'

/** Each operation's action, which names it and gives its icon. */
const OPERATIONS = {
  union: 'booleanUnion',
  subtract: 'booleanSubtract',
  intersect: 'booleanIntersect',
  exclude: 'booleanExclude',
} as const

/**
 * A shape's own settings, for layers that are all the same kind: a polygon's sides and corner
 * radius, a star's points, inner radius and corner radius, a line's ends.
 */
export function ShapeSection({ target, design }: SectionProps) {
  const t = useMessages()
  const p = t.editor.props
  const kind = factsOf(target, design).ownShape
  // A rectangle's own settings are its corners, which this section doesn't show.
  if (!kind || kind === 'rect') return null
  const shapes = target.props.map((pr) => pr.shape as Shape)
  const value = (key: string) =>
    shared(shapes.map((s) => (s as Record<string, unknown>)[key])) as number | string | 'mixed' | undefined
  const setShape = (change: (now: Record<string, unknown>) => Record<string, unknown>) =>
    set(target, (now) => ({
      shape: { ...(now.shape as Record<string, unknown>), ...change(now.shape as Record<string, unknown>) },
    }))
  /** A knob, as in the mock: its range is what designs mostly use, and the shape keeps the schema's limits. */
  const knob = (
    key: string,
    name: string,
    {
      min,
      max,
      scale = 1,
      unit,
      whole = true,
    }: { min: number; max: number; scale?: number; unit?: string; whole?: boolean },
  ) => {
    const to = (n: number) => clamp(whole ? Math.round(n) : tidy(n), min, max)
    return (
      <NumberField
        label={name}
        name={name}
        value={value(key) as number | 'mixed' | undefined}
        min={min}
        max={max}
        scale={scale}
        unit={unit}
        editor={target.editor}
        onSet={(n) => setShape(() => ({ [key]: to(n) }))}
        onEach={(change) => setShape((now) => ({ [key]: to(change((now[key] as number | undefined) ?? min)) }))}
      />
    )
  }
  return (
    <Part id="shape-card" title={p.shapeKinds[kind]} headed={false} why={lockedWhy(target, design, t)}>
      {kind === 'line' ? (
        <div className="grid grid-cols-2 gap-x-3">
          {(['start', 'end'] as const).map((end) => (
            <label key={end} className={cn('flex min-w-0 flex-col gap-1', FIELD_LABEL)}>
              {p.lineEndShort[end]}
              <Choice
                name={p.lineEnd[end]}
                value={value(end) as LineEnd | 'mixed' | undefined}
                options={LineEnd.options}
                labels={p.lineEnds}
                onSet={(v) => setShape(() => ({ [end]: v }))}
              />
            </label>
          ))}
        </div>
      ) : (
        <div className={KNOBS}>
          {kind === 'polygon' && knob('sides', p.sides, { min: 3, max: 24 })}
          {kind === 'star' && knob('points', p.points, { min: 3, max: 24 })}
          {kind === 'star' &&
            knob('innerRadius', p.innerRadius, { min: 0.05, max: 0.95, scale: 100, unit: '%', whole: false })}
          <RadiusField target={target} p={p} label={p.cornerRadius} fillRange={[0, 200]} />
        </div>
      )}
    </Part>
  )
}

/**
 * A boolean's operation, changed in place: its shapes added together, the rest cut from the first,
 * where they overlap, or where they don't.
 */
export function CombineSection({ target, design, headed }: SectionProps) {
  const t = useMessages()
  const p = t.editor.props
  const a = t.editor.actions
  const value = shared(target.props.map((pr) => pr.op as (typeof BooleanOp.options)[number]))
  return (
    <Part id="combine-card" title={p.combine} headed={headed} why={lockedWhy(target, design, t)}>
      <RadioGroup
        label={p.combine}
        options={BooleanOp.options}
        value={value}
        onPick={(op) => set(target, () => ({ op }))}
        className={SEGMENTS}
      >
        {BooleanOp.options.map((op) => {
          const action = OPERATIONS[op]
          const Icon = COMBINE.find((c) => c.action === action)?.icon
          const name = a[action]
          return (
            <Radio
              key={op}
              value={op}
              aria-label={name}
              title={name}
              data-value={op}
              className={cn(SEGMENT, 'grid place-items-center')}
            >
              {Icon && <Icon size={16} aria-hidden />}
            </Radio>
          )
        })}
      </RadioGroup>
    </Part>
  )
}

/**
 * Combining several shapes into one combined shape: a button for each way to combine them, two to a
 * row, with its key in its tooltip.
 */
export function CombineShapesSection({ target, design, headed }: SectionProps) {
  const t = useMessages()
  const why = lockedWhy(target, design, t)
  return (
    <Part id="combine-shapes" title={t.editor.editPanel.sections.combineShapes} headed={headed} why={why}>
      <div className="grid grid-cols-2 gap-1.5 max-sm:gap-[8px]">
        {COMBINE.map(({ action, icon }) => (
          <PanelAction
            key={action}
            target={target}
            action={action}
            name={t.editor.actions[action]}
            icon={icon}
            why={why}
          />
        ))}
      </div>
    </Part>
  )
}

/** Why the section's controls are off: the layers are locked; null while they may change. */
function lockedWhy(target: Target, design: Design, t: Messages) {
  return factsOf(target, design).locked.length > 0 ? t.editor.bar.lockedRow : null
}

/**
 * A section titled `title`: as its heading where `headed`, else only to a screen reader. While `why`
 * says why, its controls are off and it says why.
 */
function Part({
  id,
  title,
  headed,
  why,
  children,
}: {
  id: string
  title: string
  headed: boolean
  why: string | null
  children: ReactNode
}) {
  const body = (
    <ViewOnlyFieldset off={why !== null}>
      {/* Turned off, its controls fade as a control turned off does (`DISABLED`). */}
      <div className={cn(why && 'opacity-40')}>{children}</div>
    </ViewOnlyFieldset>
  )
  if (headed)
    return (
      <PanelPart id={id} title={title} {...(why && { note: why })}>
        {body}
      </PanelPart>
    )
  return (
    <section aria-label={title} data-testid={id} className={PANEL_PART}>
      {why && <p className="text-caption font-medium text-muted">{why}</p>}
      {body}
    </section>
  )
}
