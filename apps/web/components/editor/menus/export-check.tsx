'use client'

// The check before export, under the Export button: what the texts of the ticked frames won't draw
// as designed, fonts the catalog has no file for and characters no font has. A warning only: the
// file still comes. Checked when the form opens and again shortly after the ticks or the design
// change; the last answer stays until the next one lands.
import { useEffect, useRef, useState } from 'react'

import type { Editor, FontCheck } from '@dazbee/editor'
import type { Design } from '@dazbee/schema'

import { cn } from '@/lib/cn.ts'
import { useLocale, useMessages } from '@/lib/i18n/client.tsx'
import { counted, format } from '@/lib/i18n/index.ts'

/** How long the ticks or the design stay as they are before the check runs again. */
const SETTLE_MS = 300
/** The most families, characters and text names listed before "and N more". */
const SHOWN = { families: 3, characters: 8, layers: 3 }

/** A name or character set apart from the sentence's direction, as `<bdi>` would. */
const isolated = (text: string) => `⁨${text}⁩`

/**
 * What the editor finds for the ticked frames, the last answer kept while the next is on its way;
 * checked again when fonts arrive, as on reconnecting, since a text may then draw.
 */
function useFontCheck(editor: Editor, design: Design, frameIds: readonly string[]) {
  const [check, setCheck] = useState<FontCheck | null>(null)
  const [arrivals, setArrivals] = useState(0)
  // The first check runs at once; every one after waits for the changes to settle.
  const started = useRef(false)
  const key = frameIds.join('\n')
  useEffect(() => {
    const off = editor.onFontsArrive(() => setArrivals((n) => n + 1))
    return () => {
      off()
    }
  }, [editor])
  useEffect(() => {
    let current = true
    const timer = setTimeout(
      () => {
        started.current = true
        editor.fontCheck(key ? key.split('\n') : []).then(
          (found) => {
            if (current) setCheck(found)
          },
          () => undefined,
        )
      },
      started.current ? SETTLE_MS : 0,
    )
    return () => {
      // An older run that ends after a newer one began is dropped.
      current = false
      clearTimeout(timer)
    }
  }, [editor, design, key, arrivals])
  return check
}

export function ExportCheck({
  editor,
  design,
  frameIds,
}: {
  editor: Editor
  design: Design
  frameIds: readonly string[]
}) {
  const t = useMessages()
  const locale = useLocale()
  const check = useFontCheck(editor, design, frameIds)
  const shown = check !== null && (check.families.length > 0 || check.characters.length > 0)
  const words = t.editor.exports.check
  const list = (items: readonly string[], most: number) => {
    const named = items.slice(0, most).map(isolated)
    if (items.length > most) named.push(counted(locale, words.more, items.length - most))
    return new Intl.ListFormat(locale, { type: 'conjunction' }).format(named)
  }
  const characters = check?.characters.map((c) => c.text) ?? []
  const layers = [...new Set(check?.characters.slice(0, SHOWN.characters).flatMap((c) => c.layers))]
  // The region is there while the form is open, so a screen reader reads the warning as it comes;
  // empty, it takes back the form's gap above it.
  return (
    <div
      role="status"
      data-testid="export-check"
      className={cn('flex flex-col gap-1 text-tiny text-warning', !shown && '-mt-3')}
    >
      {shown && (
        <>
          <p className="font-semibold">{words.title}</p>
          {check.families.length > 0 && (
            <p data-part="families">{format(words.families, { families: list(check.families, SHOWN.families) })}</p>
          )}
          {characters.length > 0 && (
            <p data-part="characters">
              {format(words.characters, {
                characters: list(characters, SHOWN.characters),
                layers: list(layers, SHOWN.layers),
              })}
            </p>
          )}
        </>
      )}
    </div>
  )
}
