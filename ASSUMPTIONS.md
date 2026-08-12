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
| A12 | TipTap atom node views tolerate IntersectionObserver-gated lazy mounting | Fall back to eager render with `liveUpdates:false` below the fold | open |
| A13 | Recon was read at `origin/master` `06d8cccef`; implementation branched later at `82914e7c6` — structural findings (registry tables, notes pipeline, bars ceilings) assumed unchanged in between; each is re-verified against the live tree before its first edit | A moved line number or renamed symbol; caught at read-before-edit time | open |
