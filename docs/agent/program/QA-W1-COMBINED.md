# QA verdict — combined UCT Agent Wave 1 RC (agent/int @ ce68db88a0, worktree C:/w/w1-int)

**Verdict: GO** (security + integration), with three owner-awareness notes (N1-N3) and no blocking finding.
Date 2026-11-02. Scope: targeted suites only (full suites run elsewhere under the suite lock). No paid calls, no network beyond git fetch. All test runs below are SCRIPTED/stubbed-model, never live-model results.

## 10. Master drift (checked first)
- `git fetch origin master`: HEAD..origin/master = **1 commit**: `7b6b7a1b4f fix(chart-iq): the web pod never builds the pack unless armed` (merge-base 8fbf76c6ee, as expected).
- Files in that commit: api/main.py, api/routers/chart_iq.py, api/services/chart_iq/pack.py, docs/feature_flags.json, tests/test_chart_iq_router.py.
- Overlap with the RC's 147 changed files: **none** (comm -12 of both name lists is empty). Merge is textually clean; no Agent path is touched by master.

## 1. Dark-by-default — PASS
Every flag read, with its default (file:line):
- UCT_AGENT_DATA — api/services/uct_agent/marketdata/gateway.py:64 `== "1"` (unset = off); read() refuses at :177.
- UCT_AGENT_DATA_KINDS — gateway.py:68-72: empty while DATA off; unset/empty admits NO kind (fails closed, no wildcard).
- UCT_AGENT_ISOLATED — gateway.py:79-80 `data_enabled() and == "1"`.
- UCT_AGENT_SCAN — gateway.py:83-84 `data_enabled() and == "1"`; refused at :192.
- UCT_AGENT_NEWS — api/services/uct_agent/news.py:41-42, on-values only, unset = off.
- UCT_AGENT_STREAM — api/routers/uct_agent.py:184-188, on-values only, unset = off.
- UCT_AGENT_NL1 — api/services/uct_agent/turn.py:196 `== "1"`.
- UCT_AGENT_EFFORT — turn.py:96-97: None unless a known level.
- UCT_AGENT_PLANNER — api/services/uct_agent/turn_v2.py:85: "v2" only on exact `v2`, else "v1" (**planner v2 DEFAULT OFF**); router gates step/resume on planner_v2() at uct_agent.py:210-212, :355.
- UCT_AGENT_PLANNER_ROUNDS / UCT_AGENT_TURN_USD — turn_v2.py:90, :98: defaults 6 / 0.25 and only consulted inside v2.
- AGENT_BREADTH_CURRENT — api/services/uct_agent/breadth_now.py:54, on-values only, default OFF.
- CREATE_INDICATOR_COHORT_ENABLED — api/services/rollout_gate.py:255-265, default "0".
- No browser-side read of any of these (grep app/src non-test for import.meta/process.env: none; the app learns flags from /api/agent/config).
- Note: api/services/uct_agent/scan/sat/seed.py:152-153 does `os.environ.setdefault(UCT_AGENT_DATA/SCAN,"1")` — CLI-only SAT seeding tool (`python -m ...`, refuses when a Railway var is set), imported only by scan/sat/section_b.py (also CLI). Not an app/import path. OK.
- `pytest tests/test_uct_agent_program_gateway.py tests/test_uct_agent_planner_v2.py -q`: **38 passed** (15 + 23).
  v2-off = v1-unchanged proofs: `test_FLAG_OFF_v1_request_is_byte_identical_and_the_flag_alone_changes_nothing_in_run_turn`, `test_FLAG_OFF_the_stream_route_serves_v1_and_never_registers_a_step_turn`, `test_config_reports_the_planner`; dark gateway: `test_dark_by_default_every_registered_kind_is_refused_and_never_runs`, `test_scan_kinds_stay_refused_with_only_the_data_flag`, `test_scan_kinds_need_their_own_flag`, `test_model_isolated_kinds_answer_the_member_only`.

