# A session names the person; the page names the workspace

This replaces the part of ADR-0012 where a session token names one workspace and sign-in picks it. The rest of ADR-0012 stands: sign-in through the API, tokens signed with `SESSION_SECRET`, roles in `memberships`.

A person can be a member of several workspaces (ADR-0011), and with invites many will be. So the session token names only the person and their WorkOS session. Every page's URL names the workspace it shows (`/w/<workspace id>/...`), every API route that reads a workspace's records takes the workspace in its path, and the API checks on each request that the person is a member there, with their role and the brands they may see read from that membership. Tabs in two workspaces work side by side, a link to another of the person's workspaces just opens, and removing a membership ends the person's access to that workspace at once while their other workspaces go on. `/` and sign-in open the workspace the person used last.

## Considered Options

- One active workspace per session, as ADR-0012 had it, with a switch that moves every tab: rejected. A tab still open on the old workspace breaks or jumps, and a link to another workspace needs a switch first.
- The workspace's name in the URL (`/harbour-agency/...`): rejected for now. It needs unique names and a rule for renames; the id needs neither.
