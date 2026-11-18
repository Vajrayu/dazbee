import { afterEach, describe, expect, it, vi } from 'vitest'

import { LAYER_CLIPBOARD_TYPE } from '@dazbee/schema'
import { SVG_TYPE } from '@dazbee/svg'

import type { ClipboardPayload } from './clipboard.ts'
import { type ClipboardEventsDeps, editorClipboardEvents } from './clipboard-events.ts'

/** An element of the page by its tag: an `INPUT` is one of the page's own fields. */
class Part {
  readonly tagName: string
  readonly isContentEditable = false
  constructor(tagName: string) {
    this.tagName = tagName
  }
}
const FIELD = new Part('INPUT')
const BODY = new Part('BODY')
const LAYERS: ClipboardPayload = { text: 'Rect', data: { [LAYER_CLIPBOARD_TYPE]: '{"kind":"dazbee.layers"}' } }

/** A clipboard's data with the given types and files on it; a type not there reads as '', as in a browser. */
function transfer(types: Record<string, string> = {}, files: File[] = []) {
  const items = new Map(Object.entries(types))
  return {
    items,
    files,
    getData: (type: string) => items.get(type) ?? '',
    setData: (type: string, value: string) => void items.set(type, value),
  }
}
/** A clipboard event of the browser on an element, which records whether the editor took it. */
function clipboardEvent(data: ReturnType<typeof transfer> | null, target: Part = BODY) {
  const event = {
    target,
    clipboardData: data,
    taken: false,
    preventDefault() {
      event.taken = true
    },
  }
  return event
}

/** A clipboard item as a browser makes one: what it holds by type. */
class Item {
  readonly items: Record<string, Promise<Blob>>
  constructor(items: Record<string, Promise<Blob>>) {
    this.items = items
  }
}

/** A clipboard item of a browser whose items hold no promise of what they hold: making one throws. */
function noPromises(): never {
  throw new TypeError('a clipboard item holds no promise')
}

/**
 * The page's side of the clipboard over a window that keeps its listeners and a system clipboard
 * that keeps the text and the items written to it, with an editor that logs what it is asked and
 * answers as told: `png` says whether Copy as PNG has something to copy and what its picture gives.
 */
