# Indicator End-Zone — Parallel Wave 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the eight disjoint lanes of Wave 1 — hygiene, the code editor, definition shape v2, closed table v2, the thinkScript translator, the screener authoring door + run-now, the continuous live sweep, and the Evidence tab — each behind its own measured yardstick, so a member can author a multi-plot indicator in a real editor, import from three languages, scan it live, and read its evidence.

**Architecture:** One jsep AST persisted as the artifact, two interpreters (JS + Python) at 1e-9, one closed table as the single vocabulary authority, one `def_hash` at every surface. Wave 1 widens the definition document (many trees, styles, placement), the table (a `clock` section, session windows, bounded state, pivots), the doors (editor, Import tab, `/screener` door, run-now) and the read paths (live overlay side table, Evidence receipt) — without moving any existing hash or growing the frozen alert grid.

**Tech Stack:** React 19 + Vite 7 + Vitest 4 (forks pool) · lightweight-charts 5.2 · jsep 1.4 · CodeMirror 6 (new, lazy chunk) · FastAPI + SQLite (WAL) · APScheduler jobs in `api/main.py` · `tools/ast_conformance.py` for two-lane parity.

**Spec:** `docs/superpowers/specs/2026-08-25-indicator-ecosystem-endzone-design.md` — §1 acceptance A1–A12, §4 non-negotiables, §5 architecture, §6 waves and file ownership.

**Lane contract (the executor of every task reads it first):** `.superpowers/sdd/endzone-wave1/00-lane-contract.md` — file ownership, the FIXED cross-lane interface names, the hand-back protocol, the two baselines.

## Global Constraints

- A thing that cannot be computed refuses **by name at its token** (`pine:*`, `pcf:*`, `thinkscript:*`, `budget:*`, `scan:*`, `picker:*`, `gate:*`, `let:*`); nothing resolves to a neighbour; no translator approximates a proprietary formula (`MS`/`TSV` stay refusals).
- **One object, one hash:** `def_hash == astHash(compute.ast)`; multi-plot adds `compute.trees`/`treesHash`/`scanPlot` and moves NO existing hash; `scan_hits`, `scan_coverage`, `definition_record` keys are untouched.
- **The closed table is the single authority:** every vocabulary, completion list, schema, sentence, picker row and translator map is DERIVED from `closedTable.json`; counts are pinned in BOTH directions and move with the manifest; `tableVersion` goes `1 → 2` exactly once (W2a Task 2).
- **Two lanes at 1e-9** for anything a scan can run: a new table entry lands in `closedTable.json` AND `api/services/ast_table.py`/`ast_interpret.py` with a fixture under `tests/fixtures/ast/` registered with `tools/ast_conformance.py`.
- **Closed-bar alerts; the linter is the brand:** lookforward is declared (`lookforward: 'argN'` → `preview-repaints`, k = the arg) or refused; `INDICATOR_FUNCS` does not grow (the `alert_replay --check` grid is frozen); user trees stay in `USER_FUNCS`.
- **Never a naked hit rate:** `HorizonResult` requires `baseline`; the Evidence UI renders strategy and baseline side by side or a named refusal.
- **No provider storm:** live paths read only the shared 30 s `scan_volume.full_market_snapshot()`; the prewarm ring goes through `bars_fetch`'s breaker-aware path; both pinned by AST rails in the `test_screener_live_tier.py` idiom.
- **Repo mechanics:** TDD per task; pathspec commits (`git commit -m "…" -- <paths>`); never `git add -A`; never push (the controller ships); frontend tests from `app/` with the default forks pool; backend tests from the worktree root; never edit `pine.js` through a heredoc; models in product code are `claude-opus-5` with a `cost_guard` entry; local surfaces on `127.0.0.1`.
- **Baselines to beat, measured 2026-08-25 in this worktree:** frontend `npx vitest run` 10,657 pass / 2 fail (pre-existing: `cotFactsEntry`, `StockChart.anchor`, `controlDoorCensus`); backend lane set 345 pass / 1 fail (`test_ast_scalars` partition — W2a Task 1 turns it green). A lane reports its own suite counts against these; a new red anywhere else blocks the lane's ship.
- **Every lane ends with a live-surface audit** against a real payload (the standing review → audit → ship cadence); a case that reads 0 both with and without its perturbation has measured nothing.

## File ownership (from the contract — a lane edits only its list; shared files use the hand-back protocol)

