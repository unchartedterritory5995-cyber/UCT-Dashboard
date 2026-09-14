# Discord Render Hardening — Program Ledger

Program home: `docs/discord-render/`. Branch: `discord-render-hardening`
(worktree `C:\Users\Patrick\uct-worktrees\discord-render`). Started 2026-09-13 (Sunday).

**Scope:** every Discord command that produces a chart image or an options-flow render and
delivers it into Discord — `/chart` · `/c` · `/charts` (retired, handler live) · `/flow` ·
the chart-message controls (buttons/select) · the `/flow` "View chart" popup · `/buzz` (board
image). Scheduled image posts that share the same renderer (index-close, buzz digest) are
mapped as **capacity neighbours**, not rebuilt by this program.

## Standing rules this program runs under (read before any merge)

| Rule | Source |
|---|---|
| ONE master merge at a time, repo-wide. Railway `web` SUCCESS **and** the running SHA confirmed before the next. | CLAUDE.md (owner, 2026-09-13) · `docs/runbooks/deploy-windows.md` |
| Everything ships DARK behind a flag. The owner flips. | program brief |
| flow-worker watched files: after-hours/weekend only. Any red from `tools/flow_worker_watch_coverage.py` gets an ADDITIVE / BEHAVIOUR-CHANGING classification **in this ledger** before the push. | `docs/runbooks/deploy-windows.md` |
| `chart-renderer` has NO repo source — no push deploys it. A renderer change is its own deploy (`railway up`), gated like flow-worker: what it serves, whether a restart drops in-flight renders. | deploy-windows "Current state" |
| Partner-owned files (`OptionsFlow.jsx`, `live_massive_router.py`, `schwab_router.py`): minimal isolated diffs, noted per row. | CLAUDE.md · memory `project_partner_collab_branch` |
| Backend pytest is SCOPED (named files), never repo-wide. One gate at a time on this box. A run with no totals line is not a run. | CLAUDE.md |
| Every master push carries a plain-English member-impact paragraph (in the row below). | memory `feedback_master_push_needs_explicit_deploy_and_member_summary` |
| Same file edited / same command re-run more than twice → stop, write the loop here, change approach. | program brief |

## Merge ledger

One row per commit on program paths. `Running SHA` is read from the deployed service, never
inferred from a CLI exit code. **No row below has reached master yet**: these are commits on the
program branch, pushed to `origin/discord-render-hardening` only. Nothing is deployed and no member
sees any of it until a master merge row says otherwise.

| # | Date (ET) | Commit | Step | Files | Flags added (default) | flow-worker strand | Tests (scoped, totals) | Bench before → after | Deploy: status · running SHA | Member impact |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 2026-09-13 | `e248ba341` | Phase 0 map + tools · Phase 1 architecture · V2 runtime core | `docs/discord-render/{LEDGER,00-system-map,03-architecture}.md` · `tools/discord_render_{forensics,bench}.py` · `api/services/discord_render/{__init__,ids,contract,jobs_store,delivery,runtime}.py` · 2 test files | none (the package is imported by nothing yet) | none — no `api/*` file on flow-worker's watch list touched | 48 passed (bench 8, core 40) | baseline recorded in `02` (this commit is the instrument) | **branch only · not merged · not deployed** | None. Nothing imports the new package. |
| 2 | 2026-09-13 | `4ce26315d` | 2.1a — `fail_fn` hooks; 7 stale reds corrected; latent row-truncation fix; `02-baseline.md` | `api/services/discord_interactions.py` · `api/routers/discord_interactions.py` · `tests/test_discord_chart.py` · `tests/test_discord_chart_prefs.py` · `tests/test_discord_render_{v2_core,fail_hooks}.py` · `docs/discord-render/02-baseline.md` | none | none — `api/routers/discord_interactions.py` and `api/services/discord_interactions.py` are not on the watch list and flow-worker does not import them | 321 passed (13 files); mutation proofs **7/7 red**, restores sha-verified, control green | n/a (no hot-path change without `fail_fn`) | **branch only · not merged · not deployed** | None today. Every hook is optional and the pre-V2 sentences are railed byte-identical without it. The truncation fix only affects servers listed in `DISCORD_ACTIVITY_GUILDS`, which is `off` in production. |
| 3 | 2026-09-13 | `1778f4553` | 2.1b — V2 command layer, router branch, lifespan resume/release, forensics 429 fix, flag ledger entry | `api/services/discord_render/{commands,jobs_store,runtime}.py` · `api/routers/discord_interactions.py` · `api/main.py` · `docs/feature_flags.json` · `tools/discord_render_forensics.py` · `tests/test_discord_render_v2_router.py` | `DISCORD_RENDER_V2_ENABLED` (default OFF, declared `dark`) · `DISCORD_RENDER_V2_{CHART,FLOW,BUZZ,CONTROLS}_ENABLED` (kill switches, default ON under the master) | none — `api/main.py` is not on flow-worker's watch list (`api/flow_worker_main.py` is its entrypoint); to be re-verified with `tools/flow_worker_watch_coverage.py` before the master merge | 487 passed (16 files incl. flag-ledger + lifespan rails); mutation proofs **8/8 red**, restores sha-verified, control green | not yet benched (V2 is off by default; the flag-on bench is a Phase 2 row in `05`) | **branch only · not merged · not deployed** | None while `DISCORD_RENDER_V2_ENABLED` is unset: the endpoint runs the pre-V2 path exactly (railed by `test_flag_off_never_consults_v2`, mutation-proved). Not yet built, and so not claimed: the queue-position edit after 2 s, scheduled `store.purge`, the stuck-job alert (2.2). |

### Master merge 1 — Phase 0 + dark 2.1 (2026-09-13, Sunday)

| # | Date (ET) | Commit | Step | Files | Flags added (default) | flow-worker strand | Tests (scoped, totals) | Bench before → after | Deploy: status · running SHA | Member impact |
|---|---|---|---|---|---|---|---|---|---|---|
| 4 | 2026-09-13 | branch tip after `7f230fbe9` (merge of `origin/master` `506eeee6d` into the branch) + this ledger commit, fast-forwarded to master | **Master merge 1**: rows 1–3 + the Phase 0 close-out `a3b9074ef` | 26 files vs master (listed by `git diff --name-only origin/master..HEAD`): `api/main.py`, `api/routers/discord_interactions.py`, `api/services/discord_interactions.py`, `api/services/discord_render/*` (7), `docs/discord-render/*` (6), `docs/feature_flags.json`, 7 test files, 3 tools | as rows 1–3; nothing new | **none** — `tools/flow_worker_watch_coverage.py` on the merged tree: `reachable=154 watched=24 changed=26 OK` | merged tree: **494 passed, 1 failed**. The failure is `test_feature_flag_ledger.py::test_every_off_by_default_gate_is_declared` naming four `ALERT_TAXONOMY_*_DARK_ENABLED` gates — **inherited**: the same test fails identically on a clean checkout of master's tip `506eeee6d` (S7 alert-taxonomy commits `5fa4b4582` `edebd8bf0` `1bfd54069` `fd3c6aaaa`). Not this program's flags to declare; **0 new failures**. | no hot-path change with the flag unset (bench re-run is a flag-on row in `05`) | **MERGED `740b79ad5`** (fast-forward `506eeee6d..740b79ad5`, 17:14:57 UTC). `web` SUCCESS 17:17:20 UTC, running `RAILWAY_GIT_COMMIT_SHA=740b79ad52aa…` read in-process, `/api/health` uptime 62 s, `DISCORD_RENDER_V2_ENABLED` absent from the process. flow-worker **SKIPPED**. ⚠️ **Another session pushed to master inside this deploy window** (`2b94fba2f` + merge `f34ce660b`, S7 price-level, created 17:17:01 UTC): Railway marked this program's `web`/`worker`/`bars-api` deployments REMOVED and served `f34ce660b`; a bad-signature probe got a 502 during their swap. **Final state, re-measured 17:23 UTC:** running `f34ce660b798b6ca5` (`740b79ad5` verified an ancestor), health 200, probe `401 invalid request signature` ×3 in 0.18–0.43 s, V2 flag still unset, flow-worker SKIPPED on both pushes. Smoke PASS on the final pod; the 502 was INCONCLUSIVE (their swap), not a failure — no rollback (H15). | **Nothing members can see changes.** This adds the Discord render V2 code switched off (`DISCORD_RENDER_V2_ENABLED` unset), the program's documents, and three diagnostic tools. With the switch off, `/chart`, `/flow`, `/buzz` and the chart buttons run exactly the code they run today, and a test fails if V2 is even consulted with the switch off. Two small changes run for everyone and neither is visible: the chart-controls row in servers with Discord Activities enabled is split instead of truncated (no production server has Activities enabled), and a failed Discord edit now records its status code for diagnosis. Like any `api/` change, the push restarts `web`, `worker` and `bars-api` — roughly a minute of API blips — and does **not** restart flow-worker. Rollback: leave the flag unset (already the case), or revert the merge commit and push. |

### Step 2.2 on the branch (2026-09-13, Sunday)

| # | Date (ET) | Commit | Step | Files | Flags added (default) | flow-worker strand | Tests (scoped, totals) | Bench before → after | Deploy: status · running SHA | Member impact |
|---|---|---|---|---|---|---|---|---|---|---|
| 5 | 2026-09-13 | `2509cc0de` | 2.2 — observability: scrubbed `drender` events (exceptions through `observe.exception`), SLOs from the jobs table, alert rules per `03` §3.9, the observer thread (alerts, durable cooldown, hourly `store.purge`), `GET /api/discord/render-health`, the `/renderhealth` handler (built, **not registered**); stale `/flow` command-list assertion corrected | `api/services/discord_render/{observe (new),commands,jobs_store,runtime}.py` · `api/routers/discord_interactions.py` (`_renderer_health`, render-health route) · `api/services/discord_interactions.py` (`build_renderhealth_command`, `build_commands(renderhealth=False)`) · `tools/discord_chart_commands.py` (`--renderhealth`) · `tests/test_discord_render_{observe,health_endpoint,health_command}.py` (new) · `tests/test_discord_activity.py` | no new gate (the flag-ledger rail agrees). Config, inert while V2 is off: `DISCORD_RENDER_ALERT_WEBHOOK` (blank = alerts are `drender` log events only, OI-08) · `DISCORD_RENDER_ADMIN_USER_IDS` (blank = the admin bit only) · `DISCORD_RENDER_OBSERVE_S` (60) · `DISCORD_RENDER_ALERT_COOLDOWN_S` (1800) | none — no file on flow-worker's watch list; re-verified on the merged tree before merge 2 | 11 files: **458 passed, 1 failed** — the inherited `ALERT_TAXONOMY_*` flag-ledger red (row 4); **0 new**. The `test_discord_activity.py` assertion had been red on master since `08cadbba9` (2026-09-06, `/flow` joined the default set; the test was last touched 2026-09-01) — provenance by `git show`, corrected, mutation M0 proves it can fire. Mutation proofs **18/18 red**, restores sha-verified, control green (19 node ids) | n/a — no member-path change with V2 off | **branch only** (ships in master merge 2) | None while `DISCORD_RENDER_V2_ENABLED` is unset: the observer starts only with the V2 runtime, and `/renderhealth` is not registered. The one thing that exists regardless is `GET /api/discord/render-health`, which answers 401 without the PUSH_SECRET bearer and with it only reads (railed: it never starts V2 and never creates the jobs database). |

### Master merge 2 — dark 2.2 (2026-09-13, Sunday)

| # | Date (ET) | Commit | Step | Files | Flags added (default) | flow-worker strand | Tests (scoped, totals) | Bench before → after | Deploy: status · running SHA | Member impact |
|---|---|---|---|---|---|---|---|---|---|---|
| 6 | 2026-09-13 | branch tip after `72cfddf87` (merge of `origin/master` `d6ac61816` into the branch, 22 commits, no file overlap) + this ledger commit, fast-forwarded to master | **Master merge 2**: row 5 (`2509cc0de`) + docs `6864b051f` | 14 files vs master (`git diff --name-only origin/master..HEAD`): `api/routers/discord_interactions.py`, `api/services/discord_interactions.py`, `api/services/discord_render/{commands,jobs_store,observe,runtime}.py`, `docs/discord-render/{03-architecture,05-progress,LEDGER}.md`, `tests/test_discord_activity.py`, `tests/test_discord_render_{observe,health_endpoint,health_command}.py`, `tools/discord_chart_commands.py` | as row 5; nothing new | **none** — `tools/flow_worker_watch_coverage.py` on the merged tree: `reachable=154 watched=24 changed=14 OK` | merged tree `72cfddf87`, 13 scoped files: **479 passed, 0 failed**. Row 4's inherited flag-ledger red is gone — master's own commits now declare the `ALERT_TAXONOMY_*` gates (7 entries on `origin/master`). | no member-path change with the flag unset | **MERGED `6d779dd47`** (fast-forward `d6ac61816..6d779dd47`, 18:03:56 UTC; `web` was SUCCESS on `d6ac61816` and master 0 ahead, checked in the same call). `web` BUILDING 18:04:21 → DEPLOYING 18:05:48 → **SUCCESS 18:06:09 UTC**. Running `RAILWAY_GIT_COMMIT_SHA=6d779dd47d1f`, read from `/proc/1/environ` of the running process; `/api/health` 200, uptime 33 s; interactions bad-signature `401` ×3 (0.11–1.80 s); `GET /api/discord/render-health` without the bearer `401 unauthorized` — the new route answering; `DISCORD_RENDER_V2_ENABLED` and `DISCORD_RENDER_ALERT_WEBHOOK` absent. flow-worker **SKIPPED**; `bars-api` SUCCESS; `worker` SUCCESS (re-read after 18:07 UTC). No other push inside the window. | **Nothing members can see changes.** This adds the monitoring half of the Discord render V2 code, which stays switched off (`DISCORD_RENDER_V2_ENABLED` unset). With it off, `/chart`, `/flow`, `/buzz` and the chart buttons run exactly today's code; the new background monitor only starts with V2, so it does not run; the admin `/renderhealth` command is written but not registered, so nobody sees a new command. One new read-only endpoint, `GET /api/discord/render-health`, exists for the owner and answers 401 to anyone without the push secret. One test assertion that had been wrong since 2026-09-06 is corrected. Like any `api/` change, the push restarts `web`, `worker` and `bars-api` — about a minute of API blips — and does **not** restart flow-worker. Rollback: revert the merge and push; there is no flag to flip because nothing is on. |

