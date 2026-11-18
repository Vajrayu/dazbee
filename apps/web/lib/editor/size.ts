// Sizes as the app writes them and as they are typed, the size of the frame you are on, and a
// layer's width or height as a patch: with the ratio kept, the other side follows by the same
// factor, rounded as the fields show it, or to whole pixels for a frame; a box with a side of 0 has
// no ratio, so only that side changes. And what is typed into a number field: arithmetic, or an
// edit relative to the value it has.
import type { Editor } from '@dazbee/editor'
import {
  BLANK_SIZE,
  coverFrame,
  type DesignInput,
  framesOf,
  ratioLocked,
  type SizeIssue,
  sizeIssue,
} from '@dazbee/schema'

import { LIMITS } from './limits.ts'

type Box = { width: number; height: number }
type Axis = keyof Box

/** A side of a typed size that keeps it from being a frame's size, and why. */
export interface SideIssue {
  side: Axis
  issue: SizeIssue
}

/**
 * What text typed into a number field asks for: a value to set, an amount to shift the value by, or
 * a factor to scale it by. Where the layers don't share a value, a shift or a scale moves each one's own.
 */
export type Typed = { set: number } | { shift: number } | { scale: number }

/** What a number field writes: one value for every layer, or a change to make to each layer's own. */
export type FieldEdit = { set: number } | { each: (now: number) => number }

/** A number field's limits, in the value stored, and how many times that value it shows. */
export interface FieldLimits {
  scale?: number
  min?: number
  max?: number
}

/** Typed arithmetic being read: its text, and how far in the reading is. */
interface Reader {
  text: string
  at: number
}

/** Arabic-Indic and Persian digits: each run starts at a multiple of 16, so a digit's code modulo 16 is its value. */
const EASTERN_DIGITS = /[\u0660-\u0669\u06F0-\u06F9]/g
/** The Arabic decimal separator, which Persian uses too. */
const ARABIC_DECIMAL = '\u066B'
/** A side as typed, once in Latin digits: digits with at most one decimal point. */
const DIGITS = /^(?=\.?\d)\d*\.?\d*$/
/** A number as typed arithmetic starts with it: digits with a point or a comma, then its exponent when it has one. */
const NUMBER = /^([\d.,]*)(e[+-]?\d+)?/i
/** How deep brackets and minus signs nest in typed arithmetic, at most. */
const MAX_DEPTH = 32
/** A unit after a number in typed arithmetic: letters, a degree or a percent sign, after spaces or not. */
const UNIT = /^\s*[A-Za-z°%]+/

/**
 * The width or height typed into Position for one layer, as a patch: the side typed, and the side
 * its Lock ratio moves where that changes. The longer side stops where a typed side would
 * (`LIMITS.any`), the other with it while the ratio is locked.
 */
export function sizePatch(now: Box & { lockRatio?: unknown }, axis: Axis, to: number): Partial<Box> {
  const sized = sizeTo(now, axis, to, ratioLocked(now))
  const longest = Math.max(...Object.values(sized))
  const shrink = longest > LIMITS.any ? LIMITS.any / longest : 1
  return Object.fromEntries(
    Object.entries(sized)
      .map(([side, v]) => [side, Object.keys(sized).length > 1 ? tidy(v * shrink) : Math.min(v, LIMITS.any)] as const)
      .filter(([side, v]) => side === axis || v !== now[side as Axis]),
  )
}

/**
 * A box's size with one side set to `to`: with the ratio kept, the other side moves by the same
 * factor, rounded to hundredths as the fields show it; a box with a side of 0 has no ratio, so only
 * the side typed is given. With `whole`, every side given is rounded to whole pixels, the side typed
 * first, as a frame takes them.
 */
export function sizeTo(
  now: Box,
  axis: Axis,
  typed: number,
  keepRatio: boolean,
  { whole = false }: { whole?: boolean } = {},
): Partial<Box> {
  const other: Axis = axis === 'width' ? 'height' : 'width'
  const round = whole ? Math.round : tidy
  const to = whole ? Math.round(typed) : typed
  if (!keepRatio || now.width <= 0 || now.height <= 0) return { [axis]: to }
  return { [axis]: to, [other]: round((now[other] * to) / now[axis]) }
}

