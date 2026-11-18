'use client'

// A layer's picture as its row in the layers panel shows it, and as a row of the stage menu's Select
// layer list does: the mask icon for a mask, else the layer's drawn picture once it is drawn, set off
// on a backdrop when it is about the colour of the panel in a theme, else the layer's icon, a text's
// on an outlined tile.
import { useState } from 'react'

import { isMask } from '@dazbee/doc'
import type { Design } from '@dazbee/schema'

import { iconOf } from '@/components/editor/layer-looks.ts'
import { LAYER_PICTURE } from '@/components/editor/styles.ts'
import { cn } from '@/lib/cn.ts'
import { useMessages } from '@/lib/i18n/client.tsx'

import { MaskIcon } from './mask-icon.tsx'
import { PICTURE } from './tree-row.tsx'

type Layer = Design['nodes'][string]

/**
 * The mean luminance of a picture under which it nearly vanishes on the dark theme's tile, and over
 * which on the light theme's: under 2:1 contrast with each (#1b1621 and #ffffff, the `--surface` of
 * styles/tokens.css).
 */
const DARK_CLOSE = 0.069
const LIGHT_CLOSE = 0.475
/** A picture's backdrop in the theme its colour is close to: the text colour, inset round it. */
const BACKDROP = {
  dark: 'dark:bg-text dark:p-[3px]',
  light: '[[data-theme=light]_&]:bg-text [[data-theme=light]_&]:p-[3px]',
}

/** The thumbnail's size asked of the editor for a picture: the tile's, at twice its pixels. */
export const PICTURE_PIXELS = 2 * PICTURE

/**
 * Whether a layer's row shows its drawn picture, so the picture is asked for: a text's row shows the
 * text icon, as a picture of its words in their own colour can vanish against the panel, and a
 * mask's the mask icon.
 */
export const pictured = (node: Layer) => node.type !== 'text' && !isMask(node)

/**
 * How a drawn picture reads: blank when it has no pixel drawn, else the theme whose tile it is about
 * the colour of, by the mean colour of its pixels, or null when it reads on both.
 */
function readPicture(img: HTMLImageElement): keyof typeof BACKDROP | 'blank' | null {
  const paint = document.createElement('canvas')
  const scale = Math.min(1, 32 / Math.max(img.naturalWidth, img.naturalHeight, 1))
  paint.width = Math.max(1, Math.round(img.naturalWidth * scale))
  paint.height = Math.max(1, Math.round(img.naturalHeight * scale))
  const g = paint.getContext('2d', { willReadFrequently: true })
  if (!g) return null
  g.drawImage(img, 0, 0, paint.width, paint.height)
  const data = g.getImageData(0, 0, paint.width, paint.height).data
  const sum = [0, 0, 0]
  let weight = 0
  for (let i = 0; i < data.length; i += 4) {
    const a = (data[i + 3] ?? 0) / 255
    for (let c = 0; c < 3; c++) sum[c] = (sum[c] ?? 0) + (data[i + c] ?? 0) * a
    weight += a
  }
  if (weight === 0) return 'blank'
  const [r = 0, gr = 0, b = 0] = sum.map((c) => {
    const v = c / weight / 255
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  })
  const luminance = 0.2126 * r + 0.7152 * gr + 0.0722 * b
  return luminance < DARK_CLOSE ? 'dark' : luminance > LIGHT_CLOSE ? 'light' : null
}

/** A layer's picture tile: `picture` is its drawn picture, or null while it has none. */
export function LayerPicture({ node, picture, selected }: { node: Layer; picture: string | null; selected: boolean }) {
  const t = useMessages()
  // How the picture read once it loaded: blank, or the theme whose tile it is about the colour of.
  const [read, setRead] = useState<{ src: string; look: keyof typeof BACKDROP | 'blank' | null } | null>(null)
  const mask = isMask(node)
  const look = read !== null && read.src === picture ? read.look : null
  // A picture with nothing drawn, as of a group that holds only a mask, shows the layer's icon.
  const drawn = look === 'blank' ? null : picture
  const close = look === 'blank' ? null : look
  const LayerIcon = iconOf(node, t.editor.layouts)
  return (
    <span
      aria-hidden
      data-testid="layer-picture"
      style={{ width: PICTURE, height: PICTURE }}
      className={cn(
        'grid shrink-0 place-items-center overflow-hidden rounded-[5px] transition-colors duration-[var(--chrome-fast)]',
        // A picture is bare, as in the mock; a text's icon sits on an outlined tile, solid pink
        // while selected, and any other icon, a mask's among them, is bare until its picture is drawn.
        (mask || !drawn) && !selected && 'text-muted',
        !mask && !drawn && node.type === 'text' && (selected ? 'bg-accent-solid text-on-accent' : LAYER_PICTURE),
        !mask && drawn && close && BACKDROP[close],
      )}
    >
      {mask ? (
        <MaskIcon />
      ) : drawn ? (
        <img
          src={drawn}
          alt=""
          draggable={false}
          onLoad={(event) => setRead({ src: drawn, look: readPicture(event.currentTarget) })}
          className="size-full max-h-[20px] max-w-[20px] object-contain"
        />
      ) : (
        <LayerIcon size={13} weight={selected ? 'bold' : 'regular'} />
      )}
    </span>
  )
}
