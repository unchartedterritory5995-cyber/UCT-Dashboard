# UCT Indicators Engine — baseline, milestone ledger, and Phase 6 (2026-10-11)

Branch `feat/uie-phase6`, worktree `C:\w\uie6`, from master **`b4282b5d9d`** (= `production`). Read off the
code at that commit, not off older reports; where a doc and the code disagree it is said below.

## 1. Baseline (what master holds)

Every Indicators branch is merged: `feat/indicators-agent-seams` (parameterised add, `dollar_vol_1d`),
`feat/runtime-hardening-p1` (UIE Phases 1–5), the Agent-side "Add a 20 EMA". No engine file changed on
master after the UIE release (`ee373f1215`).

**One canonical engine, several lanes** (`engine/defSchema.js` `COMPUTE_KINDS`):
`native` (shipped indicators), `ast` (member formulas — the closed grammar, `docs/formulas/GRAMMAR.md`:
5 series, 32 clock, 15 operators, 79 functions, 138 scalars), `runtime` (per-bar Pine VM), `server`, `script`
(reserved). Pine / thinkScript / TC2000 imports all translate INTO these lanes; nothing has its own runtime.

**Production state (web variables, read 2026-10-11) vs. the flag ledger:**

| Capability | Production |
|---|---|
| Formula indicators (create/edit/save/version, Info Row values, conditions, alerts, scans) | ON |
| Pine member pane (host lane) — `VITE_PINE_MEMBER_PANE_ENABLED` | ON (armed 09-19) |
| Pine objects-only pane — `VITE_PINE_OBJECTS_ONLY_PANE_ENABLED` | ON (armed 09-27) |
| Indicator templates — `VITE_INDICATOR_TEMPLATES_ENABLED` | ON (`=1` on web) — ⚠ `docs/frontend_feature_flags.json` still says `dark` |
| Indicator vision — `INDICATOR_VISION_ENABLED` | ON |
| Advanced Pine runtime pane — `VITE_PINE_RUNTIME_PANE_ENABLED` (+ `PINE_RUNTIME_STAGE`) | **OFF** (unset) |
| Lower-timeframe series — `VITE_PINE_LOWER_TF_ENABLED` | OFF |
| Create Indicator member cohort — `CREATE_INDICATOR_COHORT_ENABLED` | OFF at 10-07 (not re-read) |

## 2. Milestone ledger

| Area | State | Evidence |
|---|---|---|
| Formula lane: closed grammar, two-lane (JS⇄Python) proof at 1e-9, repaint linter as a gate, budgets | ✅ complete | P0–P3, Batches 1–2; `tests/fixtures/ast/*`, `__truth__/*` |
| Multi-output definitions (v2 trees), Info Row values, conditions, events | ✅ complete | `outputType.js` (`series`/`condition`/`events`/`scalar`) |
| Visuals: line, stepline, histogram, area, baseline, **band** (a fill between two plot columns, `edges: {upper, lower}`), markers (shapes/positions/text), `hlines` guides, `bgcolor` (background) / `barcolor` (candle) paints | ✅ complete | `defSchema.PLOT_STYLES`, `PAINT_KINDS` |
| Plot styles schema-reserved "for a later phase" (a document naming one is refused by name): `zones`, `bgband`, `barcolor`, `fill`, `cross` — their EFFECTS partly exist under other names (`band`, the `bgcolor`/`barcolor` paints) | ⏳ reserved; demand not measured here | `defSchema.RESERVED_PLOT_STYLES`, `checkVocabulary` |
| Lifecycle: create / edit / version (append-only, `baseVersion` conflicts) / fork / share / install / history / delete | ✅ complete | `api/routers/user_definitions.py` routes |
| Runtime (Pine VM): limits, warm-up curtain, incremental realtime, source edit, drawings | ✅ complete, **dark** | UIE Phases 1–5; ledger 96/266 admitted, 52 math-verified |
| Runtime: alerts / scans / other-timeframe for runtime documents | 🚫 refused by design (named) | `calcTimeframeCapability`, alert `lane` gate |
| Runtime: heavy scripts under the first-load budget (delta-rsi ≈ 4 s / 10k bars) | ⛔ blocked — owner decision (compile-to-JS is an architecture change) | Phase 5 report |
| TradingView parity probes Q-UIE3a/b (linear-regression, order-blocks) | ⛔ blocked — needs the owner's TradingView account | `capture-queue-2026-10-11-uie3-na-index-text.md` |
| thinkScript import | 🟡 partial: **10 of 24** real scripts translate and save (23 columns); the rest refuse by named guard (strategy, aggregation, state, time, study-ref…) | `__fixtures__/thinkscriptCorpus.json` ledger |
| TC2000 PCF import | 🟡 partial: ≥30 accepted real formulas produce the engine's OWN tree (by astHash); ≥21 refused by name | `pcf.test.js` |
| Pine import (member door) | 🟡 partial: 80 formula + 16 runtime of 266 corpus scripts; 170 refused by name | `docs/pine/uie-compatibility-ledger-2026-10-11.md` |
| **Alerts on a definition with level lines** | ✅ **Phase 6 (this branch)** — was OPEN-FINDINGS §1 | below |
| Agent seams (mutation interface, catalog with inputs, authoring draft) | ✅ complete | `agentMutations.js`, `AGENT-M3-CONTRACT.md`, `agent-seams-2026-10-11.md` |
| Open findings for other owners (colour sinks, light-theme tables, `useFundamentalSources` reload) | ⏳ not Indicators' | `OPEN-FINDINGS-2026-10.md` §4, §9, §10 |

