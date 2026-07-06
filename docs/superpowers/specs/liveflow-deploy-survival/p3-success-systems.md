# Success-Assurance Layer — Live Flow Deploy-Survival (Monitor · Scorecard · Drill · KPIs · Guards)

Companion to `docs/superpowers/specs/2026-07-06-liveflow-worker-deploy-survival-design.md` (P3 expanded + new P3.5/P3.6). Design rule throughout: **zero edits to Ravi's files** (`massive_ws_worker.py`, `live_massive_router.py`); everything below is new Patrick-owned modules + a 3-line `worker_main.py` hook + Railway/local config. All time math uses `zoneinfo("America/New_York")` (the `data_sync.py:36` pattern) — never fixed UTC offsets.

## 0. What already exists (verified, reuse — don't rebuild)

| Piece | Where | What it gives us |
|---|---|---|
| Pure alert state machine | `worker_main.py:202-219` `_down_alert_decision(prev, ok, now)` → event ∈ {None, down, still_down, up}; `DOWN_ALERT_FAILS=2`, `RENAG=1800s` | The exact debounce/renag/recovery pattern to mirror (it's unit-tested) |
| Discord delivery | `worker_main.py:222-236` `_post_discord(webhook, content)` — stdlib urllib, never raises | Copy verbatim into the new module (importing worker_main from a service risks module-level side effects) |
| Config gates | `DISCORD_WEBHOOK_URL` + `DOWN_ALERT_ENABLED` (`worker_main.py:287-288`) | Same gating idiom for new env vars |
| Freshness endpoint | `GET /api/live/massive/status` → `{connected, last_event_at, last_event_age_sec, max_id, stale_threshold_sec:120}`; DB-failure shape has `last_error` + null age (`live_massive_router.py:1202-1294`) | The poll target. **`max_id` is the DST-immune oracle** |
| Gap forensics | `GET /api/live/massive/worker-history` → `market_minutes_with_writes`, strict windows w/ `est_dropped_events`, `total_estimated_dropped_events` (:2723-2934) | Scorecard + drill measurement |
| Restart forensics | `GET /api/live/massive/restart-log` → per-start `deployment_id`, `during_market_hours`, `seconds_since_previous_start`, live `current_uptime_sec` (:2995-3143) | Scorecard restart attribution + drill timing |
| Consumer state in-process | `restart-log` already imports `massive_ws_worker.get_status()` in-process on web (:3103-3106) | Precedent for the new `/api/liveflow/consumer-state` router |
| Full-closure calendar | `bars_fetch._NYSE_HOLIDAYS_YYYYMMDD` 2025-2027 (half-days deliberately excluded, `bars_fetch.py:100-118`) | Import; add early-close set |
| Web availability alert | keep-warm probe + down-alert, worker, 60s cadence | Already covers "site down" — liveflow monitor must dedupe against it, not repeat it |

## 1. LIVE MONITOR (P3) — `api/services/liveflow_monitor.py` (NEW, Patrick, ~2-3h incl. tests)

Daemon thread started from `worker_main.main()` right after `_start_keepwarm()` (3-line hook: `from api.services.liveflow_monitor import start_liveflow_monitor; start_liveflow_monitor()`). Nothing runs before uvicorn (worker boot invariant). Gate: `LIVEFLOW_MONITOR_ENABLED=1` + webhook present.

**Poll**: every 60s, `GET {LIVEFLOW_STATUS_URL}` (default `https://uctintelligence.com/api/live/massive/status`, cache-buster `?_={unix}`), stdlib urllib, 15s timeout — the keep-warm probe idiom.

**Session gate (DST-safe, data-driven)**: evaluate only when `now_et` is a trading day (weekday, not in full-closure set imported from `bars_fetch`) and `09:35 ≤ now_et < session_end` where `session_end = 13:00` if date ∈ `_NYSE_EARLY_CLOSES_YYYYMMDD` (new set in this module: 2026: 1127, 1224; refresh annually with the holiday list) else `16:05`. The 9:35 start is open-grace (overnight age is meaningless at 9:30); 16:05 end catches a close-minute death.

**Primary staleness oracle — `max_id` delta, not timestamps.** The router's age math sits on a hardcoded UTC-4 (`live_massive_router.py:46`) that goes wrong by +3600s when EST resumes in November. `max_id` (newest flow rowid) advances on every write and is immune. Track `(max_id, monotonic_ts)` of the last poll where max_id advanced; **staleness = seconds since last advance**. `last_event_age_sec` is logged as a secondary/diagnostic only.

**Threshold**: staleness > **180s** (`LIVEFLOW_STALE_THRESHOLD_SEC`, default 180). Rationale: 1.5× the router's own 120s display threshold; > any healthy flush stall; gives P1's 30-60s backoff ladder room to self-heal unalerted. With 60s polls + 2-consecutive-bad confirmation, first alert lands ~4-6 min into an outage — mid-window for the 9-11 min Class B pattern, early enough to act.

**Classification per poll (each with distinct alert text)**:
1. **HEALTHY** — HTTP 200 and max_id advanced since last poll (or staleness ≤ 180s).
2. **WORKER DOWN (data loss)** — HTTP 200, max_id frozen > 180s during session. Before alerting, cross-check `GET /api/liveflow/consumer-state` (§1b): `connected:false` → "consumer down (deploy/cooldown?)"; `connected:true` → "WS up but zero prints — upstream OPRA outage or (unlikely) dead-quiet tape". Alert includes staleness, max_id, consumer connected/reconnect_count/last_error, and the playbook line ("check Railway deploys; a fresh deploy clears client-side cooldown").
3. **MONITOR BLIND (FlowDB)** — HTTP 200 but the DB-error shape (`last_error` present / age null / no-rows note; exact shapes at :1230-1245, :1257-1262). "Can't see the data; worker may be fine."
4. **MONITOR BLIND (web unreachable)** — timeout/non-200. Since the consumer RUNS on web, this likely also means data loss — but the existing down-alert (2-fail confirm) always fires first; this class requires **5 consecutive** failed polls and is rate-limited to 1/hour: "web unreachable ≥5 min — site down-alert covers availability; note liveflow data is also dropping while web is down."

**State machine**: `_liveflow_alert_decision(prev, cls, now)` — a pure function mirroring `_down_alert_decision`, unit-tested with the same style. Events: `down` (2 consecutive WORKER-DOWN evals) → 🔴 alert; `escalate` at **+10 min** still down → 🔴🔴 second alert ("still down 10+ min — est. ~N events/min dropping"); `still_down` renag every 30 min after that; `up` → 🟢 recovery alert with total outage duration + a pointer to run `/worker-history` for the dropped estimate. Delivery: `LIVEFLOW_ALERT_WEBHOOK_URL` falling back to `DISCORD_WEBHOOK_URL` (check Railway vars before adding — house rule).

### 1b. Consumer-state endpoint — `api/routers/liveflow_health.py` (NEW, Patrick, ~45 min)
`GET /api/liveflow/consumer-state` on **web** (registered in `main.py` with the defensive `getattr` idiom from the dangling-import playbook): returns sanitized `massive_ws_worker.get_status()` — `connected, uptime_sec, reconnect_count, watchdog_force_reconnects, sessions_started (once P1 adds it), last_error, events_written_stocks, dry_run, enabled`. Precedent: `/restart-log` already does this import in-process (:3103-3106). New prefix `/api/liveflow` so Ravi's `/api/live/massive` namespace is untouched. This is the monitor's disambiguator (down vs upstream-quiet) and the drill's instrument.

## 2. DAILY INTEGRITY SCORECARD (P3.5) — same module, worker svc (Patrick, ~2h)

The monitor thread doubles as the scheduler (worker has no APScheduler — verified): each loop iteration checks `now_et ≥ 16:15` on a trading day and a not-yet-posted-today marker (`/data/liveflow_scorecard/YYYY-MM-DD.json` on the worker volume — file exists ⇒ posted; also the trend store). On early-close days it posts at 13:15 ET.

**Calls** (web public endpoints): `/api/live/massive/worker-history?min_gap_minutes=2`, `/api/live/massive/restart-log`, `/api/liveflow/consumer-state`; once P2 exists, the P2 run-manifest status for T-1 (until then prints `gap-fill: n/a (P2 not built)`).

**Discord post format**:
```
📊 LIVE FLOW SCORECARD — Mon 7/6  🔴 RED
Coverage: 302/390 market-minutes with writes (77.4%)
Gaps ≥2min: 16 windows · worst 3:38→3:51 PM (13 min) · est 8,659 events dropped
Restarts: 11 (11 during market hours) — deploys: 8d133c26, f54ec976, …
Consumer now: connected, uptime 1.2h, reconnects today 3
T-1 gap-fill: n/a (P2 not built)
Trend: coverage 77% vs 100% last Mon · 5-day avg 95.4%
(absence of this card by 4:30 PM ET on a trading day = the worker/monitor is down — investigate)
```
**GREEN** = coverage ≥ 388/390 (scaled to scanned minutes on early closes) AND 0 strict gap-windows AND market-hours restarts = 0 (or every restart's worker-history gap < 90s) AND est dropped < 500. **YELLOW** = coverage ≥ 380 or exactly 1 window < 5 min. **RED** = anything worse. Week-over-week: same-weekday-last-week + trailing-5-day average from the JSON store. Known caveat printed in the card until the router DST fix lands: worker-history's live-day scan-cap is UTC-4-hardcoded (:2813) — harmless at 16:15 in summer; wrong by 1h in winter (fix deadline 10/30, §5).

## 3. DEPLOY DRILL (P3.6) — controlled proof P0+P1 work (Patrick runs, Ravi CC'd; 1 evening + one 3:55 PM window)

**Precondition (Ravi, folded into P1 spec, ~4 lines)**: greppable `[massive-ws] graceful close complete (stop())` on the stop() path; `[massive-ws] clean-close reconnect after {gap}s` on the post-clean-return sleep; `_state["sessions_started"]` incremented at `auth_success` (today `reconnect_count` only counts except-branch reconnects, :1304 — clean paths are invisible without this).

**(a) After-hours drill** (same evening P0+P1 deploy, ~5:30 PM ET — note: options prints end 4:00-4:15 PM, so this measures the *connection* layer, not data gaps):
1. Baseline: `GET /api/liveflow/consumer-state` → record `sessions_started`, `reconnect_count`, `uptime_sec`; `GET /restart-log` → record count.
2. Push a trivial commit (docs touch) → web redeploys.
3. **Pass criteria**: web deploy logs contain the graceful-close line within `RAILWAY_DEPLOYMENT_DRAINING_SECONDS`; **zero** `max_connections` lines post-boot (Railway docs confirm stop-then-start for volume-attached services, so the session is released before the new process can connect — this should now be structurally impossible); new `/restart-log` entry with the new `deployment_id` and `seconds_since_previous_start` consistent with drain+boot; `consumer-state` shows `sessions_started` +1, `connected:true`, and (SIGTERM-log-timestamp → first `auth_success`) **< 60s**.
4. Repeat once (two data points; also proves the drain env var survived the redeploy it triggered).

**(b) ONE intentional market-hours deploy — 3:55 PM ET** (only after (a) passes; worst case bounded by the 4:00 close; healed by P2 once built):
1. Pre-stage a trivial commit; push at 3:55:00 PM; watch the monitor channel (it should NOT alert if the gap stays < ~4 min).
2. After 4:10 PM: `GET /worker-history?min_gap_minutes=1` → **PASS: the 3:55-4:00 window shows a single gap < 90s** (target 15-60s per the plan's loss budget); `GET /restart-log` → exactly 1 market-hours restart, the drill's deployment_id; zero `max_connections` in logs.
3. Record both drills' numbers in the scorecard store and in the spec doc as the accepted baseline. **Fail path**: if gap ≥ 90s or any max_connections appears → P4 hard rule (no market-hours deploys) stays in force and P1 gets a fix pass before any further market-hours pushes.

## 4. KPIs — 3 numbers, visible in the daily scorecard (+ on-demand endpoints)

| KPI | Target | Source |
|---|---|---|
| Market-hours gap minutes/day (`390 − market_minutes_with_writes`) | **≤ 2** (GREEN gate) | `/worker-history`, daily card, weekly trend line |
| Max single gap | **< 2 min** non-deploy days; **< 90s** on days with a deploy | strict windows in `/worker-history` |
| Market-hours deploys | **0** (each exception listed with deployment_id) | `/restart-log` `restarts_during_market_hours` |

Baseline for contrast (7/6): 88 gap-min, worst 13 min, 11 market-hours deploys. Week 1 success = three consecutive GREEN days including ≥1 deploy day.

## 5. REGRESSION GUARDS — what keeps this class of bug dead (Patrick)

1. **The scorecard IS the standing guard**: a watchPatterns regression or new blocking-flush bug shows up as RED the same day with restart attribution. Effort: already counted in §2.
2. **Weekly Railway-config audit (local PC, no prod tokens)** — `tools/railway_config_audit.ps1`, Task Scheduler Mon 8:00 AM ET, using the already-linked Railway CLI in `C:/Users/Patrick/uct-dashboard` (feasibility proven — this workstream already read `watchPatterns` and deployment ids via the Railway API). Asserts: worker `watchPatterns` non-empty and = the P0 list; `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` present on web AND worker; `MASSIVE_WS_ENABLED/DRY_RUN` placement unchanged (web=1/0, worker=0/1) until P5 flips it deliberately. Drift → Discord post. ~1h. (Alternative if CLI output proves unstable: Railway GraphQL with a **project-scoped** token on the local PC only.)
3. **Post-change smoke rule**: after ANY change to railway.json / watchPatterns / drain env / start command → run drill (a) that evening. Written into the spec doc §P0 and the CLAUDE.md note.
4. **CLAUDE.md invariant block** (~5 min):
   > **Live Flow deploy invariants (2026-07-06)**: the Massive OPRA consumer runs on the WEB service — every web deploy interrupts it. NEVER deploy `api/**` or Railway config during market hours without checking the 3:55 PM drill baseline. `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` must stay set on web+worker (Railway default drain is 0s → dirty WS death → 10-min Massive lockout). Worker `watchPatterns` must never read `[]`. `MIN_RECONNECT_GAP ≥ 30s` (Massive guidance) — no retry ladder faster than 30s without Massive support sign-off. Verify: 4:15 PM scorecard in Discord; its absence on a trading day = worker down. DST: `live_massive_router.py` UTC-4 sites must be fixed before 2026-11-01.
5. **Unit-tested decision functions**: `tests/test_liveflow_monitor.py` — classifier + state machine + calendar (early-close, holiday, DST-skew simulation with advancing max_id) + scorecard grading. Pure functions, no network. ~included in §1 effort.
6. **DST fix deadline**: the 4 UTC-4 sites in `live_massive_router.py` (:46, :2813, :3028, :3043) fixed by **2026-10-30** (Ravi, or Patrick with Ravi's OK per open question 2). The monitor survives without it (max_id oracle); worker-history/restart-log winter accuracy does not.

## 6. ALERT FATIGUE POLICY (built into the state machine)

- **Session-gated**: no polling-based alerts outside 9:35 ET → session-end on trading days (holidays/half-days data-driven). Quiet hours are automatic.
- **Per-incident shape**: 1 DOWN + 1 escalation (+10 min) + renags capped at every 30 min + 1 RECOVERY. Max **6 messages per incident**.
- **Daily cap**: max **10 liveflow messages/day**; on breach, one final "🔇 liveflow alerts muted until tomorrow (cap hit — check scorecard)" — the 4:15 card still posts (separate path, never muted).
- **Dedup vs site down-alert**: web-unreachable class needs 5 consecutive fails + 1/hour cap, and its text defers to the existing down-alert.
- **No flapping**: recovery requires 2 consecutive HEALTHY polls before `up` fires (prevents down/up/down spam during a reconnect storm).

## 7. Ownership · effort · placement (no Ravi files touched)

| Deliverable | File(s) | Owner | Effort |
|---|---|---|---|
| Live monitor + scorecard + calendar + tests | `api/services/liveflow_monitor.py` (NEW), `tests/test_liveflow_monitor.py` (NEW), 3-line hook in `api/worker_main.py` | Patrick | ~4-5h total |
| Consumer-state endpoint | `api/routers/liveflow_health.py` (NEW) + defensive include in `api/main.py` | Patrick | ~45 min |
| P1 observability riders (log lines + sessions_started) | inside Ravi's P1 patch to `massive_ws_worker.py` | **Ravi** | ~4 lines |
| Deploy drill (a)+(b) | procedure above; results into spec doc + scorecard store | Patrick (Ravi CC'd) | 1 evening + one 3:55 PM slot |
| Railway config audit | `tools/railway_config_audit.ps1` + local Task Scheduler | Patrick | ~1h |
| CLAUDE.md invariants | `CLAUDE.md` | Patrick | 5 min |
| DST fix (4 sites) | `live_massive_router.py` | Ravi (or Patrick w/ sign-off) | ~30 min, deadline 10/30 |

**Env vars (check Railway for collisions first, per house rule)**: `LIVEFLOW_MONITOR_ENABLED=1`, `LIVEFLOW_STATUS_URL` (default prod status URL), `LIVEFLOW_ALERT_WEBHOOK_URL` (fallback `DISCORD_WEBHOOK_URL`), `LIVEFLOW_STALE_THRESHOLD_SEC=180`, `LIVEFLOW_SCORECARD_ENABLED=1`. All on **worker**. Env changes redeploy the worker once — apply after hours, then run drill (a)'s worker-side sibling check (worker `/api/health` green).

**Rollout order**: liveflow_health router + monitor ship tonight (independent of P1; monitor is useful even against today's broken behavior — it would have caught all 16 windows on 7/6). Scorecard next morning. Drill (a) the evening P0+P1 land; drill (b) the following afternoon; config audit + CLAUDE.md same week.

---
## Risk appendix

**P3-R1** (high×high): DST time bomb: live_massive_router.py hardcodes UTC-4 (ET = timezone(timedelta(hours=-4)) at :46, feeding _ts_from_row → /status last_event_age_sec; also :2813 worker-history scan-end and :3028/:3043 restart-log). When EST resumes (Nov 1, 2026), age reads +3600s too old → the monitor would false-alarm 'worker down' permanently, and worker-history would report a phantom afternoon gap window.
- Mitigation: Make the monitor's PRIMARY staleness oracle the max_id delta between polls (/status already returns max_id; SQLite rowid is monotonic and timezone-immune). last_event_age_sec becomes a secondary/diagnostic signal only. Independently, fix the 4 UTC-4 sites (pending Ravi's ownership answer) with a hard deadline of 2026-10-30.
- Verify: Unit test the decision function with a simulated +3600s age skew and advancing max_id → must classify HEALTHY. Calendar reminder + scorecard sanity check on Mon Nov 2, 2026: scorecard must show 390/390 on a clean day.

**P3-R2** (medium×high): Watcher-of-the-watcher gap: the monitor and scorecard both run on the worker service. If the worker pod is down or its deploy failed (known incident class 2026-07-02), liveflow outages go unalerted and no scorecard posts — silence looks like green.
- Mitigation: Dead-man convention: the 4:15 PM ET scorecard posts EVERY trading day, including all-green days — 'no scorecard by 4:30 PM ET on a trading day' is itself the alarm. Document this in the scorecard header text and CLAUDE.md. Optional hardening: local-PC Task Scheduler 4:35 PM ET check that curls the worker /api/health and the day's scorecard marker file endpoint.
- Verify: During drill week, set LIVEFLOW_MONITOR_ENABLED=0 for one after-hours evening and confirm the missing-scorecard condition is noticed/actioned next day; re-enable.

**P3-R3** (medium×medium): Alert duplication/fatigue during a web outage: the consumer runs ON web, so web-down means the existing worker_main down-alert fires AND the liveflow monitor sees its probe fail — two alert streams for one incident.
- Mitigation: Classify web-unreachable as MONITOR-BLIND (distinct wording), require 5 consecutive failed polls (~5 min) before the liveflow monitor speaks (site down-alert fires at 2 probes ≈ 2 min, so it always leads), rate-limit monitor-blind to 1 alert/hour, and include 'site down-alert covers availability; this means liveflow data is also being lost' in the message.
- Verify: Unit tests: sequence of HTTP-fail polls must emit site-style classification only after 5 fails and never emit 'worker down'; live check during the market-hours drill by watching both streams.

**P3-R4** (low×medium): Consumer-down vs upstream-OPRA-outage vs genuinely quiet tape are indistinguishable from FlowDB writes alone — a Massive-side feed outage would page 'worker down' and could trigger wasted restarts.
- Mitigation: Ship the tiny Patrick-owned /api/liveflow/consumer-state router (in-process massive_ws_worker.get_status(): connected, reconnect_count, last_error, uptime). Monitor cross-checks it on every DOWN evaluation: connected=true + no writes → 'feed quiet/upstream outage' wording; connected=false → 'consumer down'. Alert text always states both hypotheses.
- Verify: Drill step: while healthy, confirm consumer-state.connected=true and that the monitor logs the cross-check; unit test both classification branches.

**P3-R5** (high×medium): Half-day early closes (e.g. Nov 27 2026, Dec 24 2026, 1:00 PM ET close): bars_fetch._NYSE_HOLIDAYS_YYYYMMDD intentionally EXCLUDES half-days (verified :113-118), and data_sync.in_active_data_window has no holiday awareness at all — monitor would false-alarm 1:00-4:00 PM and the scorecard would report 195/390 as red.
- Mitigation: New market_calendar helper inside liveflow_monitor.py: imports the full-closure set from bars_fetch (single source, no dual maintenance) and adds a small _NYSE_EARLY_CLOSES_YYYYMMDD set (1:00 PM ET session end). Session math uses zoneinfo('America/New_York') like data_sync (:36). Annual refresh folded into the existing 'refresh _NYSE_HOLIDAYS annually' invariant.
- Verify: Unit tests: 2026-11-27 13:05 ET with stale writes → NO alert, scorecard denominator = 210 minutes; 2026-11-26 (Thanksgiving) → no scorecard at all.

**P3-R6** (medium×medium): Deploy drill has no greppable evidence: P1's graceful-close path currently has no specified log line, and reconnect_count only increments in the except branch (massive_ws_worker.py:1304) — clean-close reconnects are invisible, so the drill can't prove 'graceful close ran, no cooldown' from data.
- Mitigation: Add to the P1 spec (Ravi, ~4 lines): log '[massive-ws] graceful close complete (stop())' on the stop() path, log '[massive-ws] clean-close reconnect after {gap}s' on the post-clean-return sleep, and add _state['sessions_started'] incremented at auth_success. Drill pass/fail greps these.
- Verify: After-hours drill: Railway web deploy logs contain the graceful-close line; /api/liveflow/consumer-state shows sessions_started incremented exactly once and no 'max_connections' line in logs.

**P3-R7** (medium×medium): Railway-config regression guard needs API access: a scheduled check of watchPatterns/drain-seconds requires a Railway token. Putting an account-scoped token on the worker is a credential-blast-radius risk; skipping the guard entirely means watchPatterns=[] can silently return (it already did once).
- Mitigation: Run the guard on the local PC (Task Scheduler, weekly Mon 8:00 AM ET) using the already-linked Railway CLI in C:/Users/Patrick/uct-dashboard — no token ships to prod. Script asserts: worker watchPatterns non-empty, RAILWAY_DEPLOYMENT_DRAINING_SECONDS present on web+worker, MASSIVE_WS_ENABLED placement unchanged; on drift, posts to the same Discord webhook. Feasibility is proven: this workstream already read watchPatterns and resolved deployment ids via the Railway API.
- Verify: Dry-run the script once against current (known-bad-until-P0) config and confirm it flags watchPatterns=[]; after P0, confirm it passes; simulate drift by checking against a deliberately wrong expected value.

**P3-R8** (low×low): The intentional 3:55 PM market-hours drill deploy drops real data (~15-60s if P0+P1 work; ~5 min worst case if they don't, bounded by the close), and skipping the drill means the first real market-hours deploy is an unplanned experiment.
- Mitigation: Keep the 3:55 PM slot (worst case bounded by 4:00 close + P2 T+1 gap-fill heals it once built). Only run after the after-hours drill passes all connection-level checks. Pre-stage the commit (trivial docs change) so the deploy itself is zero-risk.
- Verify: Same-day after 4:10 PM: /worker-history?min_gap_minutes=1 shows the deploy window gap <90s; /restart-log shows exactly 1 market-hours restart with the drill's deployment_id.
