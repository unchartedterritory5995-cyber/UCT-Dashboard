"""
liveflow_monitor.py — independent live-flow outage monitor + daily scorecard.

Runs on the WORKER service (a different process, volume, and deploy lifecycle
than the web pod that hosts the Massive OPRA WS consumer) — the independent
oracle. Would have caught all 16 downtime windows on 2026-07-06.

Design (deploy-survival P3 — docs/superpowers/specs/liveflow-deploy-survival/
p3-success-systems.md):
- Poll GET /api/live/massive/status every 60s during market sessions.
- PRIMARY staleness oracle = max_id delta between polls (SQLite rowid,
  timezone-immune). last_event_age_sec is diagnostic only — the router's age
  math sits on a hardcoded UTC-4 that skews +1h when EST resumes in November.
- 4-way classification: HEALTHY / WORKER_DOWN / BLIND_DB / BLIND_WEB, with a
  consumer-state cross-check (/api/liveflow/consumer-state) distinguishing
  "consumer down" from "connected but zero prints (upstream quiet)".
- Pure decision state machine mirroring worker_main._down_alert_decision:
  2-consecutive confirm -> DOWN alert; +10 min escalation; 30-min renags;
  recovery needs 2 healthy polls. Fatigue: <=6 msgs/incident, 10/day cap.
- Daily Integrity Scorecard posts at 16:15 ET (13:15 on early closes) EVERY
  trading day — its ABSENCE by 4:30 PM ET is itself the alarm (dead-man
  convention). Marker + trend JSON at /data/liveflow_scorecard/.

Env (worker service): LIVEFLOW_MONITOR_ENABLED=1 (master gate),
LIVEFLOW_SCORECARD_ENABLED (default 1), LIVEFLOW_STATUS_URL,
LIVEFLOW_CONSUMER_STATE_URL, LIVEFLOW_ALERT_WEBHOOK_URL (falls back to
DISCORD_WEBHOOK_URL), LIVEFLOW_STALE_THRESHOLD_SEC (default 180).
"""
import json
import logging
import os
import threading
import time
from datetime import datetime
from zoneinfo import ZoneInfo

log = logging.getLogger(__name__)

ET = ZoneInfo("America/New_York")

ENABLED = os.environ.get("LIVEFLOW_MONITOR_ENABLED", "0").lower() in ("1", "true", "yes")
SCORECARD_ENABLED = os.environ.get("LIVEFLOW_SCORECARD_ENABLED", "1").lower() in ("1", "true", "yes")
WEB_ORIGIN = os.environ.get("LIVEFLOW_WEB_ORIGIN", "https://uctintelligence.com").rstrip("/")
STATUS_URL = os.environ.get("LIVEFLOW_STATUS_URL", f"{WEB_ORIGIN}/api/live/massive/status")
CONSUMER_STATE_URL = os.environ.get(
    "LIVEFLOW_CONSUMER_STATE_URL", f"{WEB_ORIGIN}/api/liveflow/consumer-state")
WEBHOOK = (os.environ.get("LIVEFLOW_ALERT_WEBHOOK_URL")
           or os.environ.get("DISCORD_WEBHOOK_URL") or "").strip()
STALE_THRESHOLD_SEC = float(os.environ.get("LIVEFLOW_STALE_THRESHOLD_SEC", "180"))
POLL_INTERVAL_SEC = float(os.environ.get("LIVEFLOW_POLL_INTERVAL_SEC", "60"))
SCORECARD_DIR = os.environ.get(
    "LIVEFLOW_SCORECARD_DIR",
    os.path.join(os.environ.get("DATA_DIR", "/data"), "liveflow_scorecard"))

# Incident shape: confirm -> escalate(+10min) -> renag(30min) -> recover(2 ok)
DOWN_AFTER = 2                 # consecutive WORKER_DOWN polls before alerting
ESCALATE_AFTER_SEC = 600.0     # second (louder) alert if still down
RENAG_SEC = 1800.0             # further nags while down
RECOVER_AFTER = 2              # consecutive HEALTHY polls to declare recovery
BLIND_WEB_AFTER = 5            # web-unreachable polls before we say anything
BLIND_RATE_LIMIT_SEC = 3600.0  # blind-class alerts at most 1/hour
DAILY_MSG_CAP = 10             # hard cap on monitor messages per ET day

