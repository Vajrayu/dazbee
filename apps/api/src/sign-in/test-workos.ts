// WorkOS as the API's seam tests see it: a stand-in that never calls out.
import { randomUUID } from 'node:crypto'

import { inviteExpiry, type InvitesProvider, type ProviderInvite } from '../members/invites-provider.ts'
import type { SignedInPerson, SignInProvider } from './sign-in.ts'

/**
 * WorkOS as far as the API sees it: codes name people, it remembers what it was asked to make, and it
 * holds the invitations it sent, which a test accepts as the invited person would with `accept`.
 */
export function fakeWorkos(people: Record<string, SignedInPerson> = {}) {
  const made = {
    organizations: [] as { id: string; name: string; workspaceId: string }[],
    members: [] as { organizationId: string; userId: string }[],
    invitations: [] as { id: string; email: string; organizationId: string | null; inviterUserId: string }[],
    removed: [] as { organizationId: string; userId: string }[],
    endedSessions: [] as string[],
  }
  // Each invitation as WorkOS holds it, by id.
  const invitations = new Map<string, ProviderInvite>()

  const provider: SignInProvider = {
    signInUrl: (state, invitationToken) =>
      `https://auth.example.test/authorize?state=${state}${invitationToken ? `&invitation_token=${invitationToken}` : ''}`,
    authenticate: (code) => {
      const person = people[code]
      return person ? Promise.resolve(person) : Promise.reject(new Error('invalid_grant'))
    },
    createOrganization: (name, workspaceId) => {
      const id = `org_${randomUUID()}`
      made.organizations.push({ id, name, workspaceId })
      return Promise.resolve(id)
    },
    addMember: (organizationId, userId) => {
      made.members.push({ organizationId, userId })
      return Promise.resolve()
    },
    signOutUrl: (sessionId) => `https://auth.example.test/logout?session_id=${sessionId}`,
    endSession: (sessionId) => {
      made.endedSessions.push(sessionId)
      return Promise.resolve()
    },
  }

  /** The invitation as WorkOS would answer it now: past its expiry, a pending one is expired. */
  function read(id: string): ProviderInvite {
    const invitation = invitations.get(id)
    if (!invitation) throw new Error('invitation not found')
    const expired = invitation.state === 'pending' && invitation.expiresAt.getTime() <= Date.now()
    return { ...invitation, state: expired ? 'expired' : invitation.state }
  }
  /** Sets what WorkOS holds of an invitation, and answers it. */
  function hold(invitation: ProviderInvite): Promise<ProviderInvite> {
    invitations.set(invitation.id, invitation)
    return Promise.resolve(read(invitation.id))
  }

  const invites: InvitesProvider = {
    invite(email, organizationId, inviterUserId) {
      const id = `invitation_${randomUUID().replaceAll('-', '')}`
      made.invitations.push({ id, email, organizationId, inviterUserId })
      const link = `https://auth.example.test/invite?invitation_token=token_${id}`
      return hold({ id, state: 'pending', link, expiresAt: inviteExpiry(), acceptedUserId: null })
    },
    resend(id) {
      const invitation = read(id)
      if (invitation.state !== 'pending') return Promise.reject(new Error('invitation is not pending'))
      return hold({ ...invitation, expiresAt: inviteExpiry() })
    },
    // WorkOS refuses to revoke an accepted invitation.
    revoke(id) {
      const invitation = read(id)
      if (invitation.state === 'accepted') return Promise.reject(new Error('invitation is already accepted'))
      return invitation.state === 'pending' ? hold({ ...invitation, state: 'revoked' }) : Promise.resolve(invitation)
    },
    read: (id) => Promise.resolve(read(id)),
    removeMember: (organizationId, userId) => {
      made.removed.push({ organizationId, userId })
      return Promise.resolve()
    },
  }

  /** Accepts an invitation as the WorkOS user would on WorkOS's page, whatever our table says. */
  function accept(id: string, workosUserId: string) {
    const invitation = invitations.get(id)
    if (!invitation) throw new Error('invitation not found')
    invitations.set(id, { ...invitation, state: 'accepted', acceptedUserId: workosUserId })
  }

  return { provider, invites, made, people, accept }
}
