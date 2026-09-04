# Current Architecture — Indicator/Screener/Translation Layer

Synthesis of wave-one findings, Core Golden Journey #1, and wave-two #2 (all 2026-09-04): the
Pine/thinkScript Translation Layer Archaeologist, the Indicator Platform Program Archaeologist, this
program's own live `BENCHMARK_REPRODUCTION.md`, a real browser E2E pass
(`CORE_GOLDEN_JOURNEY_01_PINE_RSI_IMPORT.md`), and the Screener/"Custom Screens" Archaeologist. Satisfies
master-prompt §89.C. **Scope note:** covers the compiler/engine/translation layer AND the screener/scanner
system in depth. Still does NOT cover: data-provider architecture, job orchestration,
observability/telemetry, security threat-modeling, or the frontend design system broadly — those remain
later-wave items, see `PROGRESS.md`.

**A pattern worth naming explicitly, now confirmed a third time:** this codebase's design docs go stale
within weeks of being approved, reliably. The 7/31 Indicator Platform doc went stale at Phase D (real work
continued to Phase E under a separate 8/8 doc). The 2026-06-19 Full-Market-Screener doc went stale the
same way (superseded by an 8/21 "screener-deep-work" doc and an 8/30 base-structure-library doc). And now
**`CLAUDE.md` itself — the file every session, including this one, reads first — was found to carry a
stale, twice-superseded claim** (see "Screener/Scanner system" below). None of these are isolated
incidents; they're the same failure shape recurring across every substantial epic examined so far. The
operating conclusion for the rest of this program: **treat every doc, including this repo's own onboarding
file, as a lead to verify against current code and tests — never as authoritative on its own** — which is
CL-008 applied reflexively one level further than originally scoped.

**Correction to the baseline:** DEC-001 named the 7/31 design doc as (part of) the program baseline.
Archaeology found that document's own roadmap table was meticulously maintained through Phase D
(~2026-08-08) but **was never updated for Phase E**, despite Phase E having its own separate approved
spec (`docs/superpowers/specs/2026-08-08-phase-e-screener-toolkits-design.md`) and real shipped
implementation. This doesn't change DEC-001's policy (extend/harden what exists) — it changes what "the
existing architecture" actually *is*: the 7/31 doc plus its Phase E addendum plus what's actually on
`origin/master`, not the 7/31 doc read alone. Treat this file, not the 7/31 doc by itself, as the current
source of truth for what's built.

## The shipped pipeline

All five of the master prompt's "input doors" (§14) already exist as modes inside one component,
converging on one canonical representation:

```
Pine / thinkScript / TC2000-PCF source text, or a plain-language request, or a screenshot
                              │
        dialect-specific parser + semantic lowering (pine.js / thinkscript.js / pcf.js /
        definition_concierge.py NL pipeline / ImageBox.jsx vision pipeline)
                              │
                    ONE canonical AST (jsep-derived: num/series/op/call nodes)
              — persisted verbatim; raw source text is transient, never saved —
                              │
         manifest-driven static analysis (closedTable.json → lint.js/ast_lint.py repaint
                    decidability, budget.js/ast_budget.py node/lookback caps)
                              │
      TWO synchronized execution kernels, cross-checked at 1e-9 tolerance
      (interpret.js in JS, ast_interpret.py in Python — tools/ast_conformance.py verifies)
                              │
        ┌──────────┬──────────────┬───────────────┬────────────────────┐
     chart adapter  screener adapter  alert adapter   AI concierge (reuses
  (nativeRegistry.  (scan_definition.  (alert_user_    the identical schema→
   installUser       assert_scannable,  series.py,      canonical→budget→
   Definitions)       scan_evaluator.py) USER_FUNCS,     lint→compute pipeline)
                                         excluded from
                                         the frozen
                                         alert replay grid)
```

