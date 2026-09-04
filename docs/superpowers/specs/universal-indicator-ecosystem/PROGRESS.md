# Progress — Universal Custom Indicator + Screener Ecosystem

**Read `00-MASTER-PROMPT.md` first** for the objective, then `DECISIONS.md` for what's already settled.
This file tracks live status only — it will go stale; trust it less than the two files above, and less
than the repo itself.

**Current phase:** Phase Zero — Deep Discovery, Baseline & Validation (reconciled scope per DEC-001).
**Workspace:** worktree `C:\Users\Patrick\uct-dashboard\.claude\worktrees\indicator-ecosystem`, branch
`worktree-indicator-ecosystem`, based on `origin/master` @ `12cf5c8d3` (2026-09-04). Created via the
harness's native `EnterWorktree` tool — do not also `git worktree add` a second one for this program;
enter this one.
**Do not commit to:** the main `uct-dashboard` checkout (stale `feat/catalyst-coverage-precision` with
active third-party WIP — see `CLAUDE.md`/`2026-07-31-phase-a-signature-launch.md` Global Constraints).
**Do not touch (owner-flagged, someone else's active work):** `api/live_massive_router.py`,
`api/schwab_router.py`, `api/massive_ws_worker.py`, `api/massive_processor.py`,
`app/src/pages/OptionsFlow.jsx`, `api/liveflow_router.py`.
**Unconfirmed:** whether another session is currently active on `feat/indicator-endzone` (its worktree
was touched 2026-09-04 08:17, hours before this session started). Treat as possibly live until the
owner confirms otherwise — read freely, do not write there.

## The owner's 8-point establishment list (DEC-001) — this IS the Phase Zero task list

| # | Item | Status |
|---|---|---|
| 1 | What the 7/31 architecture actually intended | Read in full (`00-MASTER-PROMPT.md` is not a copy of it — the doc itself lives at `docs/superpowers/specs/2026-07-31-indicator-platform-design.md`). Summarized in DEC-001/DEC-002. |
| 2 | What portions were actually implemented | In progress — Indicator Platform Program Archaeologist dispatched (see below). |
| 3 | What portions shipped (vs. implemented-but-not-shipped) | In progress — same agent. Confirmed so far: Phase A signature indicators are on `origin/master`, i.e. shipped. |
| 4 | What has evolved beyond the original specification | Confirmed example: `confluence.py`, `registry_defs.py` in `api/services/signature/` are not in the Phase A plan text. Full accounting in progress. |
| 5 | What is currently in flight | Partial — worktree timestamps show `indicator-endzone` active as of this morning; `phase-b1-foundations`, `phase-b2-engine` worktrees exist but flight status unconfirmed. In progress. |
| 6 | Whether current product behavior matches that architecture | Not started — needs browser-verified behavior, not just code presence. |
| 7 | Which decisions remain appropriate under the expanded objective | Not started — depends on 1–6. |
| 8 | Which decisions may deserve reconsideration on genuinely new evidence | Not started — depends on 1–6; route through DEC-001's conflict policy, not a unilateral call. |

## Dispatched this session (2026-09-04)

- **Fork — Ledger construction. DONE.** `REQUIREMENTS_LEDGER.md` (120 rows) and `CONSTRAINT_LEDGER.md`
  (19 entries) written and committed. Key findings:
  - **Gap flagged, not yet resolved:** Door C (TC2000/PCF, MP-014C) is rated MUST by the master prompt
    on the same footing as Pine/thinkScript, but zero repo evidence of any TC2000 work exists anywhere
    (no branch/worktree/doc/commit) — unlike Pine and thinkScript, which both have real active
    engineering behind them. Kept at MUST (master prompt's own authority) but repo-area marked "unknown,
    may be greenfield." A TC2000 specialist should expect to start from zero, unlike the other two doors.
  - Several rows flag "likely already partially satisfied by the 7/31 program — verify, don't reinvent"
    (MP-016 one-saved-logic-object vs. 7/31 §3 definition schema; MP-052 versioning vs. §3.1's
    version/compute.rev split; MP-032 Vendor Oracle Protocol vs. the "ruling(bbw/percentrank/median)"
    commit pattern; MP-066 doc-from-metadata vs. the "Segment G6 ... generated from the manifest"
    commit). This is a direct, expected consequence of DEC-001 — confirming "already satisfied" is as
    valid a Phase Zero outcome as finding a gap, and the archaeology agents below should check these
    specifically rather than treating them as open.
- **Agent — Indicator Platform Program Archaeologist.** Scope: origin/master + the Indicator-Platform-
  adjacent worktrees under `C:\Users\Patrick\uct-worktrees\` (`phase-a-signature`, `phase-b1-foundations`,
  `phase-b2-engine`, `indicator-endzone`, `candle-library`, `screener-deep-work`, `patterns-retire`,
  `live-scan-retire`). Answers establishment items 2–6 above. Read-only. Status: dispatched, awaiting
  result.
- **Agent — Pine/thinkScript Translation Layer Archaeologist.** Scope: find and characterize the actual
  current Pine/thinkScript parser/translator/evaluator/pattern-engine code on `origin/master`; reconcile
  memory's "Pine parity ceiling 17/21" (dated 2026-08-12) against the master prompt's cited 38/38 · 43/58
  · 21/48 · 28/48 figures (same benchmark evolved, or different benchmarks entirely — currently unknown);
  determine whether the translation layer is strictly an *import* door (member already has a script) or
  has drifted into a user-facing *authoring* surface (would conflict with DEC-002 — flagged as an
  immediate high-priority finding if so); locate the "manifest" that `Segment G6: the member's grammar
  reference` was generated from. Read-only. Status: dispatched, awaiting result.

## Not yet started (second wave candidates)

- Custom Screens / Screener current implementation state (have the 2026-06-19 Full-Market-Screener
  design doc + memory notes on `feat/screener-deep-work`; need fresh verification against origin/master
  and the `screener-deep-work` / `full-market-screener` worktrees/branches).
- Data provider / market-data contract audit (master-prompt §25).
- Existing test-suite credibility assessment (addendum §14).
- Telemetry/observability current-state audit (master-prompt §27, §37).
- Competitive research (master-prompt §64–65) — low urgency per master prompt's own phase ordering.
- Validation Coverage Map skeleton (addendum §3) — blocked on establishment items 2–6 landing first.

## Artifacts in this folder so far

- `00-MASTER-PROMPT.md` — verbatim source objective + addendum + reconciliation. Read first.
- `DECISIONS.md` — DEC-001 (program scope), DEC-002 (no standalone scripting language, preserved).
- `PROGRESS.md` — this file.
- `REQUIREMENTS_LEDGER.md` (120 rows), `CONSTRAINT_LEDGER.md` (19 entries) — done.

## Next steps once dispatched work returns

1. Reconcile the two archaeology agents' findings into `CURRENT_ARCHITECTURE.md` and update this file's
   establishment-list table.
2. Resolve the 17/21 vs. 38/38·43/58·21/48·28/48 benchmark question explicitly — do not use either
   number in any report until resolved.
3. Decide second-wave dispatches based on what's actually found (don't pre-commit further agents before
   seeing wave-one evidence, per master-prompt §61 "determine optimal parallelization after initial
   orientation").
4. Commit this folder's contents once reviewed — nothing has been committed yet this session.
