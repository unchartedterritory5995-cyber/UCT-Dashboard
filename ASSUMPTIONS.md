# Journal Widgets — Running Assumptions

> Owner reviews this file before code lands (per the feature spec's rule 7).
> Every assumption made without asking, plus the blast radius if it's wrong.
> Source plan: `~/.claude/plans/lets-enter-a-plan-wise-dragonfly.md` (approved 2026-08-11).

| # | Assumption | Blast radius if wrong | Status |
|---|---|---|---|
| A6 | `FrozenWorkspaceProvider` can satisfy all 13 widgets' context reads (the full `WorkspaceContext` surface gets enumerated and deliberately stubbed before wiring) | Per-widget shims needed; worst case a widget stays workspace-only until shimmed | open |
| A7 | `modern-screenshot` (or equivalent small DOM-to-PNG dep) captures our DOM widgets, including canvas children | Swap lib; worst case the headless `/r/*` + Playwright rail serves those types | open |
| A8 | The 5 MB PNG cap on the note-image pipeline suffices for embed fallbacks at ~2× render size | WEBP re-encode (community-images precedent) or a cap bump for the embed kind | open |
| A9 | "Last-active note" = most recently opened/edited note (localStorage recency + `updatedAt`) is acceptable capture-target UX | Tune the heuristic; the toast's "Move…" already covers misses | open |
| A10 | Capture-time bars warm is reachable cleanly from the web service (existing `_maybe_kick_deepfill` rail; else a tiny `POST /api/bars/warm` wrapper) | Add the explicit wrapper endpoint | open |
| A11 | Capture inbox is a new `j2_capture_inbox` table + `/api/j2/inbox` endpoints (NOT a preference key — prefs have no delete route / size cap) | — decided in planning, low risk | accepted |
| A12 | ~~IO-gated node views?~~ **RESOLVED**: IntersectionObserver gating shipped in P6 (400px rootMargin, reveal-once, eager fallback when IO is absent — jsdom/tests) | — | closed |
| A13 | Recon was read at `origin/master` `06d8cccef`; implementation branched later — structural findings re-verified at read-before-edit time throughout; two master merges landed clean (backend-only overlap) | — | closed |
| A14 | `FrozenWorkspaceProvider` was NOT built: v1 has no non-chart live embeds (chart's embed renderer is ChartPane directly), so no widget ever reads workspace context inside a note. The provider becomes necessary the day a non-chart type flips `liveCapable: true` | The next live-capable widget's PR carries it (surface enumeration notes live in the plan doc) | closed-for-v1 |
| A15 | ~~Multi-tab clobber?~~ **RESOLVED**: PUT /notes/{id} now takes an optional `baseUpdatedAt` compare-and-set (409 on a stale baseline; absent = legacy last-writer-wins), and the editor reconciles a 409 by pulling the fresh note, appending server-side embeds it lacks, advancing the baseline, and retrying once (`NoteConflictError` in notes.py; rail: `test_update_note_compare_and_set`) | — | closed |
| A16 | Slash-created embeds have no visible-range anchor (no `to`), so they render latest bars on every open — correct for "current view" captures; range-anchored snapshots come from Send-to-Journal/hotkey which freeze the on-screen window | — by design | note |