The one write door for member-authored definitions is `BuilderSheet.jsx` →
`nativeRegistry.installUserDefinitions`. Nothing downstream re-parses source text; every consumer reads
the same persisted AST. This is a shipped, real instance of the 7/31 doc's core principle ("one grammar,
many surfaces") and of master-prompt §12's hypothesized target shape — not an open research question.

**The manifest is `app/src/components/chart/engine/ast/closedTable.json`** (169KB): sections
`nodeTypes, functions, scalars, series, clock, operators, benchmarks` (grammar) plus `_`-prefixed prose
sections recording *why* specific functions are refused. One writer; two runtime readers (JS + Python),
each AST-walked by its own test to forbid a hand-copied vocabulary string outside the manifest — a real
anti-drift mechanism, not a convention. `vocabulary.js` generates the member-facing
`/formulas/reference` docs from it; `definition_concierge.py`'s AI tool schema is separately generated
from the same source. **Master-prompt MP-066 (docs derived from engine capability metadata) is already
satisfied here.**

## Phase-by-phase status (7/31 doc's own phase labels, corrected against `origin/master`)

| Phase | 7/31 doc says | Actual status, verified 2026-09-04 |
|---|---|---|
| A — Signature Launch | 3 server-computed premium indicators + signal ledger | **Shipped**, live on `origin/master`. `api/services/signature/{rules,darkpool_levels,flow_breakout,gex_walls,ledger,sweep}.py` + router. Grew beyond its own plan: `confluence.py` (unwired prototype, see Risks) and `registry_defs.py` (generic server-lane dispatch, 4 registered defs) both exist and aren't in the Phase A plan text. |
| B — Foundation (engine/binding layer) | Engine, binding layer, two-flip native migration | **Shipped and unconditionally active** — not a parallel/shadow path. `StockChart.jsx`'s own comment: "after Flip B the engine is active on EVERY chart." `docs/decisions/2026-08-04-engine-enabled-deleted.md` records the feature flag itself deleted at all 7 sites once cutover completed. 14/15 legacy natives migrated; the 15th (`volumeProfile`) is a documented, deliberate permanent carve-out (`nativeRegistry.CARVED_OUT_INDICATOR_KEYS`), not an oversight. |
| C — Alerts & depth | Closed-bar alert engine, per-plot alerts | **Shipped.** `ALERT_EVAL_MODE = "closed"` confirmed at `api/services/indicator_alert_evaluator.py:134`. `alert_user_series.py` (`USER_FUNCS`) is a dedicated partition deliberately excluded from the frozen alert replay grid. |
| D — Builder + AI door | jsep AST + interpreter, NL concierge, machine repaint linter | **Shipped.** `jsep: "1.4.0"` pinned exactly in `app/package.json`. `definition_concierge.py` implements the full `cost → generate → schema → canonical shape → budget → lint → compute → read back` pipeline the doc specifies. |
| E — Screener & toolkits | Definitions run server-side across the full universe; named toolkits; tiering | **Mechanism shipped, commercial half deliberately open.** `scan_evaluator.py` runs the nightly full-universe AST-definition sweep reusing the identical Phase D interpreter (same "one grammar, many surfaces" guarantee extended to screening). `entitlements.py` (toolkit gating) is real, tested, wired to production since 2026-08-09 — but `entitlements.TOOLKITS` currently defines exactly **one** toolkit (`"all"`, fully ungated); its own docstring states plainly "today exactly one toolkit ships and it changes nothing for anybody... design §8.4 is OPEN." This is a known, flagged, already-open owner decision (pricing/tiering), not a silent gap. |

## Benchmark reality (see `BENCHMARK_REPRODUCTION.md` for full detail)

