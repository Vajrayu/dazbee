'use client'

// Arrange's sections, the one home of how the selected layers sit. Position: their size, each
// side's sizing and, where auto layout sizes them, its least and most, place, turn and flip, then
// their constraints where the rule reads them, and whether a layer in a laid-out box is kept where it
// is put. Order: their order in the stack. Line up: one layer with its frame, several with each
// other and spread. A lock turns all but Order off, each control saying why. Position and Line up
// show only the controls their `controls` name.
import { useEffect } from 'react'

import { type ShortcutAction, stackEnds } from '@dazbee/editor'
import { type Constraints } from '@dazbee/schema'

import { ALIGN } from '@/components/editor/arrange-actions.ts'
import { Choice, PanelTitle, SwitchRow } from '@/components/editor/edit-panel/fields.tsx'
import type { SectionProps } from '@/components/editor/edit-panel/tabs/tabs.ts'
import {
  constraintPatch,
  constraintsShown,
  type Facts,
  factsOf,
  type P,
  set,
  shared,
  type Target,
} from '@/components/editor/edit-panel/target.ts'
import { FIELD_LABEL, PANEL_PART, SWITCH, SWITCH_ROW } from '@/components/editor/styles.ts'
import { GreyedButton } from '@/components/ui/greyed.tsx'
import { ArrowDownIcon, ArrowLineDownIcon, ArrowLineUpIcon, ArrowUpIcon, type Icon } from '@/components/ui/icons.tsx'
import { useMessages } from '@/lib/i18n/client.tsx'
import { format, type Messages } from '@/lib/i18n/index.ts'

import { LineUpEachOther } from './line-up.tsx'
import { PanelAction } from './panel-action.tsx'
import { PlaceCard } from './place-card.tsx'

/** The four moves along the stack, two to a row: a step forward and back, then all the way. */
const MOVES = [
  { action: 'bringForward', icon: ArrowUpIcon, front: true },
  { action: 'sendBackward', icon: ArrowDownIcon, front: false },
  { action: 'bringToFront', icon: ArrowLineUpIcon, front: true },
  { action: 'sendToBack', icon: ArrowLineDownIcon, front: false },
] as const satisfies readonly { action: ShortcutAction; icon: Icon; front: boolean }[]

/** Each axis's constraints, in FigCraft's order. */
const ACROSS = ['left', 'right', 'leftRight', 'center', 'scale'] as const satisfies readonly Constraints['horizontal'][]
const DOWN = ['top', 'bottom', 'topBottom', 'center', 'scale'] as const satisfies readonly Constraints['vertical'][]

/**
 * Why the layers' settings are off, by the layers' facts: `lock` while they are locked; `placedWhy`,
 * for their place and lining up, while they are locked or their laid-out box places them.
 */
function offWhys({ placed, locked }: Facts, t: Messages) {
  const b = t.editor.bar
  const lock = locked.length > 0 ? b.lockedRow : null
  return { lock, placedWhy: lock ?? (placed ? format(b.placedByLayout, { keep: t.editor.props.absolute }) : null) }
}

/**
 * Position: the numbers, with the flips where `controls` has them, then Constraints where the rule
 * reads them for every layer, then for a layer in a laid-out box Keep where I put it.
 */
export function PositionSection({ target, design, controls }: SectionProps) {
  const t = useMessages()
  const p = t.editor.props
  const facts = factsOf(target, design)
  const { lock, placedWhy } = offWhys(facts, t)
  // A flip and Lock ratio are refused only for a layer locked against resizing, which keeps its turn, flip and ratio.
  const flipWhy = target.ids.some((id) => design.nodes[id]?.lock?.resize) ? t.editor.bar.lockedRow : null
  const constraints = constraintsShown(target, design)
  return (
    <>
      <PlaceCard
        target={target}
        design={design}
        p={p}
        why={lock}
        placedWhy={placedWhy}
        flipWhy={flipWhy}
        flips={controls.includes('flip')}
      />
      {constraints && <ConstraintsPart target={target} shown={constraints} why={lock} />}
      {facts.inFlow && <FlowPart target={target} p={p} why={lock} />}
    </>
  )
}

