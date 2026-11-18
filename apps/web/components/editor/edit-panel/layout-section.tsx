'use client'

// The layout section, which is all of a box's Layout switcher tab, and ends the Image tab of a photo
// a box holds: how a box places what is inside it. Its layout (Free, Row, Column or Grid, with a grid's columns, or a row's or column's wrap,
// under it); for a laid-out box, a 3×3 pad lining up what it holds beside the room between, a
// number or Auto, the room between its rows or columns where it wraps or is a grid, and the room
// around, one field or each side's; whether it hides what is outside it; then its look, the corners.
import { type ReactNode } from 'react'

import { type AutoLayout, gridColumns, layoutOf } from '@dazbee/schema'

import { type LayoutLook, layoutLook, LAYOUTS, type Words } from '@/components/editor/box-layouts.ts'
import type { SectionProps } from '@/components/editor/edit-panel/tabs/tabs.ts'
import { FIELD_LABEL, PANEL_PART } from '@/components/editor/styles.ts'
import { ViewOnlyFieldset } from '@/components/editor/view-only.tsx'
import {
  ArrowLineDownIcon,
  ArrowLineLeftIcon,
  ArrowLineRightIcon,
  ArrowLineUpIcon,
  SelectionIcon,
} from '@/components/ui/icons.tsx'
import { FOCUS_RING } from '@/components/ui/looks.ts'
import { Select } from '@/components/ui/select.tsx'
import { cn } from '@/lib/cn.ts'
import { tidy } from '@/lib/editor/size.ts'
import { useMessages } from '@/lib/i18n/client.tsx'

import { CornerFields } from './corner-fields.tsx'
import { PanelPart, Segments, SwitchRow } from './fields.tsx'
import { NumberField } from './number-field.tsx'
import { OneOrFour } from './one-or-four.tsx'
import { factsOf, type P, set, shared, type Target } from './target.ts'
import { lineGapOf, lineGapPatch, wrapApplies, wrapPatch } from './wrap.ts'

type Side = keyof AutoLayout['padding']

/** Where the pad lines layers up, along and across the flow. */
type Place = AutoLayout['align']

/** The columns a grid's chips offer. */
const COLUMNS = ['2', '3', '4', '5'] as const

const PLACES: Place[] = ['start', 'center', 'end']

/** Around's four fields, in the order they sit, two by two: left and right, then top and bottom. */
const SIDES: { side: Side; icon: ReactNode }[] = [
  { side: 'left', icon: <ArrowLineLeftIcon size={14} aria-hidden /> },
  { side: 'right', icon: <ArrowLineRightIcon size={14} aria-hidden /> },
  { side: 'top', icon: <ArrowLineUpIcon size={14} aria-hidden /> },
  { side: 'bottom', icon: <ArrowLineDownIcon size={14} aria-hidden /> },
]

/** Whether a box's layers spread out with the room left between them: Between's Auto. */
const AUTO = 'space-between'

/** Sets the selected boxes' layout settings, each from its own, as one undo step. */
const setLayoutOf = (target: Target, change: (l: AutoLayout) => Partial<AutoLayout>) =>
  set(target, (now) => {
    const l = now.layout as AutoLayout | undefined
    return l ? { layout: { ...l, ...change(l) } } : null
  })

/** Something for each layout the layout section offers, by layout. */
const byLayout = <V,>(value: (look: LayoutLook) => V, words: Words) =>
  Object.fromEntries(LAYOUTS.map((layout) => [layout, value(layoutLook(layout, words))])) as Record<
    (typeof LAYOUTS)[number],
    V
  >

