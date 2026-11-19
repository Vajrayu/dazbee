// Writes each error a request met on the server as one JSON line on stdout, which `docker logs` shows: the
// route, the path without its query (which may hold a sign-in's code or an invite's token), the error's kind
// and its digest. Its message, which may hold personal data, is left out; Next prints the error itself on
// stderr with the same digest.
import 'server-only'

import type { Instrumentation } from 'next'

export const onRequestError: Instrumentation.onRequestError = (error, request, context) => {
  const failure = error instanceof Error ? (error as Error & { digest?: unknown }) : null
  console.log(
    JSON.stringify({
      event: 'request-error',
      method: request.method,
      path: request.path.split('?')[0],
      route: context.routePath,
      kind: context.routeType,
      error: failure?.name ?? typeof error,
      digest: typeof failure?.digest === 'string' ? failure.digest : null,
    }),
  )
}
