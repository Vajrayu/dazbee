// What a layer made from an element is called: the name a design tool wrote on it, else its id.

import type { XmlElement } from './xml.ts'

export function nameOf(element: XmlElement, fallback: string) {
  return element.attrs['data-name'] ?? element.attrs.label ?? element.attrs.id ?? fallback
}
