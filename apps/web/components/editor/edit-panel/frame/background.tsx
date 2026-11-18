'use client'

// The picked frame's Background: the kit's and the design's colours, which paint the frame's top
// fill that shows, + with any paint for it, then all its fills, which a fill is added to, reordered
// in and removed from. Each change is the frame's alone and one undo step; a kit colour paints as it
// is, with no binding.
import { boundFillIndex, changeFill, type Paint, paintColour, showingFillIndex } from '@dazbee/schema'

import { ColourChoices, FILL_ON_TOP, NEW_FILL } from '@/components/editor/edit-panel/colour-panel.tsx'
import { PanelPart } from '@/components/editor/edit-panel/fields.tsx'
import { PaintEditor, PaintRow } from '@/components/editor/paint/paint-stack.tsx'
import { AddButton, ReorderList } from '@/components/editor/reorder-list.tsx'
import { useMessages } from '@/lib/i18n/client.tsx'
import { format } from '@/lib/i18n/index.ts'

import type { FrameSectionProps } from './types.ts'

/** The Background switcher tab's section: the frame's colours, then its fills. */
export function BackgroundSection({ editor, design, frameId, workspaceId, brandId }: FrameSectionProps) {
  const t = useMessages()
  const p = t.editor.props
  const b = t.editor.bar
  const f = t.editor.frames
  const fills = design.frames[frameId]?.fills ?? []
  // Each change runs on the frame's fills as the document holds them then, and leaves a frame
  // another tab deleted a moment ago be.
  const writeFills = (to: (now: Paint[]) => Paint[]) => {
    const now = editor.design().frames[frameId]
    if (now) editor.session.run('frame.update', { frameId, fills: to(now.fills) })
  }
  const bound = fills[boundFillIndex(fills)]
  const paint = (hex: string) => writeFills((now) => changeFill(now, boundFillIndex(now), paintColour(hex), NEW_FILL))
  const pickFill = (to: (now: Paint) => Paint) =>
    writeFills((now) => changeFill(now, showingFillIndex(now), to, NEW_FILL))
  return (
    <>
      <ColourChoices
        editor={editor}
        design={design}
        workspaceId={workspaceId}
        brandId={brandId}
        p={p}
        b={b}
        current={bound?.type === 'solid' ? bound.color : undefined}
        paint={paint}
        picker={
          <PaintEditor
            paint={fills[showingFillIndex(fills)] ?? NEW_FILL}
            workspaceId={workspaceId}
            brandId={brandId}
            editor={editor}
            p={p}
            onSet={pickFill}
          />
        }
      />
      <PanelPart
        id="frame-fills"
        title={b.colourPanel.fills}
        action={
          <AddButton
            label={f.addFill}
            onClick={() =>
              writeFills((now) => [...now, now.length === 0 ? { type: 'solid', color: '#FFFFFFFF' } : FILL_ON_TOP])
            }
          />
        }
      >
        <ReorderList
          items={fills}
          field="fills"
          topFirst
          removeLabel={(n) => format(p.remove, { name: f.fill, n })}
          onWrite={writeFills}
          render={(item, n, change) => (
            <PaintRow
              paint={item}
              name={format(f.fillName, { n })}
              workspaceId={workspaceId}
              brandId={brandId}
              editor={editor}
              p={p}
              onSet={change}
            />
          )}
        />
      </PanelPart>
    </>
  )
}
