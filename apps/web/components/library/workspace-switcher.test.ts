import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { en } from '@/lib/i18n/en.ts'

import { CRUMB_MENU, WorkspaceSwitcher } from './workspace-switcher.tsx'

const WORKSPACES = [
  { id: 'client-studio', name: 'Client Studio' },
  { id: 'dev-workspace', name: 'Development agency' },
]

/** The switcher's markup on a page of `currentId`. */
const html = (currentId: string) =>
  renderToStaticMarkup(createElement(WorkspaceSwitcher, { t: en, workspaces: WORKSPACES, currentId }))

describe('WorkspaceSwitcher', () => {
  it("names the page's workspace, typed in any case, and marks it in the menu", () => {
    const markup = html('DEV-WORKSPACE')

    expect(markup).toMatch(/<summary[^>]*><span[^>]*>Development agency<\/span>/)
    expect(markup).toMatch(/<a(?=[^>]*href="\/w\/dev-workspace")[^>]*aria-current="true"/)
    expect(markup).not.toMatch(/<a(?=[^>]*href="\/w\/client-studio")[^>]*aria-current/)
  })

  it('opens each workspace by its id', () => {
    expect(html('dev-workspace')).toContain('href="/w/client-studio"')
  })

  it("shares the crumb's menu name, so opening it closes the brand menu", () => {
    expect(html('dev-workspace')).toContain(`<details name="${CRUMB_MENU}"`)
  })
})
