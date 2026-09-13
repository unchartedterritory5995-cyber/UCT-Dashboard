# Live Flow Worker — Deploy Survival System (v2, risk-hardened)

**Date:** 2026-07-06 (v2 same evening) · **Status:** design for review · **Owners:** Patrick (Railway config, monitor, scorecard, gap-fill) + Ravi (massive_ws_worker.py patch, DST fix)
**Inputs:** Ravi's handoff · two multi-agent verification passes (6-agent root-cause verify + 6-agent adversarial risk review, ~1.4M tokens) · live prod endpoints · Railway API · Railway/uvicorn docs.
**Supporting specs (full detail):** `liveflow-deploy-survival/` — `p0-config-runbook.md` · `p1-patch-spec.md` (includes the actual patch text) · `p2-gapfill-spec.md` · `p3-success-systems.md` · `coordination-package.md` (includes the Discord draft for Ravi) · `v2-risk-register-and-directives.md` (full register + conflict resolutions).
Line citations use function-name anchors; master moved during analysis (now @ `4773872d`, worker file 2,344 lines) — refresh exact lines at PR time.

## 0. Why v2 exists — two silent-failure catches

The risk review found two flaws in v1 that would have shipped a fix that **looked done and did nothing**:

1. **The v1 shutdown hook would never have run.** v1 said "register `stop()` via `@app.on_event('shutdown')`; do NOT introduce `lifespan=`". Current master already uses `FastAPI(lifespan=lifespan)` (zero `on_event` registrations) — Starlette **silently ignores** `on_event` handlers when a custom lifespan is passed. Correct: register `stop()` **after the `yield` in the existing lifespan context manager**, next to the existing `_scheduler.shutdown(wait=False)` block, via defensive `getattr`.
2. **SIGTERM never reaches uvicorn today.** The railway.json startCommand is a shell `if` wrapper — `sh` is PID 1 and does not forward SIGTERM. Setting a drain window **without** fixing this is strictly *worse* than today (+30s zombie holding the Massive session, then SIGKILL — still a dirty close). Correct: add **`exec`** to both startCommand branches **in the same atomic commit** as `deploy.drainingSeconds: 30` and `--timeout-graceful-shutdown 5`.

Everything else in this doc is the v1 plan reshaped by 12 ranked risks (§5) and 8 reviewer-conflict decisions (in `v2-risk-register-and-directives.md`).

## 1. Root cause (verified — unchanged from v1)

Two failure classes, one shared amplifier: a **blind 600s cooldown** after `max_connections`.

- **Class A (deploys):** No watch paths → every commit rebuilds web. The OPRA consumer runs **on web** (env-verified; worker is DRY_RUN staging; every restart-log `deployment_id` resolves to the web service). Railway volume-backed deploys are **stop-then-start** (doc-confirmed; no container overlap). Old process dies by SIGKILL (0s default drain + SIGTERM swallowed by the shell wrapper) → no WS close frame → Massive holds the dead session 10-30s → new process connects fast → `max_connections` at hello → blind 600s sleep. **≈9-10 min unreplayable loss per deploy; 11 market-hours deploys on 7/6.**
- **Class B (non-deploy flapping):** sync SQLite flush + enrichment on the consumer's event loop stalls it → stale watchdog (60s, market-hours-only) closes code 1001 = clean → reconnect sleep exists **only in the except branch** → zero-gap reconnect → `max_connections` → 600s. Self-sustaining because `last_trade_ts` is not reset in session-clear. New on 7/6 (7/2 was 390/390 clean); trigger = launch-day load.
- **7/6 damage:** 16 windows, ~8,659+ events (floor — rows were ~56% of 7/2 volume), ~108 min. Deploy-attributed ≥37 min; Class B ≥54 min. Fresh deploys consistently *ended* outages (cooldown is client-side).

## 2. Corrections to the handoff (for Ravi — full draft message in `coordination-package.md`)

1. The consumer is on **web**, not worker (three-way verified). Worker watch paths alone would not have stopped the bleeding — still set (bars-pipeline hygiene + P5 end-state), and the ask is honored first in the message.
2. The handoff's watch-path list is too narrow for worker (bars pipeline lives there). Use `/api/**` + build files, **dashboard-only** (never in the shared railway.json — it would apply to web too and stop frontend deploys).
3. "2 deploys + 10 WS reconnects" under-attributes: all 11 recorded restarts were deploys; the morning windows are the Class B loop with concrete 1-2 line fixes. Falsification grep for the "second client with the prod key" hypothesis: any `max_connections at hello` NOT preceded ≤2 min by a watchdog line or boot banner.

## 3. The plan v2