| lane | owns |
|---|---|
| W0 | `app/src/components/StockChart.jsx` (legend/colour paths), `binder.js` (colour re-apply only), `api/services/definition_concierge.py` (MODEL), `api/services/cost_guard.py`, `tests/test_definition_record.py`, `api/services/definition_record.py` (escaping write), `nativeRegistry.js` (`AST_DEFS`), `IndicatorLibraryDialog.jsx` (own-formula badge) |
| W1a | new `app/src/components/chart/builder/editor/**`, `app/package.json` + lock, `FormulaField.jsx` (mount) |
| W1b | `defSchema.js`, `BuilderSheet.jsx` + css, `builderInputs.js`, new `engine/ast/letPrepass.js`, new `engine/ast/trees.js`, `binder.js` (plots/placement, additive), `api/services/user_definitions.py` (v2 validation), `api/services/ast_interpret.py` (`interpret_trees`, additive) |
| W2a | `closedTable.json`, `interpret.js`, `lint.js`, `budget.js`, `freshness.js`, `sentence.js`, `pcf.js` (TC2000 remainder), `api/services/ast_table.py`, `ast_interpret.py` (sections), `ast_lint.py`, `ast_budget.py`, `ast_freshness.py`, `tests/fixtures/ast/*`, `tools/ast_conformance.py`, `tests/test_ast_*.py`, the `computeVWAP` owner file |
| W3 | new `engine/ast/thinkscript.js` + tests, new `engine/ast/dialect.js`, `PineBox.jsx` (→ `ImportBox`), `tests/fixtures/thinkscript/**` |
| W4a | `app/src/pages/Screener.jsx`, `pages/screener/ScreensManager.jsx`, new `api/routers/scan_run.py`, new `tests/test_scan_run.py`, new `components/screener/RunNowButton.jsx`, `api/main.py` (one include line) |
| W4b | `api/services/screener/scan_evaluator.py` (live mode), `scan_store.py` (`scan_hits_live` + overlay), `api/main.py` (scheduler block), `api/worker_main.py` (prewarm ring), `api/routers/scan_results.py` (tier fields), new `tests/test_scan_live_sweep.py` |
| W5a | new `builder/EvidenceTab.jsx` + css + tests, the `ScanResults` component (Evidence button), `api/services/screener/backtest.py` (controls, additive), `api/routers/screener_backtest.py` (def-based body) |

## Cross-lane interfaces (fixed names — see the contract for the full shapes)

- Definition v2: `compute: { kind:'ast', fn: astHash(compute.ast), rev, ast, source, trees?, treesHash?, scanPlot? }`; `plots[].style|lineWidth|color|levels|fill.with`; `placement.target: 'overlay'|'pane'`.
- Engine entries: JS `interpret(ast, bars, inputs, budget, scalars)`; Python `interpret(tree, bars, inputs=None, scalars=None)` + `interpret_trees(trees, bars, inputs, scalars) -> dict`.
- Closed table v2: `tableVersion: 2`; `clock` section; functions `vwap, avwap, obvN, barssince, valuewhen, highestbars, lowestbars, pivothigh, pivotlow, stochWorden, aroonUp, aroonDown, bop`; lookback grammar `session`; `lookforward: 'argN'`.
- `let` pre-pass: `prepareSource(source) -> { source, bindings[] }` in `engine/ast/letPrepass.js` (W1b), consumed by the editor's diagnostics (W1a) and `buildDefinition`.
- Import: `ImportBox` (= `PineBox` props + `dialect`), `inspectSource(source, dialect)`, `translateThinkScript(source)`, `detectDialect(source)` in `engine/ast/dialect.js`.
- Run-now: `POST /api/scans/run` → `{def_hash, as_of, tier:'on-demand', hits[], coverage{}}`; `scan_evaluator.note_demand(symbols)` (W4b provides, W4a calls).
- Live sweep: `run_sweep(mode='live', deadline)`, `scan_hits_live`, `hits_for(def_hash, tf)` rows carry `tier`, receipt `{cycle_started, cycle_seconds, definitions, evaluated, answered, skipped_reason}`, flag `SCAN_LIVE_SWEEP_ENABLED`.
- Evidence: `POST /api/screener/backtest` (+ `def_id` body) → `{job}`; `GET /api/screener/backtest/{job}` → `Receipt` (+ `method.winsorised`, `method.same_day_control`, `horizons[].strategy.avg_pct_winsorised`).

## Execution order

Wave 1 lanes run **in parallel**, one implementer per lane, tasks inside a lane in order, per-task review (spec compliance → code quality) before the next task starts. Merge order at the end of the wave: W2a → W1b → W0 → W1a → W3 → W4b → W4a → W5a (engine before its consumers; the two `binder.js` editors and the two `api/main.py` editors resolve by hand-back notes). Then the whole-tree gates (both suites, conformance, `alert_replay --check` byte-identical) and the wave's live audit on production.

---

<!-- LANE SECTIONS (W0 · W1a · W1b · W2a · W3 · W4a · W4b · W5a) are appended below from .superpowers/sdd/endzone-wave1/lanes/*.md after controller review. -->
