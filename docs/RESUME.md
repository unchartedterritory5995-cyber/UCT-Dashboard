# RESUME — restart checkpoint 2026-09-13 15:30 ET (Sunday)

Written by the **Discord render hardening** session. A fresh session with no memory continues from
here. One command re-verifies everything: `C:\Users\Patrick\uct-worktrees\discord-render\scripts\resume.ps1`.

---

## a. HEAD state

| Worktree | Branch | HEAD | Pushed | Dirty |
|---|---|---|---|---|
| `C:\Users\Patrick\uct-worktrees\discord-render` (**this program**) | `discord-render-hardening` | the checkpoint commit on top of code tip `3f71d5364` ("Merge origin/master into discord-render-hardening (3 commits; no file overlap with 2.4a)") | yes — `origin/discord-render-hardening` = HEAD at checkpoint | no |
| `C:\Users\Patrick\uct-dashboard` (main checkout) | `feat/catalyst-coverage-precision` | `270498f32` | — | **yes, 72 files — NOT this session's work**; the catalyst session must checkpoint it. Never `git add -A` there. |
| `C:\Users\Patrick\uct-worktrees\_dr-master-506` | — | not a git repository any more (a half-removed provenance checkout) | — | owner: delete the directory |

Every other worktree (57 total) belongs to another session; `scripts/resume.ps1` prints each one's
live branch, HEAD and dirty count instead of a table that would be stale by the time it is read.

Production at checkpoint: master `404b808c5` (another session) — `web` SUCCESS 19:24:43 UTC;
chart-renderer deployment `6090d306` SUCCESS 18:49:58 UTC; flow-worker untouched by this program.

## b. What we were doing

