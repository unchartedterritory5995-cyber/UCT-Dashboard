# Combined Agent release candidate — Agent × Indicators + Response-time (2026-10-12)

Branch `release/agent-indicators-perf` (worktree `C:/w/agrc1012`). LOCAL — not pushed, not deployed.

## Composition (owner-specified order)
1. master `75ba500fdf` (promoted to production; +8 commits since 382606e92c — ledger, alert-rating flag,
   live-trading-room page, FMP note, measurement window; **0 overlap** with Agent / Indicators / Breadth /
   alerts / workspace code).
2. `feat/agent-indicator-builder` **`0a4d3cf57c`** (the Indicators session's latest validated head =
   588a59b38a + docs-only real-model Refine PASS) — merge `79aacb358c`, no conflicts.
3. `perf/agent-latency` **`9aa5c608fd`** — merge `923033a9e1`, no conflicts.
4. `57ffd15a61` fix: a streamed turn is never re-sent (owner requirement 4) + regression tests.

## What ships
- Create Indicator / Modify → UCT Agent (admin + Agent flag), member-facing chart-side builder fallback,
  resizable sidebar, chart context, approvals and Undo (Indicators).
- Chart commands with fewer serial waits (board check beside the ticker search; indicator changes saved
  once; board check reads 2 preference keys), post-reply bookkeeping, turn/stage timing (numbers only).
- Streaming code, **dark**: `UCT_AGENT_STREAM` unset ⇒ `GET /api/agent/config` answers `{stream:false}` and
  the browser never calls `/api/agent/turn/stream`. All Agent routes stay `require_admin_dark`.

## Verification (this branch)
| Check | Result |
|---|---|
| Frontend, FULL `vitest run` | 3301 files / 45541 tests pass; 13 files / 12 tests fail — ALL pre-existing / environmental, none in a file this release changes: the 6 known baseline files (jsonFetcher ratchet, terminal formControls + panelProvenance, 2 journal importer round-trips needing `markdown_it`), 5 chart-engine *.measure / census corpus scans that time out at 15 s here (they fail identically on the perf-only tree, no Indicators code), plus 2 that pass when run alone (CaptureHost, objectFnInline.vendor / pineStrictCensus — load flakes) |
| Latency budgets, streaming off / on | 12 / 12 and 12 / 12 |
| Never-resent regression (200 JSON, 200 HTML, 404, 405) | 4 / 4 pass; all 4 FAIL on the previous client |
| Python: Agent, workspace/board, preferences, SSE rail, user-definitions, Create-Indicator rollout, measurement window | 924 pass; 1 pre-existing master failure (`test_user_definitions_auth…PER_ROUTER` — 3 screener routers share one sentence; untouched here) |
| `vite build` | pass |
| ESLint (every changed JS file vs master's copy) | no new errors; new files clean |
| `check_repo_hygiene.py` | clean |
| Browser (agent-harness, synthetic, scripted model, writes refused in-page) | 15 / 15 — see below (one scripted expectation of mine corrected: an admin's Create Indicator re-opens a closed Agent by design) |

Browser acceptance: ordinary question answered with ONE `/api/agent/turn` and no stream request; timeframe /
symbol / add RSI → 3 receipts, 0 model calls, none "not saved"; Undo → "Removed the RSI (14) I added…";
Create Indicator → Agent question + 4 doors → "EMA 21" draft (1 builder call, 0 planner calls); sidebar drag
392 → 576 px, remembered, 0 bars refetched; question after resize; Agent closed (admin) → Create Indicator
re-opens the Agent (by design); Agent unavailable (flag off, as a member) → chart-side builder with its 4
doors; approval card → nothing written before approval → one receipt → a second "do it" runs nothing; no
page errors.

## Release plan (on explicit authorization only)
1. Re-fetch master; if it moved, merge it into this branch and re-run the gates above.
2. Respect the deploy freeze (`tools/deploy_freeze.py`): weekly Wednesday 10:00–11:00 ET and the one-off
   Tuesday 2026-10-13 09:00–11:00 ET window. One master merge at a time; `tools/pre_push_guard.py` must pass.
3. Fast-forward master to this branch; let the master deploy gate + promotion run; confirm web / worker /
   bars-api deploy SUCCESS on the new SHA.
4. Post-deploy (no production variables changed): anonymous 401 on all Agent routes incl. `/api/agent/config`
   and `/api/agent/turn/stream`; `/api/agent/config` → `{"stream": false}` for an admin; bundle markers;
   0 tracebacks; owner smoke: Create Indicator → Agent, resize, chart commands + Undo, a question.
5. Afterwards (separate approvals): production timing report (`tools/agent_latency_telemetry.py`), small
   real-model probe (≤ $0.30), then — only then — consider `UCT_AGENT_STREAM=1` for admins.

## Rollback
- Code: re-promote the previous production SHA (`75ba500fdf`) through the normal promotion path (Railway
  rollbacks alone have not held here — redeploy the SHA). The release adds no migrations and no new stored
  data shapes (telemetry `latency_ms` on browser rows uses the existing column).
- Behaviour levers without a deploy: streaming stays off unless `UCT_AGENT_STREAM` is set (unset to roll
  back); per browser `localStorage['uct.agent.stream']='0'`; the Agent itself stays admin-only
  (`require_admin_dark`) and behind the Agent flag; Create Indicator falls back to the chart-side builder
  whenever the Agent is unavailable.

## Remaining blockers / risks
- **Production authorization** (this document stops there).
- No production latency baseline yet (production read denied in this session — owner run or permission rule).
- Streaming is not real-model verified (stays off).
- `test_user_definitions_auth…PER_ROUTER` fails on master itself — unrelated, but the master gate's
  report-only full suite will show it.

## Coordination
- INDICATORS session: confirmed 0a4d3cf57c as its latest validated head; will verify this RC independently without modifying it.
- BREADTH session (via AGENT) proposes ONE combined push with `breadth/live-reliability-release` 57c34f7c10 (dry-merges cleanly; shared file api/main.py, different regions). NOT merged — owner decision.
