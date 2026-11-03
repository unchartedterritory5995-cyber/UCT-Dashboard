# BOARD.md — Wave 1 task graph

States: `todo` · `doing` · `pr` (PR open, number) · `int` (merged to agent/int) · `rc` (in a release candidate) · `done` (on master, verified) · `blocked (why)`. Only the integrator sets `int`/`rc`/`done`. Builders edit their own rows in every PR. Evidence = test counts, eval set + score, or verification note.

## W1-A Planner (builder-a, `agent/w1/planner`)
| id | task | paths | depends | state | PR | evidence |
|---|---|---|---|---|---|---|
| A-01 | `contracts/STEP-1.md`: step protocol (server loop ↔ browser executor), frozen for the wave | docs/agent/program/contracts/STEP-1.md | — | todo | | |
| A-02 | Eval prerequisites (free): `UCT_AGENT_EFFORT` → `output_config.effort`, MAX_TOKENS 4096 when thinking is on; Haiku 5.5 row in `narrative_cost_guard._PRICES`; capture bodies for dev-nl1 / live batch / latency (no model calls); dry-run cost estimates recorded in EVAL.md | api/services/uct_agent/turn.py, api/services/narrative_cost_guard.py, app/src/agent/agent*Capture*.test.* | — | todo | | |
| A-03 | Cumulative cross-run eval ledger: `tools/agent_eval_ledger.py` (shared SQLite, BEGIN IMMEDIATE, reserve worst case before every call, settle with actual usage incl. cache write/read + thinking, hard cumulative cap read from a file the owner sets; every eval runner must acquire it) | tools/agent_eval_ledger.py, tools/agent_eval_run.py, tools/agent_live_batch.py, tools/agent_latency_probe.py, tools/agent_live_chain.py, tests/test_uct_agent_eval_ledger.py | — | todo | | |
| A-04 | Server loop `run_turn_v2` behind `UCT_AGENT_PLANNER=v2` (default off): tools from the manifest (12 always-loaded domain tools + deferred capability tools + tool search), ≤ N rounds (6) with per-turn $ cap, per-step `sanitize`/`enforce_approval`, step events streamed; scripted-model tests only | api/services/uct_agent/turn_v2.py (new), turn.py (dispatch only), api/routers/uct_agent.py (stream events), tests/test_uct_agent_planner_v2*.py | A-01 | todo | | |
| A-05 | Browser step executor: each step → `planOps`/`decideMode`/`commitPlan` → tool_result back; proposal pauses the loop; "do it" resumes; turn-level Undo group ("undo all of that") | app/src/agent/useAgent.js (v2 path only), app/src/agent/steps.js (new), app/src/agent/agentPlannerV2*.test.jsx | A-01 | todo | | |
| A-06 | Deterministic acceptance for the flagship scenario with the scripted model (every step executes against the panel harness, receipts + one approval card + Undo) | app/src/agent/agentFlagshipV2.test.jsx | A-04, A-05 | todo | | |
| A-07 | Model-path evaluation (PAID — blocked until the owner authorizes and spending controls are verified) | tools/, docs/agent/program/EVAL.md | A-02, A-03, owner | blocked (owner) | | |

## W1-B Operator (builder-b, `agent/w1/operator`)
| id | task | paths | depends | state | PR | evidence |
|---|---|---|---|---|---|---|
| B-01 | Time-anchored drawings: `drawing.addTrendline`, `addRay`, `addHorizontalRay`, `addRectangle`, `addFib`, `addText`, `addAvwap` (points as date+price → `drawingTimeFor`, `validateDrawing`), Undo by id, tracings read-back | app/src/agent/capabilities/drawings.js, app/src/agent/agentDrawingsAnchored.test.jsx, contract golden | — | todo | | |
| B-02 | Dated close / point-in-time phrasing on `stock.dailyBars` ("close last Friday", "high on 10-15") using the adapter's `to` | app/src/agent/capabilities/marketDataBars.js, marketDataPhrases.js, agentDataBars.test.js | — | todo | | |
| B-03 | Indicator-alert target kind: `indicatorAlert.create/toggle/delete` over `hooks/useIndicatorAlerts.js` (announce to Indicators) | app/src/agent/capabilities/indicatorAlerts.js (new), builtins.js, host.js adapter, agentIndicatorAlerts.test.jsx | — | todo | | |
| B-04 | Chart settings KNOWN → ELIGIBLE rows (bgGradient, header toggles, volume MA/colours/style, watermark, markers, heikinAshi, darkPool, positionCalc) with types/options; announce to Charts | app/src/components/chart/chartSettingsDescriptors.js, app/src/agent/capabilities/chart.js tests | — | todo | | |
| B-05 | Generic `widget.setOption {widget, key, value}` validated against `widgets/registry.js` param schemas, committed via `handleOptsChange`, exact Undo | app/src/agent/capabilities/workspace.js or board.js, host.js, agentWidgetOptions.test.jsx | — | todo | | |
| B-06 | `chart.replay {date|null}` via `openReplay`/`replayCutoff` | app/src/agent/capabilities/chart.js, host.js, ChartWidget adapter | — | todo | | |
| B-07 | Flagship scenario pieces exercised deterministically: open two charts in the bottom row + 9/20 EMA + save layout "Momentum Review" (existing caps) composed in one scripted plan | app/src/agent/agentFlagshipOperator.test.jsx | — | todo | | |