- **Discord render hardening** (this session) — Phase 2, step **2.4a built and committed, master merge 4 PARKED (not pushed)**. Detail below.
- Notebook (Wave Q1 live, Wave K kill switch, roadmap) — another session; read `docs/notebook/wave-all-RESUME-HERE.md`.
- Joystick hub — programme closed, launch docs; read `docs/plans/joystick/RESUME.md`.
- S7 alert taxonomy / D2 canonical indicator axis — another session (`C:\Users\Patrick\uct-worktrees\s7-price-level`, pushed `404b808c5` today); it owes a `docs/feature_flags.json` entry for `CANONICAL_INDICATOR_AXIS_ENABLED`.
- Wisdom Loop — another session (worktrees `wisdom/*` under `C:\Users\Patrick\uct-dashboard\.claude\worktrees\`).
- Indicator ecosystem — another session; read `docs/runbooks/indicator-ecosystem-resume.md`.
- Catalyst coverage precision — another session, main checkout (dirty, see §a).

### Discord render hardening — in detail

Home: `docs/discord-render/` — `LEDGER.md` (rules, merge ledger rows 1–11, OI table, loop log),
`00`–`03` (map, forensics, baseline, architecture), `05-progress.md` (numbers after every merge).

| Step | State |
|---|---|
| Phase 0 (map, forensics, baseline) · Phase 1 (architecture) | closed |
| 2.1 runtime, durable jobs, failure contract, V2 command layer | **merged dark** — master merge 1 `740b79ad5` |
| 2.2 observability (events, SLOs, alerts, purge, render-health, `/renderhealth` unregistered) | **merged dark** — master merge 2 `6d779dd47` |
| 2.3 renderer hygiene/ceiling/correlation/pool + web headers | **merged** — master merge 3 `d32d14d60`; chart-renderer deployed `6090d306` (pool OFF) |
| 2.4a symbol resolution at the ack (D-04) + `/flow` ETF partition (C-14), V2 only | **committed** `0e331168a` + docs `53b55e9e9` + row 11 `f41c185ef`; merged with master as `3f71d5364` — **NOT pushed** |
| 2.4b market clock, freshness envelope + STALE badge, per-dependency timeouts + breakers (renderer/flow/quote), cached flow card ≤10 min, deploy-swap retry | not started |
| 2.5 cache + coalescing · 2.6 delivery hardening · 2.7 visual spec + goldens · 2.8 a regression test per class | not started |
| Phase 3 (load, chaos, determinism, weekend soak via Task Scheduler, real-Discord smoke) · Phase 4 (flip packet, runbook, final report) | not started |

**Why merge 4 is parked:** while the merged-tree gate ran, master moved 3 commits (other sessions);
the push guard refused. Re-merged as `3f71d5364` (no overlap). The gate on `3f71d5364` is
**762 passed, 1 failed** — `tests/test_feature_flag_ledger.py::test_every_off_by_default_gate_is_declared`
names `CANONICAL_INDICATOR_AXIS_ENABLED`, added by master `404b808c5` (D2 CP4). Inherited, not this
program's; provenance on a clean master checkout still to run.

**The very next action** (in the discord-render worktree, Git Bash):

1. `git fetch origin master && git merge --no-edit origin/master` (if master moved; check overlap with our 8 files first).
2. Run the 26-file scoped gate (never repo-wide):
   `python -m pytest tests/test_discord_render_symbols.py tests/test_chart_renderer_pool.py tests/test_chart_renderer_service.py tests/test_discord_render_correlation.py tests/test_discord_render_health_command.py tests/test_discord_render_observe.py tests/test_discord_render_health_endpoint.py tests/test_discord_render_v2_core.py tests/test_discord_render_v2_router.py tests/test_discord_render_fail_hooks.py tests/test_discord_render_bench.py tests/test_railway_env_logs.py tests/test_discord_chart.py tests/test_discord_chart_hotset.py tests/test_discord_chart_warm_budget.py tests/test_discord_activity.py tests/test_discord_chart_prefs.py tests/test_feature_flag_ledger.py tests/test_buzz_*.py -q -p no:cacheprovider`
3. For any red: provenance on a detached checkout of the master tip (`git worktree add --detach <scratch> origin/master`, same test) — inherited means 0 new.
4. Update ledger row 11 (merge base, gate numbers), commit, then the guarded push: master 0 ahead **and** `web` newest deployment terminal, then `git push origin HEAD:discord-render-hardening` and `git push origin HEAD:master`.
5. Poll `web` for the new SHA; verify in-process with `docs/discord-render/instruments/pod_env_probe.py`; HTTP checks (health 200, bad-signature 401, render-health 401); ledger + `05`.
6. Then 2.4b.

Mutation harnesses for every step: `docs/discord-render/instruments/` (`python mutation_harness_<step>.py .`).

## c. Open decisions (all logged in `docs/discord-render/LEDGER.md`, proceeding on the recommendation)

| OI | Decision | Recommendation → state |
|---|---|---|
| OI-01 | Invalid-symbol refusal vs "the universe is not a gate" | Refuse only when every authority misses — `/api/bars` decides after a static miss — ≤3 suggestions + background warm → **built 2.4a** |
| OI-02 | Queue kind | Thread-backed bounded queue + SQLite → built |
| OI-03 | Jobs in `web` or a worker service | Stay in `web` with durable resume → proceeding |
| OI-04 | Context line = second PATCH | Fold into the image PATCH → 2.6 |
| OI-05 | Warm cycle shares renderer slots | Background lane, ≤2 slots → lanes built; renderer cap built behind `RENDER_POOL_ENABLED` |
| OI-06 | Unlabelled stand-in | Label it → 2.7 |
| OI-07 | "Flow feed is reconnecting" for every cause | Per-class wording (built, V2) + cached card → 2.4b |
| OI-08 | Alert destination | `DISCORD_RENDER_ALERT_WEBHOOK` ships blank; recommend dev server `#system-alerts` → **owner** |
| OI-09 | `/renderhealth` registration | Register at flip (`tools/discord_chart_commands.py register --renderhealth`) → built, unregistered |
| OI-10 | RTH cache TTL 30 s vs today's 120 s | Follow D-02 → 2.5 |
| OI-11 | Flow target for `days=all` | Per-window targets from `02` → proceeding |
| OI-12 | chart-renderer has no repo source | Deploy via `railway up` of a `git archive` of the merged commit; owner may connect the repo |
| OI-13 | Render token was in renderer logs | Log fix shipped (`6090d306`) → **owner rotates `CHART_RENDER_TOKEN` + `VITE_CHART_RENDER_TOKEN`** |
| OI-14 | ~77 web deploys/day | Out of scope, recorded |
| OI-15 | flow-worker `/ticker-flow` has no time budget | Our side 10 s + cached card; their side is a partner file |
| OI-16 | `/flow` ETF partition | Resolve from the symbol, V2 only → **built 2.4a** |
| OI-17 | Renderer warm-up URL needs the render token | Hermetic warm shipped; owner may set `RENDER_WARM_URL` after OI-13 |
| OI-18 | Hard-ceiling default 20 s would 504 renders web budgets longer | Ceiling = the request's declared budget; lower to 20 s after 2.4/2.6 re-budget |

## d. Processes to restart

**None for this program.** Nothing was running at checkpoint: no dev server, bench, soak, tunnel or
watcher (the deploy pollers exited after their deploys finished). The weekend soak (Phase 3.4) is not
armed yet.

Task Scheduler (registered, **survive the reboot on their own**, none belongs to this program): the
`UCT Brain *`, `UCT Breadth *`, `UCT Morning Wire`, `UCT EOD Updater`, `UCT Market Ingest`,
`UCT Clips - *`, `UCT Desk *`, `UCT RTH *`, `UCT-WaveQ1-*`, `UCT20 *` families (57 tasks at checkpoint).
Nothing needs re-arming.

## e. Flags and env that matter (read live 2026-09-13)

| Name | Where | Value | Meaning |
|---|---|---|---|
| `DISCORD_RENDER_V2_ENABLED` | web | **unset** (read in-process 18:47 UTC) | V2 off → every command runs the pre-V2 path |
| `DISCORD_RENDER_V2_{CHART,FLOW,BUZZ,CONTROLS,SYMBOLS}_ENABLED` | web | unset (= on under the master) | per-command kill switches |
| `DISCORD_RENDER_ALERT_WEBHOOK` | web | unset | alerts would be log events only |
| `DISCORD_RENDER_ADMIN_USER_IDS` · `DISCORD_RENDER_OBSERVE_S` · `DISCORD_RENDER_ALERT_COOLDOWN_S` · `DISCORD_RENDER_DB_PATH` | web | unset (defaults) | |
| `RENDER_POOL_ENABLED` | chart-renderer | **unset** (`/health` `pool_enabled: false`) | pool, recycle, background cap off |
| `RENDER_HARD_TIMEOUT_S` · `RENDER_WARM_URL` · `RENDER_RECYCLE_AFTER` · `RENDER_RSS_CEILING_MB` · `RENDER_BACKGROUND_SLOTS` · `RENDER_POOL_KEYS` | chart-renderer | unset (defaults) | |
| `/renderhealth` | Discord app | **not registered** | |

## f. Gotchas (pulled into one place)

- **Backend pytest is SCOPED** — name the files; `pytest tests/` (even with `-k`) OOMs this box at collection. A run with no totals line is not a run.
- **One master merge at a time, repo-wide** — `web` SUCCESS before the next push; other sessions push constantly, so re-fetch right before pushing and refuse if master moved.
- **flow-worker watch list** — pushes touching those files bounce the OPRA tape (permanent gap); after-hours/weekend only. Check with `python tools/flow_worker_watch_coverage.py`. This program touches none.
- **chart-renderer has NO repo source** — deploy = `railway up <ABSOLUTE payload dir> --path-as-root --service chart-renderer --detach`, payload = `git -c core.autocrlf=false archive <sha> services/chart_renderer`; verify the image (`wc` of `/app/app.py`) and `/health` keys, not just SUCCESS.
- **`railway ssh` from Windows** — Git Bash with `MSYS_NO_PATHCONV=1`; never from Python `subprocess` (the `.cmd` shim eats `"|"`); never discard stderr on a probe.
- **Cloudflare 1010** blocks curl/python user agents on uctintelligence.com — send a browser `User-Agent`.
- **Frontend `VITE_*` flags are baked at build**; a Railway variable change on web restarts it (verify the boot).
- **Partner-owned files** (`OptionsFlow.jsx`, `api/live_massive_router.py`, `api/schwab_router.py`): minimal diffs, Ravi/Manrav ack first. This program only READS `live_massive_router.py`.
- **Mutation proofs:** byte-restore by sha256, never `git checkout`; a harness control must be green; a rail the code under test can swallow (fail-open wrappers) is not a rail.
- **`C:\data` is live data** on this box; tests are sandboxed by the repo-root `conftest.py` tripwire — never run tools against it outside pytest.
- **Every commit gets a ledger row**; every master push carries a member-impact paragraph; everything ships dark and the owner flips.

## g. Verification checklist (what `scripts/resume.ps1` runs)

1. `git -C C:\Users\Patrick\uct-worktrees\discord-render status --porcelain` → empty.
2. `git merge-base --is-ancestor 3f71d5364 HEAD` → true, and `HEAD == origin/discord-render-hardening`.
3. `git rev-list --count HEAD..origin/master` → how far master moved (information).
4. `railway deployment list --service web --json` → newest `SUCCESS`, and its commit contains `d32d14d60`.
5. `railway deployment list --service chart-renderer --json` → newest `SUCCESS`.
6. `GET https://uctintelligence.com/api/health` (browser UA) → 200.
7. `POST https://uctintelligence.com/api/discord/interactions` with a bad signature → 401.
8. `GET https://uctintelligence.com/api/discord/render-health` without the bearer → 401 (route live).

## h. Owner hands (after reboot)

- Delete `C:\Users\Patrick\uct-worktrees\_dr-master-506` (not a git repo; a shell delete was refused by the permission classifier).
- Rotate `CHART_RENDER_TOKEN` (web) and `VITE_CHART_RENDER_TOKEN` (build) now that renderer logs are scrubbed (OI-13).
- Choose the alert webhook destination (OI-08); optionally connect chart-renderer to the repo (OI-12) and set `RENDER_WARM_URL` (OI-17).
- The S7/D2 session must declare `CANONICAL_INDICATOR_AXIS_ENABLED` in `docs/feature_flags.json` (it reds every gate that includes the flag-ledger rail).
- The catalyst session must checkpoint the 72 uncommitted files in `C:\Users\Patrick\uct-dashboard`.
- If `railway` commands fail after the reboot: `railway login` (and `railway link` in the worktree if asked).
- Flag flips (V2, pool, `/renderhealth` registration) come at Phase 4 — not now.
