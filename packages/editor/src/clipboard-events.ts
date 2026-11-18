// The page's side of the clipboard: the window's copy, cut and paste events, each left to the page
// when it is in one of its fields, read into a payload for the editor or written from the one the
// editor gives; the text a menu's Copy writes to the system clipboard, outside any event; and Copy
// as PNG's picture, written there as an image.
import { LAYER_CLIPBOARD_TYPE } from '@dazbee/schema'
import { SVG_TYPE } from '@dazbee/svg'

import type { ClipboardPayload } from './clipboard.ts'
import type { EditorClipboard, NoticeDetail } from './core-interface.ts'
import { inField } from './gestures/dom-input.ts'

export interface ClipboardEventsDeps {
  clipboard: EditorClipboard
  /** Whether Copy as PNG has something to copy now. */
  canCopyPng: () => boolean
  /** Copy as PNG's picture of what is chosen now, as PNG bytes drawn in the export worker; 'tooBig', or null with nothing drawn; null at once with nothing chosen. */
  picture: () => Promise<Uint8Array | 'tooBig' | null> | null
  /** Tells the page whether the picture went on the clipboard. */
  notify: (...told: NoticeDetail<'pngCopied' | 'pngNotCopied'>) => void
  /** Whether copy, cut and paste are paused: each is left to the browser, as the live editor's while a version is viewed over it. */
  paused?: () => boolean
  /** Removes the listeners once it aborts. */
  signal: AbortSignal
}

export interface EditorClipboardEvents {
  /**
   * Copies the selected layers from a menu, outside any clipboard event: their plain text goes to
   * the system clipboard, where the page may write to it. False with nothing copied.
   */
  copyLayers(): boolean
  /**
   * Copies Copy as PNG's picture to the system clipboard as `image/png`. The write starts at once,
   * while the key or the click that asked for it still lets the page write, with the picture still
   * being drawn in it; the page is told `pngCopied` once it is there, or `pngNotCopied` with why.
   * False with nothing to copy, when nothing is written or told.
   */
  copyPng(): boolean
}

/** The types the editor reads from a paste, beside plain text; a copy writes the first, the layers'. */
const OWN_TYPES = [LAYER_CLIPBOARD_TYPE, SVG_TYPE]

export function editorClipboardEvents({
  clipboard,
  canCopyPng,
  picture,
  notify,
  paused = () => false,
  signal,
}: ClipboardEventsDeps): EditorClipboardEvents {
  const on = { signal }
  /** How many copies as PNG were asked for: only the latest's refusal is told. */
  let latest = 0

  function copyLayers() {
    const copied = clipboard.copyLayers()
    if (!copied) return false
    void navigator.clipboard?.writeText(copied.text ?? '').catch(() => {
      // Without clipboard access, Paste in the menu still has the kept copy.
    })
    return true
  }
  function copyPng() {
    if (!canCopyPng()) return false
    if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
      notify('pngNotCopied', { why: 'refused' })
      return true
    }
    const drawing = picture()
    if (!drawing) return false
    const mine = ++latest
    /** Why the picture didn't come: too big, it failed to draw, or there is nothing to draw any more. */
    let none: 'tooBig' | 'failed' | null | undefined
    const png = drawing.then(
      (made) => {
        if (made instanceof Uint8Array) return new Blob([new Uint8Array(made)], { type: 'image/png' })
        none = made
        throw new Error('no picture to copy')
      },
      (error: unknown) => {
        none = 'failed'
        throw error
      },
    )
    // The write may be refused before the browser reads the picture: its own failure then reaches no one.
    png.catch(() => undefined)
    /** Says why nothing went on the clipboard, unless a later copy took its place or nothing is drawn any more. */
    const refused = () => {
      if (mine === latest && none !== null) notify('pngNotCopied', { why: none ?? 'refused' })
    }
    try {
      navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]).then(() => notify('pngCopied'), refused)
    } catch {
      // A browser whose clipboard items take no promise of what they hold.
      refused()
    }
    return true
  }
  /** A copy or a cut event outside the page's fields: what the editor gives goes on the event, which is then the editor's alone. */
  function onCopy(e: ClipboardEvent, give: () => ClipboardPayload | null) {
    if (paused() || inField(e.target) || !e.clipboardData) return
    const payload = give()
    if (!payload) return
    for (const [type, value] of Object.entries(payload.data ?? {})) e.clipboardData.setData(type, value)
    if (payload.text !== undefined) e.clipboardData.setData('text/plain', payload.text)
    e.preventDefault()
  }
  /** A paste event outside the page's fields: the editor is given what it brings, and the event is the editor's alone when it took it. */
  function onPaste(e: ClipboardEvent) {
    if (paused() || inField(e.target)) return
    if (clipboard.paste(payloadOn(e.clipboardData))) e.preventDefault()
  }

  window.addEventListener('copy', (e) => onCopy(e, clipboard.copy), on)
  window.addEventListener('cut', (e) => onCopy(e, clipboard.cut), on)
  window.addEventListener('paste', onPaste, on)

  return { copyLayers, copyPng }
}

/**
 * What a paste event brings as a payload: its plain text, the editor's own types and its files, each
 * left out when the event has none. A file is described by its name and type, and read only when asked.
 */
function payloadOn(data: DataTransfer | null): ClipboardPayload {
  const text = data?.getData('text/plain')
  const own = OWN_TYPES.flatMap((type) => {
    const value = data?.getData(type)
    return value ? [[type, value] as const] : []
  })
  const files = Array.from(data?.files ?? [], (file) => ({
    name: file.name,
    type: file.type,
    text: () => file.text(),
    bytes: async () => new Uint8Array(await file.arrayBuffer()),
  }))
  return {
    ...(text ? { text } : {}),
    ...(own.length > 0 ? { data: Object.fromEntries(own) } : {}),
    ...(files.length > 0 ? { files } : {}),
  }
}
