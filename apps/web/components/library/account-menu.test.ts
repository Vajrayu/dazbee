import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { I18nProvider } from '@/lib/i18n/client.tsx'

import { AccountMenu, AccountRows } from './account-menu.tsx'

/** `element`'s markup in English. */
const html = (element: ReturnType<typeof createElement>) =>
  renderToStaticMarkup(createElement(I18nProvider, { locale: 'en', children: element }))

/** The labels of the open menu's links and buttons, in order. */
function rowsOf(signedIn: boolean) {
  const markup = html(createElement(AccountRows, { workspaceId: 'workspace-1', signedIn }))
  return [...markup.matchAll(/<(?:a|button)\b[^>]*>(?:<svg[\s\S]*?<\/svg>)?([^<]*)<\/(?:a|button)>/g)].map(
    (match) => match[1],
  )
}

describe('AccountMenu', () => {
  it("shows the person's initials on the avatar", () => {
    const markup = html(
      createElement(AccountMenu, { workspaceId: 'workspace-1', name: 'Ada Lovelace', signedIn: true }),
    )

    expect(markup).toContain('<span aria-hidden="true">KC</span>')
  })
})

describe('AccountRows', () => {
  it('holds Settings and Sign out, and nothing else', () => {
    expect(rowsOf(true)).toEqual(['Settings', 'Sign out'])
  })

  it('leaves Sign out out with no session to end', () => {
    expect(rowsOf(false)).toEqual(['Settings'])
  })

  it("opens the workspace's Settings", () => {
    expect(html(createElement(AccountRows, { workspaceId: 'workspace-1', signedIn: true }))).toContain(
      'href="/w/workspace-1/settings"',
    )
  })
})
