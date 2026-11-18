// Where the sync link gets each sync token from: the page's fetch, retried patiently. A fetch that
// fails while the token in hand is still good is tried again with backoff until that token expires,
// so a blip at the API during a renewal shows nothing; only once it has expired does the failure
// reach the link. An answer that says no, that the member may not have the design, is final:
// nothing more is fetched, and every ask fails. So is a token for another member than the page's:
// someone else signed in on this browser since the page was kept, and the tab, kept for the page's
// member, must not go on as them (C44).
import { type Member, sameMember, type SyncToken } from '@dazbee/schema'

export interface TokenSourceDeps {
  /** Fetches a fresh token from the API, through the page; null when the API says the member may not have the design. */
  fetch: () => Promise<SyncToken | null>
  /** The member the page opened the design as: a token for anyone else is refused. */
  member?: Member
  now?: () => number
  wait?: (ms: number) => Promise<void>
}

/** How long the first retry waits; each after it waits twice as long, up to `LAST_RETRY_MS`. */
const FIRST_RETRY_MS = 1000
const LAST_RETRY_MS = 8000
/** What an ask fails with once the API has said no. */
export class TokenRefused extends Error {
  constructor() {
    super('the API gives no sync token for this design')
    this.name = 'TokenRefused'
  }
}

/** A function that gives a fresh token, and gives every ask made while one is on its way that one. */
export function tokenSource({
  fetch,
  member,
  now = Date.now,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}: TokenSourceDeps): () => Promise<string> {
  /** When the last token fetched expires, in milliseconds since the epoch; 0 before the first. */
  let expiresAt = 0
  /** The fetch on its way, if any. */
  let fetching: Promise<string> | null = null
  /** Whether the API has said no. */
  let refused = false

  async function fetchPatiently() {
    for (let delay = FIRST_RETRY_MS; ; delay = Math.min(delay * 2, LAST_RETRY_MS)) {
      let fresh: SyncToken | null
      try {
        fresh = await fetch()
      } catch (error) {
        if (now() + delay >= expiresAt) throw error
        await wait(delay)
        continue
      }
      if (!fresh || (member && !sameMember(fresh.member, member))) {
        refused = true
        throw new TokenRefused()
      }
      expiresAt = Date.parse(fresh.expiresAt)
      return fresh.token
    }
  }
  function next() {
    if (refused) return Promise.reject(new TokenRefused())
    fetching ??= fetchPatiently().finally(() => {
      fetching = null
    })
    return fetching
  }

  return next
}
