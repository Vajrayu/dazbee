// The API's calls for early access, from the web app's server only: the admin page's Dazbee invites and
// waiting list, which the API answers 404 to anyone but an admin, and the public request to join.
import 'server-only'

import { cache } from 'react'
import { z } from 'zod'

import { AccessRequest, DazbeeInvite, DazbeeInvites, type RequestAccess } from '@dazbee/schema'

import { ApiFailure, call } from './api.ts'

/**
 * The Dazbee invites and the waiting list for the admin page, or null when the person is not an admin, to
 * whom the API answers as if there were no such page. Asked once per request, by the page and its title.
 */
export const findAdminPage = cache(async (): Promise<{ invites: DazbeeInvites; requests: AccessRequest[] } | null> => {
  try {
    const [invites, requests] = await Promise.all([
      call(DazbeeInvites, '/admin/invites'),
      call(AccessRequest.array(), '/admin/access-requests'),
    ])
    return { invites, requests }
  } catch (e) {
    if (e instanceof ApiFailure && e.status === 404) return null
    throw e
  }
})

/** Invites an email to Dazbee; an email with a pending invite has it sent again. */
export const inviteToDazbee = (email: string) =>
  call(DazbeeInvite, '/admin/invites', { method: 'POST', body: { email } })

export const resendDazbeeInvite = (inviteId: string) =>
  call(DazbeeInvite, `${dazbeeInvitePath(inviteId)}/resend`, { method: 'POST' })

export const cancelDazbeeInvite = (inviteId: string) => call(z.null(), dazbeeInvitePath(inviteId), { method: 'DELETE' })

/** Removes the access of the person who joined through the invite; their account and designs are kept. */
export const removeInvitedPerson = (inviteId: string) =>
  call(z.null(), `${dazbeeInvitePath(inviteId)}/remove`, { method: 'POST' })

/** Sends a waiting request's email a Dazbee invite, which takes it off the waiting list. */
export const inviteRequest = (requestId: string) =>
  call(DazbeeInvite, `${requestPath(requestId)}/invite`, { method: 'POST' })

export const dismissRequest = (requestId: string) => call(z.null(), requestPath(requestId), { method: 'DELETE' })

/**
 * Sends a request to join, from the person at `address` as Cloudflare saw it (null when unknown), which the
 * API limits per address. The API's refusal is thrown as an `ApiFailure`.
 */
export const requestAccess = (request: RequestAccess, address: string | null) =>
  call(
    z.null(),
    '/access-requests',
    { method: 'POST', body: request, headers: address ? { 'cf-connecting-ip': address } : {} },
    { signIn: false },
  )

function dazbeeInvitePath(inviteId: string) {
  return `/admin/invites/${encodeURIComponent(inviteId)}`
}

function requestPath(requestId: string) {
  return `/admin/access-requests/${encodeURIComponent(requestId)}`
}
