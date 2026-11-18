// The other people in the design over the stage, each in their colour: their selected layers
// outlined and their picked frame, which the overlay puts under the tab's own selection; and their
// cursor, a notched dart edged in white with their name in a tag beside it, which it puts over
// everything but the loupe.
import type { ShownPerson } from '../presence.ts'
import type { Frame } from './frames.ts'
import { px } from './rulers.ts'

/** What `presenceParts` builds: the outlines, and the cursors. */
export interface PresenceParts {
  outlines: HTMLElement[]
  cursors: HTMLElement[]
}

/** The dart's outline, its tip at the pointer, pointing up and to the start. */
const DART = 'M0 0 L3.5 15.5 L7.5 8.5 L15.5 4 Z'
/** The dart's box, with room for its white edge. */
const DART_BOX = '-1 -1 18 18'
const SVG = 'http://www.w3.org/2000/svg'
/** A colour lighter than this, by its weighted mean of red, green and blue out of 255, takes dark text. */
const LIGHT = 170
const DARK_TEXT = '#1E1E1E'
const LIGHT_TEXT = '#FFFFFF'

/**
 * The parts of `people`: each one's layers outlined along their shape by `layerOutline` and their
 * picked frame by `frameOutline`, each given the person's colour as its colour, then each cursor.
 */
export function presenceParts(
  people: readonly ShownPerson[],
  layerOutline: (frame: Frame, id: string) => HTMLElement | null,
  frameOutline: (frame: Frame) => HTMLElement,
): PresenceParts {
  const outlines: HTMLElement[] = []
  const cursors: HTMLElement[] = []
  for (const person of people) {
    const theirs = [
      ...person.layers.flatMap(({ frame, id }) => layerOutline(frame, id) ?? []),
      ...(person.frame ? [frameOutline(person.frame)] : []),
    ]
    for (const el of theirs) {
      el.style.color = person.colour
      el.dataset.tab = String(person.tabId)
    }
    outlines.push(...theirs)
    if (person.cursor) cursors.push(cursorPart(person))
  }
  return { outlines, cursors }
}

/** The colour of text that reads on `colour`, a `#RRGGBB`. */
export function textOn(colour: string): string {
  const [r, g, b] = [1, 3, 5].map((at) => Number.parseInt(colour.slice(at, at + 2), 16))
  const light = 0.299 * (r ?? 0) + 0.587 * (g ?? 0) + 0.114 * (b ?? 0)
  return light > LIGHT ? DARK_TEXT : LIGHT_TEXT
}

/** A person's cursor at their pointer: the dart, and their name beside it. */
function cursorPart(person: ShownPerson): HTMLElement {
  const el = document.createElement('div')
  el.className = 'presence-cursor'
  el.dataset.tab = String(person.tabId)
  Object.assign(el.style, { left: px(person.cursor?.x ?? 0), top: px(person.cursor?.y ?? 0), color: person.colour })
  const svg = document.createElementNS(SVG, 'svg')
  svg.setAttribute('class', 'presence-dart')
  svg.setAttribute('viewBox', DART_BOX)
  const dart = document.createElementNS(SVG, 'path')
  dart.setAttribute('d', DART)
  svg.append(dart)
  const name = document.createElement('div')
  name.className = 'presence-name'
  name.textContent = person.name
  Object.assign(name.style, { background: person.colour, color: textOn(person.colour) })
  el.append(svg, name)
  return el
}
