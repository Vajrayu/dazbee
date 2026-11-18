// The rows the font chooser lists: the families a search and a category chip keep, under three
// headings in order (the brand's fonts, the ones used last, then all), the chosen family's weights
// under it, and how the arrow keys move between them.
import { byCodeUnits, type FontFamily } from '@dazbee/schema'

import { categoryOf, type FontCategory, nearest, weightsOf } from '@/components/brand-kit/font-catalog.ts'

/** The chooser's groups, in the order it lists them. */
export type FontGroup = 'brand' | 'recent' | 'all'

/** One row of the chooser: a group's heading, a family, or one weight of the chosen family under it. */
export type FontRow =
  | { kind: 'heading'; key: string; group: FontGroup }
  | { kind: 'family'; key: string; group: FontGroup; family: FontFamily }
  | { kind: 'weight'; key: string; group: FontGroup; family: FontFamily; weight: number }

/** What the chooser keeps: the families whose name holds every word of `query`, of `category` when one is on. */
export interface FontFilter {
  query: string
  category: FontCategory | null
}

/** The selected texts' family and weight, each null where they differ. */
export interface ChosenFont {
  family: string | null
  weight: number | null
}

const GROUPS: readonly FontGroup[] = ['brand', 'recent', 'all']

/**
 * The chooser's rows for a catalog: the brand's uploads, then the families `recent` names (newest
 * first, those the catalog has and the brand's fonts don't), then every other family by name; each
 * group that keeps a family under its heading, and the chosen family's weights under it.
 */
export function fontRows(
  catalog: readonly FontFamily[],
  filter: FontFilter,
  recent: readonly string[],
  chosen: ChosenFont,
): FontRow[] {
  const brand = catalog.filter((family) => family.source === 'upload')
  const others = catalog.filter((family) => family.source !== 'upload')
  const groups: Record<FontGroup, FontFamily[]> = {
    brand,
    recent: recent.flatMap((name) => {
      const family = others.find((one) => one.family === name)
      return family ? [family] : []
    }),
    all: [...others].sort((a, b) => byCodeUnits(a.family, b.family)),
  }
  const kept = keeps(filter)
  return GROUPS.flatMap((group) => {
    const families = groups[group].filter(kept)
    if (families.length === 0) return []
    return [
      { kind: 'heading', key: group, group } as const,
      ...families.flatMap((family): FontRow[] => [
        { kind: 'family', key: `${group} ${family.family}`, group, family },
        ...(family.family === chosen.family ? weightChoices(family, chosen.weight) : []).map((weight): FontRow => ({
          kind: 'weight',
          key: `${group} ${family.family} ${weight}`,
          group,
          family,
          weight,
        })),
      ]),
    ]
  })
}

/**
 * The key of the family or weight `step` rows on from the one keyed `key`, past the headings, or the
 * first family when no row is; it stops at either end. Null in a list with no family.
 */
export function stepActive(rows: readonly FontRow[], key: string | null, step: 1 | -1): string | null {
  const options = rows.filter((row) => row.kind !== 'heading')
  const at = options.findIndex((row) => row.key === key)
  if (at === -1) return options[0]?.key ?? null
  return options[Math.min(Math.max(at + step, 0), options.length - 1)]?.key ?? null
}

/** The font a pick sets: the family, in the weight it has nearest the text's (Regular when they differ). */
export function fontPick(family: FontFamily, weight: number | null): { family: string; weight: number | undefined } {
  const weights = weightsOf(family)
  return { family: family.family, weight: weights.length > 0 ? nearest(weights, weight ?? 400) : undefined }
}

/**
 * The weights the chosen family offers: none for a family of one weight, else its weights with the
 * text's own among them, as a variable font's 450 that the family doesn't list.
 */
function weightChoices(family: FontFamily, weight: number | null): number[] {
  const weights = weightsOf(family)
  if (weights.length < 2) return []
  return weight === null || weights.includes(weight) ? weights : [...weights, weight].sort((a, b) => a - b)
}

/** Whether a family's name holds every word of the filter's query, in any case, and it is of the chip's category. */
function keeps({ query, category }: FontFilter) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  return (family: FontFamily) =>
    (category === null || categoryOf(family) === category) &&
    words.every((word) => family.family.toLowerCase().includes(word))
}
