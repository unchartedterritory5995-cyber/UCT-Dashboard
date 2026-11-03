# BOARD.md — Wave 1 task graph

States: `todo` · `doing` · `pr` (PR open, number) · `int` (merged to agent/int) · `rc` (in a release candidate) · `done` (on master, verified) · `blocked (why)`. Only the integrator sets `int`/`rc`/`done`. Builders edit their own rows in every PR. Evidence = test counts, eval set + score, or verification note.

## W1-A Planner (builder-a, `agent/w1/planner`)
| id | task | paths | depends | state | PR | evidence |
|---|---|---|---|---|---|---|
| A-01 | `contracts/STEP-1.md`: step protocol (server loop ↔ browser executor), frozen for the wave | docs/agent/program/contracts/STEP-1.md | — | rc | #712/#713/#714 | merged into agent/int; in RC #718 |
| A-02 | Eval prerequisites (free): `UCT_AGENT_EFFORT` → `output_config.effort`, MAX_TOKENS 4096 when thinking is on; Haiku 5.5 row in `narrative_cost_guard._PRICES`; capture bodies for dev-nl1 / live batch / latency (no model calls); dry-run cost estimates recorded in EVAL.md | api/services/uct_agent/turn.py, api/services/narrative_cost_guard.py, app/src/agent/agent*Capture*.test.* | — | rc | #712/#713/#714 | merged into agent/int; in RC #718 |
| A-03 | **Owner-approved 2026-11-02; acceptance = the six proofs in EVAL.md §0.** Cumulative cross-run eval ledger: `tools/agent_eval_ledger.py` (shared SQLite, BEGIN IMMEDIATE, reserve worst case before every call, settle with actual usage incl. cache write/read + thinking, hard cumulative cap read from a file the owner sets; every eval runner must acquire it) | tools/agent_eval_ledger.py, tools/agent_eval_run.py, tools/agent_live_batch.py, tools/agent_latency_probe.py, tools/agent_live_chain.py, tests/test_uct_agent_eval_ledger.py | — | rc | #712/#713/#714 | merged into agent/int; in RC #718 |
| A-04 | Server loop `run_turn_v2` behind `UCT_AGENT_PLANNER=v2` (default off): tools from the manifest (12 always-loaded domain tools + deferred capability tools + tool search), ≤ N rounds (6) with per-turn $ cap, per-step `sanitize`/`enforce_approval`, step events streamed; scripted-model tests only | api/services/uct_agent/turn_v2.py (new), turn.py (dispatch only), api/routers/uct_agent.py (stream events), tests/test_uct_agent_planner_v2*.py | A-01 | rc | #712/#713/#714 | merged into agent/int; in RC #718 |
| A-05 | Browser step executor: each step → `planOps`/`decideMode`/`commitPlan` → tool_result back; proposal pauses the loop; "do it" resumes; turn-level Undo group ("undo all of that") | app/src/agent/useAgent.js (v2 path only), app/src/agent/steps.js (new), app/src/agent/agentPlannerV2*.test.jsx | A-01 | rc | #712/#713/#714 | merged into agent/int; in RC #718 |
| A-06 | Deterministic acceptance for the flagship scenario with the scripted model (every step executes against the panel harness, receipts + one approval card + Undo) | app/src/agent/agentFlagshipV2.test.jsx | A-04, A-05 | rc | #712/#713/#714 | merged into agent/int; in RC #718 |
| A-07 | Model-path evaluation (PAID — blocked until the owner authorizes and spending controls are verified) | tools/, docs/agent/program/EVAL.md | A-02, A-03, owner | blocked (owner) | | |