# Curated-feed wedge (2026-07-28 blind spot): flow.db can be LIVE (max_id
# advancing → HEALTHY) while the curated /recent feed serves empty because its
# fill hung. max_id can't see this; the `curated` block now on /status can.
CURATED_STALE_SEC = float(os.environ.get("LIVEFLOW_CURATED_STALE_SEC", "180"))
CURATED_FILL_HUNG_SEC = float(os.environ.get("LIVEFLOW_CURATED_FILL_HUNG_SEC", "90"))
CURATED_WEDGE_AFTER = int(os.environ.get("LIVEFLOW_CURATED_WEDGE_POLLS", "3"))
CURATED_RENAG_SEC = float(os.environ.get("LIVEFLOW_CURATED_RENAG_SEC", "1800"))

# Classification labels
HEALTHY = "healthy"
WORKER_DOWN = "worker_down"
BLIND_DB = "blind_db"
BLIND_WEB = "blind_web"


# --- Market calendar (DST-safe, data-driven) -------------------------------
# Full closures come from the bars pipeline's single source of truth.
# Half-days are intentionally NOT in that set (they are real sessions) —
# we add the 1:00 PM ET early-close dates here. Refresh annually together
# with _NYSE_HOLIDAYS_YYYYMMDD (same invariant, nyse.com/markets/hours-calendars).
_NYSE_EARLY_CLOSES_YYYYMMDD = frozenset({
    20250703, 20251128, 20251224,   # 2025
    20261127, 20261224,             # 2026
    20271126,                       # 2027 (Dec 24 2027 is a FULL closure)
})


def _full_closures() -> frozenset:
    try:
        from api.services.bars_fetch import _NYSE_HOLIDAYS_YYYYMMDD
        return _NYSE_HOLIDAYS_YYYYMMDD
    except Exception:
        return frozenset()


def session_window(now_et: datetime):
    """Returns (in_alert_session, is_trading_day, session_end_hhmm).

    Alert session = 09:35 -> 16:05 ET (13:00 on early closes): open-grace at
    9:35 because overnight staleness is meaningless at 9:30; 16:05 catches a
    close-minute death. Non-trading days -> no alerts at all.
    """
    ymd = now_et.year * 10000 + now_et.month * 100 + now_et.day
    is_trading = now_et.weekday() < 5 and ymd not in _full_closures()
    early = ymd in _NYSE_EARLY_CLOSES_YYYYMMDD
    end_hhmm = 1300 if early else 1605
    hhmm = now_et.hour * 100 + now_et.minute
    in_session = is_trading and 935 <= hhmm < end_hhmm
    return in_session, is_trading, end_hhmm


def session_minutes(now_et: datetime) -> int:
    """Expected market minutes for the day (390 normal, 210 early close)."""
    ymd = now_et.year * 10000 + now_et.month * 100 + now_et.day
    return 210 if ymd in _NYSE_EARLY_CLOSES_YYYYMMDD else 390


# --- Pure classification ----------------------------------------------------

def classify_poll(http_ok: bool, payload, staleness_sec: float,
                  threshold: float = STALE_THRESHOLD_SEC,
                  status_code: int = None) -> str:
    """Classify one poll. `staleness_sec` = seconds since max_id last advanced
    (monotonic, computed by the caller) — NOT the payload's age field, which
    carries the router's UTC-4 DST skew. A skewed age with an advancing
    max_id must classify HEALTHY (unit-tested).

    `status_code`: after P5 the web status endpoint reverse-proxies to the flow
    worker, so a 502/503/504 means web is UP but the WORKER is down — that must
    alarm LOUD (WORKER_DOWN), not soft/suppressed (BLIND_WEB). A connection
    failure with no status (web genuinely unreachable) stays BLIND_WEB."""
    if not http_ok:
        if status_code in (502, 503, 504):
            return WORKER_DOWN
        return BLIND_WEB
    if not isinstance(payload, dict):
        return BLIND_WEB
    if payload.get("max_id") is None or payload.get("last_error"):
        # The router's DB-failure shape: can't see the data — the worker
        # itself may be fine.
        return BLIND_DB
    if staleness_sec > threshold:
        return WORKER_DOWN
    return HEALTHY