/** Order: the moves along the stack, which a lock leaves on; each greyed at the end it moves to. */
export function OrderSection({ target, design }: SectionProps) {
  const t = useMessages()
  const b = t.editor.bar
  const ends = stackEnds(design, target.ids)
  return (
    <section aria-labelledby="order-part-title" className={PANEL_PART} data-testid="order-part">
      <PanelTitle id="order-part-title">{b.order}</PanelTitle>
      <div className="grid grid-cols-2 gap-1.5 max-sm:gap-[8px]">
        {MOVES.map(({ action, icon, front }) => (
          <PanelAction
            key={action}
            target={target}
            action={action}
            name={t.editor.shortActions[action]}
            icon={icon}
            why={front ? (ends.front ? b.atFront : null) : ends.back ? b.atBack : null}
          />
        ))}
      </div>
    </section>
  )
}

/**
 * Line up: one layer with its frame (`line-up-frame`), greyed while its box's layout places it, or
 * several with each other, then spread (`line-up`).
 */
export function LineUpSection({ target, design, controls }: SectionProps) {
  const t = useMessages()
  const { lock, placedWhy } = offWhys(factsOf(target, design), t)
  const frame = controls.includes('line-up-frame')
  return (
    <section aria-labelledby="line-up-part-title" className={PANEL_PART} data-testid="line-up-part">
      <PanelTitle id="line-up-part-title">{frame ? t.editor.bar.placing.lineUpFrame : t.editor.bar.lineUp}</PanelTitle>
      {frame && (
        <div dir="ltr" className="grid grid-cols-3 gap-1.5 max-sm:gap-[8px]">
          {ALIGN.map(({ action, icon }) => (
            <PanelAction
              key={action}
              target={target}
              action={action}
              name={t.editor.shortActions[action]}
              icon={icon}
              why={placedWhy}
            />
          ))}
        </div>
      )}
      {controls.includes('line-up') && <LineUpEachOther target={target} why={lock} />}
    </section>
  )
}

/**
 * How the layers follow their parent's edges as it is resized: Across and Down, each the value the
 * layers share or Mixed. A pick sets that axis on every layer, each keeping its own other axis, as
 * one undo step. While it shows, the stage draws the layers' constraint lines. Greyed while `why`
 * says the layers are locked, each select saying so.
 */
function ConstraintsPart({
  target,
  shown,
  why,
}: {
  target: Target
  shown: NonNullable<ReturnType<typeof constraintsShown>>
  why: string | null
}) {
  const t = useMessages()
  const c = t.editor.bar.placing
  const { editor } = target
  useEffect(() => {
    editor.showConstraints(true)
    return () => editor.showConstraints(false)
  }, [editor])
  return (
    <section aria-labelledby="constraints-part-title" className={PANEL_PART} data-testid="constraints-part">
      <PanelTitle id="constraints-part-title">{c.constraints}</PanelTitle>
      <div className="grid grid-cols-2 gap-1.5 max-sm:gap-[8px]">
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className={FIELD_LABEL}>{c.across}</span>
          <Choice
            name={c.acrossName}
            value={shown.horizontal}
            options={ACROSS}
            labels={c.horizontal}
            why={why}
            testId="constraints-horizontal"
            onSet={(horizontal) => set(target, (now) => constraintPatch(now, { horizontal }))}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className={FIELD_LABEL}>{c.down}</span>
          <Choice
            name={c.downName}
            value={shown.vertical}
            options={DOWN}
            labels={c.vertical}
            why={why}
            testId="constraints-vertical"
            onSet={(vertical) => set(target, (now) => constraintPatch(now, { vertical }))}
          />
        </div>
      </div>
    </section>
  )
}

/**
 * A layer in a laid-out box, last in Position: kept where it is put, out of the flow. Greyed while
 * `why` says the layers are locked, saying so.
 */
function FlowPart({ target, p, why }: { target: Target; p: P; why: string | null }) {
  const on = shared(target.props.map((pr) => pr.absolute === true))
  return (
    <section aria-labelledby="flow-card-title" data-testid="flow-card" className={PANEL_PART}>
      <PanelTitle id="flow-card-title">{p.inAutoLayout}</PanelTitle>
      {why ? (
        <GreyedButton why={why} role={on === 'mixed' ? 'checkbox' : 'switch'} aria-checked={on} className={SWITCH_ROW}>
          {p.absolute}
          <span aria-hidden className={SWITCH} />
        </GreyedButton>
      ) : (
        <SwitchRow
          name={p.absolute}
          on={on}
          onSet={(absolute) => set(target, () => ({ absolute: absolute ? true : undefined }))}
        />
      )}
    </section>
  )
}
