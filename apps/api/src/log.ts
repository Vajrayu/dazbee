// The API's log: one JSON line on stdout for each unexpected error and each sign-in it refuses or can't
// finish, which `docker logs` shows. An error's text loses its email addresses and a failed query's values,
// and no caller passes a code, token or email in a line's fields.

/** A value a log line may hold. */
export type LogValue = string | number | boolean | null

/** How many lines of an error's stack a line keeps. */
const STACK_LINES = 8

/** Anything shaped like an email address. */
const EMAIL = /[^\s@"'<>(),;:]+@[^\s@"'<>(),;:]+\.[^\s@"'<>(),;:]+/g

/** A failed query's values, which Drizzle adds to its message after `params:`. */
const QUERY_VALUES = /\bparams:[\s\S]*$/

/** Writes the event with its fields as one line on stdout. */
export function logEvent(event: string, fields: Record<string, LogValue | undefined> = {}): void {
  console.log(JSON.stringify({ event, ...fields }))
}

/** Writes an unexpected error as one line: its kind, message, cause and stack, without personal data. */
export function logError(event: string, e: unknown, fields: Record<string, LogValue | undefined> = {}): void {
  logEvent(event, { ...fields, ...describeError(e) })
}

/** The error's kind, message, cause and the top of its stack, with emails and a query's values taken out. */
function describeError(e: unknown): Record<string, string> {
  if (!(e instanceof Error)) return { error: scrub(String(e)) }
  // Only the frames: the stack begins with the message, which may run over several lines.
  const stack = e.stack
    ?.split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('at '))
    .slice(0, STACK_LINES)
  return {
    error: `${e.name}: ${scrub(e.message)}`,
    ...(e.cause === undefined ? {} : { cause: describeError(e.cause).error ?? '' }),
    ...(stack?.length ? { stack: scrub(stack.join(' | ')) } : {}),
  }
}

function scrub(text: string): string {
  return text.replace(QUERY_VALUES, 'params: <left out>').replace(EMAIL, '<email>')
}