# --- Pure alert state machine (mirrors worker_main._down_alert_decision) ---

def initial_state() -> dict:
    return {
        "down_fails": 0, "web_fails": 0, "db_fails": 0,
        "down": False, "down_since": None, "escalated": False,
        "last_alert_at": None, "healthy_streak": 0,
        "last_blind_alert_at": None,
    }


def _liveflow_alert_decision(prev: dict, cls: str, now: float,
                             *, down_after: int = DOWN_AFTER,
                             escalate_s: float = ESCALATE_AFTER_SEC,
                             renag_s: float = RENAG_SEC,
                             recover_after: int = RECOVER_AFTER,
                             blind_after: int = BLIND_WEB_AFTER,
                             blind_rate_s: float = BLIND_RATE_LIMIT_SEC):
    """Pure state machine. Returns (new_state, event) where event is one of
    None, "down", "escalate", "still_down", "up", "blind_web", "blind_db".

    Shape per incident: 1 down + 1 escalate + renags(30min) + 1 up.
    Recovery needs `recover_after` consecutive HEALTHY polls (no flapping).
    Blind classes never mark the worker down; they rate-limit to 1/hour and
    (web) require 5 consecutive failures so the existing site down-alert
    always leads.
    """
    s = dict(prev)
    event = None

    s["down_fails"] = s.get("down_fails", 0) + 1 if cls == WORKER_DOWN else 0
    s["web_fails"] = s.get("web_fails", 0) + 1 if cls == BLIND_WEB else 0
    s["db_fails"] = s.get("db_fails", 0) + 1 if cls == BLIND_DB else 0
    s["healthy_streak"] = s.get("healthy_streak", 0) + 1 if cls == HEALTHY else 0

    if not s.get("down"):
        if s["down_fails"] >= down_after:
            s.update(down=True, down_since=now, escalated=False, last_alert_at=now)
            event = "down"
    else:
        if s["healthy_streak"] >= recover_after:
            s.update(down=False, down_since=None, escalated=False, last_alert_at=now)
            event = "up"
        elif cls == WORKER_DOWN:
            since = s.get("down_since") or now
            last = s.get("last_alert_at")
            if not s.get("escalated") and now - since >= escalate_s:
                s.update(escalated=True, last_alert_at=now)
                event = "escalate"
            elif s.get("escalated") and last is not None and now - last >= renag_s:
                s["last_alert_at"] = now
                event = "still_down"

    # Blind classes (independent of the down incident)
    if event is None and cls == BLIND_WEB and s["web_fails"] == blind_after:
        lb = s.get("last_blind_alert_at")
        if lb is None or now - lb >= blind_rate_s:
            s["last_blind_alert_at"] = now
            event = "blind_web"
    if event is None and cls == BLIND_DB and s["db_fails"] == down_after:
        lb = s.get("last_blind_alert_at")
        if lb is None or now - lb >= blind_rate_s:
            s["last_blind_alert_at"] = now
            event = "blind_db"

    return s, event


# --- Curated-feed wedge detection (pure) ------------------------------------
# Distinct from the flow.db down machine above: this catches "flow.db live but
# the curated /recent feed is empty/hung", which max_id-based classification
# calls HEALTHY. A legit quiet tape (curated key cached, fresh, 0 alerts) is NOT
# a wedge — only a NOT-cached / stale / hung-fill key while flow.db advances.

def _curated_is_wedged(cur: dict,
                       stale_sec: float = CURATED_STALE_SEC,
                       hung_sec: float = CURATED_FILL_HUNG_SEC) -> bool:
    """True when the canonical curated key looks wedged (not just a quiet tape)."""
    if not isinstance(cur, dict):
        return False                      # no signal → don't flag (blind handled elsewhere)
    frs = cur.get("fill_running_sec")
    if frs is not None and frs > hung_sec:
        return True                       # a fill running past the hang window
    if not cur.get("cached"):
        return True                       # serving a warming stub while flow.db is live
    age = cur.get("age_sec")
    if age is not None and age > stale_sec:
        return True                       # cached but the warmer's refills aren't landing
    return False                          # cached + fresh (0 alerts = legit quiet tape)


