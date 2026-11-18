// The paths of a workspace's pages and of the app's own route handlers below its brands, and the
// browser's reading of a route's answer as JSON or as the error it gives.
import { ApiError } from '@dazbee/schema'

/** A route's refusal: its status, and the text of its `{ error }` body, or the status when it has none. */
export class RouteError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'RouteError'
    this.status = status
  }

  /** The error of an answer that isn't ok, from its status and its body read as JSON (null when it isn't JSON). */
  static fromBody(status: number, body: unknown) {
    return new RouteError(status, ApiError.safeParse(body).data?.error ?? String(status))
  }
}

/** The path of a workspace's page, `/w/<workspace>/<segment>/…`, with the workspace and each segment encoded. */
export function workspacePath(workspaceId: string, ...segments: string[]): string {
  return ['', 'w', workspaceId, ...segments].map((part) => encodeURIComponent(part)).join('/')
}

/** The path of a brand's page or route, `/w/<workspace>/brands/<brand>/<segment>/…`, each part encoded. */
export function brandPath(workspaceId: string, brandId: string, ...segments: string[]): string {
  return workspacePath(workspaceId, 'brands', brandId, ...segments)
}

/** A route's answer read as JSON, null when it isn't JSON; a `RouteError` when the answer isn't ok. */
export async function readJson<T = unknown>(response: Response): Promise<T> {
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) throw RouteError.fromBody(response.status, body)
  return body as T
}
