// The UI's typefaces, served from our own files: Geist for text, Bricolage Grotesque for the display
// role, Geist Mono for numbers, Noto Naskh Arabic for Arabic, which Geist doesn't draw. The latin
// faces take no metric fallback: next/font draws one in Arial, which would take Arabic from Noto.
import localFont from 'next/font/local'

const geist = localFont({
  src: [
    { path: '../node_modules/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2', weight: '100 900' },
    { path: '../node_modules/@fontsource-variable/geist/files/geist-latin-ext-wght-normal.woff2', weight: '100 900' },
  ],
  variable: '--font-geist',
  display: 'swap',
  adjustFontFallback: false,
})

const bricolage = localFont({
  src: [
    {
      path: '../node_modules/@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-wght-normal.woff2',
      weight: '200 800',
    },
    {
      path: '../node_modules/@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-ext-wght-normal.woff2',
      weight: '200 800',
    },
  ],
  variable: '--font-bricolage',
  display: 'swap',
  adjustFontFallback: false,
})

const geistMono = localFont({
  src: [
    {
      path: '../node_modules/@fontsource-variable/geist-mono/files/geist-mono-latin-wght-normal.woff2',
      weight: '100 900',
    },
    {
      path: '../node_modules/@fontsource-variable/geist-mono/files/geist-mono-latin-ext-wght-normal.woff2',
      weight: '100 900',
    },
  ],
  variable: '--font-geist-mono',
  display: 'swap',
  adjustFontFallback: false,
})

const notoArabic = localFont({
  src: [
    { path: '../../../packages/fonts/files/NotoNaskhArabic-Regular.ttf', weight: '400' },
    { path: '../../../packages/fonts/files/NotoNaskhArabic-Bold.ttf', weight: '700' },
  ],
  variable: '--font-noto-arabic',
  display: 'swap',
})

export const fontVariables = [geist, bricolage, geistMono, notoArabic].map((f) => f.variable).join(' ')