def initial_curated_state() -> dict:
    return {"fails": 0, "wedged": False, "wedged_since": None, "last_nag_at": None}


def _curated_wedge_decision(prev: dict, wedged_now: bool, now: float,
                            *, wedge_after: int = CURATED_WEDGE_AFTER,
                            renag_s: float = CURATED_RENAG_SEC):
    """Pure. Returns (new_state, event): None | 'curated_wedged' | 'curated_still'
    | 'curated_recovered'. Confirms over `wedge_after` consecutive polls (no flap),
    renags every `renag_s`, and fires one recovery when it clears."""
    s = dict(prev)
    event = None
    s["fails"] = s.get("fails", 0) + 1 if wedged_now else 0
    if not s.get("wedged"):
        if s["fails"] >= wedge_after:
            s.update(wedged=True, wedged_since=now, last_nag_at=now)
            event = "curated_wedged"
    else:
        if not wedged_now:
            s.update(wedged=False, wedged_since=None, last_nag_at=None)
            event = "curated_recovered"
        elif s.get("last_nag_at") is not None and now - s["last_nag_at"] >= renag_s:
            s["last_nag_at"] = now
            event = "curated_still"
    return s, event


def _curated_alert_text(event: str, cur: dict, wedged_since, now: float) -> str:
    dur = (now - wedged_since) / 60.0 if wedged_since else 0.0
    age = (cur or {}).get("age_sec")
    alerts = (cur or {}).get("alerts")
    if event == "curated_wedged":
        return ("\U0001F7E0 LIVE FLOW curated feed WEDGED -- flow.db is LIVE (max_id "
                f"advancing) but /recent is serving empty (canonical key age={age}s, "
                "cached=%s). Self-heal should steal the hung fill within the lease; if "
                "it persists, restart flow-worker. (The 2026-07-28 blind spot.)"
                % (cur or {}).get("cached"))
    if event == "curated_still":
        return (f"\U0001F7E0 LIVE FLOW curated feed STILL wedged ({dur:.0f} min) -- "
                "/recent empty while flow.db is live.")
    if event == "curated_recovered":
        return (f"\U0001F7E2 LIVE FLOW curated feed recovered after ~{dur:.0f} min -- "
                f"/recent serving alerts again ({alerts}).")
    return ""


# --- Scorecard grading (pure) -----------------------------------------------

def grade_day(minutes_with_writes: int, expected_minutes: int,
              gap_windows: list, market_hours_restarts: int,
              est_dropped: int) -> str:
    """GREEN / YELLOW / RED per the KPI gates (spec §2)."""
    coverage_floor = expected_minutes - 2   # e.g. >=388/390
    worst_gap = max((w.get("duration_min", 0) for w in gap_windows), default=0)
    if (minutes_with_writes >= coverage_floor and not gap_windows
            and market_hours_restarts == 0 and est_dropped < 500):
        return "GREEN"
    if minutes_with_writes >= expected_minutes - 10 and (
            len(gap_windows) <= 1 and worst_gap < 5):
        return "YELLOW"
    return "RED"


# --- Network + delivery (best-effort, never raise) ---------------------------