As measured live, 2026-09-04: Pine 14/21 · Pine (community) 19/30 · thinkScript 10/24 · TC2000/PCF
57/57. Combined honest denominator (excluding permanent, correct refusals): **43/58** — confirmed
accurate and current, matching the master prompt's cited figure exactly. The "28/48 after assisted
edits" figure is **currently false** — the repo's own test (`pine.blindCorpus.test.js`) is red on this
today. End-to-end: all 43 currently-translating scripts evaluate and are saveable; 18/43 are directly
scannable and all 43 are reachable as a screen with one added comparison — real, tested evidence against
the "translation ≠ delivery" failure mode (master-prompt §36).

## Known drift and naming issues (new findings, not yet resolved)

1. **Two unrelated features both named "Confluence."** `api/services/signature/confluence.py` (`dpc-v1`
   — Dark-Pool Reclaim Confluence, a complete, tested, paid-gated compute prototype, *deliberately*
   unwired to any surface per the design doc's own D-A8 entry: synthesizing historical `evaluate()` runs
   against dark-pool clusters that hadn't formed yet would be an honesty violation — a real, reasoned,
   recorded refusal, not an oversight). Separately, `app/src/pages/Confluence.jsx` +
   `useConfluence.js` + `api/confluence_screen.py` is a completely independent "Confluence Radar"
   screener board (dark-pool accumulation × LEAP flow) that **shipped 2026-08-30**, reusing the name and
   a similar thesis but sharing no code. This falsifies the 7/31 doc's D-A8 claim that the string
   "confluence" occurred nowhere under `app/` — true when written, false since. Two different concepts,
   confusingly similar names, different modules. **Flagged for owner awareness; not resolved here** —
   resolving it (rename? cross-link the docstrings?) touches shipped, live code and belongs in the
   decision queue, not a unilateral Phase Zero edit.
2. **`confluence.py`'s `dpc-v1` remains built, tested, gated, and unreachable by any user.** Its own
   docstring reportedly sketches a scan-shaped follow-up. Whether to finish wiring it or formally retire
   it is a real product decision — logged in `RISK_REGISTER.md`, not decided here.
3. **`CLAUDE.md` itself carries a stale, twice-superseded claim.** It states `app/src/components/screener/
   SavedScreensPanel.jsx` wires the AST-scan system's results into the Scanner UI. That file was deleted
   2026-08-22 (screener wave 4) and replaced by `ScreensManager.jsx`/`scanSession.js`/`ScanResults.jsx`.
   CLAUDE.md's own surrounding prose was originally *correcting* an even older false claim ("E-4 has not
   wired a surface to these results") — the code has since been fixed correctly a second time, and
   CLAUDE.md never caught up. Logged as RISK-015: not fixed here (small, mechanical, but touches the
   repo's primary onboarding doc — flagged for the owner/doc-hygiene pass).

## Screener / Scanner system (added by wave-two #2 archaeology)

**"Custom Screens" is not this repo's term for anything** — it appears only in the master prompt and this
program's own derivative docs. The repo's real, evidenced vocabulary is layered and historically distinct:
"Scanner Hub" (the original `/screener` page name) → "Custom Scan" (one now-retired tab inside it,
confirmed absorbed per the 6/19 doc) → "Saved Screens" (the DB-table-level concept) → today, simply
**"Screens"** (the `ScreensManager.jsx` dropdown) inside a page whose own `<h1>` still reads "Screener."
Use "Screener"/"Scanner"/"Screens" in any future capability matrix, never "Custom Screens" verbatim.

**Today's shape is more unified than either the 6/19 design or an 8/21 intermediate doc described** — the
system count here has genuinely changed twice as the codebase evolved, not just been described
inconsistently:
- One page, one shell (`ScannerShell.jsx`), replacing the old three-tab Scanner Hub. Per `Screener.jsx`'s
  own header: *"THIS PAGE IS THE SCANNER NOW... Candidate Board... and Live Scan retired 2026-08-29."*
  (Matches memory's `project_live_scan_retirement`/`project_patterns_page_retirement` — independently
  confirmed against current code, not just recalled.) The underlying 7 AM scanner feed (`candidates.json`)
  is untouched — only its dedicated `/screener` tab was removed; it still feeds Morning Wire and other
  consumers.
- **Two backend evaluation mechanisms, deliberately joined, not merely coexisting side by side:** the
  Finviz-style nightly-snapshot query (`/data/screener.db`, built 3:00 AM ET daily, `SCREENER_SNAPSHOT_
  ENABLED` on by default) and the AST-definition nightly-scan sweep (the one this program's own Core
  Golden Journey exercised) are joined into one filter category (`my_scans`) by an explicit, recorded
  owner decision ("unify formula scans into the Scanner, join-only this round" — 8/21 doc, overturning an
  earlier "keep them separate" call on freshness-disclosure grounds). A dedicated, passing test
  (`test_never_swept_hash_is_INERT_and_disclosed_not_a_silent_universe`) enforces the same "Honest-None"
  behavior this program's own Core Golden Journey observed live in the browser ("first sweep tonight," not
  a silent zero) — independent confirmation, from two different angles, of the same correct behavior.
