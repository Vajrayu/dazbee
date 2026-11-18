'use client'

// Style's sections, each under its title: a mask's settings, the colour, a rectangle's corners, the
// outline, the transparency and the effects. Each sets the selected layers' values, every change one
// undo step. A locked layer's sections show their values turned off, with the reason by the title.
import type { ReactNode } from 'react'

import { BlendMode, ContainerBlendMode } from '@dazbee/schema'

import { ColourPanel } from '@/components/editor/edit-panel/colour-panel.tsx'
import { CornerFields } from '@/components/editor/edit-panel/corner-fields.tsx'
import { EffectsPanel } from '@/components/editor/edit-panel/effects-panel.tsx'
import { Choice, PanelPart, Segments } from '@/components/editor/edit-panel/fields.tsx'
import { clamp, NumberField } from '@/components/editor/edit-panel/number-field.tsx'
import { StrokePanel } from '@/components/editor/edit-panel/outline-panel.tsx'
import {
  factsOf,
  num,
  type P,
  type PanelProps,
  set,
  shared,
  type Target,
} from '@/components/editor/edit-panel/target.ts'
import { FIELD_LABEL, KNOBS } from '@/components/editor/styles.ts'
import { ViewOnlyFieldset } from '@/components/editor/view-only.tsx'
import { cn } from '@/lib/cn.ts'
import { tidy } from '@/lib/editor/size.ts'
import { useMessages } from '@/lib/i18n/client.tsx'

import type { StyleSectionId } from './tabs.ts'

/** What each of Style's sections holds for the selection, by the section's id. */
export const STYLE_SECTION_PARTS: Record<StyleSectionId, (props: PanelProps) => ReactNode> = {
  mask: MaskSection,
  colour: ColourSection,
  corners: CornersSection,
  outline: StrokeSection,
  transparency: TransparencySection,
  effects: EffectsSection,
}

/**
 * One of Style's sections: its title, a step above the headings of the parts inside it, then its
 * fields, the parts spaced without a hairline between them. While a layer is locked its fields are
 * turned off and dimmed, and the title says why.
 */
function StyleSection({ id, design, target, children }: PanelProps & { id: StyleSectionId; children: ReactNode }) {
  const t = useMessages()
  const why = factsOf(target, design).locked.length > 0 ? t.editor.bar.lockedRow : null
  return (
    <PanelPart id={`${id}-section`} title={t.editor.editPanel.sections[id]} note={why}>
      <ViewOnlyFieldset off={why !== null}>
        <div className={cn('flex min-w-0 flex-col gap-3 [&>*]:border-t-0 [&>*]:pt-0', why && 'opacity-55')}>
          {children}
        </div>
      </ViewOnlyFieldset>
    </PanelPart>
  )
}

function MaskSection(props: PanelProps) {
  const p = useMessages().editor.props
  return (
    <StyleSection id="mask" {...props}>
      <MaskFields target={props.target} p={p} />
    </StyleSection>
  )
}

function ColourSection(props: PanelProps) {
  return (
    <StyleSection id="colour" {...props}>
      <ColourPanel {...props} />
    </StyleSection>
  )
}

function CornersSection(props: PanelProps) {
  const t = useMessages()
  return (
    <StyleSection id="corners" {...props}>
      <CornerFields target={props.target} p={t.editor.props} label={t.editor.editPanel.radius} />
    </StyleSection>
  )
}

function StrokeSection(props: PanelProps) {
  return (
    <StyleSection id="outline" {...props}>
      <StrokePanel {...props} />
    </StyleSection>
  )
}

function TransparencySection(props: PanelProps) {
  const p = useMessages().editor.props
  return (
    <StyleSection id="transparency" {...props}>
      <TransparencyFields target={props.target} p={p} />
    </StyleSection>
  )
}

function EffectsSection(props: PanelProps) {
  return (
    <StyleSection id="effects" {...props}>
      <EffectsPanel {...props} />
    </StyleSection>
  )
}

/** A mask's settings: masking by its shape (where it is opaque) or by its brightness. */
function MaskFields({ target, p }: { target: Target; p: P }) {
  return (
    <div className="flex flex-col gap-1" data-testid="mask-fields">
      <span className={FIELD_LABEL}>{p.maskBy}</span>
      <Segments
        name={p.maskBy}
        value={shared(target.props.map((pr) => pr.mask as 'alpha' | 'luminance'))}
        options={['alpha', 'luminance'] as const}
        labels={p.maskTypes}
        onSet={(mask) => target.editor.session.run('node.mask', { ids: target.ids, mask })}
      />
    </div>
  )
}

/** The layers' transparency: how much they show through, and how they blend with what is under them. */
function TransparencyFields({ target, p }: { target: Target; p: P }) {
  const containers = target.types.every((type) => type === 'group' || type === 'box')
  const modes = containers ? ContainerBlendMode.options : BlendMode.options
  return (
    <div className={KNOBS} data-testid="transparency-fields">
      <NumberField
        label={p.opacity}
        unit="%"
        name={p.opacity}
        value={shared(target.props.map((pr) => num(pr, 'opacity') ?? 1))}
        scale={100}
        min={0}
        max={1}
        editor={target.editor}
        onSet={(v) => set(target, () => ({ opacity: tidy(v) }))}
        onEach={(change) => set(target, (now) => ({ opacity: tidy(clamp(change(num(now, 'opacity') ?? 1), 0, 1)) }))}
      />
      <Choice
        name={p.blend}
        value={shared(target.props.map((pr) => pr.blendMode as string))}
        options={modes as readonly string[]}
        labels={p.blends as Record<string, string>}
        onSet={(mode) => set(target, () => ({ blendMode: mode }))}
      />
    </div>
  )
}
