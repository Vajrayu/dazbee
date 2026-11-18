'use client'

import { useRouter } from 'next/navigation'

import { SEGMENT, SEGMENTS } from '@/components/ui/looks.ts'
import { Radio, RadioGroup } from '@/components/ui/radio-group.tsx'
import { useLocale, useMessages } from '@/lib/i18n/client.tsx'
import { type Locale, LOCALE_NAMES, LOCALES } from '@/lib/i18n/index.ts'

/** Picks the UI language, each named in itself; Arabic mirrors the whole UI. On a phone each is a touch target. */
export function LocaleSwitch() {
  const locale = useLocale()
  const t = useMessages().language
  const router = useRouter()
  function choose(next: Locale) {
    document.cookie = `locale=${next}; path=/; max-age=31536000; samesite=lax`
    router.refresh()
  }
  return (
    <RadioGroup label={t.label} options={LOCALES} value={locale} onPick={choose} className={SEGMENTS}>
      {LOCALES.map((l) => (
        <Radio key={l} value={l} lang={l} className={SEGMENT}>
          {LOCALE_NAMES[l]}
        </Radio>
      ))}
    </RadioGroup>
  )
}
