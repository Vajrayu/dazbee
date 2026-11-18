// The app's vendored files, each loaded once per page: CanvasKit, for the editor, the version viewer
// and the export worker, and the fonts we ship.
import type { CanvasKit } from '@dazbee/canvaskit'
import canvasKitModule from '@dazbee/canvaskit'
import { WASM_FILE } from '@dazbee/canvaskit/wasm'
import { FONT_FACES } from '@dazbee/fonts'

// CommonJS whose types claim an ES default export; the bundler hands over the init function itself.
const CanvasKitInit = canvasKitModule as unknown as typeof import('@dazbee/canvaskit').default

/** CanvasKit and the fonts we ship, loading or loaded; a load that failed is tried again on the next ask. */
let canvasKit: Promise<CanvasKit> | undefined
let fonts: Promise<{ family: string; bytes: Uint8Array }[]> | undefined

/** Loads CanvasKit, its WebAssembly file from the app's `/vendor/`; the editor and the version viewer share it. */
export function loadCanvasKit(): Promise<CanvasKit> {
  canvasKit ??= CanvasKitInit({
    locateFile: (file: string) => `/vendor/${file === 'canvaskit.wasm' ? WASM_FILE : file}`,
  }).catch((error: unknown) => {
    canvasKit = undefined
    throw error
  })
  return canvasKit
}

/** The fonts we ship, from the app's `/vendor/fonts/`. */
export function shippedFonts() {
  fonts ??= Promise.all(
    FONT_FACES.map(async (f) => ({ family: f.family, bytes: await fetchBytes(`/vendor/fonts/${f.file}`) })),
  ).catch((error: unknown) => {
    fonts = undefined
    throw error
  })
  return fonts
}

async function fetchBytes(url: string) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: ${res.status}`)
  return new Uint8Array(await res.arrayBuffer())
}