## W1-B Operator (builder-b, `agent/w1/operator`)
| id | task | paths | depends | state | PR | evidence |
|---|---|---|---|---|---|---|
| B-01 | Time-anchored drawings: `drawing.addTrendline`, `addRay`, `addHorizontalRay`, `addRectangle`, `addFib`, `addText`, `addAvwap` (points as date+price → `drawingTimeFor`, `validateDrawing`), Undo by id, tracings read-back | app/src/agent/capabilities/drawings.js, app/src/agent/agentDrawingsAnchored.test.jsx, contract golden | — | int | #707 | reviewed (APPROVE after fixes), agent-ci green, merged into agent/int 53f6607acc |
| B-02 | Dated close / point-in-time phrasing on `stock.dailyBars` ("close last Friday", "high on 10-15") using the adapter's `to` | app/src/agent/capabilities/marketDataBars.js, marketDataPhrases.js, agentDataBars.test.js | — | int | #707 | reviewed (APPROVE after fixes), agent-ci green, merged into agent/int 53f6607acc |
| B-03 | Indicator-alert target kind: `indicatorAlert.create/toggle/delete` over `hooks/useIndicatorAlerts.js` (announce to Indicators) | app/src/agent/capabilities/indicatorAlerts.js (new), builtins.js, host.js adapter, agentIndicatorAlerts.test.jsx | — | int | #711 | reviewed (APPROVE after fixes), agent-ci green, merged into agent/int 53f6607acc |
| B-04 | Chart settings KNOWN → ELIGIBLE rows (bgGradient, header toggles, volume MA/colours/style, watermark, markers, heikinAshi, darkPool, positionCalc) with types/options; announce to Charts | app/src/components/chart/chartSettingsDescriptors.js, app/src/agent/capabilities/chart.js tests | — | int | #711 | reviewed (APPROVE after fixes), agent-ci green, merged into agent/int 53f6607acc |
| B-05 | Generic `widget.setOption {widget, key, value}` validated against `widgets/registry.js` param schemas, committed via `handleOptsChange`, exact Undo | app/src/agent/capabilities/workspace.js or board.js, host.js, agentWidgetOptions.test.jsx | — | int | #715 | reviewed (APPROVE after fixes), agent-ci green, merged into agent/int 53f6607acc |
| B-06 | `chart.replay {date|null}` via `openReplay`/`replayCutoff` | app/src/agent/capabilities/chart.js, host.js, ChartWidget adapter | — | int | #715 | reviewed (APPROVE after fixes), agent-ci green, merged into agent/int 53f6607acc |
| B-07 | Flagship scenario pieces exercised deterministically: open two charts in the bottom row + 9/20 EMA + save layout "Momentum Review" (existing caps) composed in one scripted plan | app/src/agent/agentFlagshipOperator.test.jsx | — | int | #715 | reviewed (APPROVE after fixes), agent-ci green, merged into agent/int 53f6607acc |

## W1-C Data + scan (builder-c, `agent/w1/data-scan`)
| id | task | paths | depends | state | PR | evidence |
|---|---|---|---|---|---|---|
| C-01 | `lastScreen` refinement state persisted per conversation server-side; refinements compose ("now only tech", "exclude under $10", "sort by 3-month") onto it; F-16 refusals offer a public alternative | api/services/uct_agent/scan/, store.py, app/src/agent/capabilities/screener.js, agentScanRefine.test.jsx, tests/test_uct_agent_scan_refine.py | — | int | #708 | reviewed (APPROVE), agent-ci green, merged into agent/int 115353ff60 |
| C-02 | Wire `fundamentals`, `earnings`, `news.company`, `themes` kinds to `stock.*` capabilities with MD-1 freshness wording | app/src/agent/capabilities/marketData*.js, stock.js, agentData*.test.js, tests/test_uct_agent_data_*.py | — | int | #705 | reviewed (APPROVE), agent-ci green, merged into agent/int 115353ff60 |
| C-03 | Index / commodity / crypto: dedicated kinds (`index.quote`, `commodity.quote`, `crypto.quote`) with licensing-class rows and an honest decline when no licensed source exists; the resolver routes "gold", "oil", "s&p", "btc" to them, never to a ticker guess | api/services/uct_agent/marketdata/kinds.py, instruments.py, provider_licensing_class.py rows, tests/test_uct_agent_data_instruments*.py | — | int | #706 | reviewed (APPROVE), agent-ci green, merged into agent/int 115353ff60 |
| C-04 | Legacy `stock.js`/`alert.js` quote reads moved onto the gateway; new rail: no Agent path calls `/api/live-prices` | app/src/agent/capabilities/stock.js, alert.js, app/src/agent/qa/noLivePrices.test.js | — | int | #705 | reviewed (APPROVE), agent-ci green, merged into agent/int 115353ff60 |
| C-05 | Flagship scan slice deterministic: "above 20 EMA, volume ≥ 2x avg, price ≥ $10, top 5 by 3-month change" as a validated SC-1 spec (public fields only) → result set → `watchlist.create`+`add` composition | app/src/agent/agentFlagshipScan.test.jsx, tests/test_uct_agent_scan_flagship.py | C-01 | todo | | |

