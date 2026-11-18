---
name: spec-check
description: Check a spec issue and its tickets with a fresh agent before any ticket is built. Use after /to-tickets on a spec, or when asked to check a spec.
---

# Spec check

Whoever wrote a spec reads it with the whole conversation in mind, so the gaps a builder will hit are invisible to them. A **fresh agent** sees only what a builder sees: the issues and the code.

## Steps

1. **Collect** the spec issue's number and the number of every ticket cut from it (its sub-issues). Done when the list is complete.

2. **Brief one fresh agent** (the Agent tool, general-purpose) with only those numbers and the checks below. Leave out everything from this conversation: its summary, its intent, your conclusions. Tell it to read each issue with `gh issue view`, then `GLOSSARY.md`, `docs/agents/code-layout.md`, and the ADRs and code the issues touch. It reports findings only, each with its place (issue and section), what is wrong, what a builder would do because of it, and a proposed fix.

   The checks:
   - **Unclear:** a sentence two builders would build two ways; a word that is neither in `GLOSSARY.md` nor defined in the spec.
   - **Unproven:** a claim about the code, a library or a number with no measurement, prototype or file behind it. Check each one against the code.
   - **Goals:** each goal says how it is measured, and a ticket delivers it.
   - **Tickets:** each fits one session, has acceptance criteria, names the file each behaviour lives in, and is blocked by exactly the tickets it needs.
   - **Two homes:** a behaviour that two tickets, or a ticket and existing code, would each define.
   - **Reach:** code that calls or reads what changes and would now behave differently; a case a person can hit that no acceptance criterion covers.
   - **Rules:** anything against an ADR, `CLAUDE.md` or `docs/agents/code-layout.md`.

3. **Verify** each finding against the code yourself. Done when every finding left is one you have confirmed.

4. **Settle.** Write a fix that is a matter of fact (a wrong path, a missing criterion) straight into the issue it belongs to. Bring the owner the findings that need a decision in one round, numbered, each with your recommended fix and worded so "yes" accepts it, then write each answer into its issue. Done when every confirmed finding is written into an issue or dropped by the owner.