function harness(
  answers: {
    copy?: ClipboardPayload | null
    cut?: ClipboardPayload | null
    paste?: boolean
    copyLayers?: ClipboardPayload | null
    /** Whether copy, cut and paste are paused, as the live editor's are while a version is viewed. */
    paused?: () => boolean
  } = {},
  clipboard: 'writes' | 'refuses' | 'none' = 'writes',
  png: { ready?: boolean; picture?: Uint8Array | 'tooBig' | null | 'fails'; items?: 'take promises' | 'throw' } = {},
) {
  const log: string[] = []
  const pasted: ClipboardPayload[] = []
  const written: string[] = []
  /** The items written, each once what it holds has come, or a write's refusal. */
  const images: Promise<string>[] = []
  const onWindow = new Map<string, { listener: (e: unknown) => void; signal: AbortSignal | undefined }>()
  vi.stubGlobal('HTMLElement', Part)
  vi.stubGlobal('ClipboardItem', png.items === 'throw' ? noPromises : Item)
  vi.stubGlobal('window', {
    addEventListener: (type: string, listener: (e: unknown) => void, options?: { signal?: AbortSignal }) =>
      onWindow.set(type, { listener, signal: options?.signal }),
  })
  vi.stubGlobal('navigator', {
    ...(clipboard === 'none'
      ? {}
      : {
          clipboard: {
            writeText: (text: string) => {
              written.push(text)
              return clipboard === 'writes' ? Promise.resolve() : Promise.reject(new Error('not allowed'))
            },
            write: (items: Item[]) => {
              log.push('write')
              // A browser waits for what each item holds, and refuses the write when it doesn't come.
              const held = Promise.all(
                items.flatMap((item) =>
                  Object.entries(item.items).map(async ([type, blob]) => `${type} ${(await blob).size}`),
                ),
              ).then((all) => all.join(' '))
              images.push(held)
              return clipboard === 'writes' ? held.then(() => undefined) : Promise.reject(new Error('not allowed'))
            },
          },
        }),
  })
  const listening = new AbortController()
  const deps: ClipboardEventsDeps = {
    clipboard: {
      copy: () => {
        log.push('copy')
        return answers.copy ?? null
      },
      cut: () => {
        log.push('cut')
        return answers.cut ?? null
      },
      paste: (payload) => {
        log.push('paste')
        pasted.push(payload)
        return answers.paste ?? false
      },
      copyLayers: () => {
        log.push('copyLayers')
        return answers.copyLayers ?? null
      },
    },
    canCopyPng: () => png.ready ?? true,
    picture: () => {
      log.push('picture')
      if (png.picture === 'fails') return Promise.reject(new Error('the export worker failed'))
      return Promise.resolve(png.picture === undefined ? new Uint8Array(5) : png.picture)
    },
    notify: (...told) => void log.push(told.length > 1 ? `${told[0]} ${JSON.stringify(told[1])}` : told[0]),
    signal: listening.signal,
    ...(answers.paused ? { paused: answers.paused } : {}),
  }
  const events = editorClipboardEvents(deps)
  /** Sends the window a clipboard event. */
  const send = (type: 'copy' | 'cut' | 'paste', e: ReturnType<typeof clipboardEvent>) => {
    onWindow.get(type)?.listener(e)
    return e
  }
  return { events, log, pasted, written, images, onWindow, listening, send }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('editorClipboardEvents', () => {
  it('listens to the window’s copy, cut and paste until its signal aborts', () => {
    const { onWindow, listening } = harness()
    expect([...onWindow.keys()]).toEqual(['copy', 'cut', 'paste'])
    expect([...onWindow.values()].every(({ signal }) => signal === listening.signal)).toBe(true)
  })

  describe.each(['copy', 'cut'] as const)('a %s event', (type) => {
    it('writes the payload the editor gives onto the event, its own types and its plain text, and keeps the browser from it', () => {
      const { send, log } = harness({ [type]: LAYERS })
      const data = transfer()
      expect(send(type, clipboardEvent(data)).taken).toBe(true)
      expect([...data.items]).toEqual([
        [LAYER_CLIPBOARD_TYPE, '{"kind":"dazbee.layers"}'],
        ['text/plain', 'Rect'],
      ])
      expect(log).toEqual([type])
    })

    it('writes a payload of plain text alone as that text', () => {
      const { send } = harness({ [type]: { text: 'ell' } })
      const data = transfer()
      expect(send(type, clipboardEvent(data)).taken).toBe(true)
      expect([...data.items]).toEqual([['text/plain', 'ell']])
    })

    it('leaves the event to the browser when the editor gives nothing', () => {
      const { send, log } = harness()
      const data = transfer()
      expect(send(type, clipboardEvent(data)).taken).toBe(false)
      expect(data.items.size).toBe(0)
      expect(log).toEqual([type])
    })

    it('asks the editor nothing for an event in one of the page’s fields, or one that carries no clipboard data', () => {
      const { send, log } = harness({ [type]: LAYERS })
      const data = transfer()
      expect(send(type, clipboardEvent(data, FIELD)).taken).toBe(false)
      expect(send(type, clipboardEvent(null)).taken).toBe(false)
      expect(data.items.size).toBe(0)
      expect(log).toEqual([])
    })
  })

  it('asks the editor nothing for a copy, a cut or a paste while paused, and leaves each to the browser; then asks again', () => {
    let paused = true
    const { send, log } = harness({ copy: LAYERS, cut: LAYERS, paste: true, paused: () => paused })
    for (const type of ['copy', 'cut', 'paste'] as const)
      expect(send(type, clipboardEvent(transfer())).taken).toBe(false)
    expect(log).toEqual([])
    paused = false
    expect(send('paste', clipboardEvent(transfer({ 'text/plain': 'Rect' }))).taken).toBe(true)
    expect(log).toEqual(['paste'])
  })

  describe('a paste event', () => {
    it('gives the editor the event’s plain text and the editor’s own types as a payload, and keeps the browser from an event it took', () => {
      const { send, pasted } = harness({ paste: true })
      const types = {
        'text/plain': 'Rect',
        [LAYER_CLIPBOARD_TYPE]: '{}',
        [SVG_TYPE]: '<svg/>',
        'text/html': '<b>Rect</b>',
      }
      expect(send('paste', clipboardEvent(transfer(types))).taken).toBe(true)
      expect(pasted).toEqual([{ text: 'Rect', data: { [LAYER_CLIPBOARD_TYPE]: '{}', [SVG_TYPE]: '<svg/>' } }])
    })

    it('leaves the browser an event the editor did not take', () => {
      const { send, pasted } = harness({ paste: false })
      expect(send('paste', clipboardEvent(transfer({ 'text/plain': 'Hi' }))).taken).toBe(false)
      expect(pasted).toEqual([{ text: 'Hi' }])
    })

    it('gives an empty payload for an event that brings nothing, or carries no clipboard data', () => {
      const { send, pasted } = harness()
      send('paste', clipboardEvent(transfer()))
      send('paste', clipboardEvent(null))
      expect(pasted).toEqual([{}, {}])
    })

    it('describes each file by its name and type, and reads its text or its bytes only when asked', async () => {
      const { send, pasted } = harness({ paste: true })
      const logo = new File(['<svg/>'], 'logo.svg', { type: SVG_TYPE })
      const photo = new File([new Uint8Array([1, 2, 3])], 'photo.png', { type: 'image/png' })
      const reads = [logo, photo].flatMap((file) => [vi.spyOn(file, 'text'), vi.spyOn(file, 'arrayBuffer')])
      send('paste', clipboardEvent(transfer({}, [logo, photo])))
      const files = pasted[0]?.files ?? []
      expect(Object.keys(pasted[0] ?? {})).toEqual(['files'])
      expect(files.map(({ name, type }) => ({ name, type }))).toEqual([
        { name: 'logo.svg', type: SVG_TYPE },
        { name: 'photo.png', type: 'image/png' },
      ])
      expect(reads.map((read) => read.mock.calls.length)).toEqual([0, 0, 0, 0])
      expect(await files[0]?.text()).toBe('<svg/>')
      expect(await files[1]?.bytes()).toEqual(new Uint8Array([1, 2, 3]))
      expect(reads.map((read) => read.mock.calls.length)).toEqual([1, 0, 0, 1])
    })

    it('reads back what a copy event wrote as the payload the editor gave, for layers and for plain text', () => {
      for (const payload of [LAYERS, { text: 'ell' }]) {
        const { send, pasted } = harness({ copy: payload })
        const data = transfer()
        send('copy', clipboardEvent(data))
        send('paste', clipboardEvent(data))
        expect(pasted).toEqual([payload])
      }
    })

    it('describes several image files, each by its name and type', () => {
      const { send, pasted } = harness()
      const photos = ['one.png', 'two.png'].map((name) => new File([new Uint8Array([1])], name, { type: 'image/png' }))
      expect(send('paste', clipboardEvent(transfer({}, photos))).taken).toBe(false)
      expect(pasted[0]?.files?.map(({ name, type }) => ({ name, type }))).toEqual([
        { name: 'one.png', type: 'image/png' },
        { name: 'two.png', type: 'image/png' },
      ])
    })

    it('asks the editor nothing for an event in one of the page’s fields', () => {
      const { send, log } = harness({ paste: true })
      expect(send('paste', clipboardEvent(transfer({ 'text/plain': 'Hi' }), FIELD)).taken).toBe(false)
      expect(log).toEqual([])
    })
  })

  describe('copyLayers', () => {
    it('writes the plain text of the payload the editor gives to the system clipboard, and says it copied', () => {
      const { events, written, log } = harness({ copyLayers: LAYERS })
      expect(events.copyLayers()).toBe(true)
      expect(written).toEqual(['Rect'])
      expect(log).toEqual(['copyLayers'])
    })

    it('writes nothing and says so when the editor gives nothing', () => {
      const { events, written } = harness()
      expect(events.copyLayers()).toBe(false)
      expect(written).toEqual([])
    })

    it('still says it copied where the page may not write to the clipboard, or has none', async () => {
      const refused = harness({ copyLayers: LAYERS }, 'refuses')
      expect(refused.events.copyLayers()).toBe(true)
      expect(refused.written).toEqual(['Rect'])
      // The refusal is the write's own: it reaches no one.
      await Promise.resolve()
      expect(harness({ copyLayers: LAYERS }, 'none').events.copyLayers()).toBe(true)
    })
  })

  describe('copyPng', () => {
    it('starts the write at once, before the picture is drawn, then puts the PNG on the clipboard and says it copied', async () => {
      const { events, log, images } = harness()
      expect(events.copyPng()).toBe(true)
      // The picture is asked for, and the write made, in the same turn as the key or the click.
      expect(log).toEqual(['picture', 'write'])
      expect(await images[0]).toBe('image/png 5')
      await vi.waitFor(() => expect(log).toEqual(['picture', 'write', 'pngCopied']))
    })

    it('starts nothing and tells nothing with nothing to copy', () => {
      const { events, log } = harness({}, 'writes', { ready: false })
      expect(events.copyPng()).toBe(false)
      expect(log).toEqual([])
    })

    it('says the picture is too big when the export takes it at no scale, and the browser refused when it refuses', async () => {
      const big = harness({}, 'writes', { picture: 'tooBig' })
      big.events.copyPng()
      await vi.waitFor(() => expect(big.log).toEqual(['picture', 'write', 'pngNotCopied {"why":"tooBig"}']))
      const refused = harness({}, 'refuses')
      refused.events.copyPng()
      await vi.waitFor(() => expect(refused.log).toEqual(['picture', 'write', 'pngNotCopied {"why":"refused"}']))
      const none = harness({}, 'none')
      expect(none.events.copyPng()).toBe(true)
      // Nothing is drawn for a clipboard that takes no image.
      expect(none.log).toEqual(['pngNotCopied {"why":"refused"}'])
    })

    it('says the picture failed when it fails to draw, and the browser refused when its clipboard items take no promise', async () => {
      const failed = harness({}, 'writes', { picture: 'fails' })
      failed.events.copyPng()
      await vi.waitFor(() => expect(failed.log).toEqual(['picture', 'write', 'pngNotCopied {"why":"failed"}']))
      const old = harness({}, 'writes', { items: 'throw' })
      expect(old.events.copyPng()).toBe(true)
      expect(old.log).toEqual(['picture', 'pngNotCopied {"why":"refused"}'])
    })

    it('tells only the latest of two copies made one after the other why it copied nothing', async () => {
      const { events, log } = harness({}, 'refuses')
      events.copyPng()
      events.copyPng()
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(log).toEqual(['picture', 'write', 'picture', 'write', 'pngNotCopied {"why":"refused"}'])
    })

    it('tells nothing when the selection draws nothing any more by the time it is drawn', async () => {
      const { events, log, images } = harness({}, 'writes', { picture: null })
      events.copyPng()
      await expect(images[0]).rejects.toThrow()
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(log).toEqual(['picture', 'write'])
    })
  })
})