/**
 * A size typed into a width and a height field: null while either is empty, else its numbers and,
 * for each side that keeps it from being a frame's size, that side and why (`sizeIssue`). A side
 * is digits (Latin, Arabic or Persian) with at most one decimal point; anything else, a sign, an
 * exponent or a letter, reads as not whole. With both sides within the limits, a size longer than
 * the ratio allows names its long side.
 */
export function typedSize(width: string, height: string): (Box & { issues: SideIssue[] }) | null {
  const w = sideOf(width)
  const h = sideOf(height)
  if (w === null || h === null) return null
  const issues: SideIssue[] = []
  for (const [side, n] of [
    ['width', w],
    ['height', h],
  ] as const) {
    const issue = sizeIssue(n, n)
    if (issue) issues.push({ side, issue })
  }
  const ratio = issues.length === 0 && sizeIssue(w, h)
  if (ratio) issues.push({ side: w > h ? 'width' : 'height', issue: ratio })
  return { width: w, height: h, issues }
}

/**
 * The size of the frame you are on, which Add page and Add a frame start a new frame at: the picked
 * frame's, else that of the frame the selection is in, else the shown page's first frame's, else
 * the cover frame's, else a blank design's.
 */
export function sizeYouAreOn(
  editor: Pick<Editor, 'pickedFrame' | 'selectedFrame' | 'shownPage'>,
  design: Pick<DesignInput, 'pages' | 'frames'>,
): Box {
  const on = [editor.pickedFrame(), editor.selectedFrame()].find(
    (id) => id !== null && Object.hasOwn(design.frames, id),
  )
  const frame =
    (on ? design.frames[on] : undefined) ??
    framesOf(design, editor.shownPage())[0]?.[1] ??
    coverFrame(design)?.[1] ??
    BLANK_SIZE
  return { width: frame.width, height: frame.height }
}

/**
 * A size as the app writes it, in numerals that read the same in every locale. The chrome shows it
 * through `SizeText`, isolated left to right, so it reads width × height in Arabic too.
 */
export function sizeOf({ width, height }: Box) {
  return `${width} × ${height}`
}

/** A size as a chip shows it, short. */
export function shortSizeOf({ width, height }: Box) {
  return `${width}×${height}`
}

/** A number rounded to hundredths, as the fields show it. */
export function tidy(n: number) {
  return Math.round(n * 100) / 100
}

/** Text with its Arabic-Indic and Persian digits as Latin ones and the Arabic decimal separator as a point. */
export function latinDigits(text: string) {
  return text.replace(EASTERN_DIGITS, (d) => String(d.charCodeAt(0) % 16)).replaceAll(ARABIC_DECIMAL, '.')
}

/**
 * What text typed into a number field asks for: arithmetic with `+ - * /` and brackets, multiplying
 * and dividing first, its numbers in Latin, Arabic or Persian digits with a point or a comma as the
 * decimal mark and an exponent or none (1e3), each with any unit after it (px, °, %) skipped. Text that starts with `+` shifts the
 * value by the rest, and with `*` or `/` scales it; a leading `-` is a negative number to set. Null
 * for text it can't read, a division by zero and an empty field, which leave the value as it was.
 */
export function parseTyped(text: string): Typed | null {
  const typed = latinDigits(text).trim()
  const lead = typed[0]
  const relative = lead === '+' || lead === '*' || lead === '/'
  const n = arithmetic(relative ? typed.slice(1) : typed)
  if (n === null) return null
  if (lead === '+') return { shift: n }
  if (lead === '*') return { scale: n }
  if (lead === '/') return n === 0 ? null : { scale: 1 / n }
  return { set: n }
}