/** The layout section for the selected boxes; headed where `headed`, beside other sections. */
export function LayoutSection({ target, design, headed }: SectionProps) {
  const t = useMessages()
  const p = t.editor.props
  // A locked box's settings are off, saying why.
  const why = factsOf(target, design).locked.length > 0 ? t.editor.bar.lockedRow : null
  const layouts = target.props.map((pr) => pr.layout as AutoLayout | undefined)
  const layout = shared(target.props.map((pr) => layoutOf(pr)))
  const laidOut = layouts.every(Boolean)
  const body = (
    <ViewOnlyFieldset off={why !== null}>
      {/* Turned off, its controls fade as a control turned off does (`DISABLED`). */}
      <div className={cn('flex flex-col gap-3', why && 'opacity-40')}>
        <div className="flex flex-col gap-3">
          {/* The Layout switcher tab, or the section's heading, names its layout, so the choice shows no label of its own. */}
          <div className="flex flex-col gap-1.5">
            <Segments
              name={p.layout}
              value={layout}
              options={LAYOUTS}
              labels={byLayout(({ word }) => word, t.editor.layouts)}
              icons={byLayout(
                ({ Icon }) => (
                  <Icon size={18} aria-hidden />
                ),
                t.editor.layouts,
              )}
              onSet={(to) => to !== layout && target.editor.setLayout(to)}
            />
          </div>
          {layout === 'grid' && <ColumnsPart target={target} p={p} layouts={layouts} />}
          {laidOut && layouts.every(wrapApplies) && (
            <SwitchRow
              name={p.wrap}
              on={shared(layouts.map((l) => l?.wrap === true))}
              onSet={(on) => set(target, (now) => wrapPatch(now, on))}
            />
          )}
          {laidOut && <FlowPart target={target} p={p} layouts={layouts} />}
          <SwitchRow
            name={p.clip}
            on={shared(target.props.map((pr) => pr.clip !== false))}
            onSet={(clip) => set(target, () => ({ clip }))}
          />
        </div>
        {/* Its corners' own label names it, so the part shows no heading. */}
        <section aria-label={p.look} className={PANEL_PART}>
          <CornerFields target={target} p={p} />
        </section>
      </div>
    </ViewOnlyFieldset>
  )
  // Beside the Image tab's other sections, a heading names the layout; the tab says once why it is off.
  if (headed)
    return (
      <PanelPart id="box-panel" title={p.layout}>
        {body}
      </PanelPart>
    )
  return (
    <div data-testid="box-panel" className="flex flex-col gap-3">
      {why && <p className="text-caption font-medium text-muted">{why}</p>}
      {body}
    </div>
  )
}

/** A grid's columns, as chips from 2 to 5; a count outside them shows as one more chip, pressed. */
function ColumnsPart({ target, p, layouts }: { target: Target; p: P; layouts: (AutoLayout | undefined)[] }) {
  const columns = shared(layouts.map((l) => String(gridColumns(l ?? {}))))
  const options = columns === 'mixed' || COLUMNS.some((c) => c === columns) ? COLUMNS : [...COLUMNS, columns]
  return (
    <div className="flex flex-col gap-1.5">
      <span id="box-columns-label" className={FIELD_LABEL}>
        {p.columns}
      </span>
      <Segments
        labelledBy="box-columns-label"
        value={columns}
        options={options}
        labels={Object.fromEntries(options.map((c) => [c, c]))}
        onSet={(to) => setLayoutOf(target, () => ({ columns: Number(to) }))}
      />
    </div>
  )
}

/**
 * How a laid-out box places what it holds: the Line up pad on the start side, and beside it the
 * room between and the room around.
 */
