# UCT Agent — Phase 2: Real-model validation, generalized execution, product intelligence

Branch `feat/agent-intelligence-p2` (worktree `C:\w\agent-p1`), on Phase 1 (`feat/agent-intelligence-p1`,
rebased onto master `b0dd21dc67`). Evolution of the existing Agent: same registry, planner, composer,
runtime, approvals, receipts and Undo. Admin-only, unchanged.

## What changed

| Milestone | Change |
|---|---|
| M1 spending | `UCT_AGENT_COST_CAP_DAILY` — an OPT-IN daily dollar ceiling on the Agent route (checked before every model call and before the background naming call). Unset = production behaviour unchanged. Before this the route had a request-count cap only. |
| M1 live batch | `tools/agent_live_batch.py` + `agentLiveCapture.test.jsx`: the exact panel requests, sent through the server's own `run_turn` with research off; nothing executed; dry run by default; `--run` needs the key AND `--max-usd`, and stops before any call whose worst case could pass it. **Not run — awaiting owner approval.** |
| M2 phrasing | One shared normalizer (`fastPath.canon`) over the existing capability phrases: synonyms (throw/stick/plot → add; get rid of/take off/ditch → remove; never "delete"), number words, `5m`/`1h` shorthand (never a money amount), "20-period exponential moving average", "this/my/the/main/that chart", "now…/ok…" lead-ins; verb carry ("add VWAP and RSI"); mixed-kind commands resolve when every kind has exactly one target. `indicator.remove` by the indicator's kind ("get rid of RSI"), still a proposal. |
| M2 execution | Indicator edits stay exclusive (their own rule) but are `sequential`: extra ones run as their own steps after the rest, each with receipt + Undo. Steps that were on an approved card run as approved (re-validated, never re-asked). The policy counts a chart and its indicators as one target. |
| M3 defaults | "my watchlist" = the shown list, or the only list; "my trading layout" = the ONE layout named with those words (opening only); `screener.run within` a member's list (the Screener's own My Lists universe, `wl:<id>`); prompt: concepts run UCT's starter/saved screen by name, never invented criteria; "strongest" = RS Rank (said). |
| M4 workflows | A (symbol + timeframe + indicator, 0 model calls), C (open list + symbol, 0), D (screen + save + show: writes now see the same request's reads), E (follow-up timeframe + remove, 0; removal still approved). |
| M5 speed | Context refresh only for the routed groups (alerts/digest/saved screens were re-read before EVERY model turn): 3.6 → 0.9 reads per model-path task. Eval rows now profile exec ms, request bytes, pre-model reads. |
| M6 parity | Agent links carry exactly the filters the Agent ran (tested); latest-session conditions are named on the link and a saved screen is REFUSED rather than saved broader. |

## Benchmark — `agentEval.test.jsx`, 24 tasks, same fixtures, same manifest-aware scripted model, run alone

| | master `b0dd21dc67` | Phase 1 | Phase 2 |
|---|---|---|---|
| Tasks completed | 67% | 88% | **100%** |
| Tasks with an unnecessary question | 18% | 0% | 0% |
| Necessary questions asked | 100% | 100% | 100% |
| Model calls per task | 1.00 | 0.71 | **0.54** |
| Model calls, 9 simple commands | 6 | 1 | 1 |
| Approval violations | 0 | 0 | 0 |
| Pre-model reads per model task | 3.6 | 3.6 | **0.9** |
| Request size per task (KB) | 21.8 | 16.8 | **11.5** |
| Local ms p50 / p95 | 111 / 232 | 111 / 358 | 140 / 419 |

Local ms is the panel's own processing (no model): Phase 2 is higher because it now completes work
master refused (paged scans, multi-step workflows). Real-model latency is NOT measured here.

## Capability audit (from the Agent's own registry, `discovery.js`)

| Area | Status | Gaps |
|---|---|---|
| Charts (symbol, timeframe incl. custom, type, scale, session, go-to-date, compare, tabs) | 1 Fully operational | replay; removing a custom timeframe |
| Chart settings (themes, templates, defaults, colours, approved display settings, volume) | 2 Partial | ~35 settings not eligible (volume pane/MA styling, watermark position/opacity, Heikin Ashi …) |
| Indicators on a chart (list/add/remove/show/hide built-in + own) | 2 Partial | **inputs (a 20 EMA's period/type), colours, pane** — 3 Available in UCT, not exposed: the Indicators interface (`agentMutations`, MUTATION_OPS add/remove/setVisible) adds at defaults only |
| Custom indicators (Create Indicator draft/preview/save) | 2 Partial | editing saved indicators; indicator alerts |
| Watchlists (show/create/rename/add/remove/clear/delete/copy/open) | 1 Fully operational | reorder/sort, notes, tags — 3 not exposed |
| Screener (numeric/yes-no/list fields, latest-session measures, within a list, refine, full results) | 2 Partial | field-vs-field, logic/ranking in new screens, custom-date sort |
| Saved screens (list/run/save/copy/rename/delete) | 1 Fully (save refuses latest-session screens) | overwrite (waits on Screener revisions) |
| Layouts (list/open/save as/rename/duplicate/delete/create/save current) | 1 Fully operational | version history, dock pins, sharing |
| Widgets (add into empty space, add charts, show list/scan) | 2 Partial | other widgets' settings |
| Board (remove/move/resize/arrange/link/tabs) | 1 Fully operational | floating/pop-out/merge |
| Drawings (horizontal level, style, remove, list) | 2 Partial | trendlines/rectangles/Fib/text (need time anchors, Batch 8b) |
| Alerts (price above/below: list/create/delete) | 2 Partial | indicator/trendline alerts (Indicators), snooze/re-arm |
| Stock info & news (profile, earnings, compare, news, catalysts) | 1 (read-only) | calendar, ownership, insiders, ETF holdings, options flow |
| App settings & navigation | 1 Fully operational | — |
| Backtest, screenshot rebuild, history questions, similar setups | 5 Not implemented in UCT (roadmap stages) | — |

## Integration handoffs (not done here — another lane owns them)

1. **Latest-session dollar volume in the Screener** (Agent ⇄ Screener parity). A real screener column
   `dollar_vol_1d` (= the row's newest bar close × volume, the `bars_asof` session, `_SINGLE_BAR`) was
   built and tested in screener-owned code (`snapshot_db.COLUMNS`, `technicals.compute_technicals`,
   `filters.FILTERS`) and then REVERTED: two census rails require every screener column to be declared
   by the Indicators engine — `tests/test_ast_scalars.py::test_the_scalar_section_PARTITIONS_snapshot_db_COLUMNS_exactly`
   and `tests/test_scan_store.py::test_the_screener_COLUMN_SET_still_partitions_into_E1s_frozen_manifest`
   (`ast_table` scalars / excluded columns). Needed from Indicators: one decision — `dollar_vol_1d` is a
   scalar or an excluded column. Then the column (3 small edits), a snapshot rebuild, and the Agent's
   session measure maps to it so a saved screen keeps the condition. Freshness note: the snapshot is
   nightly (its newest bar), the Agent measure uses the newest session whose 16:00 close has passed —
   they differ between the close and the nightly rebuild.
2. **Indicator inputs** ("a 20 EMA", "the 50-day moving average"): an `add` with inputs (or a
   `setInputs` op) in `components/chart/builder/agentMutations.js` (Indicators). Until then the Agent
   adds indicators at their defaults only and must say so.

## Live-model batch (Milestone 1) — plan, NOT RUN

- Model `claude-haiku-4-5` (`UCT_AGENT_MODEL` default), $1 / $5 per million input / output tokens.
- Billed account: whichever Anthropic account owns the `ANTHROPIC_API_KEY` exported for the run (the
  same variable production reads on Railway). This machine has no key; nothing was called.
- 14 requests (the 10 representative ones, 3 phrasing variants, 1 follow-up), one call each, research off.
  Measured prompt sizes 8.4k–16.4k tokens. Typical ≈ $0.19; worst case (every call at 2,048 output
  tokens) ≈ $0.31. Proposed ceiling: `--max-usd 1.00`.
- Isolation: no browser, no database, no workspace, no member data — plans are scored, never executed.
- Command: `python tools/agent_live_batch.py <bodies.json> --run --max-usd 1.00 --out results.json`
  (bodies from `AGENT_LIVE_OUT=… AGENT_LIVE_FIELDS=… npx vitest run src/agent/agentLiveCapture.test.jsx`).
