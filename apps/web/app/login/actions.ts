'use server'

// Starts sign-in: asks the API for WorkOS's sign-in page, carrying the token of the invite the person
// came from, and keeps the state and that token in short-lived cookies for WorkOS's answer at /callback.
import { randomBytes } from 'node:crypto'

import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'

import { InvitationToken } from '@dazbee/schema'

import { signInLink } from '@/lib/server/api.ts'
import { cookieOptions, INVITATION_COOKIE, STATE_COOKIE, STATE_SECONDS } from '@/lib/server/sign-in.ts'

export async function start(form: FormData) {
  const state = randomBytes(24).toString('base64url')
  const token = InvitationToken.safeParse(form.get('invitation_token'))
  const url = await signInLink(state, token.data)
  if (!url) redirect('/login?unavailable=1')
  const jar = await cookies()
  const options = { ...cookieOptions((await headers()).get('origin')), maxAge: STATE_SECONDS }
  jar.set(STATE_COOKIE, state, options)
  if (token.success) jar.set(INVITATION_COOKIE, token.data, options)
  else jar.delete(INVITATION_COOKIE)
  redirect(url)
}