function FlowPart({ target, p, layouts }: { target: Target; p: P; layouts: (AutoLayout | undefined)[] }) {
  const value = <K extends keyof AutoLayout>(key: K) => shared(layouts.map((l) => l?.[key]))
  const direction = value('direction')
  const sides = layouts.flatMap((l) => (l ? [l.padding] : []))
  return (
    <div className="grid grid-cols-2 items-stretch gap-3">
      <div className="flex min-w-0 flex-col gap-1.5">
        <span id="box-line-up-label" className={FIELD_LABEL}>
          {p.lineUp}
        </span>
        <LineUpPad target={target} p={p} direction={direction} layouts={layouts} />
      </div>
      <div className="flex min-w-0 flex-col gap-3">
        <BetweenField target={target} p={p} direction={direction} layouts={layouts} />
        {layouts.every((l) => l && (l.direction === 'grid' || l.wrap === true)) && (
          <BetweenLinesField target={target} p={p} direction={direction} layouts={layouts} />
        )}
        <OneOrFour
          id="around-fields"
          label={p.around}
          eachName={p.eachSide}
          icon={<SelectionIcon size={14} aria-hidden />}
          differ={sides.some((s) => new Set(Object.values(s)).size > 1)}
          one={
            <NumberField
              label={<SelectionIcon size={14} aria-hidden />}
              name={p.around}
              value={shared(sides.flatMap((s) => [s.top, s.right, s.bottom, s.left]))}
              min={0}
              editor={target.editor}
              onSet={(v) => setLayoutOf(target, () => ({ padding: { top: v, right: v, bottom: v, left: v } }))}
              onEach={(change) =>
                setLayoutOf(target, (l) => ({
                  padding: {
                    top: tidy(Math.max(0, change(l.padding.top))),
                    right: tidy(Math.max(0, change(l.padding.right))),
                    bottom: tidy(Math.max(0, change(l.padding.bottom))),
                    left: tidy(Math.max(0, change(l.padding.left))),
                  },
                }))
              }
            />
          }
          four={SIDES.map(({ side, icon }) => (
            <NumberField
              key={side}
              label={icon}
              name={p.padding[side]}
              value={shared(sides.map((s) => s[side]))}
              min={0}
              editor={target.editor}
              onSet={(v) => setLayoutOf(target, (l) => ({ padding: { ...l.padding, [side]: v } }))}
              onEach={(change) =>
                setLayoutOf(target, (l) => ({
                  padding: { ...l.padding, [side]: tidy(Math.max(0, change(l.padding[side]))) },
                }))
              }
            />
          ))}
        />
      </div>
    </div>
  )
}

/**
 * The 3×3 pad that lines up what the box holds along both axes at once: across the pad is along a
 * row's line, or down a column's. While Between is Auto the layers stay spread out along the line,
 * so a press sets only where they sit across it.
 */
function LineUpPad({
  target,
  p,
  direction,
  layouts,
}: {
  target: Target
  p: P
  direction: AutoLayout['direction'] | 'mixed' | undefined
  layouts: (AutoLayout | undefined)[]
}) {
  const justify = shared(layouts.map((l) => l?.justify))
  const align = shared(layouts.map((l) => l?.align))
  return (
    <div
      role="group"
      aria-labelledby="box-line-up-label"
      dir="ltr"
      className="grid min-h-[96px] flex-1 grid-cols-3 gap-[3px] rounded-[10px] bg-well p-[5px]"
    >
      {PLACES.map((y) =>
        PLACES.map((x) => {
          const [along, across] = direction === 'column' ? [y, x] : [x, y]
          const pressed = align === across && (justify === along || justify === AUTO)
          const look = cn(
            'grid min-h-6 place-items-center rounded-[5px] after:size-1 after:rounded-full after:bg-subtle aria-pressed:after:h-1.5 aria-pressed:after:w-4 aria-pressed:after:rounded-[2px] aria-pressed:after:bg-accent',
            FOCUS_RING,
          )
          const props = {
            'aria-label': p.padCells[`${y}-${x}`],
            'aria-pressed': pressed,
            'data-justify': along,
            'data-align': across,
          }
          return (
            <button
              key={`${y}-${x}`}
              type="button"
              {...props}
              onClick={() =>
                setLayoutOf(target, (l) => {
                  const own = l.direction === 'column' ? { justify: y, align: x } : { justify: x, align: y }
                  return { justify: l.justify === AUTO ? AUTO : own.justify, align: own.align }
                })
              }
              className={cn(look, 'cursor-pointer hover:bg-hover active:bg-pressed')}
            />
          )
        }),
      )}
    </div>
  )
}

/**
 * The room between the layers: ↔ along a row or a grid, ↕ down a column. Its menu offers Auto,
 * where the layers spread out with the room left between them, except in a grid; a number typed or
 * picked gathers them at the start again.
 */
