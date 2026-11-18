'use client'

import { SEGMENT, SEGMENTS } from '@/components/ui/looks.ts'
import { Radio, RadioGroup } from '@/components/ui/radio-group.tsx'
import { useMessages } from '@/lib/i18n/client.tsx'
import { type ThemePick, THEMES } from '@/lib/theme.ts'
import { useThemePick } from '@/lib/theme-pick.tsx'

declare global {
  interface Window {
    __applyTheme?: () => void
  }
}

/** System, light or dark; only the tokens change. On a phone each is a touch target. */
export function ThemeSwitch() {
  const t = useMessages().theme
  const [pick, setPick] = useThemePick()

  function choose(next: ThemePick) {
    document.cookie = `theme=${next}; path=/; max-age=31536000; samesite=lax`
    setPick(next)
    if (next === 'system') delete document.documentElement.dataset.theme
    window.__applyTheme?.()
  }

  return (
    <RadioGroup label={t.label} options={THEMES} value={pick} onPick={choose} className={SEGMENTS}>
      {THEMES.map((theme) => (
        <Radio key={theme} value={theme} className={SEGMENT}>
          {t[theme]}
        </Radio>
      ))}
    </RadioGroup>
  )
}