/**
 * What a number field writes for an edit, typed or made by a step or a scrub (a shift), in the value
 * as the field shows it, `scale` times the value stored: a value to set every layer to, or the change
 * to make to each layer's own. Either is held between `min` and `max`, in the value stored.
 */
export function fieldEdit(
  typed: Typed,
  { scale = 1, min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY }: FieldLimits = {},
): FieldEdit {
  const held = (n: number) => Math.min(max, Math.max(min, n))
  if ('set' in typed) return { set: held(typed.set / scale) }
  if ('shift' in typed) return { each: (now) => held(now + typed.shift / scale) }
  return { each: (now) => held(now * typed.scale) }
}

/**
 * The change an edit of the Text tab's size makes to each text's own size, set, shifted or scaled
 * alike: held between 1 and `LIMITS.fontSize`, then rounded to tenths, as the field shows it.
 */
export function fontSizeChange(typed: Typed): (now: number) => number {
  const edit = fieldEdit(typed, { min: 1, max: LIMITS.fontSize })
  return (now) => Math.round(('set' in edit ? edit.set : edit.each(now)) * 10) / 10
}

/** A side as typed: null when empty, its number when it is digits with at most one decimal point, else NaN. */
function sideOf(text: string): number | null {
  const latin = latinDigits(text.trim())
  if (!latin) return null
  return DIGITS.test(latin) ? Number(latin) : Number.NaN
}

/** The number arithmetic works out to; null when it can't be read whole, or isn't a finite number. */
function arithmetic(text: string): number | null {
  const reader = { text, at: 0 }
  const n = sumOf(reader, 0)
  skipSpace(reader)
  return n !== null && reader.at === text.length && Number.isFinite(n) ? n : null
}

/** Sums and differences of products. */
function sumOf(reader: Reader, depth: number): number | null {
  let n = productOf(reader, depth)
  while (n !== null) {
    if (eat(reader, '+')) n = plus(n, productOf(reader, depth))
    else if (eat(reader, '-')) n = plus(n, negated(productOf(reader, depth)))
    else return n
  }
  return null
}

/** Moves the reading past the spaces at its place. */
function skipSpace(reader: Reader) {
  while (/\s/.test(reader.text[reader.at] ?? '')) reader.at += 1
}

/** Products and quotients of factors; null for a division by zero. */
function productOf(reader: Reader, depth: number): number | null {
  let n = factorOf(reader, depth)
  while (n !== null) {
    if (eat(reader, '*')) {
      const by = factorOf(reader, depth)
      n = by === null ? null : n * by
    } else if (eat(reader, '/')) {
      const by = factorOf(reader, depth)
      n = by === null || by === 0 ? null : n / by
    } else return n
  }
  return null
}

/** Moves the reading past its spaces, then past `char` when it comes next; whether it did. */
function eat(reader: Reader, char: string) {
  skipSpace(reader)
  if (reader.text[reader.at] !== char) return false
  reader.at += 1
  return true
}

/** `n` plus `by`; null without `by`. */
function plus(n: number, by: number | null) {
  return by === null ? null : n + by
}

/** `n` with its sign turned; null without `n`. */
function negated(n: number | null) {
  return n === null ? null : -n
}

/** A number with its unit, a bracketed sum, or either after a minus; null past `MAX_DEPTH` deep. */
function factorOf(reader: Reader, depth: number): number | null {
  if (depth > MAX_DEPTH) return null
  if (eat(reader, '-')) return negated(factorOf(reader, depth + 1))
  if (eat(reader, '(')) {
    const n = sumOf(reader, depth + 1)
    return n !== null && eat(reader, ')') ? n : null
  }
  const [number = '', digits = '', exponent = ''] = NUMBER.exec(reader.text.slice(reader.at)) ?? []
  reader.at += number.length
  const latin = digits.replace(',', '.')
  if (!DIGITS.test(latin)) return null
  // Its unit, after a space or not (px, pt, °, %), is skipped.
  const unit = UNIT.exec(reader.text.slice(reader.at))?.[0] ?? ''
  reader.at += unit.length
  return Number(latin + exponent)
}
