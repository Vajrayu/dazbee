# The API owns workspace records and migrations; the sync server only keeps its saves

`apps/api` (Hono on Node) serves workspaces, brands and designs from Postgres through `packages/db` (Drizzle). Every row has a workspace, every design a brand of that workspace (a composite foreign key holds this in the database too), and every query runs under `/workspaces/:workspaceId`, checked against the person's membership there (ADR-0016); a brand or design of another workspace is answered with 404, as if it didn't exist. (These were orgs and clients until ADR-0011.) The API runs the migrations on start and creates each design together with its first save, so the sync server never opens an empty design. The sync server keeps each design's saves and journal (`design_saves`, `design_journal`, `design_journal_dead`, ADR-0015) and adds the design's automatic versions to `design_versions` under its keep rules, which drop the oldest automatic one to make room, and reads versions back for a tab that asks (the version history spec, #734), and nothing else; of the design's own row it only marks it updated.

Sign-in (ADR-0012) gives each request a session. Locally and in CI a development session stands in: with `DAZBEE_DEV_SESSION=on` a request without a session token is one development user of a seeded development workspace. The API refuses to start with it in production, and without it `/me` and every route under `/workspaces/:workspaceId` answer 401 to a request without a valid session token; each workspace's routes are then checked against the person's membership there (ADR-0016). The web app calls the API from its server only, so no browser talks to the API yet.

## Considered Options

- The sync server creating designs on first connection, as in phase 0: rejected, a design would exist without a workspace or brand.
- Migrations as a separate deploy step: rejected for now; one API container is the only writer of the schema, and Drizzle's migrator skips what has run.
