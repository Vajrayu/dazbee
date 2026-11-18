'use client'

// The zoom pill at the stage's bottom corner: out, the zoom, in, and the keyboard shortcuts.
// The zoom opens a menu with every zoom and how the stage is shown: rulers, snapping and which platform's
// safe zones, if any. The same zooms are on Ctrl/Cmd+=, Ctrl/Cmd+-, Shift+1, Shift+2 and Ctrl/Cmd+0, the
// rulers on Shift+R. On a phone the zoom alone is a chip of the tab bar, opening the same menu.
import { useEffect, useMemo, useState } from 'react'

import { type Editor, zoomPercent } from '@dazbee/editor'
import { ALL_PLATFORMS, SAFE_ZONES, type SafeZoneChoice } from '@dazbee/schema'

import { SWITCH, TAB_BAR_CHIP } from '@/components/editor/styles.ts'
import { CheckIcon, MinusIcon, PlusIcon } from '@/components/ui/icons.tsx'
import { Menu, MenuCheck, MenuDivider, MenuHeading, MenuItem, MenuRadio, MenuRadios } from '@/components/ui/menu.tsx'
import { Tooltip, withShortcut } from '@/components/ui/tooltip.tsx'
import { cn } from '@/lib/cn.ts'
import { keyOf } from '@/lib/editor/shortcut-keys.ts'
import { useLocale, useMessages } from '@/lib/i18n/client.tsx'

import { ShortcutsButton } from './shortcuts-dialog.tsx'

/** One button of the pill. */
const BUTTON =
  'grid h-8 min-w-8 cursor-pointer place-items-center rounded-row px-1.5 text-muted transition-colors duration-[var(--chrome-fast)] hover:bg-hover hover:text-text active:bg-pressed disabled:cursor-default disabled:opacity-40'

/** The safe zones' menu row that hides them, beside `ALL_PLATFORMS` and the platforms' names. */
const SAFE_ZONES_OFF = 'off'

const viewOf = (editor: Editor | null) => ({
  rulers: editor?.rulers() ?? false,
  snapping: editor?.snapping() ?? true,
  safeZones: editor?.safeZones() ?? null,
})

/** Whether the rulers and snapping are on and which safe zones show, following Shift+R and the menu. */
function useView(editor: Editor | null) {
  const [view, setView] = useState(() => viewOf(editor))
  useEffect(() => {
    setView(viewOf(editor))
    if (!editor) return
    const stop = editor.onView(() => setView(viewOf(editor)))
    return () => {
      stop()
    }
  }, [editor])
  return view
}

