// Safe zones: the parts of a vertical ad that a platform's own interface covers (its profile, caption,
// buttons and call to action), as each platform publishes them for its 9:16 placements. Only a
// figure with a first-party source is kept, with the page or file it comes from.
import type { Rect } from './primitives.ts'

/** What one platform's interface covers along each edge of a 9:16 ad, as a share of the ad's height (top, bottom) or width (sides). */
export interface SafeZone {
  platform: string
  /** The placements the figures are published for. */
  placements: string
  top: number
  bottom: number
  left: number
  right: number
  /** The platform's own pages or files the figures are read from. */
  sources: readonly string[]
}

/** The choice of safe zones that shows every platform's together, where another choice names one platform. */
export const ALL_PLATFORMS = 'all'

/** The safe zones the editor shows: one for each platform that publishes its figures itself. */
export const SAFE_ZONES = [
  {
    platform: 'Meta',
    placements: 'Facebook Stories, Instagram Stories and Instagram Reels',
    // "Consider leaving roughly 14% of the top, 35% of the bottom and 6% on each side of your asset free
    // from text, logos or other key creative elements" (each page, 9:16 at 1440 × 2560).
    top: 0.14,
    bottom: 0.35,
    left: 0.06,
    right: 0.06,
    sources: [
      'https://www.facebook.com/business/ads-guide/update/image/instagram-reels',
      'https://www.facebook.com/business/ads-guide/update/image/instagram-story',
      'https://www.facebook.com/business/ads-guide/update/image/facebook-story',
    ],
  },
  {
    platform: 'YouTube',
    placements: 'Vertical video ads, Shorts among them',
    // Google's vertical video ads safe zone at 1080 × 1920: 288 px top, 672 px bottom, 48 px left, 192 px right.
    top: 288 / 1920,
    bottom: 672 / 1920,
    left: 48 / 1080,
    right: 192 / 1080,
    sources: [
      'https://support.google.com/google-ads/answer/13547298',
      'https://services.google.com/fh/files/misc/universalsafezones-youtube.pdf',
    ],
  },
  {
    platform: 'TikTok',
    placements: 'In-Feed ads, in the same full-screen feed as posts',
    // TikTok's In-Feed safe zone template, on a 720 × 1280 frame: 160 px top (the Following and For You
    // tabs and search), 440 px bottom (username, caption and sound), 80 px each side. Its button column
    // is not printed in the template, so it is left out.
    top: 160 / 1280,
    bottom: 440 / 1280,
    left: 80 / 720,
    right: 80 / 720,
    sources: [
      'https://ads.tiktok.com/help/article/tiktok-auction-in-feed-ads?lang=en',
      'https://lf-tt4b.tiktokcdn.com/obj/i18nblog/tt4b_cms/en-US/5jqet0ab9qci-10e7f5Vig4uhAscNP8XPB0.zip',
    ],
  },
] as const satisfies readonly SafeZone[]

/** Which safe zones to show: one platform's, by its name in `SAFE_ZONES`, or every platform's together. */
export type SafeZoneChoice = (typeof SAFE_ZONES)[number]['platform'] | typeof ALL_PLATFORMS

/** How far a frame's width over its height may be from 9 / 16 and still take the safe zones: 750 × 1334 does. */
const RATIO_SLACK = 0.005
/** Each edge of every safe zone together, as deep as the deepest platform's, as a share of the frame's side. */
const UNION = {
  top: Math.max(...SAFE_ZONES.map((zone) => zone.top)),
  bottom: Math.max(...SAFE_ZONES.map((zone) => zone.bottom)),
  left: Math.max(...SAFE_ZONES.map((zone) => zone.left)),
  right: Math.max(...SAFE_ZONES.map((zone) => zone.right)),
}

/** Whether a frame is 9:16, the shape the safe zones are published for, within a pixel or so. */
export const isNineBySixteen = (width: number, height: number) =>
  width > 0 && height > 0 && Math.abs(width / height - 9 / 16) < RATIO_SLACK

/**
 * The bands of a 9:16 frame that a platform's interface covers, in the frame's pixels: given a
 * platform's name in `SAFE_ZONES`, that platform's alone; given `ALL_PLATFORMS`, the union of every
 * safe zone's, so each edge as deep as the deepest platform's. Top and bottom run the frame's width,
 * the sides between them. None for a frame of another shape.
 */
export function safeZoneBands(width: number, height: number, platform: SafeZoneChoice): Rect[] {
  const zone = platform === ALL_PLATFORMS ? UNION : SAFE_ZONES.find((each) => each.platform === platform)
  if (!zone || !isNineBySixteen(width, height)) return []
  const top = zone.top * height
  const bottom = zone.bottom * height
  const left = zone.left * width
  const right = zone.right * width
  const middle = height - top - bottom
  return [
    { x: 0, y: 0, width, height: top },
    { x: 0, y: height - bottom, width, height: bottom },
    { x: 0, y: top, width: left, height: middle },
    { x: width - right, y: top, width: right, height: middle },
  ]
}
