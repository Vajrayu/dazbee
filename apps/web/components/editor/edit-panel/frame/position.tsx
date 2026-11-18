'use client'

// The picked frame's Arrange section: its width and height, which resize it from its top left with
// its layers following their constraints, then its X and Y on the page, which move it with its
// layers staying in it, two to a row, and Lock ratio, which keeps its shape while a side is typed.
// Every value is whole pixels, as a frame takes them; a size the editor doesn't take is not taken,
// and the field shows the frame's again. Lock ratio is the section's own, off each time it shows, and
// keeps the shape the frame had when it was turned on, so steps and drags don't drift from it.
import { useState } from 'react'

import { Switch } from '@/components/editor/edit-panel/fields.tsx'
import { NumberField } from '@/components/editor/edit-panel/number-field.tsx'
import { KNOB_SWITCH, KNOBS, PANEL_PART } from '@/components/editor/styles.ts'
import { sizeTo } from '@/lib/editor/size.ts'
import { useMessages } from '@/lib/i18n/client.tsx'

import type { FrameSectionProps } from './types.ts'

type Side = 'width' | 'height'
type Spot = 'x' | 'y'
type Box = Record<Side, number>

/** The picked frame's Arrange section; none once the frame is gone. */
export function FramePositionSection({ editor, design, frameId }: FrameSectionProps) {
  const t = useMessages()
  const p = t.editor.props
  // The frame's size as Lock ratio was turned on, whose shape a side set keeps; null while it is off.
  const [ratio, setRatio] = useState<Box | null>(null)
  const frame = design.frames[frameId]
  if (!frame) return null
  // Each change reads the frame as the document holds it then, and leaves a frame another tab
  // deleted a moment ago be.
  const resize = (side: Side, to: (now: number) => number) => {
    const now = editor.design().frames[frameId]
    if (!now) return
    const size = { width: now.width, height: now.height }
    const asked = to(now[side])
    const sized = sizeTo(ratio ?? size, side, asked, ratio !== null, { whole: true })
    editor.resizeFrame(frameId, { ...size, ...sized })
  }
  const move = (spot: Spot, to: (now: number) => number) => {
    const now = editor.design().frames[frameId]
    if (now) editor.session.run('frame.update', { frameId, [spot]: Math.round(to(now[spot])) })
  }
  const sides = [
    { key: 'width', label: p.width, name: p.widthName },
    { key: 'height', label: p.height, name: p.heightName },
  ] as const
  const spots = [
    { key: 'x', label: p.x, name: p.xName },
    { key: 'y', label: p.y, name: p.yName },
  ] as const
  return (
    <div className={PANEL_PART} data-testid="frame-position-card">
      <div className={KNOBS}>
        {sides.map((f) => (
          <NumberField
            key={f.key}
            label={f.label}
            name={f.name}
            value={frame[f.key]}
            editor={editor}
            testId={`frame-${f.key}`}
            onSet={(v) => resize(f.key, () => v)}
            onEach={(change) => resize(f.key, change)}
          />
        ))}
        {spots.map((f) => (
          <NumberField
            key={f.key}
            label={f.label}
            name={f.name}
            value={frame[f.key]}
            editor={editor}
            testId={`frame-${f.key}`}
            onSet={(v) => move(f.key, () => v)}
            onEach={(change) => move(f.key, change)}
          />
        ))}
        <Switch
          on={ratio !== null}
          onSet={(on) => setRatio(on ? { width: frame.width, height: frame.height } : null)}
          testId="frame-lock-ratio"
          className={KNOB_SWITCH}
        >
          {t.editor.bar.placing.lockRatio}
        </Switch>
      </div>
    </div>
  )
}