/** The zoom pill, or on a phone (`inBar`) the zoom chip of the tab bar. */
export function ZoomControl({
  zoom,
  editor,
  inBar = false,
}: {
  zoom: number | null
  editor: Editor | null
  inBar?: boolean
}) {
  const t = useMessages()
  const locale = useLocale()
  const percent = useMemo(() => new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }), [locale])
  const [open, setOpen] = useState(false)
  const view = useView(editor)
  const off = zoom === null || editor === null
  const zooms = [
    { label: t.editor.actions.zoomIn, key: keyOf('zoomIn'), run: () => editor?.zoomIn() },
    { label: t.editor.actions.zoomOut, key: keyOf('zoomOut'), run: () => editor?.zoomOut() },
    { label: t.editor.actions.zoomToFit, key: keyOf('zoomToFit'), run: () => editor?.fitAll() },
    { label: t.editor.actions.zoomToSelection, key: keyOf('zoomToSelection'), run: () => editor?.fitSelection() },
    { label: t.editor.actions.zoomTo100, key: keyOf('zoomTo100'), run: () => editor?.zoomTo(1) },
  ]
  const toggles = [
    {
      label: t.editor.view.rulers,
      key: keyOf('toggleRulers'),
      on: view.rulers,
      flip: () => editor?.perform('toggleRulers'),
    },
    { label: t.editor.view.snap, on: view.snapping, flip: () => editor?.setSnapping(!view.snapping) },
  ] satisfies { label: string; key?: string; on: boolean; flip: () => void }[]
  // The bands a platform's interface covers on each 9:16 frame, every platform's together or one's; never
  // exported. The platforms are `SAFE_ZONES`', under their own names.
  const safeZones: { value: string; label: string; choice: SafeZoneChoice | null }[] = [
    { value: SAFE_ZONES_OFF, label: t.editor.view.safeZonesOff, choice: null },
    { value: ALL_PLATFORMS, label: t.editor.view.allPlatforms, choice: ALL_PLATFORMS },
    ...SAFE_ZONES.map((zone) => ({ value: zone.platform, label: zone.platform, choice: zone.platform })),
  ]
  // The zoom, opening the menu of zooms and views.
  const menu = (className: string) => (
    <Menu
      trigger={
        <button type="button" aria-label={t.editor.zoomMenu} disabled={off} data-testid="zoom" className={className}>
          {/* The editor's whole percent, which zooming in and out steps from. */}
          {zoom === null ? '' : percent.format(zoomPercent(zoom) / 100)}
        </button>
      }
      tooltip={t.editor.zoomMenu}
      open={open}
      onOpenChange={setOpen}
      label={t.editor.zoomMenu}
      testId="zoom-menu"
      place={{ side: 'top', align: 'end', sideOffset: 10, collisionPadding: 12 }}
      className="w-60"
    >
      {zooms.map((z) => (
        <MenuItem key={z.label} label={z.label} keys={z.key} onSelect={z.run} />
      ))}
      <MenuDivider />
      {toggles.map((toggle) => (
        <MenuCheck
          key={toggle.label}
          label={toggle.label}
          {...('key' in toggle && { keys: toggle.key })}
          checked={toggle.on}
          onCheckedChange={toggle.flip}
          mark={<span aria-hidden className={SWITCH} />}
        />
      ))}
      <MenuDivider />
      <MenuHeading>{t.editor.view.safeZones}</MenuHeading>
      <MenuRadios
        value={view.safeZones ?? SAFE_ZONES_OFF}
        label={t.editor.view.safeZones}
        onValueChange={(value) => editor?.setSafeZones(safeZones.find((row) => row.value === value)?.choice ?? null)}
      >
        {safeZones.map((choice) => (
          <MenuRadio
            key={choice.value}
            value={choice.value}
            label={choice.label}
            stayOpen
            data-safe-zones={choice.value}
          >
            {choice.label}
            <CheckIcon size={14} aria-hidden className="invisible shrink-0 group-aria-checked:visible" />
          </MenuRadio>
        ))}
      </MenuRadios>
    </Menu>
  )
  if (inBar)
    return (
      <>
        {/* As wide as 100%, so the bar stays put as the zoom changes. */}
        {menu(cn(TAB_BAR_CHIP, 'min-w-[3.5rem]'))}
        {/* A phone has no keyboard, so the bar leaves out the list of its shortcuts; ? still opens it. */}
        <ShortcutsButton className="hidden" />
      </>
    )
  return (
    <div
      role="group"
      aria-label={t.editor.zoom}
      data-zoom
      // On a tablet above the dock, which is too wide to share its line.
      className="absolute end-4 bottom-4 z-10 flex items-center max-lg:bottom-(--above-dock) gap-0.5 rounded-card surface-frost p-1"
    >
      <Tooltip label={withShortcut(t.editor.actions.zoomOut, keyOf('zoomOut'))}>
        <button
          type="button"
          aria-label={t.editor.actions.zoomOut}
          disabled={off}
          onClick={() => editor?.zoomOut()}
          className={BUTTON}
        >
          <MinusIcon size={16} aria-hidden />
        </button>
      </Tooltip>
      {menu(`${BUTTON} w-14 font-mono text-tiny tabular-nums text-text`)}
      <Tooltip label={withShortcut(t.editor.actions.zoomIn, keyOf('zoomIn'))}>
        <button
          type="button"
          aria-label={t.editor.actions.zoomIn}
          disabled={off}
          onClick={() => editor?.zoomIn()}
          className={BUTTON}
        >
          <PlusIcon size={16} aria-hidden />
        </button>
      </Tooltip>
      <ShortcutsButton className={BUTTON} />
    </div>
  )
}