function BetweenField({
  target,
  p,
  direction,
  layouts,
}: {
  target: Target
  p: P
  direction: AutoLayout['direction'] | 'mixed' | undefined
  layouts: (AutoLayout | undefined)[]
}) {
  /** The layers gathered at the start again, where Auto spread them. */
  const gathered = (l: AutoLayout): Partial<AutoLayout> => (l.justify === AUTO ? { justify: 'start' } : {})
  return (
    <RoomField
      target={target}
      p={p}
      name={p.between}
      mark={direction === 'column' ? '↕' : '↔'}
      testId="between-mark"
      menuName="between-kind"
      kindName={p.betweenKind}
      auto={shared(layouts.map((l) => l?.justify === AUTO))}
      value={shared(layouts.map((l) => l?.gap ?? 0))}
      offersAuto={direction !== 'grid'}
      onAuto={(auto) => setLayoutOf(target, (l) => (auto ? { justify: AUTO } : gathered(l)))}
      onSet={(v) => setLayoutOf(target, (l) => ({ gap: v, ...gathered(l) }))}
      onEach={(change) => setLayoutOf(target, (l) => ({ gap: tidy(Math.max(0, change(l.gap))), ...gathered(l) }))}
    />
  )
}

/**
 * The room between a wrapping row's rows or a grid's (↕), or a wrapping column's columns (↔): the
 * box's own, or its Between where it sets none. A wrapping row's or column's menu offers Auto,
 * where the lines spread out with the room left between them; a number typed or picked gathers
 * them again.
 */
function BetweenLinesField({
  target,
  p,
  direction,
  layouts,
}: {
  target: Target
  p: P
  direction: AutoLayout['direction'] | 'mixed' | undefined
  layouts: (AutoLayout | undefined)[]
}) {
  const name =
    direction === 'column' ? p.betweenLines.column : direction === 'mixed' ? p.betweenLines.mixed : p.betweenLines.row
  return (
    <RoomField
      target={target}
      p={p}
      name={name}
      mark={direction === 'column' ? '↔' : '↕'}
      testId="between-lines-mark"
      menuName="between-lines-kind"
      kindName={p.betweenLinesKind}
      auto={shared(layouts.map((l) => wrapApplies(l) && l?.alignLines === 'space-between'))}
      value={shared(layouts.map((l) => (l ? lineGapOf(l) : 0)))}
      offersAuto={layouts.every(wrapApplies)}
      onAuto={(auto) => setLayoutOf(target, () => ({ alignLines: auto ? 'space-between' : 'packed' }))}
      onSet={(v) => setLayoutOf(target, (l) => lineGapPatch(l, v))}
      onEach={(change) => setLayoutOf(target, (l) => lineGapPatch(l, tidy(Math.max(0, change(lineGapOf(l))))))}
    />
  )
}

/**
 * A room between layers or lines, `name`d and marked: a number, or while `auto` says so, Auto,
 * which the field shows in its place. Where `offersAuto`, its menu (`menuName`, `kindName`) picks
 * between the number and Auto.
 */
function RoomField({
  target,
  p,
  name,
  mark,
  testId,
  menuName,
  kindName,
  auto,
  value,
  offersAuto,
  onAuto,
  onSet,
  onEach,
}: {
  target: Target
  p: P
  name: string
  mark: string
  testId: string
  menuName: string
  kindName: string
  auto: boolean | 'mixed'
  value: number | 'mixed'
  offersAuto: boolean
  onAuto: (auto: boolean) => void
  onSet: (value: number) => void
  onEach: (change: (now: number) => number) => void
}) {
  const menu = offersAuto && (
    <Select
      name={menuName}
      label={kindName}
      value={auto === true ? 'auto' : auto === false ? 'number' : ''}
      caretOnly
      options={[
        { value: 'number', label: value === 'mixed' ? p.mixed : String(value) },
        { value: 'auto', label: p.auto },
      ]}
      onChange={(to) => onAuto(to === 'auto')}
      className="h-full gap-0 border-0 bg-transparent px-1 hover:bg-hover"
    />
  )
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className={cn(FIELD_LABEL, 'flex min-h-6 items-center')}>{name}</span>
      <NumberField
        label={
          <span data-testid={testId} aria-hidden className="text-small">
            {mark}
          </span>
        }
        name={name}
        value={auto === true ? undefined : value}
        placeholder={auto === true ? p.auto : undefined}
        min={0}
        editor={target.editor}
        menu={menu}
        onSet={onSet}
        onEach={onEach}
      />
    </div>
  )
}
