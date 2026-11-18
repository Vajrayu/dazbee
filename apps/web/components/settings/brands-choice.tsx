'use client'

// The brands an Editor or Reviewer may see: All brands, or the brands ticked. In the Invite form it is a
// choice of the two with the workspace's brands as chips to tick under Chosen brands (`BrandsChoice`); on a
// member's row it is their brands' names as a button that opens the same choice in a menu, kept by Save
// (`BrandsMenu`), since a member who loses a brand has their open design closed at its next token renewal.
import { useState } from 'react'

import type { BrandSummary, MemberBrands } from '@dazbee/schema'

import { buttonStyles } from '@/components/ui/button.tsx'
import { CaretDownIcon, CheckIcon } from '@/components/ui/icons.tsx'
import { SEGMENT, SEGMENTS } from '@/components/ui/looks.ts'
import { Menu, MenuCheck, MenuDivider, MenuItem, MenuRadio, MenuRadios } from '@/components/ui/menu.tsx'
import { Radio, RadioGroup } from '@/components/ui/radio-group.tsx'
import { Tick } from '@/components/ui/tick.tsx'
import { cn } from '@/lib/cn.ts'
import { useMessages } from '@/lib/i18n/client.tsx'
import { format } from '@/lib/i18n/index.ts'

/** A choice of brands: every brand, or those ticked, kept while every brand is picked so they come back. */
export interface BrandsPick {
  all: boolean
  ticked: string[]
}

/** Every brand, or the two choices of the brands choice. */
const MODES = ['all', 'chosen'] as const

/** The pick a member's brands make, every brand for null. */
const pickOf = (brandIds: MemberBrands): BrandsPick =>
  brandIds ? { all: false, ticked: brandIds } : { all: true, ticked: [] }

/** The brands a pick gives: null for every brand, else those ticked. */
const brandIdsOf = (pick: BrandsPick): MemberBrands => (pick.all ? null : pick.ticked)

/** Whether two choices of brands give the same brands, in whatever order. */
const sameBrands = (a: MemberBrands, b: MemberBrands) =>
  a === null || b === null ? a === b : a.length === b.length && a.every((id) => b.includes(id))

/** The pick with the brand ticked or not, in the order of `brands`. */
const toggled = (pick: BrandsPick, brands: BrandSummary[], brandId: string): BrandsPick => ({
  all: false,
  ticked: brands
    .map((brand) => brand.id)
    .filter((id) => (id === brandId ? !pick.ticked.includes(id) : pick.ticked.includes(id))),
})

/** The words a member's brands go by: All brands, their names, or No brands. */
export function brandsLabel(
  brandIds: MemberBrands,
  brands: BrandSummary[],
  words: { all: string; none: string; comma: string },
) {
  if (!brandIds) return words.all
  const names = brands.filter((brand) => brandIds.includes(brand.id)).map((brand) => brand.name)
  return names.length > 0 ? names.join(words.comma) : words.none
}

/** The brands choice in the Invite form: All brands or Chosen brands, and under Chosen the brands to tick. */
export function BrandsChoice({
  brands,
  pick,
  onPick,
}: {
  brands: BrandSummary[]
  pick: BrandsPick
  onPick: (pick: BrandsPick) => void
}) {
  const b = useMessages().settings.brands
  return (
    <div className="flex flex-col gap-2" data-testid="brands-choice">
      <RadioGroup
        label={b.label}
        options={MODES}
        value={pick.all ? 'all' : 'chosen'}
        onPick={(mode) => onPick({ ...pick, all: mode === 'all' })}
        className={cn(SEGMENTS, 'self-start')}
      >
        <Radio value="all" className={cn(SEGMENT, 'h-9 px-3')}>
          {b.all}
        </Radio>
        <Radio value="chosen" className={cn(SEGMENT, 'h-9 px-3')}>
          {b.chosen}
        </Radio>
      </RadioGroup>
      {!pick.all && (
        <div role="group" aria-label={b.chosen} className="flex flex-wrap gap-1.5">
          {brands.map((brand) => {
            const on = pick.ticked.includes(brand.id)
            return (
              <button
                key={brand.id}
                type="button"
                aria-pressed={on}
                data-brand={brand.id}
                onClick={() => onPick(toggled(pick, brands, brand.id))}
                className={cn(SEGMENT, 'flex h-9 max-w-64 items-center gap-1.5 bg-well px-3')}
              >
                {on && <CheckIcon size={14} weight="bold" aria-hidden className="shrink-0" />}
                <span className="truncate">{brand.name}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/**
 * A member's brands on their row: their names as a button that opens All brands, Chosen brands and,
 * under Chosen, each brand to tick, then Save while the pick differs from theirs. Save is greyed, saying
 * why, while Chosen brands has none ticked.
 */
export function BrandsMenu({
  brands,
  brandIds,
  name,
  busy,
  onSave,
}: {
  /** The workspace's brands. */
  brands: BrandSummary[]
  /** The member's brands now. */
  brandIds: MemberBrands
  /** The member's name, for the menu's label. */
  name: string
  busy: boolean
  onSave: (brandIds: MemberBrands) => void
}) {
  const s = useMessages().settings
  const b = s.brands
  const [open, setOpen] = useState(false)
  const [pick, setPick] = useState(() => pickOf(brandIds))
  const label = format(b.of, { name })
  const shown = brandsLabel(brandIds, brands, b)
  const next = brandIdsOf(pick)
  const changed = !sameBrands(next, brandIds)
  return (
    <Menu
      trigger={
        <button
          type="button"
          disabled={busy}
          aria-label={`${label}: ${shown}`}
          data-testid="member-brands"
          className={cn(
            buttonStyles({ variant: 'ghost', size: 'md' }),
            'h-8 max-w-56 gap-1 px-2.5 text-label font-medium text-muted hover:text-text',
          )}
        >
          <span className="truncate">{shown}</span>
          <CaretDownIcon size={12} weight="bold" aria-hidden className="shrink-0" />
        </button>
      }
      open={open}
      onOpenChange={(opening) => {
        // Each opening starts from the member's brands as they are now.
        if (opening) setPick(pickOf(brandIds))
        setOpen(opening)
      }}
      label={label}
      place={{ side: 'bottom', align: 'end', sideOffset: 6, collisionPadding: 12 }}
      className="w-64"
    >
      <MenuRadios
        value={pick.all ? 'all' : 'chosen'}
        label={label}
        onValueChange={(mode) => setPick({ ...pick, all: mode === 'all' })}
      >
        {MODES.map((mode) => (
          <MenuRadio key={mode} value={mode} label={b[mode]} stayOpen data-mode={mode}>
            {b[mode]}
            <CheckIcon size={14} aria-hidden className="invisible ms-auto shrink-0 group-aria-checked:visible" />
          </MenuRadio>
        ))}
      </MenuRadios>
      {!pick.all && (
        <>
          <MenuDivider />
          {brands.map((brand) => (
            <MenuCheck
              key={brand.id}
              label={brand.name}
              checked={pick.ticked.includes(brand.id)}
              onCheckedChange={() => setPick(toggled(pick, brands, brand.id))}
              mark={
                <span className="ms-auto">
                  <Tick on={pick.ticked.includes(brand.id)} />
                </span>
              }
            />
          ))}
        </>
      )}
      {changed && (
        <>
          <MenuDivider />
          <MenuItem
            label={s.save}
            why={next?.length === 0 ? b.noneChosen : null}
            testId="member-brands-save"
            onSelect={() => onSave(next)}
          />
        </>
      )}
    </Menu>
  )
}
