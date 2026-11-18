# @dazbee/fonts

The font files Dazbee renders with. They are loaded from these bytes, never from the system or the browser, so Node and browser exports draw the same glyphs.

| Family               | Weights       | Version | Source                         |
| -------------------- | ------------- | ------- | ------------------------------ |
| Noto Sans            | 400, 700, 800 | 2.015   | notofonts/latin-greek-cyrillic |
| Noto Sans Devanagari | 400, 700      | 2.007   | notofonts/devanagari           |
| Noto Naskh Arabic    | 400, 700      | 2.021   | notofonts/arabic               |

The unhinted static TTFs were taken from `notofonts/notofonts.github.io` (`fonts/<Family>/unhinted/ttf/`) on 2026-10-30. They are under the SIL Open Font License 1.1, in `files/OFL.txt`.

To add a face, put its file in `files/` and add a row to `FONT_FACES` in `src/index.ts`.

## Google Fonts

`src/google.ts` lists the Google Fonts families Dazbee offers, with their weights: about 300 of the most-used, in Google Fonts' popularity order. Its comment says how a family is picked and which are left out; follow it when adding one. They are not in this package: `pnpm --filter @dazbee/api fonts:google` copies them from Google into our storage, with the API's settings, and from then on they load from there like a brand's uploads. Run it once per environment, and again after adding a family to the list. Name families to copy only those, as in `pnpm --filter @dazbee/api fonts:google Inter "Bebas Neue"`.

## Script fonts

`src/scripts.ts` lists the script fonts: Noto families text falls back to for characters its own font lacks, of a script we don't ship or colour emoji (Noto Color Emoji). They are Google Fonts families too, copied by the same `fonts:google` (name one, as in `fonts:google "Noto Color Emoji"`), stored without the SVG glyphs CanvasKit never draws, and loaded only for a design whose text has their characters. The font menu does not offer them. `FALLBACK_FAMILIES` stays the shipped three; each text tries them, then the script fonts its own characters need (`scriptFamilies`), emoji last.

`test-files/` holds a few glyphs of Noto Color Emoji (OFL, `test-files/OFL.txt`) for tests, read with `@dazbee/fonts/test-fonts`; nothing ships it.
