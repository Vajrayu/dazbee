# The sync server owns the design

This replaces ADR-0003, and the undo part of ADR-0004. The full rules are in the spec on #677.

Designs no longer sync as Yjs documents. The sync server holds each open design as plain records, the design's own JSON as `packages/schema` defines it, and is its only authority. A tab sends each step as one change set. The server orders change sets, checks each one whole (the schema's own parser, the structure rules, the limits and the member's role), and applies it whole or rejects it whole. Where two tabs set one value, the change the server orders later wins. The server never makes a value itself: order keys, derived values and ids all come from tabs. A tab applies its own steps at once on its working design, and replays its queue on top when the server orders another tab's change set first. Each tab keeps its own undo: an undo writes back what its step replaced, wherever no other tab has written since. This follows FigCraft's rules, with the spec's departures (C31): a step that can't be written yet waits, one taken back only in part splits, and an undo never deletes what another tab placed since (C46).

Yjs merges every update without a server's checks, and that cost too much:

- a design's size could not be bounded (#631);
- one update could hold the server for minutes (#636);
- undo across two tabs lost pages, frames and layers (#630);
- a Reviewer's edits showed and were then lost;
- an offline edit to a deleted layer was lost without a notice.

On plain records, a design of 4,000 layers after 20,000 edits stores in 1,494 KiB instead of 2,264 KiB. It opens in 40 ms instead of 259 ms, and holds about 2.1 MiB of server memory instead of 43 MiB.

A design is still one unit, as ADR-0014 wanted: one change set can span frames and pages, so Copy to other frames stays one undo step. Comments stay in Postgres, referenced by id, as ADR-0003 had them.

**Storage.** Each design has a row in `design_saves` (the folded design, its sync id and its tabs) and a journal (`design_journal`). Accepted change sets are appended by group commit, under a fence, so a second server holding the same design fails instead of overwriting. Only once a change set is stored does the server confirm it, so Saved means stored (C34). A fold writes the journal into the row on unload, or once the journal holds 1,000 accepted entries or 4 MiB. On open, a journal entry that no longer applies moves, with the entries after it, to `design_journal_dead`. The design then opens at the last good entry under a new sync id, so every tab starts over as a new tab (C43).

**The tab.** Each browser keeps a device copy in IndexedDB, with one tab copy per tab. A reload, a crash or offline work loses nothing. A tab opened later sends what a closed tab left behind. A first visit waits for the server.

**Accepted costs.** A text's text and runs are one value, so when two tabs type in one text, the step that ends later wins (K16). Until previews, others see a drag or a typing session only when it ends (K17).

## Considered Options

- **Keep Yjs and bound it from outside**: rejected. Two attempts at #631 failed their own checks: in Yjs a delete adds bytes until compaction, and an update's effect on size is unknown until it applies.
- **A newer CRDT (Loro, Automerge)**: rejected. A CRDT still merges without a server's checks, so #631 and #636 would stay open.
- **A ready engine (tldraw sync, Liveblocks, Replicache, Zero, ShareDB)**: rejected. In order, they need a licence key and tldraw's own store; have no self-hosted production server; are in maintenance mode; sync Postgres rows, not a document; keep every operation.
- **Saving a drag or typing as it goes**: rejected. One undo step would span many change sets, which is unproven, and it would mean about 20 saves a second per person. Previews show the open step instead, never saved (K17).
- **One Postgres row per record**: rejected. It needs a write per record on the confirmation path, and readers would still need the server's rules.
- **One sync client per browser (a SharedWorker or a leader tab)**: rejected. Each tab's undo and open step are its own, and a leader adds a way to fail. A Web Lock per tab copy is simpler.
