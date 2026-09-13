# RESUME — restart checkpoint 2026-09-13 16:00 ET (Sunday), after the owner's close-out

Written by the **Discord render hardening** session. One command re-verifies everything:
`powershell -ExecutionPolicy Bypass -File C:\Users\Patrick\uct-worktrees\discord-render\scripts\resume.ps1`

---

## a. HEAD state

| Checkout | Branch | State at checkpoint |
|---|---|---|
| `C:\Users\Patrick\uct-worktrees\discord-render` (**this program**) | `discord-render-hardening` | clean, pushed; code identical to master `d623baf1d` + this checkpoint's docs |
| every other checkout under `C:\Users\Patrick\uct-worktrees\*`, the main checkout `C:\Users\Patrick\uct-dashboard`, the engine repo `C:\Users\Patrick\uct-intelligence` | their own | **captured** — see §i; `scripts/resume.ps1` prints each one's live state |

Production: master **`d623baf1d`** (master merge 4) — `web` running it, verified in-process; chart-renderer
deployment `6090d306` (pool OFF); flow-worker untouched by this program.

## b. What we were doing

- **Discord render hardening** (this session) — Phase 2: 2.1–2.4a **merged and live, all dark** (V2 flag unset). Next: **2.4b**.
- Every other program: its own resume doc (`docs/notebook/wave-all-RESUME-HERE.md`, `docs/plans/joystick/RESUME.md`, `docs/runbooks/indicator-ecosystem-resume.md`, `docs/wisdom/SESSION-STATE.md`); the checkouts whose sessions could not be reached now carry a **reconstructed** `docs/RESUME.md` on their captured commit (§i).

### Discord render — detail

| Step | State |
|---|---|
| Phase 0 · Phase 1 | closed |
| 2.1 runtime, durable jobs, failure contract | merged `740b79ad5` (dark) |
| 2.2 observability, alerts, render-health | merged `6d779dd47` (dark) |
| 2.3 renderer hygiene/ceiling/correlation/pool + web headers | merged `d32d14d60`; chart-renderer `6090d306` (pool OFF) |
| 2.4a symbol resolution (D-04) + `/flow` ETF partition (C-14) | **merged `d623baf1d`** (master merge 4, dark), `web` SUCCESS 19:51:10 UTC |
| 2.4b market clock, freshness envelope + STALE badge, per-dependency timeouts + breakers, cached flow card, deploy-swap retry | **next** |
| 2.5 cache · 2.6 delivery · 2.7 visual spec + goldens · 2.8 regression per class · Phase 3 · Phase 4 | not started |

**The very next action:** start 2.4b in `C:\Users\Patrick\uct-worktrees\discord-render` (Git Bash): `git fetch origin && git merge origin/master`, then design from `docs/discord-render/03-architecture.md` §3.8 (the "*Built in 2.4a*" note lists what 2.4b holds). Gate = the 26 scoped files in `docs/discord-render/LEDGER.md` row 11; harness pattern in `docs/discord-render/instruments/`.

## c. Open decisions (all in `docs/discord-render/LEDGER.md`)

OI-01..OI-18 unchanged from the ledger, proceeding on each recommendation. Changes at this close-out:
**OI-08 done** (alerts → private `#render-alerts`); **OI-13 not done** and **OI-12 / OI-17 not done** — see §h.

## d. Processes to restart

**None.** Nothing of this program runs locally. The 57 `UCT *` Task Scheduler jobs are registered and resume on their own.

## e. Flags and env (read live 2026-09-13)

| Name | Where | Value |
|---|---|---|
| `DISCORD_RENDER_V2_ENABLED` | web | **unset** (in-process, 19:51 UTC) — V2 off |
| `DISCORD_RENDER_ALERT_WEBHOOK` | web | **set** 19:53 UTC → private `#render-alerts` (Uncharted Territory › ADMIN CHAT), webhook "Captain Hook". Inert until V2 is on (the observer starts with V2); the test post used it directly. |
| `DISCORD_RENDER_V2_{CHART,FLOW,BUZZ,CONTROLS,SYMBOLS}_ENABLED` | web | unset (on under the master) |
| `RENDER_POOL_ENABLED` · `RENDER_WARM_URL` | chart-renderer | **unset** (setting them was refused — §h) |
| `CHART_RENDER_TOKEN` · `VITE_CHART_RENDER_TOKEN` | web | **unchanged** (rotation not done — §h) |
| `/renderhealth` | Discord | not registered |

## f. Gotchas

- Backend pytest is SCOPED (named files); a run with no totals line is not a run.
- One master merge at a time; other sessions push constantly — re-fetch and refuse if master moved (merge 4 was refused once, retried once, pushed).
- This repo is **public**: WIP pushes are published; screen for secrets first (the capture did).
- Branches that track `origin/master`: push with an explicit refspec.
- chart-renderer has no repo source: deploy = `railway up <abs path> --path-as-root` of a `git archive`.
- `railway ssh` from Windows: Git Bash + `MSYS_NO_PATHCONV=1`, never Python `subprocess`; never discard stderr.
- The Claude Code permission classifier refuses: reading or checking local credential stores (`.env`), Railway feature-flag writes, and Railway service-config changes — ask the owner, never route around.
- Cloudflare 1010: send a browser `User-Agent`. Partner files need Ravi/Manrav ack. `C:\data` is live data.

