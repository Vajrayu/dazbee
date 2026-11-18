import { type ClassValue, clsx } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/** The named text sizes from tokens.css (`text-label`, `text-title`), so merging knows them for sizes, not colours. */
export const TEXT_SIZES = [
  'micro',
  'tiny',
  'caption',
  'label',
  'small',
  'body',
  'card',
  'lead',
  'heading',
  'heading-lg',
  'title',
  'display',
] as const

const merge = extendTailwindMerge({ extend: { theme: { text: [...TEXT_SIZES] } } })

/** Joins class names, letting later Tailwind classes win over earlier ones. */
export const cn = (...classes: ClassValue[]) => merge(clsx(classes))
