# One Yjs document per design

Replaced by ADR-0015 on 2026-11-14: designs sync as plain records that the sync server owns.

Formats, masters and spanning layers were taken out on 2026-11-04 (ADR-0014), which gives the one document below a new reason; the rest stands.

All pages and formats of a design live in one Yjs document, because masters and spanning layers need every page together. Layers are a flat map with a parent id and a fractional index so moves merge cleanly. Comments live in Postgres and are referenced by id.

## Considered Options

- One document per page: rejected, masters and spanning layers would cross documents.