## W1-C Data + scan (builder-c, `agent/w1/data-scan`)
| id | task | paths | depends | state | PR | evidence |
|---|---|---|---|---|---|---|
| C-01 | `lastScreen` refinement state persisted per conversation server-side; refinements compose ("now only tech", "exclude under $10", "sort by 3-month") onto it; F-16 refusals offer a public alternative | api/services/uct_agent/scan/, store.py, app/src/agent/capabilities/screener.js, agentScanRefine.test.jsx, tests/test_uct_agent_scan_refine.py | — | todo | | |
| C-02 | Wire `fundamentals`, `earnings`, `news.company`, `themes` kinds to `stock.*` capabilities with MD-1 freshness wording | app/src/agent/capabilities/marketData*.js, stock.js, agentData*.test.js, tests/test_uct_agent_data_*.py | — | todo | | |
| C-03 | Index / commodity / crypto: dedicated kinds (`index.quote`, `commodity.quote`, `crypto.quote`) with licensing-class rows and an honest decline when no licensed source exists; the resolver routes "gold", "oil", "s&p", "btc" to them, never to a ticker guess | api/services/uct_agent/marketdata/kinds.py, instruments.py, provider_licensing_class.py rows, tests/test_uct_agent_data_instruments*.py | — | todo | | |
| C-04 | Legacy `stock.js`/`alert.js` quote reads moved onto the gateway; new rail: no Agent path calls `/api/live-prices` | app/src/agent/capabilities/stock.js, alert.js, app/src/agent/qa/noLivePrices.test.js | — | todo | | |
| C-05 | Flagship scan slice deterministic: "above 20 EMA, volume ≥ 2x avg, price ≥ $10, top 5 by 3-month change" as a validated SC-1 spec (public fields only) → result set → `watchlist.create`+`add` composition | app/src/agent/agentFlagshipScan.test.jsx, tests/test_uct_agent_scan_flagship.py | C-01 | todo | | |

## W1-SEC F-16/F-23 (sec-integrator, `agent/w1/f16-f23`)
| id | task | paths | depends | state | PR | evidence |
|---|---|---|---|---|---|---|
| S-01 | Merge #654 (server), #657 (client), #661 (rails), #666 (F-23) onto current master by merge commits; resolve conflicts; keep the original authorship | as in those PRs | — | todo | | |
| S-02 | Run: `tests/test_uct_agent_qa_isolation*.py`, `tests/test_uct_agent_qa_member_refused.py`, F-16 rails (server 40 + browser 13), `tests/test_uct_agent_scan*.py`, `qa/*.test.*`; record counts | — | S-01 | todo | | |
| S-03 | One PR into `agent/int` superseding the four, with a diff summary and the isolation-audit cells 23/24 status | — | S-02 | todo | | |
| S-04 | Independent verification by a review subagent with the diff only (integrator) | — | S-03 | todo | | |

## W1-I Integration (integrator)
| id | task | state | evidence |
|---|---|---|---|
| I-01 | `agent/int` fast-forwarded to master `67a6dada10`; five worktrees provisioned | done | this file |
| I-02 | PROGRAM.md / BOARD.md / EVAL.md seeded | done | |
| I-03 | `agent-ci.yml` (server + 4-shard browser + union rail) on `agent/**` pushes and PRs | doing | |
| I-04 | `agent-ci-benchmark.yml` on branch `ci/agent-shard-benchmark`: unsharded vs 4-shard wall time | doing | |
| I-05 | #684 (already marked merged by GitHub once agent/int contained it) and #665 closed with containment evidence | done | rev-list 0 |
| I-06 | Spending-controls report (owner's mandate) | doing | audit-H |
| I-07 | Production flag verification (owner runs the read-only command) | blocked (owner) | |
| I-08 | RC1 (B + C + SEC if green) | todo | |
| I-09 | RC2 (A) | todo | |
| I-10 | Notify Indicators/News/Charts sessions of Wave 1 branches and RC windows | doing | |
