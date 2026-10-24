# Notebook widgets phase 2 — RESUME HERE

Checkpoint written 2026-10-24 before a PC restart. Read this first, then the design.

## Where things stand
- **Phase 1 (waves 1–6): DONE and LIVE.** All six `NOTEBOOK_WIDGETS_W1..W6_ENABLED` armed on web 2026-10-23.
  Follow-ups (round A + round B: account-size single authority with the 100,000 unset default, rate-limit
  families, master reds) are merged and live; production verified (smoke PASS, widget probe all 200).
- **Phase 2 design: APPROVED by the owner 2026-10-24** ("good that sounds awesome ... begin implementation").
  - Spec: `docs/superpowers/specs/2026-10-24-notebook-widgets-phase2-design.md` on branch
    `docs/notebook-widgets-p2`, revised commit `6aa990e14a` (87 review findings: 85 integrated, 2 rejected, §17).
  - Vocabulary: Widget · Routine (not "checklist") · Tracker · Template; "Preset" keeps its phase 1 meaning.
  - Waves: 7 bytes (no flag) · 8 engine + builder (`NOTEBOOK_WIDGETS_W8_ENABLED`) · 9 routines + trackers ·
    10 formulas + more sources + shelf · 11 templates library + sharing.
- **Implementation plan for waves 7–8: IN PROGRESS at restart.** Target file
  `docs/superpowers/plans/2026-10-24-notebook-widgets-p2-w7-w8.md`. If it is not on the branch after the
  restart, the writing agent died with the session: re-dispatch it (same brief: follow the writing-plans
  skill, scope waves 7–8, use the phase 1 plan `docs/superpowers/plans/2026-10-20-notebook-widgets.md` as
  precedent and `review-feasibility.md`'s per-wave breakdown, verify every path against code).

## Local-only inputs (not in git, survive a restart)
- `C:\Users\Patrick\uct-worktrees\nbw-p2-research\` — `competitors.md`, `review-ux.md`, `review-safety.md`,
  `review-feasibility.md`.
- Worktree `C:\Users\Patrick\uct-worktrees\nbw-p2` (owner file present, session e0c59746).

## Next actions, in order
1. `git -C C:\Users\Patrick\uct-worktrees\nbw-p2 fetch origin` and check whether the w7–w8 plan is committed.
2. If not, write it (writing-plans skill) and commit/push it.
3. Execute with superpowers:subagent-driven-development (owner chose it; max 3 concurrent agents):
   create a fresh implementation worktree/branch from origin/master (e.g. `feat/notebook-widgets-p2`),
   node_modules via a junction (remove with `cmd /c rmdir`, never recursive), ledger under
   `.superpowers/sdd/<plan>/progress.md`.
4. Wave 7 first: measure a real build (`cd app && npm run build`, then
   `python tools/notebook_perf_budgets.py --dist app/dist`), record the artifact, recover ≥25 KB headroom
   from Notebook-owned modules only (budget 2,260,793 B never raised; Terminal code not touched).

## Standing rules (unchanged)
Never write to C:\data; smoke account only for production sign-in (never the owner's Chrome); never
`git stash` / `checkout --` / `--no-verify`; flag rollback is `=0`, never a delete; one master merge at a
time; the pre-push guard's waits are respected, never bypassed.

## One-line resume prompt
"Resume Notebook widgets phase 2: read docs/notebook/widgets-p2-RESUME-HERE.md in
C:\Users\Patrick\uct-worktrees\nbw-p2 and continue from Next actions."