## 3. Phase 6 milestone — level lines never block an alert

**Why this one.** It is the one open, Indicators-owned, member-facing defect in production with a
measured repro (OPEN-FINDINGS §1: "Build me an RSI with a moving average", then "alert me when RSI crosses
70" — refused, in engine language). It needs no flag, no new runtime and no shared Agent file.

**Root cause.** Both doors already treat an `hlines` plot as a guide — save (`user_definitions`: "not
data-bearing") and lint (`ast_lint`) — but the alert lane did not: a v2 document carries no tree for its
guide, `_make_value_fn` raised `plot`, and `plot` refuses the WHOLE definition. A v1 document was wrong the
other way: its guide fell back to `compute.ast`, so an alert armed on the guide would have watched the
formula's own number under the guide's name.

**Change (both lanes, held equal by the shared fixture):**
- `api/services/alert_user_series.py` — new gate `presentation` (`GATES`, `REFUSAL_FRAGMENTS`), raised in
  `_make_value_fn` BEFORE any tree lookup when the plot's declared style is `hlines`; added to
  `PER_PLOT_GATES`, so siblings stay admissible and `arm_for_alert` refuses only an alert on the guide.
- `app/src/components/chart/engine/evaluability.js` — the browser preflight mirror (`alertPlotGate`,
  `ALERT_PER_PLOT_GATES`), with a member sentence: "These are level lines — a guide drawn at fixed values…
  Alert on the indicator's own line instead (for example, RSI crossing above 70)."
- `tests/fixtures/ast/p1_evaluability_alert.json` — 4 cases (RSI + MA + levels: `rsi` and `ma` supported,
  `levels` refused/presentation; a v1 document's guide refused/presentation).

**Deployment note (not done):** `alert_user_series.py` is in flow-worker's reachable closure and not on its
watch list — a behaviour-changing strand: land in an after-hours/weekend window with a marker bump.

## 4. Competitiveness (demonstrated, not assumed)

- **TradingView:** UCT's member formula lane is a closed, proven grammar with alerts and scans from the
  SAME definition — a strength. Pine compatibility is real but partial (36% of a 266-script corpus admitted;
  the per-bar runtime that would raise it is dark and too slow for heavy scripts). Missing vs. Pine in
  production: per-bar runtime scripts (dark), strategies/backtests, libraries; `fill` exists as `band`
  (between two plot columns) and backgrounds as `bgcolor` paints.
- **thinkorswim:** thinkScript import covers simple studies (10/24); `rec`-state, aggregation periods,
  strategies and account functions refuse. No scan-over-state equivalent of TOS `rec` in the formula lane.
- **TC2000:** PCF import is the strongest of the three (the common PCF vocabulary maps to native trees,
  incl. `counttrue`/`sincetrue`/`trueinrow`), and UCT adds what TC2000 PCFs cannot do on a chart
  (multi-output panes, alerts with a repaint gate).

## 5. Recommended next milestone

**Alert-lane coverage for the remaining whole-definition refusals**, measured first: run the alert-lane
preflight over every saved member definition shape the corpus and Batch 1–2 produced and list which outputs
are still refused WITH their siblings (the class Phase 6 fixed for `hlines`). That is evidence-led and stays
inside the alert lane. A visual milestone (e.g. a shaded zone between two FIXED levels — `zones` is reserved)
should wait for a demand measurement, because `band` and the `bgcolor` paint already cover most of it.
