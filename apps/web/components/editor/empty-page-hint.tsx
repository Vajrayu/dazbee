'use client'

import type { Editor } from '@dazbee/editor'

import { buttonStyles } from '@/components/ui/button.tsx'
import { EmptyState } from '@/components/ui/empty-state.tsx'
import { cn } from '@/lib/cn.ts'
import { useMessages } from '@/lib/i18n/client.tsx'
import type { Messages } from '@/lib/i18n/index.ts'

import { useShownFrames } from './editor-hooks.ts'
import { useViewOnly } from './view-only.tsx'

/**
 * Over the stage while the shown page has no frames: Daz with a frame, how to add one and Add a
 * frame, or in a tab that may only view that the page has none yet.
 */
export function EmptyPageHint({ editor }: { editor: Editor }) {
  const t = useMessages()
  const frames = useShownFrames(editor)
  const viewOnly = useViewOnly()
  if (frames.length > 0) return null
  return <EmptyPage words={t.editor.frames} editor={viewOnly ? null : editor} />
}

/**
 * The empty page's bee and words, centred on the stage. Only Add a frame takes a press, so a click or
 * a drag anywhere else still reaches the canvas. It picks the Frame tool, as the dock's Frame button
 * does, which opens Add a frame; with no `editor`, in a tab that may only view, it isn't shown.
 */
export function EmptyPage({
  words,
  editor,
}: {
  words: Messages['editor']['frames']
  editor: Pick<Editor, 'setTool'> | null
}) {
  return (
    <div
      role="status"
      data-testid="empty-page"
      className="pointer-events-none absolute inset-0 z-[5] flex items-center justify-center"
    >
      <EmptyState
        pose="frame"
        size={180}
        title={editor ? words.emptyPage.title : words.noFrames}
        {...(editor ? { line: words.emptyPage.line } : {})}
        action={
          editor && (
            <button
              type="button"
              // Add a frame takes the focus as it opens, as it does from the dock.
              data-opens="addFrame"
              onClick={() => editor.setTool('frame')}
              className={cn(buttonStyles({ variant: 'primary', size: 'lg' }), 'pointer-events-auto')}
            >
              {words.emptyPage.add}
            </button>
          )
        }
      />
    </div>
  )
}
