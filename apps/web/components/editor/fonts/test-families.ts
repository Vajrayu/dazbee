// A catalog of 300 Google families, 60 in each category, and two brand uploads, for the chooser's tests.
import type { FontFamily, FontSource } from '@dazbee/schema'

import { FONT_CATEGORIES, type FontCategory } from '@/components/brand-kit/font-catalog.ts'

/** A family of Regular and Bold in a category, from a source. */
export function testFamily(name: string, source: FontSource, category: FontCategory | null): FontFamily {
  return {
    family: name,
    source,
    category,
    faces: [400, 700].map((weight) => ({
      id: `${name}-${weight}`,
      family: name,
      weight,
      style: 'normal' as const,
      source,
      byteSize: 1,
    })),
  }
}

/**
 * Family 000 to Family 299, each named with its category (`Family 070 serif`): the first 60 sans
 * serif, then 60 serif, display, handwriting and monospace. Then two uploads, which have no category.
 */
export const TEST_CATALOG: readonly FontFamily[] = [
  ...Array.from({ length: 300 }, (_, i) => {
    const category = FONT_CATEGORIES[Math.floor(i / 60)] ?? 'sans-serif'
    return testFamily(`Family ${String(i).padStart(3, '0')} ${category}`, 'google', category)
  }),
  testFamily('Harbour Grotesk', 'upload', null),
  testFamily('Harbour Script', 'upload', null),
]