### P0 — Config substrate (Patrick, tonight ≥8:30 PM ET) — `p0-config-runbook.md`
One **atomic railway.json commit**: `exec` in both startCommand branches + `--timeout-graceful-shutdown 5` (web branch) + `deploy.drainingSeconds: 30`. Then worker `watchPatterns` in the **dashboard only**, root-anchored: `/api/**, /requirements.txt, /railway.json, /nixpacks.toml, /Procfile, /runtime.txt`.
- The deploy that ships this is sacrificial (old container still tears down dirty) — after-hours only.
- Measure old-exit→new-start gap on a controlled redeploy: if drain behaves as a fixed wait (not max-grace), drop to 10s.
- Two-commit watch-path smoke test same night: positive (api touch → worker deploys) + negative (app/src touch → worker doesn't; web is the control).
- Deploy ledger for the evening: web ×4, worker ×2, all after hours.

### P1 — Graceful handoff patch (Ravi's file; ready-to-review branch) — `p1-patch-spec.md` (patch text included)
In `massive_ws_worker.py`: `stop()` (wrapper coroutine stores loop + root task; threadsafe cancel; `thread.join(5)`; `close_timeout=3`) · reconnect sleep after **clean** `_run_session` return · `MIN_RECONNECT_GAP` 20→30s, env-tunable · `last_trade_ts=None` on session start · `max_connections` ladder 30/60/120/300/600, reset only on `auth_success`, capped 60s while uptime <15 min, knobs env-tunable (Massive support's answer becomes a config change, not code) · greppable log lines + `sessions_started` counter (drill instrumentation) · `get_status()` must not serialize the loop/task refs.
- main.py hunk (Patrick, safe to land first): defensive `stop = getattr(...)` **after the `yield` in the existing lifespan CM**.
- **Hard prerequisite: P0's exec+drain must be live first** — without them `stop()` never gets the chance to run.
- **Test safety: `DRY_RUN=1` does NOT protect the prod connection slot.** Any local run with the prod key causes a live outage. Unit tests run against a localhost mock WS server with a hard URL assert; worker stays `MASSIVE_WS_ENABLED=0` until P5; ask Massive for a sandbox key.
- Effect: deploy gap 600s → ~15-60s; Class B loop broken. Contingency if Class B persists: offload `_write_events` to an executor (the file's own established pattern).

### P2 — Auto gap-fill, split in two — `p2-gapfill-spec.md`
- **P2a (read-only, ships this week):** T+1 gap detection + Discord report. Own ZoneInfo session calendar with early-close set (`trading_calendar.py` does **not** exist in this repo — v1 reference deleted). Runs dark (DRY_RUN) for a week; must reproduce the 16 known 7/6 windows.
- **P2b (writes; needs one Ravi ACK on the delete-window decision):** **delete-window-then-fill (±60s margin)** — per-contract reconciliation rejected as unprovable. Schedule **16:45 ET primary / 21:00 retry / 08:00 final** (v1's 12:45 PM collided with the live writer mid-session). Per-window single `BEGIN IMMEDIATE` transaction: archive full deleted-row copies + delete + insert + manifest (reversible); pre-run SQLite backup to `/data/flow_backups/` (keep 3); rollback endpoint (refuses runs >7 days old).
- **Cache-version trap (would have made P2 silently useless):** flow CSV cache invalidation = row count; a delete-N/insert-N fill leaves the version unchanged → LRU + Cloudflare serve pre-fill data behind a 24h stale window. Mandatory version bump on every fill + boot re-bump.
- Hard post-fill assertions (not heuristics): re-detection over the filled window is empty AND `COUNT(*) == COUNT(DISTINCT dedup_key)` — violation pages with the rollback command.

### P3 — Monitor + scorecard + drill (Patrick, independent — starts tonight) — `p3-success-systems.md`
- **Live monitor** (`api/services/liveflow_monitor.py`, worker service): 60s poll; **oracle = `max_id` delta** (timezone-immune; `last_event_age_sec` demoted to diagnostic — the router's 4 hardcoded UTC-4 sites make age skew +1h from Nov 1; DST fix stays Ravi's, deadline **2026-10-30**). 4-way classification (worker-down / monitor-blind-FlowDB / monitor-blind-web / upstream-quiet) via a new Patrick-owned `GET /api/liveflow/consumer-state` endpoint on web. Alert plumbing mirrors the unit-tested worker down-alert pattern (`_down_alert_decision` + copied `_post_discord`) — NOT `watchlist_alert_service` (wrong audience, dies with the web pod). Fatigue policy: 2-consecutive confirm, ≤6 msgs/incident, 10/day cap, recovery notice after 2 healthy polls.
- **Daily Integrity Scorecard** (16:15 ET, 13:15 on early closes): coverage x/390, gap windows, restarts with deployment_ids, T-1 fill status, trend. GREEN ≥388/390 + 0 windows + 0 unexplained market-hours restarts. **Dead-man convention: it posts every trading day — absence by 4:30 PM IS the alarm.**
- **Deploy drill:** (a) after-hours ×2 — pass = graceful-close log inside drain, zero `max_connections`, SIGTERM→`auth_success` <60s; (b) ONE sanctioned 3:55 PM ET deploy — pass = single gap <90s, monitor silent. Numbers recorded as the accepted baseline.

### P4 — Deploy hygiene (process, effective immediately)
- Shipping window: **≥4:20 PM ET** (options tape runs to 4:15) or **<9:15 AM ET**; batch market-hours pushes. The always-push-after-every-task habit is the root cause of the 11-deploy storm — the behavior memory itself is amended with this exception.
- Failed builds are free (web serves last SUCCESS; only a successful swap kills the consumer). Urgent mid-day fix before P1: deploy anyway — evidence shows a fresh deploy *ends* an ongoing outage; accept the one bounded gap.

### P5 — Consumer → worker migration (Ravi's staged plan; endorse after P0–P3 green ≥1 week)
Needs: flow.db locality decision (move flow reads vs private-network proxy), identical stop()/lifespan package on worker, worker boot invariant (nothing slow before uvicorn), after-hours cutover with staged env flips. Rollback = flip `MASSIVE_WS_ENABLED` back after hours (P1's stop() makes the flip itself clean). End-state: market-hours web deploys cause **zero** flow gap.

### P6 — Bullflow liveflow worker (same disease; opportunistic after P1 proven)
`stop()` + SSE read-timeout/heartbeat watchdog (`timeout=None` zombie risk) + day-state rehydrate from `live_alerts_db`.

## 4. Interim runbook (until P1 lands) — full text in `coordination-package.md`
**Unstick procedure:** Railway dashboard → web → Restart, gated on ALL of: market hours AND `/api/live/massive/status` frozen >180s AND current deploy ≥60s old. (No force-reconnect endpoint exists; a cooldown-stuck process holds **no** WS session, so a restart cannot create a zombie.) Caps any incident at ~3-5 min. Pin the card in Discord.

## 5. Risk register (top items; full FR-1…FR-12 + conflict decisions in `v2-risk-register-and-directives.md`)

| ID | Risk (L×I) | Mitigation now in plan |
|---|---|---|
| FR-1 | v1 shutdown hook silently ignored (lifespan= vs on_event) — H×C | Register in lifespan teardown; CLAUDE.md invariant with correct polarity |
| FR-2 | SIGTERM dies at shell wrapper; drain-without-exec strictly worse — H×C | Atomic commit: exec + graceful-shutdown flag + drainingSeconds |
| FR-8 | Gap-edge dedup double-count corrupts filled windows — H×H | Delete-window ±60s, single-source invariant, hard post-fill assertions |
| FR-7 | 12:45 PM fill collides with live writer — H×H | 16:45/21:00/08:00 ET; BEGIN IMMEDIATE; run-start guard |
| P2-R1 | Cache-version row-count trap: fill invisible behind CDN — H×H | Mandatory version bump + boot re-bump |
| FR-6 | DST (4× UTC-4 hardcodes) + early closes poison monitor/scorecard — H×H | max_id-delta oracle; own calendar; DST fix deadline 10-30 (Ravi) |
| FR-9 | Watch paths: silent worker freeze / shared-file web freeze — M×H | Dashboard-only, root-anchored; two-commit smoke; weekly audit |
| FR-10 | Ravi stall blocks P1; correction tone risk — M×H | Ready-to-review branch; credit-forward message; T+2 consent ask; interim runbook |
| FR-11 | Non-atomic, irreversible fills — M×H | Transactional archive+manifest; pre-run backup; rollback endpoint |
| FR-12 | Prod OPRA slot burned by testing (DRY_RUN doesn't protect it) — M×H | Localhost mock + URL assert; worker stays disabled; sandbox-key ask |

## 6. Success systems & KPIs
- **KPIs (in the daily card):** gap-minutes/day ≤2 · max single gap <2 min (<90s on deploy days) · market-hours deploys = 0 (exceptions listed). **Baseline 7/6: 88 / 13 / 11.**
- **Week-1 success:** 3 consecutive GREEN scorecard days including ≥1 deploy day.
- **Regression guards:** scorecard (standing, dead-man) · weekly Railway config audit script (local Task Scheduler, linked CLI, no tokens: watch paths + railway.json content + env placement; drift → Discord) · post-change rule: any railway.json/watch-path/startCommand change → drill (a) that evening · unit-tested pure decision functions · CLAUDE.md invariants block.
- **External:** Massive support email tonight — (1) does an at-limit connect attempt extend the lockout? (2) sandbox key? Ladder floor stays ≥30s until answered.

## 7. Phase gates (full table in `v2-risk-register-and-directives.md`)
P0 tonight (Patrick) → P1 branch tonight, lands after Ravi's review/consent (T+1 ping, T+2 "may I land it?") → P3 monitor+consumer-state tonight, scorecard next morning → drill (a) on the P0+P1 evening, drill (b) next afternoon → P2a this week dark → P2b after P2a week + Ravi ACK → P5 after ≥1 green week → P6 opportunistic.

## 8. Open questions
1. Massive support: lockout semantics + sandbox key (email drafted).
2. Ravi: land-consent for the P1 branch; delete-window ACK for P2b; may Patrick patch the UTC-4 sites (deadline 10-30 either way); second-client rule-out for 7/6 morning (grep provided).
