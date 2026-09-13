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
| 6 | 2026-09-13 | branch tip after `72cfddf87` (merge of `origin/master` `d6ac61816` into the branch, 22 commits, no file overlap) + this ledger commit, fast-forwarded to master | **Master merge 2**: row 5 (`2509cc0de`) + docs `6864b051f` | 14 files vs master (`git diff --name-only origin/master..HEAD`): `api/routers/discord_interactions.py`, `api/services/discord_interactions.py`, `api/services/discord_render/{commands,jobs_store,observe,runtime}.py`, `docs/discord-render/{03-architecture,05-progress,LEDGER}.md`, `tests/test_discord_activity.py`, `tests/test_discord_render_{observe,health_endpoint,health_command}.py`, `tools/discord_chart_commands.py` | as row 5; nothing new | **none** — `tools/flow_worker_watch_coverage.py` on the merged tree: `reachable=154 watched=24 changed=14 OK` | merged tree `72cfddf87`, 13 scoped files: **479 passed, 0 failed**. Row 4's inherited flag-ledger red is gone — master's own commits now declare the `ALERT_TAXONOMY_*` gates (7 entries on `origin/master`). | no member-path change with the flag unset | *(measured after the push — see `05-progress.md`, Merge 2)* | **Nothing members can see changes.** This adds the monitoring half of the Discord render V2 code, which stays switched off (`DISCORD_RENDER_V2_ENABLED` unset). With it off, `/chart`, `/flow`, `/buzz` and the chart buttons run exactly today's code; the new background monitor only starts with V2, so it does not run; the admin `/renderhealth` command is written but not registered, so nobody sees a new command. One new read-only endpoint, `GET /api/discord/render-health`, exists for the owner and answers 401 to anyone without the push secret. One test assertion that had been wrong since 2026-09-06 is corrected. Like any `api/` change, the push restarts `web`, `worker` and `bars-api` — about a minute of API blips — and does **not** restart flow-worker. Rollback: revert the merge and push; there is no flag to flip because nothing is on. |

## Owner decisions (OI-xx)

Each: the question, my recommendation, what I proceeded on. The owner overrides before the flip.
Full context for every row is in `03-architecture.md` §6.

| OI | Question | Recommendation | Proceeding on |
|---|---|---|---|
| OI-01 | D-04 refuses an unknown symbol in <1 s, but v20 measured that the universe is not a gate (AEHL, TCEHY, FNMA, BTC-USD chart and none are in it). | Refuse only when every authority (entity master, universe, bars store, breadth, index, delisted) misses; suggest ≤3 and start a background warm so a re-run of a real ticker works. | the recommendation (built in 2.4) |
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
- **Next:** 2.3 renderer pool (chart-renderer, `railway up` from a clean checkout in a window, with
  the token log fix that unblocks OI-13) · 2.4 symbol resolution, freshness, breakers, the ETF
  partition (C-14).
