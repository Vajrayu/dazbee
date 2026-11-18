'use client'

// The Outline panel: the strokes' look and width, then under Outlines each stroke's paint, width,
// place, dashes, ends and corners.
import { useState } from 'react'

import { type Editor } from '@dazbee/editor'
import { type Paint } from '@dazbee/schema'

import { PaintRow } from '@/components/editor/paint/paint-stack.tsx'
import { ListBody } from '@/components/editor/reorder-list.tsx'
import { FIELD, ICON_CHIP, KNOBS, PANEL_PART } from '@/components/editor/styles.ts'
import { TOUCH_GAP } from '@/components/ui/looks.ts'
import { Radio, RadioGroup } from '@/components/ui/radio-group.tsx'
import { cn } from '@/lib/cn.ts'
import { LIMITS } from '@/lib/editor/limits.ts'
import { tidy } from '@/lib/editor/size.ts'
import { useMessages } from '@/lib/i18n/client.tsx'
import { format } from '@/lib/i18n/index.ts'

import { Choice, PanelPart } from './fields.tsx'
import { clamp, NumberField } from './number-field.tsx'
import { type P, type PanelProps, set, shared, type Target } from './target.ts'

type Stroke = {
  paint: Paint
  width: number
  align: 'inside' | 'center' | 'outside'
  dashes?: number[]
  dashOffset?: number
  cap?: 'butt' | 'round' | 'square'
  join?: 'miter' | 'round' | 'bevel'
}

type StrokeLook = 'none' | 'solid' | 'dashed'

const NEW_STROKE = { paint: { type: 'solid', color: '#1A1420FF' } as Paint, width: 2, align: 'center' as const }

const STROKE_LOOKS: StrokeLook[] = ['none', 'solid', 'dashed']

/** How each of the Outline panel's tiles draws its stroke: a faint square for none, a solid or a dashed one. */
/** Each look's icon: a small square drawn with no outline, a solid one or a dashed one. */
const STROKE_FACE: Record<StrokeLook, string> = {
  none: 'border-[1.5px] border-line-strong',
  solid: 'border-2 border-current',
  dashed: 'border-2 border-dashed border-current',
}

const DASHES = [8, 4]

const dashed = (stroke: Stroke) => (stroke.dashes?.length ?? 0) > 0

/** A stroke drawn solid: its dashes and their offset gone. */
function solidOf(stroke: Stroke): Stroke {
  const next = { ...stroke }
  delete next.dashes
  delete next.dashOffset
  return next
}

/** Dash and gap lengths as typed, "8 4", or null when they aren't a pattern; nothing typed is solid. */
function parseDashes(text: string): number[] | null {
  const parts = text.split(/[\s,]+/).filter(Boolean)
  const lengths = parts.map((part) => Number.parseFloat(part))
  if (lengths.some((n) => !Number.isFinite(n) || n < 0 || n > LIMITS.any)) return null
  if (lengths.length > 0 && !lengths.some((n) => n > 0)) return null
  return lengths.map(tidy)
}

/**
 * The Outline panel: the strokes' look as three tiles, none, solid or dashed, and the width of every
 * stroke, then each stroke's own settings under Outlines. Picking solid or dashed gives a layer
 * without a stroke a new one.
 */
export function StrokePanel({ target, workspaceId, brandId }: PanelProps) {
  const t = useMessages()
  const p = t.editor.props
  const b = t.editor.bar
  const lists = target.props.map((pr) => (pr.strokes ?? []) as Stroke[])
  const look: StrokeLook | 'mixed' = lists.every((l) => l.length === 0)
    ? 'none'
    : lists.every((l) => l.length > 0 && l.every(dashed))
      ? 'dashed'
      : lists.every((l) => l.length > 0 && !l.some(dashed))
        ? 'solid'
        : 'mixed'
  const pick = (to: StrokeLook) =>
    set(target, (now) => {
      const strokes = (now.strokes ?? []) as Stroke[]
      if (to === 'none') return { strokes: [] }
      const kept = strokes.length > 0 ? strokes : [NEW_STROKE]
      return {
        strokes: kept.map((stroke) =>
          to === 'solid' ? solidOf(stroke) : dashed(stroke) ? stroke : { ...stroke, dashes: DASHES },
        ),
      }
    })
  const widths = shared(lists.flatMap((l) => l.map((stroke) => stroke.width)))
  const setWidths = (to: (now: number) => number) =>
    set(target, (now) => ({
      strokes: ((now.strokes ?? []) as Stroke[]).map((stroke) => ({
        ...stroke,
        width: tidy(clamp(to(stroke.width), 0.5)),
      })),
    }))
  return (
    <>
      <PanelPart id="stroke-look" title={b.strokeLook.title}>
        <RadioGroup
          label={b.strokeLook.title}
          options={STROKE_LOOKS}
          value={look}
          onPick={pick}
          className={cn('grid grid-cols-3 gap-1', TOUCH_GAP)}
        >
          {STROKE_LOOKS.map((to) => (
            <Radio key={to} value={to} data-value={to} className={ICON_CHIP}>
              <span aria-hidden className={cn('size-3.5 shrink-0 rounded-[3px]', STROKE_FACE[to])} />
              <span className="min-w-0 truncate">{b.strokeLook[to]}</span>
            </Radio>
          ))}
        </RadioGroup>
        {look !== 'none' && (
          <NumberField
            label={b.strokeLook.width}
            name={b.strokeLook.widthName}
            value={widths}
            min={0.5}
            step={0.5}
            fillRange={[0, 24]}
            editor={target.editor}
            onSet={(v) => setWidths(() => v)}
            onEach={(change) => setWidths(change)}
          />
        )}
      </PanelPart>
      <div className={PANEL_PART} data-testid="stroke-card">
        <StrokeBody target={target} workspaceId={workspaceId} brandId={brandId} p={p} title={b.strokeLook.outlines} />
      </div>
    </>
  )
}