def _http_get_json(url: str, timeout: float = 15.0):
    """Returns (http_ok, payload_or_None, status_code_or_None). Cache-busted;
    browser-ish UA (Cloudflare 1010-blocks raw python UAs on this domain).
    status_code is the HTTP status (incl. an error status like 502 from a
    reverse-proxy upstream failure), or None on a connection-level failure."""
    import urllib.request
    import urllib.error
    sep = "&" if "?" in url else "?"
    req = urllib.request.Request(
        f"{url}{sep}_={int(time.time())}",
        headers={"User-Agent": "Mozilla/5.0 (uct-liveflow-monitor)"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            if r.status != 200:
                return False, None, r.status
            return True, json.loads(r.read()), 200
    except urllib.error.HTTPError as e:
        return False, None, e.code    # e.g. 502 = web up, proxied worker down
    except Exception:
        return False, None, None      # connection failure = web unreachable


def _post_discord(content: str) -> bool:
    """Best-effort Discord webhook post. Never raises. (Copied from
    worker_main — importing it from there risks module side effects.)"""
    if not WEBHOOK:
        return False
    try:
        import urllib.request
        data = json.dumps({"content": content[:1900]}).encode()
        req = urllib.request.Request(WEBHOOK, data=data,
                                     headers={"Content-Type": "application/json",
                                              "User-Agent": "uct-liveflow-monitor/1"})
        with urllib.request.urlopen(req, timeout=10) as r:
            r.read(64)
        return True
    except Exception as e:
        log.warning("[liveflow-monitor] Discord post failed: %s: %s",
                    type(e).__name__, e)
        return False


def _consumer_hint() -> str:
    """Cross-check the consumer's in-process state for alert wording."""
    ok, cs, _ = _http_get_json(CONSUMER_STATE_URL, timeout=10)
    if not ok or not isinstance(cs, dict) or not cs.get("ok", True):
        return "consumer-state: unavailable"
    if cs.get("connected"):
        return ("consumer-state: CONNECTED but zero prints -- upstream OPRA "
                "outage or dead-quiet tape (do NOT restart)")
    return (f"consumer-state: DISCONNECTED (reconnects={cs.get('reconnect_count')}, "
            f"maxconn_strikes={cs.get('maxconn_strikes', 'n/a')}, "
            f"last_error={str(cs.get('last_error'))[:80]}) -- likely deploy/cooldown; "
            f"see docs/runbooks/liveflow-unstick.md")


# --- Alert texts --------------------------------------------------------------

def _alert_text(event: str, staleness: float, max_id, down_since: float | None,
                now: float) -> str:
    mins = staleness / 60.0
    dur = (now - down_since) / 60.0 if down_since else 0.0
    if event == "down":
        return (f"\U0001F534 LIVE FLOW DOWN -- no new OPRA prints for {mins:.1f} min "
                f"(max_id frozen at {max_id}). {_consumer_hint()}")
    if event == "escalate":
        return (f"\U0001F534\U0001F534 LIVE FLOW STILL DOWN {dur:.0f} min -- data is "
                f"permanently lost until the T+1 flat file. {_consumer_hint()}")
    if event == "still_down":
        return f"\U0001F534 live flow still down ({dur:.0f} min). {_consumer_hint()}"
    if event == "up":
        return (f"\U0001F7E2 LIVE FLOW RECOVERED after ~{dur:.0f} min. Run "
                f"/api/live/massive/worker-history for the dropped-event estimate.")
    if event == "blind_web":
        return ("\U0001F536 liveflow monitor: web origin unreachable >=5 min -- the "
                "site down-alert covers availability; note live-flow data is also "
                "dropping while web is down. (1/hr max)")
    if event == "blind_db":
        return ("\U0001F536 liveflow monitor: /status returns a FlowDB error -- "
                "monitor is blind, worker may be fine. (1/hr max)")
    return ""


# --- Scorecard ---------------------------------------------------------------

def _scorecard_due(now_et: datetime, posted_marker_exists: bool) -> bool:
    _, is_trading, end_hhmm = session_window(now_et)
    if not is_trading or posted_marker_exists:
        return False
    post_hhmm = 1315 if end_hhmm == 1300 else 1615
    return now_et.hour * 100 + now_et.minute >= post_hhmm


def _marker_path(now_et: datetime) -> str:
    return os.path.join(SCORECARD_DIR, f"{now_et.strftime('%Y-%m-%d')}.json")


def _trailing_coverage(now_et: datetime, days: int = 5):
    """Average coverage pct from the last N stored scorecards (best-effort)."""
    try:
        files = sorted(f for f in os.listdir(SCORECARD_DIR) if f.endswith(".json"))
        vals = []
        for f in files[-(days + 1):]:
            if f.startswith(now_et.strftime("%Y-%m-%d")):
                continue
            with open(os.path.join(SCORECARD_DIR, f)) as fh:
                d = json.load(fh)
            if d.get("expected_minutes"):
                vals.append(100.0 * d.get("minutes_with_writes", 0) / d["expected_minutes"])
        return round(sum(vals) / len(vals), 1) if vals else None
    except Exception:
        return None


def _post_scorecard(now_et: datetime) -> None:
    date_param = f"{now_et.month}/{now_et.day}/{now_et.year}"
    ok_h, hist, _ = _http_get_json(
        f"{WEB_ORIGIN}/api/live/massive/worker-history?target_date={date_param}&min_gap_minutes=2",
        timeout=30)
    ok_r, rlog, _ = _http_get_json(
        f"{WEB_ORIGIN}/api/live/massive/restart-log?target_date={date_param}", timeout=30)
    _, cs, _ = _http_get_json(CONSUMER_STATE_URL, timeout=10)

    if not ok_h or not isinstance(hist, dict):
        _post_discord("\U0001F4CA LIVE FLOW SCORECARD -- could not fetch worker-history "
                      "(web unreachable?). Treat as RED; investigate.")
        return

    expected = session_minutes(now_et)
    with_writes = int(hist.get("market_minutes_with_writes") or 0)
    windows = hist.get("downtime_windows_strict") or []
    dropped = int(hist.get("total_estimated_dropped_events") or 0)
    mh_restarts = int((rlog or {}).get("restarts_during_market_hours") or 0)
    deploy_ids = [(e.get("deployment_id") or "")[:8]
                  for e in ((rlog or {}).get("startup_log") or [])
                  if e.get("during_market_hours")]

    grade = grade_day(with_writes, expected, windows, mh_restarts, dropped)
    icon = {"GREEN": "\U0001F7E2", "YELLOW": "\U0001F7E1", "RED": "\U0001F534"}[grade]
    worst = max(windows, key=lambda w: w.get("duration_min", 0), default=None)
    worst_txt = (f"worst {worst['start']}→{worst['end']} ({worst['duration_min']} min)"
                 if worst else "none")
    cs_txt = "n/a"
    if isinstance(cs, dict) and cs.get("ok", True):
        up_h = (cs.get("uptime_sec") or 0) / 3600.0
        cs_txt = (f"{'connected' if cs.get('connected') else 'DISCONNECTED'}, "
                  f"uptime {up_h:.1f}h, reconnects {cs.get('reconnect_count', '?')}")
    trail = _trailing_coverage(now_et)
    trail_txt = f" · 5-day avg {trail}%" if trail is not None else ""

    msg = (
        f"\U0001F4CA LIVE FLOW SCORECARD -- {now_et.strftime('%a %m/%d')}  {icon} {grade}\n"
        f"Coverage: {with_writes}/{expected} market-minutes with writes "
        f"({100.0 * with_writes / expected:.1f}%){trail_txt}\n"
        f"Gaps ≥2min: {len(windows)} windows · {worst_txt} · "
        f"est {dropped:,} events dropped\n"
        f"Market-hours restarts: {mh_restarts}"
        f"{(' -- deploys: ' + ', '.join(deploy_ids)) if deploy_ids else ''}\n"
        f"Consumer now: {cs_txt}\n"
        f"T-1 gap-fill: n/a (P2 not built)\n"
        f"(this card posts every trading day -- its absence by 4:30 PM ET IS the alarm)"
    )
    posted = _post_discord(msg)

    try:
        os.makedirs(SCORECARD_DIR, exist_ok=True)
        with open(_marker_path(now_et), "w") as f:
            json.dump({
                "date": now_et.strftime("%Y-%m-%d"), "grade": grade,
                "minutes_with_writes": with_writes, "expected_minutes": expected,
                "gap_windows": len(windows), "est_dropped": dropped,
                "market_hours_restarts": mh_restarts, "posted": posted,
                "posted_at": time.time(),
            }, f)
    except Exception as e:
        log.warning("[liveflow-monitor] scorecard marker write failed: %s", e)
    log.info("[liveflow-monitor] scorecard posted (%s): %s", grade, posted)


# --- Main loop ----------------------------------------------------------------

_thread = None


def _loop():
    state = initial_state()
    curated_state = initial_curated_state()
    last_max_id = None
    last_advance_mono = time.monotonic()
    msgs_today = 0
    msg_day = None
    muted_notice_sent = False

    log.info("[liveflow-monitor] started (status=%s, threshold=%.0fs, poll=%.0fs)",
             STATUS_URL, STALE_THRESHOLD_SEC, POLL_INTERVAL_SEC)

    while True:
        try:
            now_et = datetime.now(ET)
            today = now_et.strftime("%Y-%m-%d")
            if msg_day != today:
                msg_day, msgs_today, muted_notice_sent = today, 0, False

            in_session, _, _ = session_window(now_et)

            http_ok, payload, status_code = _http_get_json(STATUS_URL)
            mono = time.monotonic()
            if http_ok and isinstance(payload, dict) and payload.get("max_id") is not None:
                mid = payload.get("max_id")
                if last_max_id is None or mid != last_max_id:
                    last_max_id = mid
                    last_advance_mono = mono
            staleness = mono - last_advance_mono

            if in_session:
                cls = classify_poll(http_ok, payload, staleness, status_code=status_code)
                state, event = _liveflow_alert_decision(state, cls, time.time())
                if event:
                    if msgs_today < DAILY_MSG_CAP:
                        txt = _alert_text(event, staleness,
                                          (payload or {}).get("max_id"),
                                          state.get("down_since"), time.time())
                        if _post_discord(txt):
                            msgs_today += 1
                        log.warning("[liveflow-monitor] %s: %s", event, txt[:160])
                    elif not muted_notice_sent:
                        _post_discord("\U0001F507 liveflow alerts muted until tomorrow "
                                      "(daily cap hit -- check the 4:15 scorecard)")
                        muted_notice_sent = True

                # Curated-feed wedge — the 2026-07-28 blind spot. Only when flow.db
                # itself is HEALTHY (an actual WORKER_DOWN already alarms above and
                # would false-trigger this). Independent tracker + own cap budget.
                cur = payload.get("curated") if (http_ok and isinstance(payload, dict)) else None
                cur_wedged = (cls == HEALTHY) and _curated_is_wedged(cur)
                curated_state, cevent = _curated_wedge_decision(
                    curated_state, cur_wedged, time.time())
                if cevent and msgs_today < DAILY_MSG_CAP:
                    ctxt = _curated_alert_text(
                        cevent, cur, curated_state.get("wedged_since"), time.time())
                    if _post_discord(ctxt):
                        msgs_today += 1
                    log.warning("[liveflow-monitor] %s: %s", cevent, ctxt[:160])
            else:
                # Outside the session the incident state resets (overnight
                # staleness is normal) but the max_id tracker keeps running.
                state = initial_state()
                curated_state = initial_curated_state()

            if SCORECARD_ENABLED and _scorecard_due(
                    now_et, os.path.exists(_marker_path(now_et))):
                _post_scorecard(now_et)

        except Exception as e:
            log.exception("[liveflow-monitor] loop error (non-fatal): %s", e)

        time.sleep(POLL_INTERVAL_SEC)


def start_liveflow_monitor() -> bool:
    """Start the monitor daemon thread. Called from worker_main.main() after
    _start_keepwarm(). Gated: LIVEFLOW_MONITOR_ENABLED=1 + a webhook present."""
    global _thread
    if not ENABLED:
        log.info("[liveflow-monitor] disabled (LIVEFLOW_MONITOR_ENABLED != 1)")
        return False
    if not WEBHOOK:
        log.warning("[liveflow-monitor] no webhook configured "
                    "(LIVEFLOW_ALERT_WEBHOOK_URL / DISCORD_WEBHOOK_URL) -- not starting")
        return False
    if _thread is not None and _thread.is_alive():
        return False
    _thread = threading.Thread(target=_loop, daemon=True, name="liveflow-monitor")
    _thread.start()
    log.info("[liveflow-monitor] thread started")
    return True
