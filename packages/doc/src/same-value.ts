/** Whether two property values are the same, as plain data: numbers, strings, arrays and objects. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const [one, other] = [a as Record<string, unknown>, b as Record<string, unknown>]
  const keys = Object.keys(one).filter((key) => one[key] !== undefined)
  if (keys.length !== Object.keys(other).filter((key) => other[key] !== undefined).length) return false
  return keys.every((key) => sameValue(one[key], other[key]))
}