## 2. Access (admin-only) — PASS
- api/routers/uct_agent.py: **19/19** `@router.*` routes take `user: dict = Depends(require_admin_dark)` in their signature (awk over every decorator+def; zero without). require_admin_dark (:91-93) = require_paid -> auth_middleware.require_admin. Router included at api/main.py:10481-10482.
- `pytest tests/test_uct_agent_qa_member_refused.py -q`: **22 passed** — 403 paid-non-admin / 402 unpaid / 401 signed-out with no provider call on config, turn, turn/stream, data(quote), data(instrument.resolve) + 5 admin controls.
- New routes: `tests/test_uct_agent_planner_v2.py::test_MEMBER_403_before_any_provider_call_on_every_v2_route` covers /turn/step and /turn/resume (plus turn, stream, config). The derived every-route rail `tests/test_uct_agent_latency.py::test_every_agent_route_refuses_anonymous_free_and_paid_member[...]` (run targeted: **19 passed**) covers POST /turn/step, POST /turn/resume and GET /conversations/{id}/state/{key} (18 route cases, 401/402/403 each).
- **N1 (minor gap, non-blocking):** that derived rail enumerates GET/POST/PATCH/DELETE only (latency.py:312), so the new **PUT** /conversations/{id}/state/{key} is the one route not in any 403 test. It carries require_admin_dark (uct_agent.py:755) and owner-checks the conversation (404 for another member, `tests/test_uct_agent_scan_refine.py::test_the_route_reads_and_writes_the_members_own_conversation_only`). Suggest adding "PUT" to `_agent_routes()` in a follow-up.

## 3. Isolation + F-16 — PASS
- `pytest tests/test_uct_agent_qa_isolation*.py tests/test_uct_agent_qa_f16.py tests/test_uct_agent_scan_hidden.py -q`: **145 passed** (qa_isolation 16, qa_isolation_audit 26, qa_isolation_layers 28, qa_f16 41, scan_hidden 34).
- `cd app && npx vitest run src/agent/qa`: **15 files / 207 tests passed** (f16Rails 19, isolationAudit 7, isolationLayers 6, modelIsolation 12, fastPathCorpus 33, md2Quote 34, readDataTurnId 21, noLivePrices 3, others).
- scanHidden.js == hidden.mirror_text(): `tests/test_uct_agent_scan_hidden.py::test_the_browser_mirror_is_generated_from_this_module_and_current` (passed).
- isolationAudit cells 23/24: app/src/agent/qa/isolationAudit.test.jsx:81-110 — describe "COMPOSITION through the screener — CLOSED by F-16": `PROVEN: the composite screen is REFUSED ... no scan ran; no value anywhere`, `PROVEN: no composite RANKING reaches the model`, `PROVEN: no COUNT above a composite threshold reaches the model`, plus a non-vacuity control. All passed.
- No removed line in app/src/agent, api/services/uct_agent or api/routers/uct_agent.py mentions Massive/licensing (diff vs merge-base) — licensing wording intact; provider_licensing_class.py only ADDS rows (see 9).

## 4. Side effects — PASS
- `npx vitest run src/agent/qa/noLivePrices.test.js`: 3 passed (`every non-test module under app/src/agent is clean`, control, `the two legacy readers now read the gateway kinds, by name`).
- grep '/api/live-prices' in app/src/agent non-test: only comments (alert.js:75,339; marketDataFacts.js:2; marketDataQuote.js:5; stock.js:15,67,76) and the test harness stub testing/panelHarness.jsx:60 (returns {}). **No fetch.**
- api/services/uct_agent: no import of live_prices or the alert service; the only mention is the warning comment in marketdata/quotes.py:6-7.
- flow-worker: no file touched (name-list grep for flow/worker hits only the two agent-ci workflow files).

## 5. Budgets — PASS (with N2)
- `git diff origin/master..HEAD --stat -- api/services/uct_agent/budget.py api/services/uct_agent/limits.py`: **empty**.
- `pytest tests/test_uct_agent_spend_limits.py tests/test_uct_agent_eval_ledger.py -q`: **58 passed** (27 + 31).
- No file under api/ imports tools.agent_eval_ledger (grep: none).
- **N2 (owner awareness):** api/services/narrative_cost_guard.py (+19/-2) adds a `claude-haiku-5-5` price row ($0.10/$0.50, >100K tier $0.50/$2.50) and a sonnet-5-5 cache-read multiplier 0.05x (was the family 0.1x). Caps/limits are unchanged, but the cost ESTIMATE for sonnet-5-5 cached input halves, and haiku-5-5 previously fell to the priciest-known fallback. Both are stated as verified against the published price page on 2026-11-02; if the owner wants estimate behaviour frozen for this release, this hunk is the one to hold back.