## g. Verification checklist (`scripts/resume.ps1`)

1. discord-render worktree clean · 2. HEAD contains the code tip and equals `origin/discord-render-hardening` · 3. master drift (info) · 4. `web` newest deployment SUCCESS and contains `d32d14d60` · 5. chart-renderer newest SUCCESS · 6. `/api/health` 200 · 7. bad signature 401 · 8. render-health without bearer 401.

## h. Owner close-out items (2026-09-13) — outcome

| # | Item | Outcome |
|---|---|---|
| 1 | Capture other sessions' uncommitted work | **Done** — 19 dirty checkouts captured and pushed (§i); secret scan clean |
| 2 | Declare `CANONICAL_INDICATOR_AXIS_ENABLED` | **Done by its owning session** on master `7bd9c8785`; the flag-ledger rail is green (merge 4 gate 764/0) |
| 3 | Rotate the render token | **Not done.** The token is also read locally by Morning Wire's Substack panel renderer (`morning-wire/substack/run.py`, `panelshot.py`, `chartwidget.py`, `earnings_ahead.py` via its `.env`). The permission classifier refused even a true/false check of that file ("Credential Exploration"). Rotating only on Railway would break Monday's 7:35 AM wire panels, so the current token stays. Needs: permission to update `C:\Users\Patrick\morning-wire\.env`, then set both web variables in one change. |
| 4 | Private `#render-alerts` + webhook + variable + test alert | **Done** — see §e and the evidence note below |
| 5 | Renderer repo connection + warm-up | **Not done.** Setting `RENDER_POOL_ENABLED`/`RENDER_WARM_URL` was refused ("Feature Flag Writes"); connecting the service to the repo was refused ("Modify Shared Resources"). Planned config, ready to apply once allowed: root `services/chart_renderer`, watch `services/chart_renderer/**`, builder Dockerfile, healthcheck `/health`, `RENDER_WARM_URL=https://uctintelligence.com/r/chart?sym=NVDA&tf=D&fixedbars=nvda-d&token=${{web.CHART_RENDER_TOKEN}}` (a Railway reference — nobody handles the value). |
| 6 | Delete `_dr-master-506`; Railway auth | **Done** — deleted (was not a registered worktree); `railway whoami` logged in |
| 7 | Master merge 4 | **Done** — `d623baf1d`, `web` SUCCESS 19:51:10 UTC, running SHA read in-process |
| 8 | Re-checkpoint | this file; `scripts/resume.ps1` dry run in the commit message |

## i. Captured checkouts (2026-09-13, by this session)

| Checkout | Branch | Captured as | Pushed ref | Excluded (on disk, not pushed) |
|---|---|---|---|---|
| `uct-dashboard` (main) | feat/catalyst-coverage-precision | `ce70861bd` | same branch | one spec doc with a credential-shaped string |
| `uct-intelligence` (engine) | master | snapshot `b83ed5781` (HEAD/tree untouched) | `wip/checkpoint/uct-intelligence-20260913` | `data/uct_intelligence.pre_tsdr_import.bak` (75 MB) |
| desk-sharpen-card | feat/desk-sharpen-workshop-card | `621881612` | same | — |
| discord-chart | feat/discord-chart-command | `6bb4e4b9f` | same | — |
| flow-nav-prefetch | perf/route-intent-prefetch | `993e6f378` | same | `app/.env.flowperf` |
| flow-sticky-guard | fix/flow-sticky-reset-and-deploy-guard | `73a18b6e3` | same | — |
| inc5-final | (detached) | snapshot `4a181e8f4` | `wip/checkpoint/inc5-final-20260913` | — |
| inc5-merge | (detached) | snapshot `dd11e73e2` | `wip/checkpoint/inc5-merge-20260913` | — |
| joystick-hub | launch/l5-launch-docs | `79e3d8d83` | same | — |
| joystick-inc5 | feat/joystick-launch-A | `1335693e6` | same | — |
| notebook-primary-platform | notebook-primary-platform | `99c428743` | `wip/checkpoint/notebook-primary-platform-20260913` (branch push rejected, never forced) | — |
| options-desk | feat/options-desk | `737ea0340`, `39744d133` | same | `app/tests/fixtures/_raw_flow10.csv` (6 MB) |
| patterns-retire | chore/patterns-page-retire | `f9599e4bc` | same | — |
| phase-a-signature | feat/phase-a-signature | `b4b4a9a9b` | same | — |
| s3-admin-routes | feat/s3-admin-routes | `c9e57e47d` | same | — |
| s8-attention-freshness | feat/s8-attention-freshness-v1 | `733244c1b` | same | — |
| single-stock-etfs | feat/single-stock-etfs | `cb7cde09b` | same | — |
| temporal-freshness-truth | feat/temporal-freshness-truth-v1 | `e60a0aea6` | same | — |

Snapshot checkouts (engine repo, inc5-final, inc5-merge) still show their files as modified — by design,
so running jobs and live sessions kept their exact working state; the snapshot on origin is the capture.
