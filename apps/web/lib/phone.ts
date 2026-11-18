import { useLayoutEffect, useState } from 'react'

/**
 * Under 640 px wide the editor is laid out for a phone: the edit panel is a sheet across the
 * screen, and the flyouts' buttons are in the tab bar. Read before the first paint, so a menu that opens on a phone,
 * as the right-click menu does, never shows a frame laid out for a wider screen first.
 */
export function usePhone() {
  const [phone, setPhone] = useState(false)
  useLayoutEffect(() => {
    // The same query as Tailwind's max-sm, so the script and the styles agree at a fractional width.
    const query = window.matchMedia('(width < 40rem)')
    const update = () => setPhone(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return phone
}
