// The families used last in a brand, which the font chooser lists after the brand's fonts: the
// last eight picked, newest first, kept per brand and per device in its storage, never in the
// design. Where the device refuses its storage they are kept for the visit only.

/** A device's storage, as much of it as is read and written; it may throw, as a blocked one does. */
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>

/** How many families a brand keeps. */
export const RECENT_FONTS_KEPT = 8

/** Where a brand's list is kept on the device. */
export const recentFontsKey = (brandId: string) => `dazbee.recentFonts.${brandId}`

/** The families used last in each brand, kept in the storage `storage` gives, or for the visit while it throws. */
export function recentFonts(storage: () => Storage) {
  /** Each brand's list the storage refused to keep. */
  const memory = new Map<string, string[]>()
  /** A brand's families, newest first. */
  function list(brandId: string): string[] {
    const kept = memory.get(brandId)
    if (kept) return kept
    try {
      return namesIn(storage().getItem(recentFontsKey(brandId)))
    } catch {
      return []
    }
  }
  /** Puts a family used in a brand first in its list. */
  function record(brandId: string, family: string) {
    const next = [family, ...list(brandId).filter((one) => one !== family)].slice(0, RECENT_FONTS_KEPT)
    try {
      storage().setItem(recentFontsKey(brandId), JSON.stringify(next))
      memory.delete(brandId)
    } catch {
      memory.set(brandId, next)
    }
  }
  return { list, record }
}

/** The family names a stored value holds, in order, each once, the first eight; whatever is no name is dropped. */
function namesIn(stored: string | null): string[] {
  let value: unknown
  try {
    value = JSON.parse(stored ?? '[]')
  } catch {
    return []
  }
  if (!Array.isArray(value)) return []
  const names = value.filter((one): one is string => typeof one === 'string' && one.length > 0)
  return [...new Set(names)].slice(0, RECENT_FONTS_KEPT)
}