## W1-SEC F-16/F-23 (sec-integrator, `agent/w1/f16-f23`)
| id | task | paths | depends | state | PR | evidence |
|---|---|---|---|---|---|---|
| S-01 | Merge #654 (server), #657 (client), #661 (rails), #666 (F-23) onto current master by merge commits; resolve conflicts; keep the original authorship | as in those PRs | — | int | #704 | merges e6f2794dcb/591f78f467/ee7257460f/337b4335c4 + lead test patch 9ca67b7e89; 3 docs-only conflicts |
| S-02 | Run: `tests/test_uct_agent_qa_isolation*.py`, `tests/test_uct_agent_qa_member_refused.py`, F-16 rails (server 40 + browser 13), `tests/test_uct_agent_scan*.py`, `qa/*.test.*`; record counts | — | S-01 | int | #704 | full vitest 2572 passed; qa_f16+scan 345 passed; cells 23/24 PROVEN; mutation (un-hide rs_rank) → 10 red |
| S-03 | One PR into `agent/int` superseding the four, with a diff summary and the isolation-audit cells 23/24 status | — | S-02 | int | #704 | merged into agent/int; final head 2b0c3d6f60 (CI-robust diff-base rail); agent-ci green |
| S-04 | Independent verification by a review subagent with the diff only (integrator) | — | S-03 | done | #704 | round 1: BLOCKING server bypass found (rank criteria validated by `column`, screener reads `key`; rails vacuous) → fixed in 14750ed95e, mutation 39 red on old validate; round 2: APPROVE. Residuals recorded: `rs_line_trend`/`candle_recent_bars_ago` visible (owner call); `scan/screen.py last_closed_session` 16:00 rule for staleness note |