## 6. Gate compatibility — PASS
- `pytest tests/test_uct_agent_deploy_gate.py -q`: **10 passed** incl. `test_no_OTHER_workflow_is_an_agent_gate`, `test_the_gate_still_runs_the_agent_suites_itself`, `test_the_gate_runs_on_every_master_push_with_no_path_filter`.
- `git diff origin/master..HEAD -- .github/workflows/master-deploy-gate.yml`: **empty**; gate still runs `pytest tests/test_uct_agent*.py` (:358) and `npx vitest run src/agent ...` (:378).
- agent-ci.yml: line 1 `# promotion-gate: no`; `on.push.branches: ['agent/**']`, `pull_request.branches: [agent/int, master]` (PR event only, never a master push). agent-ci-benchmark.yml: line 1 `# promotion-gate: no`; push only on `ci/agent-shard-benchmark`. Neither references secrets/API keys.

## 7. Golden manifest — PASS
- `npx vitest run src/agent/agentContracts.test.js src/agent/agentCore.test.js` (+ noLivePrices): **44 passed** (14 + 27 + 3).
- app/src/agent/contract/manifest.golden.json: **133 capabilities** (master 121; +12, 0 removed):
  chart.replay (local, reversible); widget.setOption (local, reversible); drawing.addTrendline / addRay / addRectangle / addFib / addHorizontalRay / addText / addAvwap (all local, reversible); indicatorAlert.create (confirm, reversible); indicatorAlert.toggle (local, reversible); indicatorAlert.delete (**confirm, NOT reversible** — the only irreversible addition, correctly confirm-gated).

## 8. Flagship deterministic proofs — PASS (SCRIPTED model)
- `npx vitest run agentFlagshipOperator / agentFlagshipScan / agentFlagshipV2`: **3 files / 6 tests passed** (1 + 3 + 2). Each file's header states the SCRIPTED model / no paid call (Operator:3, Scan:1, V2:1,58).
- `pytest tests/test_uct_agent_scan_flagship.py -q`: **5 passed** (spec validity on public fields, three follow-ups compose, top-5 by 3-month change, result ids persist as lastScreen, one-scan-per-turn).
- These are deterministic rails, not live-model results; a live-model acceptance remains an owner activity.

## 9. Files outside the Agent's paths (vs merge-base 8fbf76c6ee) — PASS (with N3)
9 files (the chart_iq/main.py/feature_flags/test_chart_iq entries in the raw origin/master..HEAD list are the master-side commit, not the RC):
- .github/workflows/agent-ci.yml (+146), agent-ci-benchmark.yml (+104) — additive CI, promotion-gate: no (see 6). OK.
- .gitignore (+1): a trailing blank line only. Harmless.
- api/services/narrative_cost_guard.py (+19/-2): price rows (N2).
- api/services/provider_licensing_class.py (+21): six ADDED rows, all U / X / R (massive indices+crypto U; yahoo indices/crypto/commodities X; alphavantage commodities R) — nothing becomes A/LA, so index/commodity/crypto kinds decline honestly. OK.
- app/src/components/chart/chartSettingsDescriptors.js (+93 net) + .test.js (+25): KNOWN -> ELIGIBLE promotions for 27 plain chart-settings rows with number ranges / alpha hex; owner-approved W1-B per the file comment; number coercion rejects out-of-range/non-integer. Reaches members only through the admin-only Agent. OK.
- app/src/pages/charts/ChartsWorkspace.jsx (+8): agentReplayRef + host.replay {read,set} wired to the existing startReplay/exitReplayMode; no hook changes. OK.
- **N3:** app/src/widgets/registry.js (+4/-4) — not on the expected list: adds `min/max/integer` to two paramsSchema numbers (econStars 1..3, minCount 1..260). Consumed by the Agent's widget.setOption `bounded()` guard (app/src/agent/capabilities/board.js:870-874); member widget rendering does not read these keys. Additive and safe; noting only because it was unlisted.
- requirements / package.json / package-lock: unchanged.

## Totals
pytest targeted: 38 + 22 + 145 + 73 + 19 = **297 passed, 0 failed**. vitest targeted: 207 + 44 + 6 = **257 passed, 0 failed**. Routes admin-gated 19/19. Flags default-off 13/13. Budget/limits/master-gate diffs empty. Master drift 1 commit, 0 overlapping files.
