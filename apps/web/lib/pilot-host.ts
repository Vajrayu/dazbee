// The pilot host: the address early access's admin page is served at, pilot.dazbee.com in production, set
// as PILOT_HOST (with its port, for a local run). On it, `/` shows the page at app/pilot/; on any other host,
// that page is not found. No PILOT_HOST, no pilot host.

/** The path of the admin page, which the pilot host's `/` shows. */
export const PILOT_PATH = '/pilot'

/** Whether `host`, a request's Host header, is the pilot host `PILOT_HOST` names. */
export function isPilotHost(host: string | null | undefined, pilotHost = process.env.PILOT_HOST): boolean {
  const wanted = pilotHost?.trim().toLowerCase()
  return Boolean(wanted && host?.trim().toLowerCase() === wanted)
}

/** The path a request to `path` on `host` is served from: `/` on the pilot host is the admin page. */
export function pilotPath(path: string, host: string | null | undefined, pilotHost = process.env.PILOT_HOST) {
  return path === '/' && isPilotHost(host, pilotHost) ? PILOT_PATH : path
}
