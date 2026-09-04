# Current Architecture — Indicator/Screener/Translation Layer

Synthesis of three wave-one findings (2026-09-04): the Pine/thinkScript Translation Layer
Archaeologist, the Indicator Platform Program Archaeologist, and this program's own live
`BENCHMARK_REPRODUCTION.md`. Satisfies master-prompt §89.C. **Scope note:** this covers the
compiler/engine/translation corner of the ecosystem in depth. It does NOT yet cover: data-provider
architecture, job orchestration, observability/telemetry, security threat-modeling, the frontend
design system broadly, or the Custom-Screens/Full-Market-Screener line of work (6/19 design doc,
`feat/screener-deep-work`) — those are second-wave items, see `PROGRESS.md`.

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

## What's still unknown

- **No browser/production verification of any of this has happened.** Every finding above is from code,
  tests, and commit history — real, but per addendum §5 ("test the real frontend, not only the backend")
  this is not equivalent to verified end-to-end product behavior. This is the single largest gap in the
  current picture and the natural next-wave priority.
- Whether production has actually recovered from a dated 2026-08-31 code comment describing `scan_hits`
  staleness (newest session stuck on Friday when read Monday) — the scheduler misfire-handling gap looks
  fixed at the code level (`coalesce=True, misfire_grace_time=3600`), but this hasn't been confirmed live.
- Whether TC2000/PCF's 57/57 corpus pass rate is representative — unknown if a blind/adversarial PCF
  corpus exists the way Pine has one deliberately built to resist gaming.
- Whether a session is currently active in the `indicator-endzone` worktree (touched 2026-09-04 08:17,
  hours before this Phase Zero session) — its tree reads clean now, which is reassuring but not proof.
