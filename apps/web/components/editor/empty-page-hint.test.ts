import { createElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { Editor, Tool } from '@dazbee/editor'

import { I18nProvider } from '@/lib/i18n/client.tsx'
import { en } from '@/lib/i18n/en.ts'

import { EmptyPage, EmptyPageHint } from './empty-page-hint.tsx'
import { ViewOnlyProvider } from './view-only.tsx'

/** An editor as the hint reads it: the shown page's frames, and the tool it is told to pick. */
function editorWith(frames: number) {
  const picked: Tool[] = []
  const editor = {
    frames: () => Array.from({ length: frames }, (_, i) => ({ id: `f${i}` })),
    onDraw: () => () => undefined,
    setTool: (tool: Tool) => {
      picked.push(tool)
    },
  } as unknown as Editor
  return { editor, picked }
}

/** The hint's markup in English, in a tab that may edit or, with `viewOnly`, only view. */
const hintHtml = (editor: Editor, viewOnly = false) =>
  renderToStaticMarkup(
    createElement(I18nProvider, {
      locale: 'en',
      children: createElement(ViewOnlyProvider, { value: viewOnly }, createElement(EmptyPageHint, { editor })),
    }),
  )

/** The first element of `tree` whose type is `type`, looking through children and an empty state's action. */
function findElement(tree: ReactNode, type: string): ReactElement<Record<string, unknown>> | null {
  if (!tree || typeof tree !== 'object') return null
  if (Array.isArray(tree)) {
    for (const child of tree) {
      const found = findElement(child as ReactNode, type)
      if (found) return found
    }
    return null
  }
  const element = tree as ReactElement<Record<string, unknown>>
  if (element.type === type) return element
  return findElement(element.props.children as ReactNode, type) ?? findElement(element.props.action as ReactNode, type)
}

describe('EmptyPageHint', () => {
  it('shows nothing while the page has frames', () => {
    expect(hintHtml(editorWith(2).editor)).toBe('')
  })

  it('shows the frame bee big, how to add a frame, and the Add a frame button', () => {
    const html = hintHtml(editorWith(0).editor)
    expect(html).toContain('src="/mascot/frame.webp"')
    expect(html).toContain('width="180"')
    expect(html).toContain('This page is empty</h2>')
    expect(html).toContain('Pick the Frame tool to add a frame, or drag on the canvas with it for any size.</p>')
    expect(html).toMatch(/<button[^>]*>Add a frame<\/button>/)
  })

  it('lets every press but the button through to the canvas', () => {
    const html = hintHtml(editorWith(0).editor)
    expect(html).toMatch(/^<div[^>]*class="[^"]*pointer-events-none/)
    expect(html.match(/pointer-events-auto/g)).toHaveLength(1)
    expect(html).toMatch(/<button[^>]*class="[^"]*pointer-events-auto/)
  })

  it('says the page has no frames yet, with no button, in a tab that may only view', () => {
    const html = hintHtml(editorWith(0).editor, true)
    expect(html).toContain('src="/mascot/frame.webp"')
    expect(html).toContain('This page has no frames yet</h2>')
    expect(html).not.toContain('<button')
    expect(html).not.toContain('pointer-events-auto')
  })
})

describe('EmptyPage', () => {
  it('picks the Frame tool when Add a frame is pressed, as the dock does', () => {
    const { editor, picked } = editorWith(0)
    const button = findElement(EmptyPage({ words: en.editor.frames, editor }), 'button')
    expect(button?.props['data-opens']).toBe('addFrame')
    const click = button?.props.onClick as () => void
    click()
    expect(picked).toEqual(['frame'])
  })

  it('holds no button when it is given no editor to add a frame in', () => {
    const tree = EmptyPage({ words: en.editor.frames, editor: null })
    expect(findElement(tree, 'button')).toBeNull()
  })
})
