// A connection's right to its design: the role its token gives, until the token expires. Before then
// the server asks the tab for a fresh token on the open connection, which the provider fetches from
// the API and sends, and asks again every so often until a valid one comes; a valid one, for the
// same member and design, carries the right on with the role it gives now. Without one the connection
// ends when the token expires. Both timers are armed when the connection opens.
import { roleWrites } from '@dazbee/schema'
import type { SyncTokenPayload } from '@dazbee/sync-token'

/** What a connection may do, from its last valid token. */
export interface Access {
  /** The member the connection is for, which a fresh token must be for too. */
  userId: string
  workspaceId: string
  /** Whether the member's role lets them change the design. */
  writes: boolean
  /** The schema version the design is at: a tab built before it may not have the design. */
  schemaVersion: number
  /** When the token expires, in milliseconds since the epoch. */
  expiresAt: number
  /** The token itself, so the same one brought back is not taken as fresh. */
  token: string
  /** Asks for a fresh token: first `beforeMs` before expiry, then every `everyMs` until one comes. */
  asking: ReturnType<typeof setTimeout> | null
  /** Ends the connection at expiry. */
  expiry: ReturnType<typeof setTimeout> | null
}

/** What the timers need of a connection: asking its tab for a fresh token. Both servers' connections have it. */
export interface TokenAsker {
  requestToken(): void
}

/** When the server asks a connection for a fresh token. */
export interface Renewal {
  /** How long before its token expires a connection is first asked. */
  beforeMs: number
  /** How often it is asked again until a valid token comes. */
  everyMs: number
}

/** What a token brought on an open connection did. */
export type Renewed = 'same' | 'renewed' | 'refused'

export const RENEWAL: Renewal = { beforeMs: 60_000, everyMs: 15_000 }

/** The access a valid token gives. */
export function accessOf(payload: SyncTokenPayload, token: string): Access {
  return {
    userId: payload.userId,
    workspaceId: payload.workspaceId,
    writes: roleWrites(payload.role),
    schemaVersion: payload.schemaVersion,
    expiresAt: payload.expiresAt,
    token,
    asking: null,
    expiry: null,
  }
}

/**
 * Arms both timers for `access`'s token: asking `connection`'s tab for a fresh one `beforeMs` before
 * it expires (at once when less is left) and every `everyMs` after, and calling `expire` when it
 * expires.
 */
export function keepFresh(connection: TokenAsker, access: Access, renewal: Renewal, expire: () => void) {
  stopRenewing(access)
  const ask = () => {
    connection.requestToken()
    access.asking = setTimeout(ask, renewal.everyMs)
  }
  access.asking = setTimeout(ask, Math.max(0, access.expiresAt - renewal.beforeMs - Date.now()))
  access.expiry = setTimeout(expire, Math.max(0, access.expiresAt - Date.now()))
}

/**
 * Takes a token a tab sent on its open connection, already checked for the design: the one it has
 * changes nothing, and the next ask comes on its time; one for another member is refused; any other
 * carries the right on with the role, version and expiry it gives, and re-arms both timers.
 */
export function renew(
  connection: TokenAsker,
  access: Access,
  payload: SyncTokenPayload,
  token: string,
  renewal: Renewal,
  expire: () => void,
): Renewed {
  if (token === access.token) return 'same'
  if (payload.userId !== access.userId || payload.workspaceId !== access.workspaceId) return 'refused'
  stopRenewing(access)
  Object.assign(access, accessOf(payload, token))
  keepFresh(connection, access, renewal, expire)
  return 'renewed'
}

/** Stops both timers, once the connection has ended or before they are armed again. */
export function stopRenewing(access: Access) {
  if (access.asking) clearTimeout(access.asking)
  if (access.expiry) clearTimeout(access.expiry)
  access.asking = null
  access.expiry = null
}
