// Cloudflare Turnstile's check on a request to join: the token the form's widget gave, checked with
// Cloudflare's siteverify using the secret TURNSTILE_SECRET_KEY. With no secret there is no check.
import { logError } from '../log.ts'

/** Whether a Turnstile token is good; tests give a stand-in that never calls out. */
export type TurnstileCheck = (token: string, address: string | null) => Promise<boolean>

/** Cloudflare's address that checks a Turnstile token. */
export const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

/** How long Cloudflare may take to answer before the token counts as not good. */
const VERIFY_TIMEOUT_MS = 10_000

/** The check from `TURNSTILE_SECRET_KEY`, or null when it isn't set. */
export function turnstileCheck(env: NodeJS.ProcessEnv = process.env, url = SITEVERIFY_URL): TurnstileCheck | null {
  const secret = env.TURNSTILE_SECRET_KEY?.trim()
  return secret ? siteverify(secret, url) : null
}

/**
 * Checks a token with Cloudflare's siteverify at `url`, passing the person's address when known. A token
 * Cloudflare refuses, an answer that isn't a success, or no answer in time is not good.
 */
export function siteverify(secret: string, url = SITEVERIFY_URL): TurnstileCheck {
  return async (token, address) => {
    const form = new URLSearchParams({ secret, response: token })
    if (address) form.set('remoteip', address)
    try {
      const response = await fetch(url, { method: 'POST', body: form, signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS) })
      if (!response.ok) return false
      const answer = (await response.json()) as { success?: unknown }
      return answer.success === true
    } catch (e) {
      logError('turnstile-unreachable', e)
      return false
    }
  }
}
