'use client'

import { useRef } from 'react'

import type { Editor } from '@dazbee/editor'
import type { Design } from '@dazbee/schema'

import { editState, setOpen, useEditState } from '@/components/editor/edit-store.ts'
import { FrameActions } from '@/components/editor/menus/frame-actions.tsx'
import { ICON_BUTTON } from '@/components/editor/styles.ts'
import { DotsThreeIcon } from '@/components/ui/icons.tsx'
import { Menu } from '@/components/ui/menu.tsx'
import { useMessages } from '@/lib/i18n/client.tsx'

/**
 * The picked frame's ⋯, with the frame's actions (`FrameActions`), which a right-click on the frame
 * also opens; Delete sits after a line and in the danger colour, as on a page's ⋯ on the Pages card.
 */
export function FrameMore({ editor, frameId, design }: { editor: Editor; frameId: string; design: Design }) {
  const t = useMessages()
  const f = t.editor.frames
  const { open } = useEditState()
  // The ⋯ button, which the rename field and Export give the focus back to after Rename or Export here.
  const more = useRef<HTMLButtonElement | null>(null)
  return (
    <Menu
      trigger={
        <button
          ref={more}
          type="button"
          aria-label={f.more}
          data-testid="frame-more"
          data-opens="addSize"
          className={`${ICON_BUTTON} data-[state=open]:bg-pressed data-[state=open]:text-text`}
        >
          <DotsThreeIcon size={18} weight="bold" aria-hidden />
        </button>
      }
      tooltip={f.more}
      open={open === 'frame-more'}
      onOpenChange={(to) => {
        // A row that opened something else, as Add size opens its card, keeps it open.
        if (to) setOpen('frame-more')
        else if (editState().open === 'frame-more') setOpen(null)
      }}
      label={f.more}
      testId="frame-more-menu"
      place={{ side: 'bottom', align: 'end', sideOffset: 4, collisionPadding: 12 }}
      className="min-w-56"
    >
      <FrameActions editor={editor} frameId={frameId} design={design} opener={more} />
    </Menu>
  )
}