/**
 * The strokes, each with its paint, width, place, dashes, ends and corners, under a heading with +.
 */
function StrokeBody({
  target,
  workspaceId,
  brandId,
  p,
  title,
}: {
  target: Target
  workspaceId: string
  brandId: string
  p: P
  title: string
}) {
  return (
    <ListBody<Stroke>
      title={title}
      p={p}
      target={target}
      field="strokes"
      fresh={NEW_STROKE}
      topFirst
      item={p.stroke}
      testId="stroke-list"
      render={(stroke, n, change) => (
        <StrokeRow
          stroke={stroke}
          place={n}
          workspaceId={workspaceId}
          brandId={brandId}
          p={p}
          editor={target.editor}
          onSet={change}
        />
      )}
    />
  )
}

/** One stroke: its colour, width and position, then its dashes and the look of its ends and corners (#152). */
function StrokeRow({
  stroke,
  place,
  workspaceId,
  brandId,
  p,
  editor,
  onSet,
}: {
  stroke: Stroke
  place: number
  workspaceId: string
  brandId: string
  p: P
  editor: Editor
  onSet: (to: (now: Stroke) => Stroke) => void
}) {
  const n = { n: place }
  return (
    <div className={cn('flex min-w-0 flex-1 flex-col gap-1', TOUCH_GAP)}>
      <PaintRow
        paint={stroke.paint}
        name={format(p.strokeColour, n)}
        workspaceId={workspaceId}
        brandId={brandId}
        editor={editor}
        p={p}
        onSet={(to) => onSet((now) => ({ ...now, paint: to(now.paint) }))}
      />
      <div className={KNOBS}>
        <NumberField
          label="W"
          name={format(p.strokeWidth, n)}
          value={stroke.width}
          min={0.5}
          step={0.5}
          editor={editor}
          onSet={(width) => onSet((now) => ({ ...now, width }))}
          onEach={(change) => onSet((now) => ({ ...now, width: tidy(clamp(change(now.width), 0.5)) }))}
        />
        <Choice
          name={format(p.strokeAlign, n)}
          value={stroke.align}
          options={['inside', 'center', 'outside'] as const}
          labels={p.aligns}
          onSet={(align) => onSet((now) => ({ ...now, align }))}
        />
        <DashField
          name={format(p.strokeDashes, n)}
          value={stroke.dashes ?? []}
          onSet={(dashes) => onSet((now) => ({ ...now, dashes }))}
        />
        <NumberField
          label="⇥"
          name={format(p.strokeDashOffset, n)}
          value={stroke.dashOffset ?? 0}
          editor={editor}
          onSet={(dashOffset) => onSet((now) => ({ ...now, dashOffset }))}
          onEach={(change) => onSet((now) => ({ ...now, dashOffset: tidy(change(now.dashOffset ?? 0)) }))}
        />
        <Choice
          name={format(p.strokeCap, n)}
          value={stroke.cap ?? 'butt'}
          options={['butt', 'round', 'square'] as const}
          labels={p.caps}
          onSet={(cap) => onSet((now) => ({ ...now, cap }))}
        />
        <Choice
          name={format(p.strokeJoin, n)}
          value={stroke.join ?? 'miter'}
          options={['miter', 'round', 'bevel'] as const}
          labels={p.joins}
          onSet={(join) => onSet((now) => ({ ...now, join }))}
        />
      </div>
    </div>
  )
}

/** A stroke's dash pattern, typed as lengths: dash, gap, dash and so on. */
function DashField({ name, value, onSet }: { name: string; value: number[]; onSet: (dashes: number[]) => void }) {
  const t = useMessages()
  const shown = value.join(' ')
  const [draft, setDraft] = useState<string | null>(null)
  const commit = (text: string) => {
    setDraft(null)
    const dashes = parseDashes(text)
    if (dashes && dashes.join(' ') !== shown) onSet(dashes)
  }
  return (
    <input
      name="dashes"
      aria-label={name}
      title={t.editor.props.dashesHint}
      value={draft ?? shown}
      placeholder={t.editor.props.solid}
      spellCheck={false}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={(event) => draft !== null && commit(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit(event.currentTarget.value)
        else if (event.key === 'Escape') {
          setDraft(null)
          event.currentTarget.blur()
        }
        event.stopPropagation()
      }}
      className={FIELD}
    />
  )
}
