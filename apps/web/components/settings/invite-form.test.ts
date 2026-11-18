import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '@/lib/i18n/client.tsx'

import { InviteForm } from './invite-form.tsx'

vi.mock('@/app/w/[workspaceId]/(workspace)/settings/actions.ts', () => ({ invite: vi.fn() }))

/** The Invite form's markup in English, as the page sends it before its scripts load. */
const html = () =>
  renderToStaticMarkup(
    createElement(I18nProvider, {
      locale: 'en',
      children: createElement(InviteForm, { workspaceId: 'workspace-1', brands: [{ id: 'brand-1', name: 'Coffee' }] }),
    }),
  )

describe('InviteForm', () => {
  it('is sent as a POST before its scripts load, so the email never shows in the address bar', () => {
    expect(html()).toMatch(/<form\b[^>]*\bmethod="post"/)
  })
})
