'use client'

// Picking an image: a panel of the brand's images with an upload from the computer, opened beside a
// card by the Image switcher tab's Replace, by a fill's Replace and by a fill's Add image. The
// image picked goes to the card; an SVG file, which can't fill a shape, is never offered.
import * as Popover from '@radix-ui/react-popover'
import { type ReactNode, useEffect, useRef, useState } from 'react'

import { AssetSummary, isVectorAsset } from '@dazbee/schema'

import { useBesidePanel } from '@/components/editor/beside-panel.ts'
import { usePopoverFocus } from '@/components/editor/popover-focus.tsx'
import { ViewOnlyFieldset } from '@/components/editor/view-only.tsx'
import { UploadSimpleIcon } from '@/components/ui/icons.tsx'
import { DASHED_BUTTON, FOCUS_RING, POPOVER, TOUCH_GAP } from '@/components/ui/looks.ts'
import { overlayScroll } from '@/components/ui/overlay-scroll.ts'
import { brandPath } from '@/lib/brand-routes.ts'
import { cn } from '@/lib/cn.ts'
import type { Placeable } from '@/lib/editor/place-asset.ts'
import { useMessages } from '@/lib/i18n/client.tsx'
import { format } from '@/lib/i18n/index.ts'
import { IMAGE_ACCEPT, sendAsset } from '@/lib/upload-asset.ts'

import { ASSET_TILE } from './styles.ts'

const PANEL = cn(POPOVER, 'flex max-h-[min(26rem,60dvh)] w-72 flex-col')

/** A button in a card that opens the picker beside it; the image picked goes to `onPick` and the picker closes. */
export function ImagePickerButton({
  workspaceId,
  brandId,
  title,
  testId,
  className,
  children,
  onPick,
}: {
  workspaceId: string
  brandId: string
  /** The picker's heading, and the button's name. */
  title: string
  testId: string
  className: string
  children: ReactNode
  onPick: (asset: Placeable) => void
}) {
  const [open, setOpenNow] = useState(false)
  const focus = usePopoverFocus()
  // The cards sit at the stage's end, so the picker opens towards its middle, clear of the card.
  const beside = useBesidePanel()
  const setOpen = (to: boolean) => {
    if (to) beside.measure(focus.button.current)
    setOpenNow(to)
  }
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button ref={focus.button} type="button" aria-label={title} data-testid={testId} className={className}>
          {children}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side={beside.side}
          align="start"
          sideOffset={beside.sideOffset}
          collisionPadding={12}
          aria-label={title}
          data-testid={`${testId}-picker`}
          onKeyDown={(e) => e.stopPropagation()}
          {...focus.content}
          className={PANEL}
        >
          {focus.back}
          <ViewOnlyFieldset>
            <ImagePickerPanel
              workspaceId={workspaceId}
              brandId={brandId}
              open={open}
              title={title}
              onPick={(asset) => {
                setOpen(false)
                onPick(asset)
              }}
            />
          </ViewOnlyFieldset>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

/**
 * The picker's own content: an upload and the brand's images, fetched while it shows, SVG files left
 * out. An upload that ends after the picker closed picks nothing.
 */
function ImagePickerPanel({
  workspaceId,
  brandId,
  open,
  title,
  onPick,
}: {
  workspaceId: string
  brandId: string
  open: boolean
  title: string
  onPick: (asset: Placeable) => void
}) {
  const t = useMessages().editor
  const [assets, setAssets] = useState<AssetSummary[] | null>(null)
  const [upload, setUpload] = useState<{ name: string; progress: number; error?: string; notice?: string } | null>(null)
  const showing = useRef(open)
  useEffect(() => {
    showing.current = open
    return () => {
      showing.current = false
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const ask = new AbortController()
    fetch(brandPath(workspaceId, brandId, 'assets'), { signal: ask.signal })
      .then(async (response) => {
        if (response.ok)
          setAssets(
            AssetSummary.array()
              .parse(await response.json())
              .filter((asset) => !isVectorAsset(asset)),
          )
      })
      // Offline: the picker keeps what it had, and an upload still works once back.
      .catch(() => undefined)
    return () => ask.abort()
  }, [workspaceId, brandId, open])

  const send = (file: File) => {
    setUpload({ name: file.name, progress: 0 })
    sendAsset(workspaceId, brandId, file, (progress) => setUpload({ name: file.name, progress }))
      .then((asset) => {
        // An SVG file can't be a fill; it stays in the library to place as layers.
        if (isVectorAsset(asset)) {
          setUpload({ name: file.name, progress: 0, notice: format(t.imagePicker.svgNotFill, { name: file.name }) })
          return
        }
        setUpload(null)
        if (showing.current) onPick(asset)
      })
      .catch((error: unknown) =>
        setUpload({ name: file.name, progress: 0, error: error instanceof Error ? error.message : String(error) }),
      )
  }

  return (
    <>
      {/* On a phone or a touch screen the upload is TOUCH_GAP from the first image. */}
      <div className="flex shrink-0 flex-col gap-2 p-3 pb-2 max-sm:pb-[8px] [@media(hover:none)]:pb-[8px]">
        <p className="font-display text-small font-bold">{title}</p>
        <label className={DASHED_BUTTON}>
          <UploadSimpleIcon size={14} aria-hidden />
          {t.imagePicker.upload}
          <input
            name="image-picker-upload"
            type="file"
            accept={IMAGE_ACCEPT}
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) send(file)
            }}
          />
        </label>
        {upload &&
          (upload.notice || upload.error ? (
            <p role="alert" className="text-tiny text-danger">
              {upload.notice ?? format(t.imagePicker.failed, { name: upload.name, reason: upload.error ?? '' })}
            </p>
          ) : (
            <div
              role="progressbar"
              aria-label={format(t.imagePicker.uploading, { name: upload.name })}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(upload.progress * 100)}
              className="h-1 overflow-hidden rounded-full bg-well"
            >
              <div
                className={cn(
                  'h-full rounded-full bg-accent-solid transition-[width]',
                  upload.progress >= 1 && 'animate-pulse',
                )}
                style={{ width: `${Math.max(4, upload.progress * 100)}%` }}
              />
            </div>
          ))}
      </div>
      <div ref={overlayScroll} className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {assets && assets.length === 0 && <p className="text-small text-muted">{t.imagePicker.empty}</p>}
        {assets && assets.length > 0 && (
          <ul aria-label={t.imagePicker.brand} className={cn('grid grid-cols-3 gap-2', TOUCH_GAP)}>
            {assets.map((asset) => {
              const name = asset.name || t.assetLibrary.untitled
              return (
                <li key={asset.id} data-asset={asset.id}>
                  <button
                    type="button"
                    aria-label={format(t.imagePicker.pick, { name })}
                    title={name}
                    onClick={() => onPick(asset)}
                    className={cn(ASSET_TILE, FOCUS_RING, 'w-full cursor-pointer hover:border-accent')}
                  >
                    <img
                      src={brandPath(workspaceId, brandId, 'assets', asset.id, 'thumbnail')}
                      alt=""
                      width={asset.width}
                      height={asset.height}
                      draggable={false}
                      loading="lazy"
                      className="size-full object-contain"
                    />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </>
  )
}