### Step 2.3 on the branch (2026-09-13, Sunday)

| # | Date (ET) | Commit | Step | Files | Flags added (default) | flow-worker strand | Tests (scoped, totals) | Bench before → after | Deploy: status · running SHA | Member impact |
|---|---|---|---|---|---|---|---|---|---|---|
| 7 | 2026-09-13 | `a353596ce` | 2.3 — chart-renderer log hygiene (C-13), hard ceiling, correlation log line and `/health` counters (**unconditional**); the pool behind `RENDER_POOL_ENABLED`; web sends `X-Correlation-Id` / `X-Render-Priority` and scrubs the renderer's error body | `services/chart_renderer/app.py` · `api/services/discord_render/{ids,runtime}.py` · `api/services/{discord_chart_house,buzz_image,discord_interactions}.py` · `tests/test_chart_renderer_pool.py` · `tests/test_discord_render_correlation.py` (new) | `RENDER_POOL_ENABLED` (chart-renderer, default OFF — not in `docs/feature_flags.json`, whose rail scans `api/ scripts/ tools/` only) · renderer config, inert until set: `RENDER_HARD_TIMEOUT_S`, `RENDER_WARM_URL` (OI-17), `RENDER_RECYCLE_AFTER` (500), `RENDER_RSS_CEILING_MB` (2500), `RENDER_BACKGROUND_SLOTS` (2), `RENDER_POOL_KEYS` (4) | none for flow-worker (no watched file; re-verified on the merged tree). **chart-renderer is a separate deploy** (`railway up` of a `git archive` of the merged commit, weekend). Classification: **ADDITIVE** for the unconditional tier — scrubbed logs, a ceiling above every budget a request declares, one more log line, more `/health` keys. A restart drops any in-flight render (on a Sunday afternoon, warm-cycle renders). | 18 files: **519 passed**. Mutation proofs **22/22 red** (12 renderer, 10 web), restores sha-verified, control green. Real-Chromium measurement in `05`. | local, hermetic: legacy p50 537 ms → pool with spares 440 ms. In production the flag is off, so no change. | **branch only** | web: none — two request headers the running renderer ignores, and scrubbed warning text. chart-renderer: none visible — the same PNGs; its logs stop carrying the render token; a render that hangs past its own budget now gets a 504 instead of holding the request until web's 60 s client timeout. |

### Master merge 3 — 2.3, web half (2026-09-13, Sunday)

| # | Date (ET) | Commit | Step | Files | Flags added (default) | flow-worker strand | Tests (scoped, totals) | Bench before → after | Deploy: status · running SHA | Member impact |
|---|---|---|---|---|---|---|---|---|---|---|
| 8 | 2026-09-13 | branch tip `a69dfc574` + this ledger commit, fast-forwarded to master (master had not moved since `6d779dd47`; nothing to merge) | **Master merge 3**: row 7 (`a353596ce`) + docs `a69dfc574` | 12 files vs master: `api/services/{buzz_image,discord_chart_house,discord_interactions}.py`, `api/services/discord_render/{ids,runtime}.py`, `docs/discord-render/{01-failure-forensics,03-architecture,05-progress,LEDGER}.md`, `services/chart_renderer/app.py`, `tests/test_chart_renderer_pool.py`, `tests/test_discord_render_correlation.py` | as row 7 | **none** — watch coverage on the tip: `reachable=154 watched=24 changed=12 OK`. `services/chart_renderer/app.py` rides along in the repo, but no push deploys chart-renderer; it ships separately once `web` is verified (row 9). | tip `a69dfc574`, 25 scoped files: **724 passed, 0 failed** | no member-path change (V2 unset, pool off) | **MERGED `d32d14d60`** (fast-forward `6d779dd47..d32d14d60`, 18:44:29 UTC; `web` SUCCESS on `6d779dd47` and master 0 ahead, checked in the same call). `web` BUILDING 18:44:42 → DEPLOYING 18:46:50 → **SUCCESS 18:47:11 UTC**. Running `RAILWAY_GIT_COMMIT_SHA=d32d14d604ee`, read in-process; `/api/health` 200, uptime 61 s; bad-signature `401` ×3 (0.20–0.26 s); render-health without the bearer `401`; V2 flag and alert webhook absent. flow-worker **SKIPPED**; `bars-api` SUCCESS, `worker` SUCCESS (re-read 18:49 UTC). | **Nothing members can see changes.** `web`'s chart renders now send the renderer two request headers — one identifying a V2 request, one marking the warm cycle as background work. The renderer running today ignores both, and the updated renderer only acts on them once its pool is switched on, which it is not. Two warning lines that could quote the chart page's address now strip it before logging. `/chart`, `/flow`, `/buzz` and the chart buttons produce the same replies as today. The push restarts `web`, `worker` and `bars-api` (about a minute of API blips) and does **not** restart flow-worker. The chart-renderer update is its own deploy right after (row 9). Rollback: revert and push. |

### chart-renderer deploy — 2.3 renderer half (2026-09-13, Sunday)

| # | Date (ET) | Commit | Step | Files | Flags added (default) | flow-worker strand | Tests (scoped, totals) | Bench before → after | Deploy: status · running SHA | Member impact |
|---|---|---|---|---|---|---|---|---|---|---|
| 9 | 2026-09-13 | `railway up --path-as-root` of `git archive a69dfc574 -- services/chart_renderer` (byte-identical at master `d32d14d60`, checked in the deploy call) | **chart-renderer deploy** for row 7 | `services/chart_renderer/{Dockerfile,app.py,requirements.txt}` — payload sha256 matched the committed blobs, 0 CR bytes | none — `RENDER_POOL_ENABLED` unset (pool OFF) | not a flow-worker deploy. **ADDITIVE** (row 7). A restart drops in-flight renders: Sunday afternoon, warm-cycle traffic only. | covered by row 8's gate (724 passed, includes `test_chart_renderer_{pool,service}.py`) | in production after the deploy: p95 2,300 ms over the first 7 renders (warm cycle, pool off) — no change is expected with the pool off | **SUCCESS**, deployment `6090d306` (BUILDING 18:48:34 → DEPLOYING 18:49:16 → **SUCCESS 18:49:58 UTC**; replaced `a4b1e594` of 2026-09-01). **Image:** `/app/app.py` 584 lines / 23,944 bytes = the payload (`railway ssh` dropped `-l`, so `wc` printed all three counts; the byte count is the stronger match). **`/health`, read from the web pod:** 19 keys where there were 3 (`ok, browser, allowed`); `ready: true`, `pool_enabled: false`, `launch_error: null`, 0 timeouts, 0 failures, RSS 790 MB. **Log:** 9 render lines, each `cid=- path=/r/chart status=200 prio=background ready=True` — web's warm cycle marking itself background, end to end; **0 unredacted `token=`**. No render failed, so the hygiene fix was not exercised in production; the real-Playwright proof is in `05`. | None visible: the same charts. The renderer's logs no longer carry the render token, which unblocks the rotation in **OI-13** (owner). |

### Step 2.4a on the branch (2026-09-13, Sunday)