- **Three separate, real, tiered pattern/structure systems**, not aliases of each other: the original
  `pattern_engine` (85 detectors, feeds charts + Compass + the Patterns filter), an old 6-detector cheap
  heuristic (confirmed **deleted** from current code), and the new Base & Structure Library
  (`base_catalog.py`, 5,598 lines; `lift_ledger.py`, a statistics-gated "publish lift, never a raw hit
  rate" evidence layer with a phase-randomized null test) — matching memory's own prior finding that this
  library's own gates killed rows that "beat baseline and lost money." The "Structure library" button seen
  live during Core Golden Journey #1 is this system's reference dialog.
- The 6/19 design shipped, then was substantially extended by two later docs (8/21 "screener-deep-work,"
  8/30 base-structure-library) — the same stale-doc pattern called out above. 101/101 targeted tests
  (`test_screener_wave4_query.py`, `test_screener_filters.py`, `test_base_count.py`,
  `test_base_catalog.py`) passed live when re-run for this program.
- All three investigated worktrees/branches (`screener-deep-work`, `feat/pattern-library-expansion`,
  `feat/full-market-screener`) confirmed **fully merged, zero unique commits** — the same clean pattern
  every branch investigated by this program has shown so far.

## What's still unknown

- **Browser/production verification is now partial, not absent.** Core Golden Journey #1 walked one Pine
  fixture end-to-end live (paste → translate → chart → save → reload → screener reach). Everything else —
  thinkScript, TC2000, plain-language, screenshot doors; the screener/scanner system's actual filter
  results with a populated snapshot; base-structure library rendering — remains code/test-level evidence
  only. See `VALIDATION_COVERAGE_MAP.md` for the precise, row-by-row state.
- Whether production has actually recovered from a dated 2026-08-31 code comment describing `scan_hits`
  staleness (newest session stuck on Friday when read Monday) — the scheduler misfire-handling gap looks
  fixed at the code level (`coalesce=True, misfire_grace_time=3600`), but this hasn't been confirmed live
  (RISK-003, still open).
- Whether TC2000/PCF's 57/57 corpus pass rate is representative — unknown if a blind/adversarial PCF
  corpus exists the way Pine has one deliberately built to resist gaming.
- Whether a session is currently active in the `indicator-endzone` worktree (touched 2026-09-04 08:17,
  hours before this Phase Zero session) — its tree reads clean now, which is reassuring but not proof.
- Actual nightly-sweep execution and real scan-result correctness (addendum §11/§12) — confirmed
  architecturally sound (enforced by a test forbidding request-path execution) but never observed
  completing by this program.
- A minor label discrepancy between what Core Golden Journey #1 saw live ("Ownership & Short," "Candles")
  and what current filter-category code names ("Ownership & Insiders," "single_candle"/"multi_candle") —
  not reconciled; worth a two-minute check before quoting exact UI text elsewhere.
