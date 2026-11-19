'use server'

// Starts sign-in: asks the API for WorkOS's sign-in page, carrying the token of the invite the person
// came from, and keeps the state and that token in short-lived cookies for WorkOS's answer at /callback.
// On the pilot host, WorkOS answers at that host's own /callback. And sends a request to join from the
// early-access notice, with the person's address as Cloudflare saw it and the form's Turnstile token.
import { randomBytes } from 'node:crypto'

import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'

import { InvitationToken, RequestAccess } from '@dazbee/schema'

import { getMessages } from '@/lib/i18n/server.ts'
import { isPilotHost } from '@/lib/pilot-host.ts'
import { requestAccess } from '@/lib/server/admin.ts'
import { ApiFailure, signInLink } from '@/lib/server/api.ts'
import { cookieOptions, INVITATION_COOKIE, STATE_COOKIE, STATE_SECONDS } from '@/lib/server/sign-in.ts'

/** What a request to join answered: sent, why it wasn't, or nothing yet. */
export type RequestAnswer = { sent: true } | { error: string } | null

export async function start(form: FormData) {
  const state = randomBytes(24).toString('base64url')
  const token = InvitationToken.safeParse(form.get('invitation_token'))
  const asked = await headers()
  const origin = asked.get('origin')
  const pilotCallback = origin && isPilotHost(asked.get('host')) ? new URL('/callback', origin).href : undefined
  const url = await signInLink(state, token.data, pilotCallback)
  if (!url) redirect('/login?unavailable=1')
  const jar = await cookies()
  const options = { ...cookieOptions(origin), maxAge: STATE_SECONDS }
  jar.set(STATE_COOKIE, state, options)
  if (token.success) jar.set(INVITATION_COOKIE, token.data, options)
  else jar.delete(INVITATION_COOKIE)
  redirect(url)
}

/**
 * Sends the form's request to join: its email, name, company, note and Turnstile token. A form a request
 * can't be made from is refused here; the API's refusals are a 429 for too many from one address and a 400
 * for a Turnstile check that failed.
 */
export async function requestToJoin(_before: RequestAnswer, form: FormData): Promise<RequestAnswer> {
  const words = (await getMessages()).signIn.request
  const text = (name: string) => {
    const value = form.get(name)
    return typeof value === 'string' ? value : ''
  }
  const input = RequestAccess.safeParse({
    email: text('email'),
    name: text('name'),
    company: text('company'),
    note: text('note'),
    turnstileToken: text('turnstile_token') || undefined,
  })
  if (!input.success) {
    const field = (name: string) => input.error.issues.some((issue) => issue.path[0] === name)
    return { error: field('email') ? words.badEmail : field('name') || field('company') ? words.missing : words.failed }
  }
  try {
    await requestAccess(input.data, (await headers()).get('cf-connecting-ip'))
  } catch (e) {
    if (!(e instanceof ApiFailure)) throw e
    return { error: e.status === 429 ? words.tooMany : e.status === 400 ? words.checkFailed : words.failed }
  }
  return { sent: true }
}