| # | Date (ET) | Commit | Step | Files | Flags added (default) | flow-worker strand | Tests (scoped, totals) | Bench before → after | Deploy: status · running SHA | Member impact |
|---|---|---|---|---|---|---|---|---|---|---|
| 10 | 2026-09-13 | `0e331168a` | 2.4a — symbol resolution at the ack (D-04, OI-01) and the `/flow` ETF partition (C-14), **V2 path only** | `api/services/discord_render/symbols.py` (new) · `api/services/discord_render/commands.py` · `api/routers/discord_interactions.py` (`run_flow_card_job(..., source="stocks")`) · `tests/test_discord_render_symbols.py` (new) | `DISCORD_RENDER_V2_SYMBOLS_ENABLED` — kill switch under the V2 master, default ON. Its name is built at run time, so the flag-ledger scan cannot see it; it is recorded here and in `03` §3.8. | none — no watched file changed. `symbols.py` *imports* `api/massive_processor.py` (on flow-worker's watch list) without changing it; re-verified on the merged tree. | 26 files: **763 passed**. Mutation proofs **22/22 red** on the second run; the first run found two rails that could not fail (S4, S9 — loop log), both fixed. Production-data probe in `05`. | invalid symbol: baseline 1.5 s end-to-end with no suggestions (`02`). Now the static check takes 0–23 ms, plus `/api/bars` `no_data` in 109–310 ms measured from outside. The end-to-end ack is a flag-on bench row (Phase 3). | **branch only** | None while `DISCORD_RENDER_V2_ENABLED` is unset. With V2 on: an unknown or uncarried symbol gets a private "No chart data for …" with up to three suggestions in under a second, instead of a public "no bars" reply; `/flow` for an ETF or index shows its real flow instead of "no significant options flow" (**behaviour change**, OI-16). The pre-V2 `/flow` path still reads `stocks` (railed). |

### Master merge 4 — 2.4a, dark (2026-09-13, Sunday)

| # | Date (ET) | Commit | Step | Files | Flags added (default) | flow-worker strand | Tests (scoped, totals) | Bench before → after | Deploy: status · running SHA | Member impact |
|---|---|---|---|---|---|---|---|---|---|---|
| 11 | 2026-09-13 | branch tip after `cee1b269b` (merge of `origin/master` `553d36432` into the branch, 14 commits, no file overlap) + this ledger commit, fast-forwarded to master | **Master merge 4**: row 10 (`0e331168a`) + docs `53b55e9e9` | 8 files vs master: `api/routers/discord_interactions.py`, `api/services/discord_render/{commands,symbols}.py`, `docs/discord-render/{01-failure-forensics,03-architecture,05-progress,LEDGER}.md`, `tests/test_discord_render_symbols.py` | as row 10 | **none** — watch coverage on the merged tree: `reachable=154 watched=24 changed=8 OK` | merged tree `cee1b269b`, 26 scoped files: **763 passed, 0 failed** | no member-path change with V2 unset | Parked at the 15:30 ET restart checkpoint (master moved during the gate; the guard refused), then resumed on the owner's close-out instruction: re-merged master `7bd9c8785` as `2b04c725a` — the S7/D2 session had declared `CANONICAL_INDICATOR_AXIS_ENABLED` itself, so the inherited red is gone. Gate on `2b04c725a`: **764 passed, 0 failed** (26 files); watch coverage OK. Pushed after this row; deploy measured in `05`, Merge 4. | **Nothing members can see changes.** This adds the symbol check and the ETF-aware `/flow` lookup to the Discord render V2 code, which stays switched off (`DISCORD_RENDER_V2_ENABLED` unset). With it off, `/chart`, `/flow`, `/buzz` and the chart buttons run exactly today's code, and `/flow` still reads the same flow partition it reads today (railed). The push restarts `web`, `worker` and `bars-api` (about a minute of API blips) and does **not** restart flow-worker. Rollback: revert and push. |

### Post-restart Step 0 — re-orient and verify (2026-09-13, Sunday, 16:2x ET)

The PC restarted; every PowerShell session was replaced. Verified before touching code — **all green**:

| Check | Result |
|---|---|
| `discord-render` worktree | clean; `HEAD = origin/discord-render-hardening = b4c9e9bcc` |
| Master drift during the restart | **none** — `git rev-list --count HEAD..origin/master` = 0, `origin/master` still `d623baf1d`. No rebase needed (0.3). |
| Running `web` SHA | `d623baf1d836`, read from `/proc/1/environ` of the running process = master tip |
| `web` · `worker` · `bars-api` | SUCCESS on `d623baf1d`; **no deploy in flight** on any service |
| flow-worker | **SKIPPED** on both recent pushes — untouched, as designed |
| chart-renderer | SUCCESS (`railway up`, 18:48 UTC); `/health` 200 `ready:true browser_connected:true pool_enabled:false renders_total:182 p95 2,570 ms rss 418 MB launch_error:null` |
| `/api/health` · bad signature · `/api/discord/render-health` unauthenticated | 200 (uptime 475 s) · **401** · **401** |
| Task Scheduler | **57** `UCT *` jobs present, all `Ready` |
| `#render-alerts` (0.5) | one alert fired through the **real code path** — `Observer.run_once` → `evaluate_alerts` → durable `alert_due` → `post_webhook` → `record_alert` — on a **temporary** jobs DB so production's alert cooldown is not consumed: `breached:["ack_over_3s"] sent:["ack_over_3s"]` |
| Other sessions' artifacts (0.4) | all four excluded files still on disk and untracked; the captured branches carry their reconstructed `docs/RESUME.md`. ⚠️ They are untracked but **not gitignored** — a `git add -A` in those worktrees would publish them to this **public** repo. The standing rule (memory `lesson_uct_dashboard_shared_worktree`) is already "never `git add -A`" there; left as-is rather than editing another session's shared git config. The owning sessions own their next steps. |

### Post-restart close-out adds A and B (2026-09-13, Sunday)

**B — was the Step 0 `ack_over_3s` breach real?** **No, and it could not have been.**
`/data/discord_render_jobs.db` **does not exist** on the web pod (read in-process): V2 has never run in
production, so there are zero job rows and no live path can produce an ack at all. The breach came from
the single synthetic row (`ack_ms = 4200`) my probe wrote to a temporary database. No forensics row.
⭐ The proof is the absent database, not a zero count — a zero count is also what a wrong path returns.

**A — the three withheld files are now ignored, and a gate enforces it.**

| Worktree | Entry added | Commit |
|---|---|---|
| `uct-worktrees/flow-nav-prefetch` | `app/.env.flowperf` | `423d7e6ee` → `perf/route-intent-prefetch` |
| `uct-worktrees/options-desk` | `app/tests/fixtures/_raw_flow10.csv` | `f0571e102` → `feat/options-desk` |
| `uct-intelligence` (private repo) | `data/uct_intelligence.pre_tsdr_import.bak` | `dd4ab93` → `master` |

Each verified with `git check-ignore -v`; each noted in that worktree's reconstructed `docs/RESUME.md`;
the files are untouched on disk. The spec doc and two resume files withheld as "credential-shaped" were
**false positives** (loop log) and were pushed instead: `944231be4`.

**The gate:** `tools/check_repo_hygiene.py` + `tests/test_repo_hygiene.py` — refuses any tracked file
over 5 MB and any tracked `.env*` outside an allowlist, in `--staged` mode too so it can serve as a
pre-commit hook. ⛔ It is an **allowlist**, not a bare limit: 15 files over 5 MB are already tracked
(`api/patches-6-25.json` is 23.7 MB), so a bare limit would be red on arrival and muted within a week.
⛔ And it **refuses rather than passing on an empty scan** — `git ls-files` from the wrong directory
answers successfully with nothing, and every assertion over an empty list passes. Mutation proofs
**5/5 red**, control green (8 tests). Self-check: `python tools/check_repo_hygiene.py --self-check`.

### Step 1.1a — dual render-token acceptance (2026-09-13, Sunday)

| # | Date (ET) | Commit | Step | Files | Flags added (default) | flow-worker strand | Tests (scoped, totals) | Bench before → after | Deploy: status · running SHA | Member impact |
|---|---|---|---|---|---|---|---|---|---|---|
| 12 | 2026-09-13 | `4821ec3f2` | 1.1a — dual render-token acceptance, and one shared guard replacing 14 copies (OI-19) | `api/routers/render_panels.py` · `app/src/lib/renderToken.{js,test.js}` (new) · 14 × `app/src/pages/*Render.jsx` · `tests/test_render_token_rotation.py` (new) | none. Config, inert until set: `CHART_RENDER_TOKEN_PREVIOUS` (backend) · `VITE_CHART_RENDER_TOKEN_PREVIOUS` (build). With both unset the gate behaves byte-identically to today — dark by construction. | none — watch coverage `reachable=154 watched=24 changed=25 OK` | 28 scoped files: **780 passed**; frontend `renderToken.test.js` **6 passed**; all 14 pages parse under esbuild. Mutation proofs **8/8 red** (5 backend, 3 frontend), restores sha-verified, controls green. | n/a — no render path timing change | *(after the push)* | None. The token check moves into one shared module and gains the ability to accept a previous token during a rotation; with no previous token set, every page and the `/api/r/*` gate accept exactly what they accept today. |

⭐ **Why the guard moved rather than being edited fourteen times.** Each page carried its own
`const TOKEN = import.meta.env.VITE_CHART_RENDER_TOKEN || ''` and `if (TOKEN && token !== TOKEN)`.
Fourteen copies cannot be mutation-proved (memory `lesson_a_guard_repeated_is_a_guard_unproved`) and
a rotation would have to edit all fourteen correctly. `app/src/lib/renderToken.js` is now the one copy.

### Step 1.1b — the rotation itself (2026-09-13, Sunday, ~16:30 ET)

⚠️ **The stated blocker did not exist, and the opposite was true.** The rotation was parked because
"Morning Wire holds the live token and rotating breaks Monday's 07:35 wire". Measured against
production before touching anything: Morning Wire's `.env` token was **already being refused**
(`GET /api/r/econ` → **403**) while Railway's token returned 200. The wire's Substack panels have
been failing that gate for some time. Rotating could not break what was already broken, and fixing
that file is an improvement to Monday's wire rather than a risk to it.

⛔ **And the first probe of this said the opposite.** `GET /api/r/movers` returned **200 for a
made-up token** — there is no `/r/movers` route, so the request fell through to the SPA catch-all
and answered 200 with an HTML page. Re-probed against real routes (`/r/econ`, `/r/themes`) with a
content-type check, the gate was working correctly all along. A status code without a body check is
not a measurement (same family as the broker_sync 405).

| What | Evidence |
|---|---|
| New token generated | `secrets.token_urlsafe(24)`, 32 chars, never printed — fingerprints only |
| Applied | ONE `railway variables --set` on `web` carrying all four values, so ONE rebuild: `CHART_RENDER_TOKEN` + `VITE_CHART_RENDER_TOKEN` → new (`fp c6cc0765`), `…_PREVIOUS` ×2 → old (`fp 15bec268`) |
| No breakage window | Each pod is self-consistent (its own backend token + its own bundle); the swap is per-pod and atomic. Deploy BUILDING 20:36:09 → SUCCESS **20:37:30 UTC** |
| Dual acceptance live | `/api/r/econ`: new → **200 JSON**, old → **200 JSON**, made-up → **403 REFUSED** |
| Morning Wire config | `morning-wire/.env` rewritten atomically, one line; 54 lines / 30 keys / no duplicates / no malformed lines afterwards; now `fp c6cc0765` → **200** where it was 403 |
| End-to-end proof | `substack.panelshot.render_panels` — the wire's OWN renderer — against production: `econ` 116 KB and `themes` 949 KB PNGs in 10.8 s. The page only sets `window.__panelReady` after the token is accepted, so a PNG **is** the proof. |
| Renderer logs | 496 lines, **0** containing `token=` in any form; 244 render lines all `path=/r/chart` with no query. C-13 closed in production. |
| Log rail | `tests/test_render_token_never_logged.py` (`a8872fbc5`) — AST over the renderer and both web senders; fails if any logging call is handed a URL without `scrub()`/`url_path()`. Includes a planted-violation control. |
| Retire job | Task Scheduler **`UCT Render Token Retire`**, Monday 2026-09-14 **07:15 CT = 08:15 ET**, one-shot, `StartWhenAvailable`, 30-min limit → `uct-q1-observe/render_token_retire.cmd`. Gated on `morning_wire_state.json::last_run_date == today`; aborts if the CURRENT token is not already 200; idempotent; posts the outcome to `#render-alerts`. Opt out with `render_token_retire.disabled`. |
| Retire job proven today | Ran it live: `WIRE MARKER ABSENT — last_run_date=2026-09-11 today=2026-09-13. Changing nothing.` exit 0, all four variables unchanged, skip notice posted. The gate is measured, not assumed. |

### Step 1.2 — renderer repo connection + warm pool, and `/renderhealth` made safe to register (2026-09-13)

**Railway service config, applied field by field** (a combined mutation returned HTTP 400: the
`Builder` enum has only `HEROKU · NIXPACKS · PAKETO · RAILPACK` — there is no `DOCKERFILE` value,
Railway resolves that from `dockerfilePath`):

| Setting | Value |
|---|---|
| `rootDirectory` | `services/chart_renderer` |
| `watchPatterns` | `["services/chart_renderer/**"]` — **set BEFORE connecting**, because an empty list on a repo-connected service means "rebuild on every push" (CLAUDE.md) |
| `dockerfilePath` · `healthcheckPath` · `healthcheckTimeout` | `Dockerfile` · `/health` · 300 |
| `source.repo` | `unchartedterritory5995-cyber/UCT-Dashboard` @ `master` |

⭐ **The scoping is proven, not assumed:** the very next master push (`834034622`, then `d31b78b750`)
arrived as **SKIPPED** on chart-renderer — neither touched `services/chart_renderer/**`.

**Pool live** (`RENDER_POOL_ENABLED=1`, `RENDER_WARM_URL` set as a Railway reference
`${{web.CHART_RENDER_TOKEN}}`, so no human or log ever handles the value):

| Measurement | Result |
|---|---|
| Boot warm | `chromium launched (pool)` 20:41:17.049 → `warm render path=/r/chart ok` 20:41:19.461 → `pool: warm complete`. **2.41 s**, and the real `/r/chart` page rendered — an unauthorised page has no `#chart-export`, so "ok" also proves the token reference resolved. |
| First render after boot | **1,184 ms** — no cold start. The documented pre-warm behaviour was a 20–40 s first render after every deploy. |
| Five renders | 1,096–1,184 ms, median 1,140, `p95_render_ms` 1,180; all valid PNGs, `X-Chart-Ready: true`; 0 failures, 0 timeouts |
| Spare-context pool | `pool_hits 5 / pool_misses 1` — only the warm render missed |
| RSS | 528 MB, against a 2,500 MB recycle ceiling |
| Token in logs | 0 occurrences of `token=` in any form |

**Self-heal, measured by killing the browser** (`pkill` inside the renderer container):

| Step | Result |
|---|---|
| After the kill | `browser_connected: false`, RSS **528 → 120 MB** — Chromium genuinely gone |
| Next renders | all 5 succeeded, **1,004–1,074 ms**, 0 failures, 0 timeouts |
| Evidence of a NEW browser | `renders_since_recycle` reset (7 → 2) and RSS returned to 533 MB — `_current_slot()` saw `is_connected()` false and relaunched |

⚠️ `ready` stays `true` while `browser_connected` is `false`: `ready` means "a render sent now will be
served" (and it was), and the pool relaunches on demand. `browser_connected` is the field that tells
the truth about the browser. Recorded so nobody reads `ready` as a browser liveness check.

**`/renderhealth` made safe to register before the flip.** It was unregistered, and registering it
with V2 off would have produced a visibly broken admin command: the router only consults V2 when the
flag is on, and the handler called `get_runtime()`, which would have STARTED the runtime and created
the jobs database as a side effect of asking how things are. Now the router answers this one command
whatever the flag says (read-only admin diagnostic, most useful *before* the flip), and the handler
PEEKS `_runtime` and opens a store only if the database already exists — mirroring
`GET /api/discord/render-health`. Two new rails cover the flag-off path.

### Step 1.2b — `/renderhealth` registered · Step 1.3 — blocked (2026-09-13)

**`/renderhealth` is registered.** Commands here are **per-guild, not global** (`GET
/applications/{id}/commands` → `[]`; the guild set held `chart, c, chartsettings, buzz, flow`), so a
`--global` PUT would have given every member a *second* copy of every command. Registered into
`882293203485720596` only, after `89c6b12bf` was SUCCESS so the code that answers it was already live:

    chart · c · chartsettings · buzz · flow · renderhealth (default_member_permissions "8")

The other five are byte-identical to what was there. Live state at the end of Step 1: running
`89c6b12bf1de`, `/api/health` 200, `/api/discord/render-health` 401 unauthenticated, V2 flag still
absent, alert webhook present, flow-worker **SKIPPED** on both pushes.

**Step 1.3 (`#render-alerts` must be invisible to Contributor) — NOT DONE, blocked two ways.**

1. The Claude browser extension is disconnected since the restart, so the Discord UI is unavailable.
2. The API route does not work either: `DISCORD_BOT_TOKEN` is the **same app** that serves `/chart`
   (`UCT Intelligence`, `1474900505917653142`), and it gets **403 `Missing Access` (50001)** on
   `GET /channels/1548783155354403046`. It is not a member of that private channel and cannot edit
   its overwrites. Granting it access needs the same permission that is missing.

⚠️ Not a data-exposure issue: `#render-alerts` carries operational figures (queue depth, latency
percentiles, failure classes, correlation ids) and no member data. The webhook is unaffected —
posting does not require channel read access, which is why the test alert landed.

### Step 2.4b P2.1 — provider adapters, and the hot path wired to them (2026-09-13, Sunday)

| # | Date (ET) | Commit | Step | Files | Flags added (default) | flow-worker strand | Tests (scoped, totals) | Bench before → after | Deploy: status · running SHA | Member impact |
|---|---|---|---|---|---|---|---|---|---|---|
| 13 | 2026-09-13 | *(branch)* | **2.4b P2.1** — one adapter per upstream (bars · quote · flow · renderer · entity) behind `fetch(request) → Result`; timeouts, retries, breakers, fallback and the freshness stamp live only there; the V2 handlers bind adapter-backed callables. Closes **OI-21** (a 60 s renderer timeout behind a 15 s deadline, and a tuned breaker with zero callers), **OI-23** (three unreconciled failure vocabularies), and bounds **OI-22** (an unbounded quote call). | `api/services/discord_render/adapters/{__init__,result,_call,bars,quote,flow,renderer,entity,classes,bindings,switch}.py` (new) · `api/services/discord_render/commands.py` (`_chart_kwargs`/`_multi_kwargs` bind adapters) · `api/services/discord_render/runtime.py` (`Job.remaining_s`, additive) · 4 new test files · `docs/discord-render/instruments/mutation_harness_adapters.py` (new) | `DISCORD_RENDER_V2_ADAPTERS_ENABLED` — kill switch **under** the V2 master, unset = ON, read per call (railed), declared `dark`. Set to `0` and the handlers bind the raw functions again: a rollback of P2.1 with **no deploy**, and a switch, never a delete. | none — watch coverage `reachable=154 watched=24 changed=10 **OK**` | *(filled at the merge)* | n/a — no member-visible timing change while V2 is unset; the renderer ceiling drops 60 s → `min(20 s, remaining)` on the V2 path | *(branch only)* | **None.** The adapters are reachable only from `commands.py`, which runs only when `DISCORD_RENDER_V2_ENABLED` is set — and it is absent on `web` (read live). Proved **structurally**, not by a golden: `test_the_pre_v2_path_cannot_reach_the_adapters` asserts neither `discord_interactions.py` imports the package, so there is no path at all, for every input. |

### Master merge 5 — 2.4b part 2 (P2.1-P2.10), dark (2026-09-13, Sunday)

| # | Date (ET) | Commit | Step | Files | Flags added (default) | flow-worker strand | Tests (scoped, totals) | Bench before → after | Deploy: status · running SHA | Member impact |
|---|---|---|---|---|---|---|---|---|---|---|
| 14 | 2026-09-13 | `5ca4d5db2` | **Master merge 5**: rows 13 + P2.4/P2.6/P2.7/P2.9/P2.10 — the adapters, the member-facing stamp, the breaker and loop-stall alerts, the event-loop probe, and shadow mode | 39 files vs master, after merging **43** master commits with overlap on `CLAUDE.md`, `api/main.py`, `docs/feature_flags.json` (**merged, not rebased** — the standing rule sends an overlapping, 43-behind branch through a merge) | `DISCORD_RENDER_V2_ADAPTERS_ENABLED` · `DISCORD_RENDER_LOOPWATCH_ENABLED` (both kill switches under the V2 master, unset = ON, declared `dark`) · `RENDER_V2_SHADOW` (an ENABLEMENT gate, unset = OFF; declared here and in `03` §3.8d, **not** in `docs/feature_flags.json` — OI-27) | none — watch coverage `reachable=154 watched=24 changed=39 **OK**`; flow-worker **SKIPPED** on both pushes | 44 scoped files: **1,112 passed, 0 failed** on the merged tree. Mutation proofs **69/69 red**, restores sha-verified, controls green either side. Secret scan **0 findings** over 39 paths (run by hand — OI-26). Hygiene gate clean, 9,219 tracked files. | n/a with the flag unset; the renderer ceiling drops 60 s → `min(20 s, remaining)` on the V2 path, read in-process as **20.0** | BUILDING → DEPLOYING → **SUCCESS**; running SHA **`5ca4d5db2385`** read in-process; `/api/health` 200, bad signature 401, render-health 401 | **None.** `DISCORD_RENDER_V2_ENABLED`, `RENDER_V2_SHADOW` and both kill switches are **absent** in the running process, read in-process. The only pre-V2 change is the interactions route delegating to `_dispatch_interaction` and returning its reply **unchanged**, with a rail asserting the reply survives even when the shadow setup raises. |

## Owner decisions (OI-xx)

Each: the question, my recommendation, what I proceeded on. The owner overrides before the flip.
Full context for every row is in `03-architecture.md` §6.

| OI | Question | Recommendation | Proceeding on |
|---|---|---|---|
| OI-01 | D-04 refuses an unknown symbol in <1 s, but v20 measured that the universe is not a gate (AEHL, TCEHY, FNMA, BTC-USD chart and none are in it). | Refuse only when every authority (entity master, universe, bars store, breadth, index, delisted) misses; suggest ≤3 and start a background warm so a re-run of a real ticker works. | built in 2.4a, with one authority added after measuring production: after every static authority misses, `/api/bars` decides — only its `symbol_not_carried` answer refuses (^GSPC is in no static authority yet charts). The v20 premise is stale: BTC-USD and FNMA are `no_data` on `/api/bars` today, so refusing them matches what `/chart` already gives. |
| OI-02 | D-01 allows an asyncio queue. | Thread-backed bounded queue + dedicated executor, because the class being closed is event-loop saturation. SQLite persistence exactly as D-01. | the recommendation (built in 2.1) |
| OI-03 | Stay in `web` or move jobs to a dedicated worker service? | Stay in `web` with durable resume; revisit after 5 sessions of `resumed` data. | stay in `web` |
| OI-04 | The context line is a second PATCH that re-declares attachment ids. | Fold it into the image PATCH; drop it for that message when it is late. | the recommendation (2.6) |
| OI-05 | The warm cycle renders ~3,300 charts/day through the same 8 renderer slots members use. | Background lane: yields to members, ≤2 renderer slots. | the recommendation (lanes built in 2.1; renderer cap in 2.3) |
| OI-06 | The mplfinance stand-in says different things from the house chart and is unlabelled (4.8 % of baseline runs). | Label it on the image and in the message. | the recommendation (2.7) |
| OI-07 | `/flow` said "the flow feed is reconnecting" for timeouts, 500s and restarts alike. | Per-class wording + a ≤10-minute cached card labelled as cached. | per-class wording built (2.1a, V2 only); cached card in 2.4 |
| OI-08 | Alert destination. | New `DISCORD_RENDER_ALERT_WEBHOOK`, ships blank; recommend the dev server's `#system-alerts`. | ships blank |
| OI-09 | `/renderhealth` registration changes the app's command set. | Register at flip time (admin-only); the HTTP endpoint is the read path until then. | built in 2.2, **not registered**: `tools/discord_chart_commands.py register --renderhealth` at flip |
| OI-10 | D-02's RTH TTL (30 s) is shorter than today's 120 s daily TTL. | Follow D-02; the durable cache and the background lane absorb the extra renders; measure in `05`. | D-02 |
| OI-11 | Flow target = baseline × 0.5 may be unreachable for `days=all` (cost is flow-worker compute in a partner file). | Per-window targets from `02` (1 → 4.4 s · 7 → 4.9 s · 30 → 8.7 s · all → 10.4 s). | per-window targets |
| OI-12 | `chart-renderer` has no repo source; it deploys with `railway up` from a local directory. | Deploy from a clean checkout of the exact merged commit, weekend/after-hours; recommend connecting the service to the repo with watch path `services/chart_renderer/**` (owner action). | clean-checkout `railway up` in a window |
| OI-13 | The render token has been written to renderer logs in plaintext (every Playwright `Page.goto` timeout prints the URL). | Ship the log fix (2.3), then rotate `CHART_RENDER_TOKEN` (owner action; also `VITE_CHART_RENDER_TOKEN`). | log fix first; rotation is the owner's |
| OI-14 | ~77 web deploys/day (1,077 in 14 days, median pod life 8.4 min) is the root of C-01 for every feature on the pod. | Out of this program's scope; recorded with the measurement. | recorded only |
| OI-15 | flow-worker `/ticker-flow` has no internal time budget (2026-09-11: Massive OI fallback >60 s while web gave up at 30 s). | Our side: 10 s timeout + cached card + honest class. Their side (partner file): a budget inside `_compute_ticker_flow`. | our side only |
| OI-16 | `/flow` hardcodes `source=stocks`, so every ETF answers "no significant options flow" (SPY 0 vs **182** contracts with `etfs`, QQQ 0 vs 136, SMH 0 vs 83; measured 2026-09-13). | Resolve the partition from the symbol (ETF → `etfs`) via the shared resolver; railed with SPY/QQQ fixtures. Behaviour-changing for members (ETF flow appears), so behind the V2 flag. | the recommendation (2.4) |
| OI-17 | §3.7's boot warm renders `/r/chart?fixedbars=…`, but the page refuses a request without the render token (`ChartRender.jsx`: `TOKEN && token !== TOKEN` → "unauthorized") and chart-renderer does not hold `CHART_RENDER_TOKEN`. | Always warm with a hermetic render (Chromium launch + one canvas screenshot, no network); also render `RENDER_WARM_URL` when it is set. Recommend the owner set `RENDER_WARM_URL=https://uctintelligence.com/r/chart?sym=NVDA&tf=D&fixedbars=nvda-d&token=<render token>` on chart-renderer **after** the rotation in OI-13 — copying a credential between services is the owner's call. | hermetic warm shipped; `RENDER_WARM_URL` unset |
| OI-18 | §3.7 sets `RENDER_HARD_TIMEOUT_S` to 20 s by default, but web budgets 15 s then 25 s of readiness per attempt (`discord_chart_house._ATTEMPTS`) on top of 21/31 s of navigation, so a 20 s ceiling would 504 renders that succeed today. | Default the ceiling to the budget the request declares (2 × readiness + 6 s navigation + settle + 10 s): only a hang is cut, and no render that succeeds today changes. Lower it to 20 s once web's attempts are re-budgeted inside the 15 s deadline (2.4/2.6) and the RTH p99 is measured. | request-declared ceiling; env unset |
| OI-19 | The close-out plan puts dual-token acceptance on **chart-renderer**. Measured in code: chart-renderer **never validates the render token** — it navigates to whatever URL it is handed. The token is checked in two places, both on **web**: `app/src/pages/*Render.jsx` (14 pages; `ChartRender.jsx:76` reads `import.meta.env.VITE_CHART_RENDER_TOKEN`, baked at BUILD time, compared at `:778`) and `api/routers/render_panels.py:61` (`CHART_RENDER_TOKEN`, the `/api/r/*` payload gate). A `CHART_RENDER_TOKEN_PREVIOUS` on the renderer would be read by nothing. | Put dual acceptance where the check is: accept `VITE_CHART_RENDER_TOKEN` **or** `VITE_CHART_RENDER_TOKEN_PREVIOUS` in the render pages, and `CHART_RENDER_TOKEN` **or** `CHART_RENDER_TOKEN_PREVIOUS` in `render_panels.py`. Ship that first (additive, dark-safe), then one `web` rebuild flips new+previous together — no window where a sender's token is rejected, because the new bundle accepts both. Monday's job clears only the `_PREVIOUS` pair. | the recommendation (built in 1.1) |
| OI-21 | **`discord_chart_house.RENDER_TIMEOUT_S` is 60 s, over two attempts, behind a 15 s job deadline.** So the watchdog sends the failure message at 15 s and the call runs on for up to another 105 seconds holding a worker thread. Meanwhile `breakers.DEFAULTS["renderer"]` — tuned for exactly this dependency — had **zero production callers**. (Adjacent to OI-18, which is about the renderer's own in-page ladder; this one is the web-side client timeout.) | The ceiling is `min(§3.8's 20 s, the job's REMAINING time)`, enforced in the renderer adapter, not in the module constant. A per-dependency timeout answers "how long may this upstream take"; only the job knows "how long is there left" — take both and let the smaller win. `Job.remaining_s()` is the accessor that did not exist. | built in 2.4b P2.1 |
| OI-22 | **A quote failure is indistinguishable from "no extended-hours print".** Three layers swallow it: `massive.get_batch_rich_snapshots` returns `{}` on any exception, `fetch_ext_quote` catches `Exception` → `None`, and the call site catches again. So a quote outage looks like a quiet overnight, and no breaker can ever see it. | The adapter bounds the call (1.5 s, §3.8 — it had no timeout of any kind) and reports `EMPTY`, **with the limitation recorded on the Result itself** rather than in a comment nobody reads. Splitting the two means making `fetch_ext_quote` raise, which is a behaviour change on the pre-V2 path → 2.8, not 2.4b. | bounded now; the split deferred to 2.8 |
| OI-23 | **Three failure taxonomies, unreconciled.** `contract.py` drives the member-facing copy; `adapters/result.py` names what an adapter saw; and the flow leg emits a third set (`flow_timeout` / `flow_unavailable` / `flow_error`). A class that exists in one and not the others renders as a generic apology — which is the state C-08 describes, one level up. | One mapping, adapter class → contract class, with a rail asserting every member of `ALL_REASONS` has copy. Do it when the handlers are rewired (P2.4/2.6), not before: a mapping written against handlers that do not use it yet is a table nobody can falsify. | queued for P2.4 |
| OI-24 | **The correlation id is lost on the produce thread.** `api/services/discord_interactions.py:1856` spawns `discord-chart-produce` without `ids.carry(fn)`, so every `drender` event from inside a chart production is unattributable — on the one path where a member's complaint has to be traceable to a job. | One-line: wrap the target in `ids.carry`. It is a pre-V2 file, so it is a behaviour-neutral fix that helps both paths; it belongs to 2.8's "close every forensics class" rather than riding in with the adapters. | queued for 2.8 |
| OI-25 | **The fixed 1.5 s bars retry is in the CALLER, and an adapter retry multiplies with it.** `produce_chart._fetch` (`api/services/discord_interactions.py:1186`) loops twice around `bars_fn` with `BARS_RETRY_DELAY_S = 1.5` between — the exact re-synchronising delay `breakers.retry_delay` exists to replace. With the bars adapter also retrying, one chart would make up to **four** bars fetches and sleep ~2.9 s inside a 15 s deadline. Found by reading the call site after wiring, not by a test: both layers are individually correct. | The binding passes **`attempts=1`**: the caller already retries, so the adapter must not. The capability stays on `BarsRequest` for direct callers and keeps its mutation proof. Moving the retry into the adapter means deleting the caller's loop, which is a **pre-V2 file** and therefore a member-visible change — it belongs to 2.8, with the jitter, not to P2.1. | bounded now; the loop moves in 2.8 |
| OI-28b | ✅ **OWNER DECIDED 2026-09-14: adopt it.** `tests/test_chart_renderer_*.py` is the chart-renderer's own test file and this programme owns that service, so red on master there is **our** red. Fix the flat `edge_scope` import the way the surrounding code imports its neighbours, confirm the 6 failures go green on a clean `origin/master` checkout, and name the session that introduced it in the ledger so they know. | ⭐ This reverses the position below, which was *"a one-line conftest change from this programme would silently adopt another session's breakage."* The reversal is the owner's and the reasoning is ownership, not blame: nobody else is going to fix a test file for a service this programme is hardening, and a permanently-red suite is one nobody reads. | Lane C (`lane-c-budget`). Tiny isolated diff, one merge. |
| OI-28 | ⛔ **`tests/test_chart_renderer_*.py` IS RED ON MASTER AND HAS BEEN FOR SOME TIME — 6 failures, not this programme's.** `services/chart_renderer/app.py:63` does a FLAT `from edge_scope import …` (correct for the renderer image, which has `WORKDIR /app` and copies modules individually), but nothing puts that directory on the test path, so every test loading the renderer app dies at import with `ModuleNotFoundError: No module named 'edge_scope'`. | **Proved inherited, not assumed:** reproduced identically — `6 failed` — on a clean detached checkout of `origin/master`, and this branch touches neither `services/chart_renderer/` nor `conftest.py`. | Lane E's two renderer tests were made self-contained (`_renderer_module()` puts the directory on `sys.path` the way the image does) rather than skipped — a skip there would have hidden the **C-13 token scrub**, the one property on that surface that must never regress. ⛔ The 6 inherited failures are NOT fixed here: the fix belongs to whoever added the flat import, and a one-line `conftest` change from this programme would silently adopt another session's breakage. |
| OI-29 | **2.6 hardens the failure MESSAGE, not the path the forensics evidence came from** (Lane C, CCR-2). `JobContext.edit` → `runtime.edit_fn` → `di.edit_original`, so the chart IMAGE PATCH never passes through `delivery.py`. The 23 × `10015` and 23 × `ATTACHMENT_NOT_FOUND` in `01-failure-forensics.md` were image/follow-up PATCHes. | Lane C's AST walk over the callers, reported rather than assumed. | ✅ **OWNER DECIDED 2026-09-14: 2.6 is NOT done until the image PATCH goes through delivery.** Built: `delivery.edit_image` (multipart, same budget/retry/429/5xx/class table as the text path, plus the §3.4 size guard, plus a text fallback so a refused image still ends in a sentence) and `bindings.delivery_edit_fn()`, which the V2 runtime is now handed in place of `di.edit_original`, re-reading the adapters kill switch per call. ⭐ **The actual closure of C-04 is not the hardening — it is `_fold_attachments`.** The class is a SECOND PATCH re-declaring ids read off the FIRST patch's response with none of the bytes; the fold re-uploads the bytes instead, and **an id naming a part present in the same request cannot be stale**. No retry policy helps a payload that is wrong every time (0 % load correlation). Regression suite `tests/test_discord_render_image_delivery.py`, written as a DIFFERENTIAL — the same fake Discord refuses the pre-V2 shape and accepts the V2 one. Mutations: `mutation_harness_image_delivery.py`, whose `M0` is the non-vacuity control that makes the fixture stop refusing — the count is in the merge row below, and the first run was **19/21**: `M19` (a shared failure slot) and `M20` (the runtime handed the raw edit again) were GREEN, i.e. two claims the code made and no rail held. Both now have one. ⛔ **Pre-V2 untouched:** the fold lives in the V2 wrapper, so `discord_interactions.py` has no diff at all. |
| OI-30 | **`contract.FAILURE_CLASSES` has no `too_large` or `permission`** (Lane C, CCR-3); delivery maps both to `discord_rejected`. | Lane C reading §3.4 against `contract.py`. | **Closed by decision, no code change.** Lane C's own map argues it: *"Discord refused the message" is true of all four rejections and is the only one of them a member can act on* — a member did not choose the chart's size, so a distinct sentence gives them nothing to do. Adding two classes nobody can act on is the gold-plating the execution brief forbids. |
| OI-31b | ✅ **OWNER DECIDED 2026-09-14: build what `03` §3.6 says.** Two tiers — L1 in-memory (the 64 MiB heap, hot artifacts), L2 on the volume (512 MiB LRU **by bytes**), L1 miss → L2 → render; same key, same TTL rules, same degraded-never-fresh guard at both. ⭐ **The reason is the pod, not the spec:** this pod's median deployment serves 8.4 minutes, so an in-memory cache is empty exactly when the first render after a deploy needs it most — the argument that made in-memory look sufficient is the same measurement that makes it insufficient. | Required tests, named by the owner: L2 survives a simulated restart · an L1 eviction does not evict from L2 · a corrupt or partially-written volume entry is detected and treated as a MISS, never served. | Lane B (`lane-b-cache`). The interim in-memory-only state is recorded as a **superseded design, not deleted** — §3.6 and the code brought into agreement, one document one product. |
| OI-31 | **`03` §3.6 and the built cache describe two different products.** §3.6 names `cache.py`, an **on-volume** LRU at `DISCORD_RENDER_CACHE_DIR` (512 MiB); `07-execution-plan` §3 and Lane B's brief specify in-memory `artifact_cache.py`, which is what exists. | Lane B, which owned neither document and said so. | The built artefact is in-memory and per-process **by design** — this pod's median deployment serves 8.4 minutes, so durability is a separate decision, not an implied one. The flag note records the 64 MiB cap as the web pod's **heap**, deliberately not §3.6's 512 MiB. ⛔ §3.6 still says the other thing; correcting it is a doc change the owner should direct, because "add an on-volume cache later" and "§3.6 was aspirational" are different answers. |
| OI-27 | **`RENDER_V2_SHADOW` cannot be declared in `docs/feature_flags.json`, and that is a property of the ledger, not of the flag.** `feature_flag_index._GATE_MARKERS` is `("ENABLED", "DISABLE")`, so the scanner only ever sees a gate whose NAME contains one of those. A row for anything else is rejected by `test_the_ledger_does_not_describe_gates_that_no_longer_exist` as describing "a repo that does not exist" — correctly, from the scanner's point of view. Any flag named otherwise is therefore **structurally undeclarable**, which is a quiet hole in the one artifact that is supposed to make "off by accident" and "off on purpose" distinguishable. | Kept the owner's literal (`RENDER_V2_SHADOW=1`, as specified) and recorded it **here** plus `03` §3.8d and `04-visual-spec`, which is the precedent 2.4a set for `DISCORD_RENDER_V2_SYMBOLS_ENABLED` (a name built at run time, equally invisible). ⛔ **Renaming the owner's flag to suit the tool was the wrong trade** — it would have made the ledger green and the spec wrong, and the next person would have set the flag the spec names and seen nothing happen. The durable fix is widening `_GATE_MARKERS`, which belongs to the flag-ledger programme. | recorded; the marker list is another programme's |
| OI-26 | ⛔ **THE PRE-PUSH SECRET SCAN HAS NEVER RUN FOR ANY WORKTREE BUT ONE, AND THIS IS A PUBLIC REPO.** The hook is installed in the **shared** git directory (`uct-dashboard/.git/hooks/pre-push`), so it fires for all ~57 worktrees — but `tools/secret_scrub.py` exists only on **`feat/breadth-charts`**, which is not an ancestor of master. Every push from every other checkout prints *"the secret scan did NOT run. This is not a pass."* and proceeds. ⭐ The hook is behaving impeccably: it refuses to imply a pass it did not earn, and it is the ONLY reason this was noticed at all. | Not this programme's tool to move — the fix is for that branch's owner to land `tools/secret_scrub.py` on master, at which point every worktree's hook starts working with no other change. **Meanwhile, measured rather than assumed:** the scanner was read out of that branch (`git show feat/breadth-charts:tools/secret_scrub.py`, never a copy committed here — a second copy is a second authority) and run over this branch's 36 changed paths: **0 findings**, with its own `--self-check` passing first so the zero means something. | reported; the fix belongs to another branch |
| OI-20 | The hygiene gate can run as a **pre-commit hook** (`--staged`), which would enforce it at the moment of `git add -A` rather than at gate time. But git hooks live in the **shared** git directory: installing one reaches all ~57 worktrees and every concurrent session at once, and a hook that misfires (no `python` on that shell's PATH) blocks every session's commits. | Ship the gate as a **test rail** now (shared through git, cannot break anyone's commit), and leave the hook opt-in: `git config core.hooksPath .githooks` after copying the one-liner from the runbook. Revisit as a hook once it has a week of green in the gate. | gate rail now; hook documented, not installed |

## Loop log

Entries are instrument or process defects caught while doing the work — each one a place where
a tool, a test or my own script would have reported something untrue. Recorded so the same trap
is not walked into twice.

| When | What was wrong | How it was caught | Change of approach |
|---|---|---|---|
| Phase 0 | `railway logs --since 14d` answers from the **newest deployment only** — 7 lines for web on a day with 20 deploys. | 7 lines against a known-busy service. | `tools/discord_render_forensics.py` enumerates every deployment over GraphQL. |
| Phase 0 | Railway log search silently matches **nothing** for a phrase containing `[` `]`: `"[flow]"` returned 0 rows on deployments that held `[flow]` lines. | Probing the filter on two deployments before trusting an empty file. | The tool refuses bracket filters; post-filter the prefix locally. |
| Phase 0 | web writes **no uvicorn access log**, and HTTP logs are unreadable for past deployments — historical interaction volume and ack latency cannot be reconstructed. | 0 rows for `"HTTP/1.1"` on every deployment. | Recorded as a finding; V2's jobs table measures both going forward. |
| Phase 0 | The bench's median used `round()`, which rounds half to even: the median of two samples became the max. | A summary unit test failed. | Nearest-rank with `ceil`. |
| Phase 0 | The bench summary crashed on a `None` hop after all 170 rows had landed. | The in-pod log ended in a `TypeError`. | A hop that did not happen is absent, not zero; railed. |
| Phase 0 | The in-pod bench kept dying: web redeployed under it four times, and one keepalive relaunch landed mid-swap. | Row count stuck at 4 across checks. | `--resume`, output on `/data`, relaunch verified in the same ssh session. |
| Phase 0 | The first full log refetch lost **755 of 1,078** deployments to HTTP 429 (two fetches at once, 1–2 s retries) and printed `rows=0` after each failure — a failed read reported as an empty deployment. | A known positive (2026-09-11 AMD/AMDL `[flow]` timeouts) was missing from the result. | 429 backoff honouring `Retry-After`; failures print `FAILED` and exit 1; `--retry-failed` re-fetches only those. |
| 2.1a | The first patch script read the file in text mode, so its CRLF detection could never fire and the working copy was rewritten LF. | Byte count of `\r\n` after the patch. | Later scripts read with `newline=""`; git's autocrlf kept the commit to the 47 real lines. |
| 2.1a | 7 tests were red on master before this program touched anything — one asserted the invalid ▲ emoji it should have caught. | Running the same 7 on a detached checkout of `f4fc5d1c1`. | Corrected against the verified behaviour changes; the ▲ assertion now forbids it; mutation-proved. |
| 2.1a | My own heartbeat rail used timestamps on multiples of 5, so the modulo bug it names would have passed it. | Reasoning through the mutation before running it. | New timestamps (int(t) % 5 ≠ 0 at every beat), asserted in the test; mutation-proved red. |
| 2.1a | The mutation harness called a green control "NOT GREEN": a parametrized node id collects two tests. | Harness exit 1 with 10 passed, 0 failed. | `passed >= node ids`; second run exit 0. (Two runs; no third.) |
| 2.1b | The V2 router branch used `received`, which the handler never defined — a `NameError` on every interaction once flagged on. | Reading the branch back before writing its tests. | Receive timestamp captured at handler entry. |
| 2.1b | The lifespan hook used `asyncio.to_thread`, but `main.py` has no module-level `import asyncio`; the `except` would have logged "non-fatal" and V2 would never have started. | `grep -c "^import asyncio" api/main.py` → 0. | Local import in both hooks; lifespan AST rail mutation-proved. |
| Phase 0 | The per-deployment log loop could not fit Railway's API budget (`ratelimit-policy: q=1000; w=3600`, read off a response header) and was also **incomplete where it succeeded**: 1 `/flow` failure against 19 real ones. | A second known positive missing; the header on a single probe. | Stopped it. `tools/railway_env_logs.py` searches the environment in a few calls. |
| Phase 0 | `environmentLogs` with `beforeDate` returns **zero rows for any date**. The first version of the new tool used it, wrote "0 line(s)" for all eight filters and **exited 0**; its unit test passed because the fake assumed the same form. | "hot warm hit" at 0 lines, when thousands exist; then four query forms probed side by side. | `anchorDate` + `beforeLimit` + `afterLimit: 0` (measured); a **live known-positive control** now gates every run (empty control → exit 2, nothing written); the fake models the measured semantics and refuses `beforeDate`. |
| Phase 0 | The shell loop's `"$SPW\\$name.jsonl"` escaped the dollar, so every filter wrote to one file literally named `env$name.jsonl`. | The printed output path. | A Python driver builds paths; no Windows path goes through shell interpolation. |
| Phase 0 | A rail for "a future `--until` is clamped to now" stayed **green under mutation**: a future `anchorDate` returns rows normally (measured), so nothing depended on the clamp. | Mutation E3. | Removed the clamp and its test rather than keep a guard that cannot fire. |
| Phase 0 | With the no-progress guard mutated out, paging looped forever and pytest's timeout killed the process: **no totals line**, so the harness could not score it. | Mutation E4 read "NO TOTALS LINE". | The fake raises after a call cap, so a runaway fails like an assertion; re-run red. (Harness run twice; no third.) |
| 2.2 | The structured-event patch script refused its first run: three `log.exception("drender evt=…")` sites were outside its replacement list, and its own leftover check stopped it before writing. Converting them exposed a leak class: `log.exception` on a failed Discord edit writes the httpx traceback, which carries the webhook URL — the live 15-minute interaction token. | The script's `FILE NOT WRITTEN` guard. | `observe.exception` writes a scrubbed traceback; an AST rail forbids `log.exception` anywhere in the package; a runtime crash test asserts the token never reaches `caplog.text`. The script's second run wrote both files; no third. |
| 2.2 | The first alert rules read the last hour for everything and paged on a single renderer probe; `03` §3.9 specifies a 30-minute p95, a 5-minute failure burst and two consecutive probes. 14 mutations had already gone red — against the wrong windows. | Re-reading §3.9 against the code before committing. | Windows fixed to the spec, four more rails (M14–M17); §3.9 now records what 2.2 built and what waits for 2.4 (breaker-open). |
| Merge 2 | The post-deploy probe called `railway ssh` from Python's `subprocess` via `shutil.which` — on Windows the `.cmd` shim, so `cmd.exe` read the quoted `\|` as a local pipe ("The system cannot find the path specified"). A Git Bash retry printed nothing: MSYS path conversion rewrote `/opt/venv/bin/python` and `/proc/1/environ`. The HTTP checks had passed; only the in-process read was missing. | `VERIFY: FAIL` with `pod: NO ANSWER`, then an empty retry. | Stopped after two. Used merge 1's recorded recipe (`MSYS_NO_PATHCONV=1 railway ssh -s web echo <b64> "\|" base64 -d "\|" /opt/venv/bin/python`) with the probe as a file: answered first time. |
| 2.4a | The production-data probe of `symbols.py` printed nothing: its `2>/dev/null` threw away the traceback. Run again with stderr showing, it failed in my loader, not in the code under test: on Python 3.12, a `@dataclass` in a module loaded by `spec_from_file_location` looks the module up in `sys.modules`, and I never registered it. The real module is imported normally in production. | An empty result where JSON was expected; the second run showed the traceback. | Registered the module before `exec_module`; a probe never discards stderr. The third run used a changed instrument, not a repeat. |
| 2.4a | Two of 22 mutations stayed **green**. **S4:** the "swap" case in the one-edit test was APPL → AAPL, which is a substitution — only one position differs — so deleting the transposition branch changed nothing (the docstring example was wrong the same way). **S9:** the kill-switch test made `resolve` raise, but the check fails open, so the exception was swallowed and the request queued exactly as it would with the switch honoured. | The harness verdict `GREEN UNDER MUTATION`. | S4: a real adjacent swap (NDVA → NVDA) plus a two-position non-swap; docstring corrected. S9: the fake records calls and the test asserts none happened. Harness re-run; a rail whose failure the code under test swallows is not a rail. |
| Step 0 | The restart capture withheld three files for "credential-shaped content". All three were **false positives**: the scanner's `sk-[A-Za-z0-9_-]{20,}` matched hyphenated slugs — `v2-ri`**`sk-register-and`**`-directives.md` and `feat/de`**`sk-sharpen-workshop-card`**. One session's reconstructed resume and a design doc were withheld for nothing. | Reading each match **in context** rather than trusting the hit count. | Verified in context, then committed and pushed (`944231be4` on `feat/catalyst-coverage-precision`). ⭐ A secret regex anchored on a two-letter prefix inside a hyphen-rich corpus is an instrument that manufactures findings; the fix for the next capture is a boundary (`(?<![A-Za-z0-9-])sk-`) plus an entropy floor, not a longer block list. |
| 1.1a | The patch that rewired the 14 render pages detected each file's line ending **from disk** and wrote that back. Git stores these files LF; the working copies were CRLF, so every file came back as a whole-file rewrite — `918` changed lines on `ChartRender.jsx` instead of 2. A 14-file whole-file diff would have conflicted with every other session touching those pages. | `git diff --numstat` after the patch: 14 files, every line changed. | Normalised all 14 back to LF (a byte transform, never a `git checkout`), re-measured: **2 lines changed per file**. ⭐ The rule the script had wrong: an EOL-preserving patch must write the ending the **index** stores, not the one it finds on disk — on a box with `core.autocrlf=true` those differ by design. |
| 2.4b | The SAME line-ending trap, a second time — `docs/feature_flags.json` came back as a 1,199-line whole-file diff after a 7-line edit. A Python `newline=""` round trip preserves what is ON DISK, and on this box git checks these files out CRLF while the index stores LF. | `git diff --numstat` again. | Normalised to LF; the diff became `0 7`. ⛔ **Standing rule, now that it has cost two edits:** any repo file written from Python on this box is written **LF**, matching the index — never "whatever was on disk". |
| R-2 | Building the line-ending gate, I ran `git checkout -- docs/discord-render/LEDGER.md` to undo a one-line probe I had appended as a control. It also discarded the finished **R-1 ledger correction** in the same file — twenty minutes of writing, gone, and I only noticed because I grepped for its text afterwards. | `grep -c "owner ruling R-1"` returned `0` for LEDGER.md and `1` for the other two docs. | Re-wrote it. ⛔ `feedback_mutation_check_never_git_checkout` now has a **second** incident behind it, and this one was not a mutation harness — it was a two-second "undo". **`git checkout -- <file>` is not an undo, it is a discard of everything uncommitted in that file.** Capture the bytes and a sha first, write them back, verify the sha. The rule is in CLAUDE.md beside R-2. |
| R-2 | The first version of the gate was **green under mutation** on both planted flips. Two independent defects: it hashed the working file with `git hash-object` (no `-w`), so `cat-file` could not read the sha back and every worktree check silently returned "nothing to look at"; and it compared an EOL *style*, which cannot see a flip on `docs/plans/joystick/deferred.md` because that file is **mixed** — 87 CRLF lines among LF ones — so both sides answer `crlf`. | The end-to-end proof: `*** GREEN UNDER MUTATION ***` on a file whose diff was visibly `87 87`. | Predicate rewritten to compare **CR-stripped content** (endings are the only difference ⇒ report), which is filter-independent and catches the mixed case; worktree mode reads the file directly. Re-proved RED on two different CRLF-stored files, with a clean control either side. ⭐ Both defects made the check answer "no" to everything — `lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`, and the reason the rail carries 11 quiet-cases beside its 4 firing ones. |
| 2.8 | ⛔⛔ **THE ADAPTER SPINE OVERRAN ITS OWN DEADLINE, AND THE LAYER EXISTS TO STOP EXACTLY THAT.** `_call.guarded` computed the effective budget **once per call** and handed it to every attempt, so an N-attempt hop could spend N × the job's remaining time. The live blast radius was zero purely by luck — `bindings` passes `attempts=1` for an unrelated reason (OI-25, the caller already retries) — so the adapter's own default was unsafe the moment anybody used it. | Lane E's `chaos_scenarios.py` on its first run: **4.6 s spent against a 2 s deadline** with the bars adapter's `ATTEMPTS = 2`. Lane E could not fix it (it ships no `api/` change) and marked the test `xfail(strict=True)` naming what must land. | Budget re-read **per attempt**; an attempt with less than `MIN_USEFUL_S` left raises rather than starting. Measured after: attempts of 1, 2 and 3 against a 2 s budget all spend ~2.0 s. The strict marker then turned the pass into an `XPASS(strict)` **failure**, which is precisely its job — a plain red test would have blocked every merge in the queue, a non-strict xfail would have swallowed the fix in silence. Now a standing guard, with mutation **A76**. ⭐ The same arithmetic as OI-21 one layer down: a per-call ceiling is a per-ATTEMPT ceiling. |
| P2.10 | ⚰️⚰️ **THE FIRST RUN OF THE ADAPTER BENCH PRINTED NUMBERS THAT WERE A LIE, AND IT TOUCHED THE OWNER'S LIVE BARS STORE TO DO IT.** `bindings.bars_fn` calls `bars.fetch(...)` with no `fetch_fn`, and the adapter then imports the REAL `fetch_bars` — so the "adapters" case never used the stub. It benched the live path against `C:\data\bars.db` (3 GB) while the "raw" case benched a 1 ms stub. | **`adapters` measured FASTER than `raw`** (0.635 ms vs 1.529 ms), which is impossible for a wrapper, plus a `bars_sanitize` warning that only a real fetch emits. | Stub pinned into `api.routers.discord_interactions.fetch_bars` so the adapter's own lookup finds it, **and `run()` now refuses to start** unless a live probe proves the adapter reached the stub. ⛔ The lesson is not "remember to stub": a bench whose cases do not provably call the SAME upstream is comparing two different programs, and a number from it is **worse than no number because it looks like evidence**. ⚠️ Second finding on the same run: a bare `python tools/...` run is outside pytest, so the conftest tripwire does not apply and `/data` resolves to the owner's live files (CLAUDE.md says so; I did it anyway). **Checked: no bars were written** — `bars_provenance` had zero rows in the window and NVDA's newest daily bar is unchanged at Friday's close. The file mtime moved because opening a WAL database **read-only still rewrites its `-shm` index**, and I very nearly reported a leak from a sidecar mtime — the exact inversion CLAUDE.md warns about. |
| P2.10 | ⚰️⚰️ **A `railway ssh` PROBE IS A DIFFERENT PROCESS, AND ITS VERDICTS CAN BE SIMPLY WRONG.** Minutes after switching shadow mode on, an in-pod probe reported `ticker_search_index.ready() = False`, `_INDEX = 0`, and **every** symbol `unanswerable` — including obvious junk (`ZZZZQQ`) and a real typo (`NDVA`). Read at face value that says V2's headline D-04 feature (refuse an unknown symbol in <1 s with suggestions) is **inert on production**, which would have been a serious finding to report. | `pid=569` in the probe's own output. `railway ssh` spawns a fresh Python; the uvicorn server is **pid 1**. The ssh process imports every module COLD, so the index it reads is the one it just failed to build — not the server's. `/api/ticker-search?q=NV` through the real server returned real entity rows seconds later. | Nothing was wrong. ⭐ `05-progress` already said a pod probe's **timing** is "a cold process: an upper bound" — the half nobody had written down is that a **VERDICT** from one can be wrong outright, because module state changes the ANSWER and not just the latency. Now stated in `shadow._index_ready`'s docstring beside the field it produces. ⛔ The near-miss is the point: this was one report away from being published as a production defect (`lesson_verify_in_the_users_client_not_your_own`, `lesson_an_instrument_can_reproduce_its_own_blind_spot`). |
| P2.10 | The probe artifact exposed a **real** ambiguity underneath it: the shadow recorded `would_refuse` and `divergence` but nothing to distinguish **"V2 agreed with the old path"** from **"V2 could not tell"**. Both produce zero refusals — and zero divergence is the single number the flip decision rests on. A weekend of apparent perfect agreement could have meant every symbol check failed open. | Reading the probe output and asking what a `0` would have meant. | `unanswerable` and `index_ready` added to every shadow line, the second three-valued (`None` = we could not find out, which is not `False`). Mutations A70–A72 red. ⭐ **The wrong instrument found the right defect** — the artifact was not the finding, but looking hard enough to disprove it was what surfaced one. |
| P2.1 | Two mutations stayed **green**, and both were instrument defects rather than code defects. **A17** (`bars.ATTEMPTS` 2 → 1, so every transient bars failure becomes final) passed because the only retry test called the SPINE directly with `attempts=3` and never touched the adapter's own constant — a constant nothing reads is a setting, not a behaviour. **A33** (dropping the `if r.ok` guard in the binding) passed because `fail()` always nulls `data`, so the only case the guard defends was one no test could construct. | `34/35 mutations RED` twice, with the same two names. | A17 re-aimed at two new tests that drive `bars.fetch` and count the attempts. A33's rail now builds a `Result(ok=False, data=<partial rows>)` **by hand** — the shape an adapter returning a partial payload would produce, and exactly what must not reach the renderer. Both RED on re-run. ⭐ Neither was "the mutation was wrong": each named a real hole, and the second one showed the guard was not dead code — the test was. |
| P2.1 | Wiring the adapters into `_handle_flow` exposed a **modelling** error the tests could not see: `unreachable` and `upstream_error` were one class, and an empty `/flow` tape was being reported as a failure. Every existing test passed, because each case happened to want the same outcome. | Reading `run_flow_card_job` to find the seam, not a red test. | `UNREACHABLE` split out (it decides whether the in-process fallback runs at all — a 5xx means flow-worker ANSWERED and `web`'s copy would answer the same); an empty tape returns `ok` with `contract_count == 0` so the router keeps its own sentence. ⭐ **The C-08 mistake has two directions** and this step committed the second one: not four causes made into one, but one non-cause made into a cause. |
| R-2 | Widening the gate to the whole programme (39 files, not the 31 I had been running) found a red I shipped in **1.1**: `VITE_CHART_RENDER_TOKEN_PREVIOUS` is read by `app/src/lib/renderToken.js` and had **no `build_flags` row** in `docs/feature_flags.json` — the exact class the owner had already made me close once. It was invisible because `test_vite_flag_ledger.py` was outside my scoped list. | `1 failed, 939 passed` — the first run of the wider set. | Row added (`dark`, UNSET, operator, with the "set both halves or neither" note and the Monday retire job named). ⭐ **A scoped gate is a claim about the files you named, not about the branch.** The file that catches a class of defect is the one least likely to be in a list you assembled from the files you were editing. |
| R-2 | The standing rule as written after 1.1a and 2.4b — *"always write LF"* — is **wrong in one direction**, and I only found out by measuring. With `core.autocrlf=true`, writing CRLF over an LF-stored file is cleaned on the way in: `git diff` reports nothing at all. The damaging direction is a CRLF-stored or mixed blob **flattened to LF**. | `docs/feature_flags.json` rewritten CRLF: numstat **empty**. | Rule restated as *"write what git already stores"*; the gate enforces that and nothing else, so it never fires on a correct CRLF edit. ⭐ Two incidents had produced a rule that happened to work for the wrong reason — a third would have entrenched it. |
| 2.4b | The merge with master produced a **duplicate** `ALERT_TAXONOMY_INDICATOR_CONDITION_DARK_ENABLED` in `docs/feature_flags.json`: I declared it (status `dark`) to unblock the gate, and the owning S7 session declared it in the same window (status `armed`). `json.load` keeps the LAST duplicate, so the "every gate is declared" rail passed while the file carried two entries — only `test_no_flag_is_declared_twice` caught it. | The scoped gate: 838 passed, 1 failed. | Removed mine, kept theirs: they own the flag and they know it is armed. ⭐ `lesson_a_clean_merge_can_still_duplicate_a_key`, exactly — and the reason two rails exist for one file. |
| C-07 | ⛔⛔ **THE VINTAGE HAD TWO AUTHORS BEFORE IT HAD ONE CONSUMER.** `freshness.Envelope.badge` owned `⚠ data as of … ET (stale)` while `ChartRender.jsx` composed its own `· data as of Aug 28` out of the stats blob's `as_of` — two sentences about one value, under one chart, neither reaching the other. 03 §3.8's `?stale=<as_of>` would have made that permanent: a bare date on the URL leaves the page to phrase the warning, which is the second author written into the contract. | Reading the page while closing the URL seam. The page already disclosed a vintage, so "the page cannot say it is stale" was half wrong, and the half that was right was the wiring. | `?stale=` carries the **SENTENCE**, composed once by `badge.vintage_param` out of `Envelope.badge` and drawn verbatim; the page suppresses its older stats clause whenever the backend's verdict is present, so there is only ever one vintage sentence under a chart. 04 §2b records the decision and says plainly that it supersedes 03 §3.8's sketch. ⭐ The general shape: **a parameter's TYPE decides how many authors a sentence has.** Ship the value and you have bought a second author in every consumer, forever. |
| C-07 | The pre-V2 byte-identity claim could not be settled by reading the diff: `urlencode` writes a dict in insertion order, so *where* the parameter is added is behaviour, and "it is gated on `options`" is exactly the kind of sentence that stays true until somebody moves a line. | Asking what evidence would distinguish a correct gate from a plausible one. A transcribed expected-URL proves only that somebody typed it correctly once. | `tests/test_discord_render_vintage_url.py` reads `api/services/discord_chart_house.py` at `4eec5e0aa` through `git show`, **executes that version**, and compares `build_render_url` across eleven option shapes — with a non-vacuity control asserting the loaded module really is the older one (otherwise it is the current module compared with itself, green forever) and a control asserting the comparison CAN report a difference. Mutation V4 plants the vintage in the params dict at creation and turns the whole matrix red. |
| C-07 | A golden for the stale render could not live in `prev2_replies.json`: that capture runs with `house_fn` **absent** so nothing reaches the network, which means the house render URL is never built on that path at all. A case added there would have been green whatever `build_render_url` did. | Reading `_capture_chart` before adding a scenario to it. | A second golden, `goldens/render_urls.json`, reading the builder directly — nine URLs that carry no vintage, two that carry the sentence, and three verdicts (fresh · unknown · stale-with-no-readable-timestamp) recorded for the **silence** they produce. ⭐ A golden that cannot see the thing it is named after reads as coverage and is none (`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`), and the absent badge is pinned as deliberately as the present one — "rare, or it is furniture" is the half a golden usually forgets. |
| C-07 | ⚰️ A control-character class went into `ChartRender.jsx` as **literal bytes** (NUL, 0x1f, DEL) instead of JavaScript unicode escapes, and git immediately classified the file as **binary** — the same defect a single 0x01 in `hub/useHubCursor.js` has already cost this repo. | `grep` answering `Binary file app/src/pages/ChartRender.jsx matches` where it had answered normally a minute earlier. | Rewritten with escape sequences by a byte-level replace; control-byte count re-measured at **0** and `git diff --numstat` back to `22 0`. ⭐ It was caught in passing output, by accident — nothing in the edit path looks for it, and a source file git reads as binary makes every later diff and every ripgrep on that page useless. |
| C-07 | The frontend half is **written and not run**: this lane's worktree had no `app/node_modules`, and the standing rule on this box is never to `npm ci` into it (three concurrent sessions OOM-swept the machine on 2026-09-12 doing exactly that, and a junction removal emptied a live worktree's `node_modules` on 09-13). | Checking for the directory before claiming a test result. | `app/src/pages/ChartRender.stale.test.jsx` ships with the change and is reported **UNVERIFIED** — named in 04 §7 and in this row rather than counted as coverage. One command closes it from a checkout that has the packages: `npx vitest run src/pages/ChartRender.stale.test.jsx`. ⛔ An unexecuted test is not a rail, and a lane that reports one as green has published a fiction. |

## Phase summaries

### Phase 0 — discovery and forensics (2026-09-13) · closed

**What exists:** `00-system-map.md` (every command, hop, timeout, cache and silent path, from source
and Railway) · `01-failure-forensics.md` (incidents and 14 classes) · `02-baseline.md` (170 in-pod
rows, closed market) · `tools/discord_render_bench.py` · `tools/discord_render_forensics.py` ·
`tools/railway_env_logs.py`.

**What broke in the last 14 days, by class (floors, not a census — see finding #1 in `01`):**
- **C-08 `/flow`: 19 failures, 14 in RTH, 18 of them timeouts**, and every one was told "the flow feed
  is reconnecting". **C-14: every ETF `/flow` is wrong** — SPY 0 contracts with `stocks` vs 182 with
  `etfs`.
- **C-02: 23 chart replies lost to `10015 Unknown Webhook`** (22 in RTH, 10 on 09-07 alone), 37× more
  likely within a minute of the renderer failing to load `/r/chart` — `web` saturation.
- **C-03: 33 charts shipped without their controls** (invalid ▲ emoji), and the test suite asserted
  the bug; 7 Discord tests were red on master until this program.
- **C-04: 23 follow-up edits refused** (`ATTACHMENT_NOT_FOUND`), deterministic, cause narrowed to the
  one path that re-declares attachment ids.
- **C-05: ticker autocomplete dead for six days** (178 failures, 08-31 → 09-06).
- **C-01: `web` deployed 1,077 times** (median pod 8.4 minutes); every restart can strand a reply and
  238 renders failed because the page was not being served.
- C-06 258 blank + 84 near-empty renders, 3 unlabelled stand-ins (2 never healed) · C-09 the warm
  cycle overran its budget 4,785 times · C-13 the render token in renderer logs 142 times.

**Baseline (closed market, before any change):** liquid chart p50 **2.17 s** / p95 **2.40 s** / p99
**14.8 s** · invalid symbol **1.5 s**, no suggestions · `/flow` cold p95 **17.3 s** · stand-in on 4.8 %
of runs, unlabelled · 58 of 85 cases byte-identical run to run. RTH baseline pending (Monday).

**Could not be reconstructed:** interaction volume, acknowledgement latency, the command/ticker behind
each Discord failure, the count of restart-killed jobs. V2's jobs table and structured events exist so
that next time these are queries.

**Built on the branch, dark, not merged:** 2.1 (runtime, durable jobs, deadline, failure contract,
`fail_fn` hooks, V2 command layer, router branch, lifespan resume/release) — rows 1–3 above; **18
mutations across three harnesses, every one red with a sha-verified restore and a green control**
(7 on the 2.1 core and corrected tests, 8 on the V2 router/commands/lifespan, 3 on the log tool). **Next:** the first master merge (Phase 0 docs/tools + dark 2.1),
then 2.2 observability — both done; see Phase 2.

### Phase 2 — build (2026-09-13 →) · in progress

- **2.1** runtime, durable jobs, deadline, failure contract, V2 command layer — merged **dark** in
  master merge 1 (`740b79ad5`, row 4).
- **2.2** observability — `2509cc0de` (row 5): every V2 line a scrubbed `drender` event; SLOs and
  alert rules computed from the durable jobs table; alerts with a durable cooldown; hourly purge;
  `GET /api/discord/render-health`; `/renderhealth` built but unregistered. Ships dark in master
  merge 2.
- **2.3** renderer hygiene + the warm pool — `d32d14d60`; renderer deployed `6090d306`.
- **2.4a** symbol resolution at the ack + the `/flow` ETF partition (C-14) — `d623baf1d`, row 10.
  ⛔ **2.4a did NOT ship the freshness contract** (owner ruling R-1, 2026-09-13). The line this
  bullet replaced read *"2.4 symbol resolution, freshness, breakers, the ETF partition"* — one
  PLANNED step that was built as two, and a later reader took the plan for the record and credited
  2.4a with work that did not exist until 2.4b. Row 10's own shipped-list was correct all along;
  it is this forward-looking line that drifted, which is the usual direction.
- **2.4b** part 1 — the market clock and the freshness envelope (a SESSION verdict, never a fixed
  age: `03` §3.8b) plus the per-dependency breakers — `9087bc196`
  (`api/services/discord_render/{freshness,breakers}.py`). 35 + 22 tests; mutations 9/9 and 8/8 red.
- **2.4b P2.1** — the provider adapters (`03` §3.8c), and the V2 handlers wired to them. Row 13.
  ⭐ Both of 2.4b part 1's modules were **built, tested, green and unwired** until this step:
  `breakers.py` had zero production callers and `freshness.py`'s only importer was a test. The
  adapters are their first real consumer, which is the difference between a capability and a
  behaviour.
- **Next:** P2.2 (per-upstream timeouts wired into the deadline arithmetic end to end) → P2.10, then
  2.5 artifact cache + coalescing · 2.6 Discord delivery hardening · 2.7 visual spec + goldens ·
  2.8 close every forensics class.

## OI-31 — resolution (Lane B, step 2.5, 2026-09-14)

⛔ Appended, never edited in place: this lane's ledger mandate was exactly one row, and the original
OI-31 entry in the open-items table above is left standing as the record of what was believed at the
time. Read them together — the row above is the finding, this one is the ruling.

| # | What was wrong | How it was caught | Resolution |
|---|---|---|---|
| OI-31 | **`03` §3.6 and the built cache described two different products.** §3.6 specified an on-volume LRU by bytes at `DISCORD_RENDER_CACHE_DIR` (512 MiB); what shipped was an in-memory, per-process store that wrote nothing, and said so in a module docstring, in a test (`test_the_cache_is_in_memory_by_design_and_writes_nothing`) and in a mutation (B32, *"a durability layer nobody asked for is imported"*). | Lane B, which owned neither document and said so; ruled by the owner 2026-09-14. | **DECIDED: build what §3.6 says. The in-memory-only design is SUPERSEDED, not wrong-and-deleted** — it is recorded here because the reasoning behind it was sound and the conclusion was backwards, which is the only kind of mistake worth keeping. That reasoning: *the median pod serves 8.4 minutes (C-01), so durability is a separate decision.* ⭐ **The owner's inversion is the whole entry: an 8.4-minute pod is not the argument against durability, it is the argument FOR it.** `web` deploys ~77 times a day, so an in-memory cache is empty exactly when the first render after a deploy needs it most — the busiest minute the pod ever has. The old build's own consolation, *"what survives a restart is the KEY"*, is true and insufficient: determinism makes the hit POSSIBLE, durability makes it HAPPEN on the first request rather than the second. Built as two tiers — L1 heap (64 MiB), L2 volume (512 MiB, LRU by bytes), L1 → L2 → miss, an L2 hit promotes into L1, an L1 eviction never reaches the volume and an L2 eviction never reaches the heap. ONE expiry function (`expired_at`) called by both tiers, so "same TTL rules" is structural rather than two copies agreeing. Atomic write (tmp in the same directory → `fsync` → `os.replace`); the read verifies payload LENGTH, SHA-256, and that the file claims the key that was asked for — eleven damage cases are each a recorded miss, never served, never raised. The degraded-never-fresh guard is explicit at the deserialisation boundary: no envelope ⇒ `stale is None` (unknown, not fresh), and a `stale` that is neither a bool nor `null` is corruption rather than a verdict. §3.6 rewritten to the built product with a *"Where it differs"* paragraph rather than a silent edit. **Two non-additive changes named because they are not refactors:** (1) the heap cap moved off `DISCORD_RENDER_CACHE_BYTES` to `DISCORD_RENDER_CACHE_MEM_BYTES` — one variable cannot be two caps, and the collision ran the dangerous way, since an operator setting §3.6's documented 512 MiB for the volume would have raised the HEAP ceiling eightfold on a pod that OOMs members; nothing sets either name today. (2) L2's `/data/...` default must be an INLINE literal in the `os.environ.get` call — written as a named constant it read as a path no env var can move and took `conftest.shared_data_root_census()`'s `unpinnable` from **0 to 1**, measured, which is a path a test run resolves against the owner's live `C:\data`. ⛔ `contracts.py` UNCHANGED: `CacheKey`, `CachedArtifact` and `ArtifactStore` are satisfied exactly as frozen, so Lane A's wiring is unaffected. |

⚠️ **Raised while doing the work, and NOT resolved here: the "degraded artifacts are cached apart"
clause of §3.6** — stand-ins 60 s, cached flow cards only as a labelled fallback — **is not built,**
**and this module cannot build it.** Nothing in the store can tell which artifacts are stand-ins:
that fact lives with the caller that chose the stand-in, so the shorter TTL is a wiring decision for
the handler step (2.4/2.8). It is flagged in §3.6 as **OI-32** and deliberately has no row of its own
in the table above — this lane's mandate was one OI-31 row, and "cache the stand-in for 60 s" versus
"never cache a stand-in" is the owner's answer to give, not a lane's. ⛔ It is named rather than
quietly dropped, because a §3.6 clause describing behaviour no code has is exactly how OI-31 started.

⚠️ **Also recorded rather than fixed: §3.6's `data_version` line named `session_state` as part of the
chart key.** It is not in the key and must not be: the session is the wall clock wearing a hat, and
with it in the key the same closed-market input re-keys at every session boundary, which makes
§3.10's determinism guarantee unobservable. `key_for` cannot read a clock at all and
`test_the_key_cannot_read_a_clock_at_all` is what makes that structural. §3.6 now says so in place of
the old claim, with the reason beside it.
---

## Lane C — OI-28 (adopted) and the C-10 budget close-out (2026-09-14)

Branch **`lane-c-budget`**, worktree `C:\Users\Patrick\uct-worktrees\lane-c-budget`, cut from
`4eec5e0aa`. **Not merged, not deployed, no flag touched.** Rows appended at the end of this file
by agreement; nothing above was edited.

| # | Date (ET) | Commit | Step | Files | Flags added (default) | flow-worker strand | Tests (scoped, totals) | Bench before → after | Deploy: status · running SHA | Member impact |
|---|---|---|---|---|---|---|---|---|---|---|
| C1 | 2026-09-14 | `d98cfd38b` | **OI-28 adopted** — the two chart-renderer loaders make their own `edge_scope` path entry | `tests/test_chart_renderer_{service,pool}.py` | none | none — tests only | `test_chart_renderer_service.py` **6 passed** (was 6 failed) · `test_chart_renderer_pool.py` **16 passed** (was 16 failed) · `test_chart_renderer_dualstack.py` 13 passed · all three together **35 passed** | n/a | **branch only** | None. Test-side only; `services/chart_renderer/app.py` is byte-identical to master, so the deployed renderer image is unaffected and no renderer deploy is implied. |
| C2 | 2026-09-14 | `ca1eb4e61` | **C-10 close-out** — `_Budget` + a module-level `_attempt`, so the per-attempt derivation is the only shape the source allows; the retry backoff moved inside the budget | `api/services/discord_render/adapters/_call.py` · `tests/test_discord_render_adapters.py` · `docs/discord-render/instruments/mutation_harness_adapters.py` | none | **none** — `tools/flow_worker_watch_coverage.py` on this tree: `base=origin/master reachable=154 watched=24 changed=5` → `OK`. Re-run on the merged tree before any master push. | 23 discord-render files: **600 passed, 3 xfailed** | not benched — V2 is off, so no member path changes. The measurement that matters is the simulated one below. | **branch only** | None while `DISCORD_RENDER_V2_ENABLED` is unset. With V2 on: a multi-attempt upstream hop can no longer outlive the job deadline, so a member is never left waiting on a call that was already answered. |
| C3 | 2026-09-14 | `988983466` | two adapter mutations repaired (A5 re-indented by C2; **A29 stale since P2.6/P2.7**) + the NOT-APPLIED count put on the harness summary line | `docs/discord-render/instruments/mutation_harness_adapters.py` | none | none | control suite 134 passed (adapters + result + boundary); all 80 `old` patterns verified to match exactly once before the run | n/a | **branch only** | None — instrument only. |

**Mutation harness, full run on `988983466` (`python -u docs/discord-render/instruments/mutation_harness_adapters.py .`, exit 0), verbatim:**

```
CONTROL (before)  GREEN    warnings.warn(PytestDeprecationWarning(_DEFAULT_FIXTURE_LOOP_SCOPE_UNSET))
...
CONTROL (after)   GREEN    warnings.warn(PytestDeprecationWarning(_DEFAULT_FIXTURE_LOOP_SCOPE_UNSET))

80/80 mutations RED, 0 NOT APPLIED (a NOT APPLIED proves nothing)
```

The five that are this lane's, each RED with a sha-verified byte restore: **A76** (the budget
computed once per call) · **A76b** (the attempt runner handed the once-per-call float again) ·
**A76c** (the backoff slept on top of the budget instead of inside it) · **A76d** (the wait on the
future outliving the upstream's own timeout) · **A76e** (Lane E's own C-10 guard defanged back to
an `xfail`). ⛔ **A76e writes `tests/test_discord_render_forensics.py`, which this lane does not
edit in the repo** — the harness restores the bytes it captured first under a `sha256` check in a
`finally`, nothing of it is committed, and `git status` was clean after the run. Without it the
permanence rail would be a gate nobody has seen fire.

### C-10: what "not allowed to stay lucky" turned out to mean

The integration fix re-derived the remaining budget inside each attempt and was **correct**. What
it was not is **safe**, and two things were still open:

1. **The wrong version was one token away.** The attempt body was a closure inside `guarded`, so
   `eff` — the whole-call float — was a live name beside `left`, and `submit(fn, eff)` would have
   read as obviously right while restoring the N × deadline overrun. Closed structurally:
   `_Budget` is an object whose only accessor subtracts the clock, and `_attempt` is **module-level**
   (`__code__.co_freevars == ()`), so `eff` is not a name that exists inside it. Handing it a float
   now raises `AttributeError` on the first line instead of overrunning quietly.
2. ⚰️ **A SECOND OVERRUN, IN THE DOCSTRING THE WHOLE TIME.** `_call`'s header has always promised
   *"the retry, with jitter, INSIDE the same budget"*; the code slept the full jittered delay
   regardless of what was left. Lane E's guard cannot see it — it passes `sleep=lambda _s: None`.
   Measured on a virtual clock: **3 attempts / 2 s deadline / a 1.5 s upstream spent 2.7–3.7 s**.
   The first attempt ate 1.5 s, attempts 2 and 3 were correctly REFUSED for want of budget, and the
   hop then sat past its deadline **sleeping between the refusals**, having already answered the
   member. `_Budget.wait()` clamps each delay to what remains.
   (`lesson_a_comment_naming_a_mechanism_is_a_claim_about_a_run`.)

**The owner's test, measured:** `attempts=3`, a 2 s deadline, a 1.5 s-per-attempt upstream →
**2.000 s spent, exactly**, one upstream call handed the whole 2.000 s. With the once-per-call
derivation restored it is **5.000 s** — the same shape as the 4.6 s Lane E's chaos harness measured
live. Also asserted across `attempts=1,2,3,5`: the ceiling is a property of the DEADLINE, never of
the retry count.

⛔ **Tolerance is ZERO, and that is not a boast.** `guarded` takes `now=` and `sleep=`, so the
timing is measured on a virtual clock with no wall clock in the arithmetic. A stopwatch assertion
on this box would need slack wide enough to hide the very overrun it is looking for. A control
(`test_real_wall_time_is_not_what_these_measure`) asserts the run costs under a second of real
time, so a `now=`/`sleep=` that stopped being honoured cannot pass quietly.

⚠️ **A deliberate non-change, recorded so it is a decision and not an oversight.** `wait()` clamps
to `remaining()`, not to `remaining() - MIN_USEFUL_S`. The tighter clamp would preserve one more
attempt in a narrow window (remaining between 0.25 s and the drawn delay), but that attempt would
be handed 0.25–0.65 s against an 8 s dependency — barely above the 0.25 s this module already calls
useless — and it would burn a bounded pool thread on a call that cannot connect. Either clamp
satisfies the deadline; this one is left as the simpler of the two. If a measurement ever says
otherwise, it is a one-token change with A76c already guarding it.

### OI-28: who introduced it, and why "6 failures" was only a third of it

**Commit `7c8554dfd` — *feat(edge): per-render service capability — the machine trust path
(Phase 1.5)*, session `01MhvqVHAhZ8zhoyMYvuVnxj`.** It added
`from edge_scope import EDGE_TOKEN_HEADER, edge_token_targets` to
`services/chart_renderer/app.py` (correct — the renderer image has `WORKDIR /app` and the
Dockerfile copies modules flat) and gave `tests/test_chart_edge_render_scope.py` a `sys.path` entry,
but never gave one to the two loaders that `exec_module` that file.

⭐ **It is green in company and red alone, which is why a careful commit said *"Failure set matches
untouched master"* and meant it.** pytest IMPORTS every selected module before running anything, in
file order, and `test_chart_renderer_dualstack.py` sorts first and makes the entry at module level —
so the whole glob `tests/test_chart_renderer_*.py` passes **35/35** while two thirds of it cannot
stand up by itself. Measured on this tree, each file in its own process:

| run | before | after |
|---|---|---|
| `tests/test_chart_renderer_service.py` alone | **6 failed** | 6 passed |
| `tests/test_chart_renderer_pool.py` alone | **16 failed** | 16 passed |
| `tests/test_chart_renderer_dualstack.py` alone | 13 passed | 13 passed |
| all three together | 35 passed *(the masking)* | 35 passed |

So the OI's "6 failures" is the `service` file run on its own; the true inherited red is **22**.
The four files that decide it are byte-identical to `origin/master`, so this reproduction IS the
clean-master reproduction — no second checkout was needed and none was made.

⛔ **The flat import is not the bug and was not touched.** The fix is a path entry in each loader,
which is the surrounding idiom: `test_chart_renderer_dualstack.py` already makes it for `serve`,
and `test_discord_render_forensics.py::_renderer_module` already makes it for `app`.

### The INTEGRATOR's half — the exact `adapters/bindings.py` edit, not made here

`adapters/bindings.py` is Lane A's and Lane C did not edit it. This is the patch the owner's ruling
asks for — *"make attempts explicit at every binding site with a comment"*.

**There are four binding sites**, and only one of them states its attempt count today:

| site | today | why it needs to say so |
|---|---|---|
| `bars_fn` | `attempts=1`, with a comment (OI-25) | already explicit — leave it |
| `quote_fn` | silent; inherits `quote.ATTEMPTS = 1` | inherited, therefore right by luck |
| `house_fn` | silent; inherits `renderer.ATTEMPTS = 1` | inherited, therefore right by luck |
| `flow_fetch_fn` | silent; inherits `flow.ATTEMPTS = 1` | inherited, therefore right by luck |

⚠️ **Precondition: three of the four Request dataclasses cannot carry the argument yet.** Only
`BarsRequest` has an `attempts` field. Hunks 1–3 add it; hunk 4 is the binding sites themselves.
All four files are Lane A's.

**Hunk 1 — `api/services/discord_render/adapters/quote.py`**

```python
 class QuoteRequest:
     ticker: str
     corr_id: str | None = None
     remaining_s: float | None = None
+    #: Override `ATTEMPTS`. ⛔ Every binding site states its own number; an attempt count that is
+    #: right by inheritance is right by luck (OI-29).
+    attempts: int | None = None
```
```python
     outcome = _call.guarded(NAME, lambda _timeout_s: quote_fn(req.ticker),
                             dep_timeout_s=TIMEOUT_S, remaining_s=req.remaining_s,
-                            corr_id=req.corr_id, attempts=ATTEMPTS, provider="massive")
+                            corr_id=req.corr_id,
+                            attempts=(ATTEMPTS if req.attempts is None else max(1, int(req.attempts))),
+                            provider="massive")
```

**Hunk 2 — `api/services/discord_render/adapters/renderer.py`** — the same field on `RenderRequest`
(after `envelope`), and in `fetch`:
```python
-        attempts=ATTEMPTS, provider=NAME)
+        attempts=(ATTEMPTS if req.attempts is None else max(1, int(req.attempts))), provider=NAME)
```

**Hunk 3 — `api/services/discord_render/adapters/flow.py`** — the same field on `FlowRequest`, and
in `fetch`, **on the REMOTE leg only**:
```python
-        attempts=ATTEMPTS, provider="flow_worker", timeout_on=_client_timeouts(),
+        attempts=(ATTEMPTS if req.attempts is None else max(1, int(req.attempts))),
+        provider="flow_worker", timeout_on=_client_timeouts(),
```
⛔ The in-process leg's `attempts=1` is already a literal and must stay 1: a second local recompute
inside one member's budget buys nothing, and the fallback IS the retry.

**Hunk 4 — `api/services/discord_render/adapters/bindings.py`**, three sites:

```python
     def _fetch(ticker):
         r = record(ctx, "quote", quote_adapter.fetch(quote_adapter.QuoteRequest(
-            ticker=ticker, corr_id=ctx.job.corr_id, remaining_s=_remaining(ctx))))
+            ticker=ticker, corr_id=ctx.job.corr_id, remaining_s=_remaining(ctx),
+            # ⛔ ONE ATTEMPT, STATED HERE ON PURPOSE. The ext-hours chip is decoration: a member
+            # waits for the chart, not for this, so a retry spends the CHART's budget on a field
+            # that can simply be omitted. Stated rather than inherited from `quote.ATTEMPTS` —
+            # the C-10 overrun was invisible in production only because one site happened to pass
+            # 1 for an unrelated reason (OI-25/OI-29).
+            attempts=1)))
```
```python
         r = record(ctx, "renderer", renderer_adapter.fetch(renderer_adapter.RenderRequest(
             ticker=sym, tf=tf, stats=stats, options=dict(options or {}),
             corr_id=ctx.job.corr_id, remaining_s=_remaining(ctx),
-            envelope=prior.envelope if prior and prior.ok else None), house_fn=inner))
+            envelope=prior.envelope if prior and prior.ok else None,
+            # ⛔ ONE ATTEMPT, STATED HERE ON PURPOSE. `render_house_chart` already runs its own
+            # settle/ready ladder inside a single call, so a retry here is OI-21's 105-second
+            # overrun in a different shape: two 20 s renders behind a 15 s deadline.
+            attempts=1), house_fn=inner))
```
```python
         r = record(ctx, "flow", flow_adapter.fetch(flow_adapter.FlowRequest(
             ticker=ticker, days=str(days), source=source, top_n=top_n,
-            corr_id=ctx.job.corr_id, remaining_s=_remaining(ctx))))
+            corr_id=ctx.job.corr_id, remaining_s=_remaining(ctx),
+            # ⛔ ONE ATTEMPT, STATED HERE ON PURPOSE. This adapter already has a SECOND leg — the
+            # in-process fallback — so a retry would mean up to four flow-worker round trips plus
+            # a local recompute inside one member's budget. The fallback is the retry.
+            attempts=1)))
```

⭐ **An existing rail gets stronger for free, and the integrator should know why it might go red.**
`tests/test_discord_render_forensics.py::test_c10_the_bars_hop_is_bounded_and_its_retry_is_jittered_not_a_fixed_wait`
parses `bindings.py` and asserts **every** `attempts=<constant>` there is `1`. Today it covers ONE
site; after this patch it covers FOUR. ⚠️ It also means a future site that genuinely needs 2 will
turn that rail red — which is a prompt to re-read OI-25, not a broken test.

⚠️ **The honest cost of this patch:** three sites will now restate a number that also lives in the
adapter constant, which is a second authority over one value. That is the trade the ruling makes on
purpose — after C-10, a binding site's attempt count is a safety property of that site, and the
adapter constant becomes the fallback for callers who have no opinion. The rail above is what keeps
the two from drifting silently.

### OI-29 — new, raised by this lane

> **A NOT-APPLIED mutation is a proof that did not happen, and this programme has been reading it
> as a footnote.** The adapters harness reported **78/80 RED** with two `NOT APPLIED (0 matches)`
> lines beneath it. One (A5) was four hours old and mine. The other (**A29 — the chart handler goes
> back to the raw client**) has been stale since P2.6/P2.7, when `edit_fn=ctx.edit` became
> `edit_fn=bindings.edit_fn(ctx)` and the `return dict(...)` line re-wrapped: it has matched nothing
> for several merges, so *"the V2 handlers bind adapters and not the raw clients"* has been asserted
> by a test whose mutation control was silently absent. Both repaired in `988983466`; the
> NOT-APPLIED count now sits on the summary line beside the RED count, in the same sentence, so the
> two cannot be read apart again. **Every harness in `docs/discord-render/instruments/` should be
> checked for the same shape** — a dry run that asserts each `old` matches exactly once costs
> seconds and needs no test run at all.

---

## Owner rulings, 2026-09-14 (Monday) — recorded before they were acted on

### OI-32 — **never cache a stand-in** (DECIDED)

Raised by Lane B, which correctly said its own module could not answer it: the store cannot tell
which artifacts are stand-ins, because that fact lives with the caller that CHOSE one.

**Ruling: artifacts carry `is_standin` in metadata and BOTH tiers refuse them.** §3.6's
*"degraded artifacts are cached apart: stand-ins 60 s"* is removed with the reason.

⭐ **Why "apart for 60 s" was the wrong compromise.** A stand-in is by definition the lower-quality
artifact, so caching one means serving it to every member who asks in the next minute — and C-06
measured **three stand-ins, two of which never healed**. A 60-second TTL does not soften that; it
industrialises it, because the coalescer fans one stand-in out to every follower. The cost of the
alternative is one extra render.

### OI-28 — the correction, and the session that introduced it

⛔ **The open item said SIX failures. The true inherited red is TWENTY-TWO** — `test_chart_renderer_
service.py` 6 and `test_chart_renderer_pool.py` 16. The glob passes 35/35 because pytest imports
every selected module at collection in file order, and `test_chart_renderer_dualstack.py` sorts
first and makes the `sys.path` entry at module level — fixing the path for everybody **by
accident**. Green in company, red alone.

**Introduced by `7c8554dfd`** — *"feat(edge): per-render service capability — the machine trust path
(Phase 1.5)"*, session **`01MhvqVHAhZ8zhoyMYvuVnxj`**. It added the flat `from edge_scope import …`
to `services/chart_renderer/app.py` and gave `test_chart_edge_render_scope.py` a path entry, but not
the two loaders that `exec_module` that file. The flat import is CORRECT for the renderer image
(`WORKDIR /app`, modules copied flat) and was not touched; the fix is a path entry in each loader.

⭐ **The lesson is the measurement, not the fix.** "Six failures" came from running the glob; the
real number came from running each file in its own process. **A suite that is green in company and
red alone is reporting its own collection order.**

### Mutation A29 — NOT-APPLIED now FAILS the gate

`A29` — *"the V2 handlers bind adapters and not the raw clients"* — had a stale anchor and was
silently skipped through several merges, reported as a footnote under the number people quote:
`78/80 RED` reads like a near-perfect score.

**Ruling: NOT-APPLIED ≠ 0 fails the harness; it is never just printed.** Every harness already
returns non-zero on a non-RED verdict; what was missing was the count on the summary line, and the
one-second dry check before committing to a 25-minute run. Added to the runbook's measurement
pitfalls.

### The second budget overrun — a class, not an instance

Found by Lane C **while measuring the first one**: `_call`'s header had always promised *"the retry,
with jitter, INSIDE the same budget"*, and the code slept the full jittered delay regardless.
Measured 3 attempts / 2 s deadline / 1.5 s upstream: **2.7–3.7 s spent**, refusing attempts 2 and 3
for want of budget and then sitting past the deadline sleeping between the refusals. Now **2.000 s**.

⛔ **This is the third instance of one class in the layer built to prevent it**, so the ruling is
structural rather than another patch: every sleep on the retry path is bounded by the remaining
deadline, and a docstring that promises "inside the same budget" is a TESTED claim.

