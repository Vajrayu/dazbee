// Why a key or an item does nothing to the selection, in the app's words: the one list that both
// the menus' greyed items and the notice a refused key raises read.
import type { Refusal } from '@dazbee/editor'

import type { Messages } from '@/lib/i18n/index.ts'

/** The words that say why, by the reason the editor gives. */
export const refusalWords = (why: Refusal, { bar: b, notices }: Messages['editor']) =>
  ({
    locked: b.lockedRow,
    apart: notices.apart,
    held: b.wrapHeld,
    maskLocked: b.maskLocked,
    groupLocked: b.groupLocked,
    inAutoLayout: b.maskInAutoLayout,
    mixed: b.maskMixed,
  })[why]
