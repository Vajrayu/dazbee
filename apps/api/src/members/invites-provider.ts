// Who sends a workspace's invites, and Dazbee invites, and says whether one was accepted: WorkOS for a
// workspace with a WorkOS organization, the development stand-in for one without; WorkOS for Dazbee
// invites when sign-in is set up, else the stand-in. The provider's own state of an invite never decides
// whether it is pending; the invite's `expires_at` in our table does.
import { type Invitation, WorkOS } from '@workos-inc/node'

import type { WorkosSettings } from '../sign-in/sign-in.ts'

/** An invite as its provider holds it. */
export interface ProviderInvite {
  id: string
  state: 'pending' | 'accepted' | 'expired' | 'revoked'
  /** The link that accepts it. */
  link: string
  expiresAt: Date
  /** The WorkOS user id of whoever accepted it, once accepted. */
  acceptedUserId: string | null
}

/** What the API needs from whoever sends invites; tests give it a stand-in that never calls out. */
export interface InvitesProvider {
  /**
   * Sends an invite to the organization, naming who invited. With no organization it is a Dazbee invite,
   * or with the stand-in an invite to a workspace without one, such as the development workspace.
   */
  invite(email: string, organizationId: string | null, inviterWorkosUserId: string | null): Promise<ProviderInvite>
  resend(id: string): Promise<ProviderInvite>
  /** Revokes a pending invite; one no longer pending is answered as it is, accepted ones included. */
  revoke(id: string): Promise<ProviderInvite>
  read(id: string): Promise<ProviderInvite>
  /** Takes the person out of the organization, when they leave or are removed. */
  removeMember(organizationId: string, workosUserId: string): Promise<void>
}

/** The providers the API has: WorkOS's when sign-in is set up, the stand-in when the development session is on. */
export interface InvitesProviders {
  workos: InvitesProvider | null
  dev: InvitesProvider | null
}

/** How long an invite lasts. */
export const INVITE_DAYS = 7

/** When an invite sent now expires. */
export function inviteExpiry(now = Date.now()): Date {
  return new Date(now + INVITE_DAYS * 24 * 60 * 60 * 1000)
}

/** The provider of a workspace's invites by its WorkOS organization, or null when it has none here. */
export function invitesProviderFor(providers: InvitesProviders, organizationId: string | null): InvitesProvider | null {
  return organizationId ? providers.workos : providers.dev
}

/** The provider of Dazbee invites: WorkOS when sign-in is set up, else the stand-in; null when there is neither. */
export function dazbeeInvitesProvider(providers: InvitesProviders): InvitesProvider | null {
  return providers.workos ?? providers.dev
}

export function workosInvites({ apiKey, clientId }: WorkosSettings): InvitesProvider {
  const { userManagement } = new WorkOS(apiKey, { clientId })
  return {
    async invite(email, organizationId, inviterUserId) {
      // No role slug: roles are ours (memberships.role), and WorkOS only needs to know the person belongs. A
      // Dazbee invite names no organization and no inviter, so WorkOS's email comes from Dazbee itself.
      const to = organizationId ? { organizationId, ...(inviterUserId ? { inviterUserId } : {}) } : {}
      return providerInvite(await userManagement.sendInvitation({ email, ...to, expiresInDays: INVITE_DAYS }))
    },
    resend: async (id) => providerInvite(await userManagement.resendInvitation(id)),
    async revoke(id) {
      try {
        return providerInvite(await userManagement.revokeInvitation(id))
      } catch (e) {
        // WorkOS refuses to revoke one no longer pending, which is answered as it is.
        const invite = providerInvite(await userManagement.getInvitation(id))
        if (invite.state === 'pending') throw e
        return invite
      }
    },
    read: async (id) => providerInvite(await userManagement.getInvitation(id)),
    async removeMember(organizationId, userId) {
      const [membership] = (await userManagement.listOrganizationMemberships({ organizationId, userId })).data
      if (membership) await userManagement.deleteOrganizationMembership(membership.id)
    },
  }
}

function providerInvite(invitation: Invitation): ProviderInvite {
  return {
    id: invitation.id,
    state: invitation.state,
    link: invitation.acceptInvitationUrl,
    expiresAt: new Date(invitation.expiresAt),
    acceptedUserId: invitation.acceptedUserId,
  }
}