## W1-I Integration (integrator)
| id | task | state | evidence |
|---|---|---|---|
| I-01 | `agent/int` fast-forwarded to master `67a6dada10`; five worktrees provisioned | done | this file |
| I-02 | PROGRAM.md / BOARD.md / EVAL.md seeded | done | |
| I-03 | `agent-ci.yml` (server + 4-shard browser + union rail) on `agent/**` pushes and PRs | done (rail amended 3356d5a4b2, owner-approved) | first run: 4 shards green, union rail green (143 passed/5 skipped); server job red on 2 deploy-gate rails → promotion-gate:no headers added; `test_no_OTHER_workflow_is_an_agent_gate` deselected in agent-ci only, PENDING OWNER decision to amend the rail (exempt promotion-gate:no workflows); these workflows must not reach master before that |
| I-04 | `agent-ci-benchmark.yml` on branch `ci/agent-shard-benchmark`: unsharded vs 4-shard wall time | done | run 41552662282 (ubuntu-latest): unsharded job 18 min 36 s wall; shards 4:58 / 4:58 / 5:41 / 5:52 (parallel) → slowest 5:52; same 143 passed / 5 skipped; equivalence rail green |
| I-05 | #684 (already marked merged by GitHub once agent/int contained it) and #665 closed with containment evidence | done | rev-list 0 |
| I-06 | Spending-controls report (owner's mandate) | done | appendix H; owner decision recorded in EVAL.md §0 |
| I-07 | Production flag verification (owner runs the read-only command) | blocked (owner) | |
| I-08 | ONE combined Wave 1 RC (SEC + A + B + C + #716 + Agent CI) | done → DEPLOYED: master 463a4bcba5 (PR #718, owner GO), gate passed, promoted 04:21Z, live 04:30:42Z (bundle index-ePgCEn0Q.js); flags untouched; Phase 1 live testing next (I-12) | manifest RELEASE-W1-MANIFEST.md; QA-W1-COMBINED.md; Agent CI on 6342332731: 2095 / 2688 / 0 |
| I-09 | (folded into I-08 by owner decision: no separate deploys) | done | |
| I-11 | LIVE-TESTING.md (Phase 1 checklist) + OWNER-ACCEPTANCE.md (Phase 2 suite, 38 prompts, scorecard) ready before deployment | done | committed b8af07c506 |
| I-12 | Phase 1 live production testing | done (first pass 2026-11-03 04:45–05:30Z): ~55 turns, 41 model calls ≈ $0.64; verdict TECHNICALLY DEPLOYED; findings LT-1..LT-12 (LT-3, LT-4, LT-8 to fix before Phase 2 scoring); flags were already all ON (no activation needed) | LIVE-TESTING-RESULTS-2026-11-03.md |
| I-13 | Phase 2 owner hands-on acceptance session; scorecard | todo | after I-12 |
| I-10 | Notify Indicators/News/Charts sessions of Wave 1 branches and RC windows | done | blake-4c (News #629) and blake-ee (News widget) acked: no master RC pending, no Agent files touched |

## Wave 1.1 repairs (overnight 2026-11-03; branches agent/w11/*, PRs into agent/int; one RC; conditional deploy)
| id | task | owner | state | PR | evidence |
|---|---|---|---|---|---|
| R-01 | LT-3: live model's args for chart.setSetting promoted rows, chart.replay (exit), screener refinement sort, widget.addCharts+indicators are refused as off-schema; make the server's compact-args expansion accept what the production model actually sends (and tighten hints), with regression tests that replay the exact failing shapes | repair-a | pr (draft) | #725 | agent/w11/args 74a9b21cf4; pytest 2222; full vitest unconfirmed |
| R-02 | LT-1: empty-board "add a daily chart of nvda to this board" → plans widget.addCharts, not a chart target | repair-a | pr (draft) | #725 | same |
| R-03 | LT-9: "rename <layout> to x" → layout.rename (protected-layout refusal reachable); LT-10: nonsense input → clarify with choices, never the FAILED sentence | repair-a | pr (draft) | #725 | same |
| R-04 | LT-4: routing offers the indicatorAlerts group for cross/alert phrasings; the planner never claims "can't create them yet" when the capability is in the manifest | repair-b | pr (draft) | #727 | agent/w11/routing-f16 b923e69f8c; vitest full 155 files green; pytest run 2 unconfirmed |
| R-05 | LT-8: hidden-field phrases ("rs rank", "uct rating", "composite"…) in refinements and new screens hit the F-16 sentence BEFORE any catalog look-alike mapping; LT-11: the refusal offers the public alternative on every path | repair-b | pr (draft) | #727 | same |
| R-06 | LT-12: "when does X report" surfaces the next report date; F-16/F-23 isolation re-check on the merged tree | repair-b | pr (draft) | #727 | same |
| R-07 | Investigation record: which production flags were on before Wave 1 and since when; `charts_active_template` read-only verification | integrator | doing | — | FLAGS-INVESTIGATION-2026-11-03.md written; template read-back pending the live rerun |
| R-08 | Wave 1.1 RC: independent review of the combined diff, agent-ci green, master sync, conditional deploy decision per the eight conditions; live rerun of the failed scenarios | integrator | HOLD | — | owner (07:00Z): no merges/deploys until they return; RELEASE-W11-CHECKLIST.md unfilled; RC not cut |

## Wave 2 (overnight start 2026-11-03; integration branch agent/int-w2; NOT deployed)
| id | task | owner | state | PR | evidence |
|---|---|---|---|---|---|
| W2-A1 | Multi-turn context: clarify threading (a new request while a clarify is open starts fresh; answers to choices bind to the open question), follow-up referents | w2-a | pr (draft) | #731 | 145eb337e3; 56+23 tests; full pytest 2182 |
| W2-A2 | Planner v2 eval readiness: scripted-model acceptance set for v2 (≥ 30 multi-step cases), step protocol hardening, tool-search miss telemetry, cost/round accounting rails; v2 stays OFF | w2-a | pr (draft, WIP) | #733 | b092cf1fcd; 23/39 acceptance; v2 per-turn-cap finding for the owner |
| W2-A3 | Schema-constrained args: server-side normalizers for the catalog's arg shapes + a golden "model output → args" corpus from production failures; deterministic coverage | w2-a | pr (draft) | #732 | 4043dc1cce; corpus 155/155; reconcile with #725 |
| W2-B1 | Research capability (RS-1 v1): grounded answer with facts / interpretation / unknowns and timestamped sources, composing gateway kinds + the existing web search; research never emits a figure the gateway did not return | w2-b | pr (ready) | #726 | 73e97cce3c; full pytest 2115 / vitest 2696 |
| W2-B2 | Historical analysis: dated ranges/comparisons ("compare this pullback to …"), post-event behaviour via the existing event_study service (value-free to the model), freshness notes | w2-b | pr (draft) | #734 | 7011ee283b; targeted green; full suites not run |
| W2-B3 | Grounded TA workflow: describe a chart's setup from served bars/indicators (no invented levels), conversational follow-ups | w2-b | todo | — | design in #734 |
| W2-C1 | App-level AgentProvider + page host adapters (screener, breadth, calendar, journal notes read), capability `surfaces` beyond charts; queries available everywhere | w2-c | pr (draft) | #728 | 4c89b53ba2; targeted 1359; full run queued, unconfirmed |
| W2-C2 | Explain / Show / Do guide targets on the new pages | w2-c | todo | — | design in #728 |
| W2-C3 | Cross-feature workflows + Undo across pages (where writers exist) | w2-c | todo | — | design in #728 |

## Wave 3 (coach foundations; integration branch agent/int-w3; NOT deployed; flag UCT_AGENT_COACH default off)
| id | task | owner | depends | state | PR | evidence |
|---|---|---|---|---|---|---|
| W3-1 | Educational explanations: `coach.explain` (query) over a curated, reviewed knowledge base (docs/agent/coach/concepts/*.md): price action, volume, risk & position sizing, market conditions; rails: no figures unless from an envelope, "educational, not advice", no guarantees | w3-a | none | pr (ready) | #724 | 4a3250519f; full pytest 2180 / vitest 2640; agent-ci green |
| W3-2 | Deterministic coach evaluation suite: unsupported-conclusion detector (guarantee/certainty/order language), uncertainty-stated check, figure-traceability check; ≥ 20 adversarial phrasings; wired as rails on every coach answer | w3-a | none | pr (ready) | #724 | same |
| W3-3 | Trade review foundations: `journal.reviewTrades` reading the member's own `/api/j2/trades` (and notes) with explicit per-conversation consent (`coach.consent` capability, stored on the conversation state), descriptive stats only, proposed note as the only write | w3-a | none (W2-C1 journal host for page context later) | pr (draft) | #729 | aadadf7b3e; targeted green; full not run |
| W3-4 | Coaching conversation workflow: ask → explain → check → next step; explicit uncertainty; uses W2-A1 threading once merged (single-turn fallback) | w3-a | W2-A1 (soft) | pr (draft, WIP) | #730 | a45050c296; 1 test expectation to fix |
| W3-5 | Setup analysis + explanation on top of `chart.describeSetup` | w3-a | W2-B3 merged + reviewed | blocked (dependency) | | |
| W3-6 | Historical setup comparison on top of `history.eventStudy` / dated ranges | w3-a | W2-B2 merged + reviewed | blocked (dependency) | | |
