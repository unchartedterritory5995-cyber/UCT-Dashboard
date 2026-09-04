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
- **Agent — Pine/thinkScript Translation Layer Archaeologist. DONE.** Major findings:
  - **Q1 (authoring-surface risk) resolved, high confidence: no conflict with DEC-002.** The translation
    layer is structurally an import door only — raw Pine/thinkScript/PCF source is transient (parsed
    client-side, never persisted); only the canonical AST is saved, through one write door
    (`nativeRegistry.installUserDefinitions`). `PineBox.jsx`'s own header states this explicitly ("A
    MODE, NOT A FOURTH BUILDER"). The one soft residual risk DEC-002 itself names (free-text editing of
    *canonical* source) is not present today — members only edit *pre-translation* paste text.
  - **The manifest = `app/src/components/chart/engine/ast/closedTable.json`** (169KB). Single writer, two
    synchronized runtime readers (`interpret.js` JS, `ast_table.py`/`ast_interpret.py` Python), each
    AST-walked by its own test to forbid a hand-copied vocabulary string — a real anti-drift mechanism.
    `vocabulary.js` generates the member-facing `/formulas/reference` docs from it (the "Segment G6"
    commit, confirmed), and `definition_concierge.py`'s AI tool schema is separately generated from the
    same manifest. **Master-prompt MP-066 (docs derived from engine capability metadata) is already
    substantially satisfied — predates this program.**
  - **Correction to the ledger's TC2000 gap flag (MP-014C):** `pcf.js` (`parsePcf`) exists in the same
    `engine/ast/` directory as the Pine/thinkScript parsers, and `tests/fixtures/ast/pcf_corpus.json`
    exists with `accepted`/`offset_dependent`/`refused` buckets. TC2000/PCF is **not** greenfield — it has
    an existing parser and test corpus, same as the other two doors. The ledger-construction fork's
    "zero evidence" finding was accurate to what it could see from the master-prompt text and light repo
    grounding, but incomplete — this is exactly the kind of cross-check multiple independent agents are
    supposed to catch. `REQUIREMENTS_LEDGER.md` MP-014C updated accordingly (see below).
  - **Benchmark reconciliation — all five cited numbers (memory's 17/21, master prompt's 38/38 · 43/58 ·
    21/48 · 28/48) are stale or mischaracterized, not current measurements.** 38/38 = the self-authored
    `pine_screener/` control corpus. 21/48 → 28/48 = the externally-styled `pine_blind/` corpus, a moving
    ratchet (was 17/48 earlier). 17/21 = confirmed real for `pine/` (21 vendor scripts) but was an 8/12
    *projected ceiling*, since revised — the permanently-refused set grew 4→5 by 8/30, and the last dated
    in-file comment showed 14/21 measured. 43/58 was **not found literally** in the repo; best-fit is
    `doorScorecard.test.js`'s combined Pine+community+thinkScript corpus, whose denominator has grown
    from a presumed 58 to **77** while a "≥43 translate" floor was never raised — meaning a quoted "43/58"
    today would overstate the real pass rate. That same test file apparently carries its own explicit
    warning against exactly this: *"41/75 SCRIPTS TRANSLATE IS NOT THE NUMBER, AND QUOTING IT
    UNDERSTATES THE PRODUCT."* **No number should be quoted anywhere until re-measured live** — exact
    repro commands are recorded, not yet run (see "Next steps").
  - **Architecture — matches master-prompt §12's hypothesized shape and appears to predate it.** All five
    input doors (§14: Pine, thinkScript, TC2000/PCF, plain-language via `ConciergeBox.jsx`, screenshot via
    `ImageBox.jsx`) already exist as modes inside one `BuilderSheet.jsx`, funneling into one canonical AST,
    one write door, two synchronized (JS + Python) execution kernels cross-checked at 1e-9 tolerance via
    `tools/ast_conformance.py`. **This is a shipped realization of "one grammar, many surfaces," not an
    open research question** — Phase Zero effort here is better spent auditing depth/correctness within
    each door than re-deriving the shape.
  - **Disambiguation:** the candlestick/chart-structure "pattern engine" (`api/services/pattern_engine/`,
    feeding the Compass coaching product) is architecturally separate from this translation layer — shares
    no code, only loose commit-message proximity. Do not conflate the two when reasoning about "the
    translation layer."
  - **Unconfirmed by this agent (in scope for the still-running program archaeologist):** whether
    `indicator-endzone`, `phase-b1-foundations`, or `phase-b2-engine` worktrees contain divergent,
    uncommitted changes to this same translation layer — this agent's read was restricted to origin/master.

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

## Benchmark reproduction — DONE (`BENCHMARK_REPRODUCTION.md`)

Ran the actual corpus tests + the Python cross-lane conformance tool (commands + full results in that
file). Headline: **43/58 and 21/48 were exactly right, live; "28/48 after assisted edits" is currently
FALSE — the repo's own test is red on this today (stuck at 21, the offer mechanism isn't lifting any of
the 21 blocked blind-corpus scripts); memory's "17/21" is superseded (today: 14/21).** Also found: TC2000
(PCF) is 57/57 on its own corpus — not just non-greenfield, plausibly the most mature door by this metric
(caveat: unknown whether it has a blind/adversarial corpus the way Pine does). Also found a second live
red check: `ast_conformance.py --coverage` shows one manifest scalar (`base_relation_count`) with zero
fixture coverage. Both red findings are real, narrow, already self-tracked by the repo — not fabricated,
not hidden.

## Next steps

1. Reconcile all findings so far (both archaeology agents + this reproduction) into `CURRENT_ARCHITECTURE.md`
   once the still-running program-status agent lands.
2. Decide second-wave dispatches based on what's actually found (don't pre-commit further agents before
   seeing wave-one evidence, per master-prompt §61 "determine optimal parallelization after initial
   orientation"). Candidates raised by this reproduction specifically: (a) investigate the blind-corpus
   assisted-edit gap as a real, scoped bug rather than leaving it as a red test someone else trips over;
   (b) determine whether TC2000/PCF has (or needs) a blind corpus equivalent to Pine's before trusting its
   57/57 as broadly representative.
3. Commit this folder's contents once reviewed — 5 commits landed so far this session (kickoff docs,
   ledgers, Pine/thinkScript reconciliation, this update, benchmark reproduction).
