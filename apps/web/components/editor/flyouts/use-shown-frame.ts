// The frame whose layers the layers panel lists, and the frame stepper's step: the frame of the
// layer selected last or the picked frame, as each is selected or picked; the opening frame when
// the panel opens or another page is shown with nothing selected; the frame now at its place when
// the frame shown is gone.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import type { Editor } from '@dazbee/editor'
import type { Design } from '@dazbee/schema'

import {
  followedFrame,
  keptFrame,
  openingFrame,
  shownAt,
  type ShownFrame,
  stepFrame,
} from '@/lib/editor/frame-stepper.ts'

/**
 * The frame shown (`frameId`, null on a page with no frame) and `step`, which shows the frame before
 * (-1) or after (1) it among the page's frames, wrapping round, and changes nothing else.
 */
export function useShownFrame({
  editor,
  design,
  pageId,
  frameIds,
  selection,
  picked,
}: {
  editor: Editor
  design: Design
  pageId: string
  /** The shown page's frames by order. */
  frameIds: readonly string[]
  selection: readonly string[]
  picked: string | null
}) {
  const opening = () => openingFrame(frameIds, followedFrame(design, selection, picked), editor.middleFrame())
  const [chosen, setChosen] = useState<ShownFrame>(() => shownAt(frameIds, opening()))
  const shown = keptFrame(frameIds, chosen)
  // A frame gone, or moved among the page's frames, is kept as `keptFrame` keeps it.
  useLayoutEffect(() => {
    if (shown.id !== chosen.id || shown.at !== chosen.at) setChosen(shown)
  })

  // Each pick of a frame, of the one picked already too, counted so the panel shows it again.
  const [picks, setPicks] = useState(0)
  useEffect(() => {
    const stop = editor.onFramePick(() => setPicks((n) => n + 1))
    return () => {
      stop()
    }
  }, [editor])
  // The page the panel last showed a frame of.
  const pageAt = useRef(pageId)
  const selectionKey = selection.join(' ')
  useLayoutEffect(() => {
    const turned = pageAt.current !== pageId
    pageAt.current = pageId
    const to = followedFrame(design, selection, picked) ?? (turned ? opening() : null)
    if (to !== null) setChosen((now) => (now.id === to ? now : shownAt(frameIds, to)))
  }, [selectionKey, picked, picks, pageId])

  const step = (by: 1 | -1) => setChosen(shownAt(frameIds, stepFrame(frameIds, shown.id, by)))
  return { frameId: shown.id, step }
}
