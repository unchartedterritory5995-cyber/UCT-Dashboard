"""The chart-data monitor's cycle, cadence, worker thread, heartbeat and daily summary.

WHERE IT RUNS: the WORKER service (``api.worker_main`` → ``start()``), as a daemon thread like
the bars-freshness watchdog and the keep-warm pinger. Why the worker: it is always on, never
member-request-bound, already reaches the public domain, already holds the volume for durable
state, and is a DIFFERENT process from everything it probes (web pod + bars-api), so a serving
outage cannot take its observer down with it. The one thing a process cannot do is notice its
own death — that is the dead-man's job, on the web pod (``deadman``), fed by the heartbeat this
loop POSTs after every cycle.

CADENCE: every ``CHART_MONITOR_INTERVAL_S`` (300) while ``session_calendar`` says pre/rth/post
on an NYSE trading day (half-days included); every ``CHART_MONITOR_OFFHOURS_INTERVAL_S`` (3600)
otherwise, REST checks only (the frontier is then the last session's final bucket).

ONE CYCLE: ~20 tickers (liquid + thin) × 1/5/15/30/60rth/60eth/D through ``/api/bars`` on the
public edge, plus (market phases) one v=2 SSE sample whose closed buckets are compared with the
REST rows. Per (check, tf) the failing tickers are folded into one observation and handed to
``alerting.step`` (N consecutive failing cycles open, M passing cycles resolve).

Kill switch: ``CHART_MONITOR_ENABLED=0``. Manual run (prints no prices):
``python -m api.services.chart_monitor.runner --once``.
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import threading
import time
import urllib.request
from dataclasses import dataclass, field
from typing import Callable, Optional

from api.services.chart_monitor import alerting
from api.services.chart_monitor import checks as C
from api.services.chart_monitor.probe import UA, Http, sample_stream, service_headers

_log = logging.getLogger("chart_monitor")

LIQUID = ("SPY", "QQQ", "IWM", "AAPL", "MSFT", "NVDA", "TSLA", "AMZN", "META", "GOOGL",
          "AMD", "AVGO", "PLTR", "SOFI", "ONON", "HOOD")
THIN = ("NVEC", "UFPT", "LWAY", "CLFD")
#: (label, tf, session) — the label is what alerts/summary name.
SERIES = (("1", "1", "eth"), ("5", "5", "eth"), ("15", "15", "eth"), ("30", "30", "eth"),
          ("60rth", "60", "rth"), ("60eth", "60", "eth"), ("D", "D", None))
BARS_N = {"1": 3000, "5": 1200, "15": 400, "30": 250, "60": 200, "D": 300}
STREAM_TICKERS = ("SPY", "AAPL", "NVDA", "SOFI")
STREAM_TFS = ("1", "5")

#: checks whose per-ticker FAIL folds into the (check, tf) alert key
PAIR_CHECKS = ("http", "tail_status", "freshness", "ohlc", "dup_sorted", "grid", "rth_gaps_today",
               "rth_gaps_prev", "missing_days", "forming")


def _env_list(name: str, default: tuple) -> tuple:
    raw = (os.environ.get(name) or "").strip()
    return tuple(s.strip().upper() for s in raw.split(",") if s.strip()) if raw else default


def _env_num(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name) or default)
    except ValueError:
        return default


@dataclass
class Config:
    base: str = "https://uctintelligence.com"
    liquid: tuple = LIQUID
    thin: tuple = THIN
    interval_s: float = 300
    offhours_interval_s: float = 3600
    grace_s: int = 90
    fail_runs: int = 2
    clear_runs: int = 2
    remind_s: float = 7200
    latency_p90_ms: float = 3000
    label_budget: float = 0.15
    label_window_s: int = 1800
    stream: bool = True
    stream_seconds: float = 120
    cycle_deadline_s: float = 240
    max_transport_fails: int = 5
    stream_settle_s: float = 60
    rps: float = 3.0
    heartbeat_url: str = ""

    @classmethod
    def from_env(cls) -> "Config":
        base = (os.environ.get("CHART_MONITOR_BASE") or cls.base).rstrip("/")
        return cls(
            base=base,
            liquid=_env_list("CHART_MONITOR_TICKERS", LIQUID),
            thin=_env_list("CHART_MONITOR_THIN", THIN),
            interval_s=max(60.0, _env_num("CHART_MONITOR_INTERVAL_S", 300)),
            offhours_interval_s=max(300.0, _env_num("CHART_MONITOR_OFFHOURS_INTERVAL_S", 3600)),
            fail_runs=max(1, int(_env_num("CHART_MONITOR_FAIL_RUNS", 2))),
            clear_runs=max(1, int(_env_num("CHART_MONITOR_CLEAR_RUNS", 2))),
            remind_s=_env_num("CHART_MONITOR_REMIND_S", 7200),
            latency_p90_ms=_env_num("CHART_MONITOR_LATENCY_P90_MS", 3000),
            label_budget=_env_num("CHART_MONITOR_LABEL_BUDGET", 0.15),
            stream=os.environ.get("CHART_MONITOR_STREAM_ENABLED", "1") != "0",
            cycle_deadline_s=max(60.0, _env_num("CHART_MONITOR_CYCLE_DEADLINE_S", 240)),
            max_transport_fails=max(1, int(_env_num("CHART_MONITOR_MAX_TRANSPORT_FAILS", 5))),
            heartbeat_url=(os.environ.get("CHART_MONITOR_HEARTBEAT_URL")
                           or f"{base}/api/internal/chart-monitor/heartbeat"),
        )


def enabled() -> bool:
    return os.environ.get("CHART_MONITOR_ENABLED", "1") != "0"


# ───────────────────────────────────────────────────────────── one (ticker, series)

def check_series(http: Http, sym: str, label: str, tf: str, session: Optional[str], now: int,
                 thin: bool, grace: int, sleep: Callable[[float], None] = time.sleep,
                 deadline: Optional[float] = None) -> dict:
    """Probe one (sym, series) and run every per-response check. Returns
    {sym, label, ms, clean, transport_error, desc, edge, checks{name: Verdict}} — no prices.
    ``deadline`` (monotonic) bounds the retries of this probe."""
    q = f"/api/bars/{sym}?tf={tf}&bars={BARS_N[tf]}" + (f"&session={session}" if session else "")
    r = http.get_json(q, deadline=deadline)
    res = {"sym": sym, "label": label, "thin": thin, "ms": r["ms"], "status": r["status"],
           "clean": bool(r.get("clean")), "transport_error": r["status"] is None,
           "desc": C.server_timing_desc(r["headers"].get("server-timing")),
           "edge": r["headers"].get("x-bars-edge"), "checks": {}}
    ck = res["checks"]
    body = r["body"] if isinstance(r["body"], dict) else None
    if r["status"] != 200 or body is None:
        ck["http"] = C.Verdict(C.FAIL, f"status={r['status']} err={r['error']}")
        return res
    ck["http"] = C.Verdict(C.PASS, f"200 retries={r['retries']}")

    first = body.get("tail_status")
    retry = None
    if first == "unverified":
        try:
            ra = float(r["headers"].get("retry-after") or body.get("retry_after") or 3)
        except (TypeError, ValueError):
            ra = 3.0
        sleep(min(max(ra, 0.5), 10.0))
        r2 = http.get_json(q, deadline=deadline)
        b2 = r2["body"] if isinstance(r2["body"], dict) else None
        retry = b2.get("tail_status") if b2 else None
        if b2 is not None and r2["status"] == 200:
            body = b2                         # judge what the client ends up holding
    if tf != "D":
        ck["tail_status"] = C.check_tail_status(first, retry)

    bars = body.get("bars") or []
    if body.get("no_data") or body.get("error") or not bars:
        ck["freshness"] = C.Verdict(C.WARN if thin else C.FAIL,
                                    f"no bars (no_data={bool(body.get('no_data'))})")
        return res
    ck["ohlc"] = C.check_ohlc(bars)
    ts = C.bar_times(bars)
    ck["dup_sorted"] = C.check_dup_sorted(ts)
    if tf == "D":
        dates = [str(t) for t in ts]
        ck["grid"] = C.check_daily_grid(dates)
        ck["freshness"] = C.check_daily_tail(now, max(dates), thin=thin, grace=grace)
        return res
    ints = [t for t in ts if isinstance(t, int)]
    if not ints:
        ck["freshness"] = C.Verdict(C.FAIL, "no integer timestamps")
        return res
    sess = session or "eth"
    last = max(ints)
    ck["grid"] = C.check_grid(ints, tf, sess)
    ck["freshness"] = C.check_tail(now, tf, last, session=sess, thin=thin, grace=grace)
    ck["forming"] = C.check_forming(now, tf, last, body.get("newest_bar_is_forming"),
                                    session=sess, grace=grace)
    sday = C.session_day_for(now)
    ck["rth_gaps_today"] = C.check_rth_gaps(now, tf, ints, sday, session=sess, thin=thin, grace=grace)
    ck["rth_gaps_prev"] = C.check_rth_gaps(now, tf, ints, C.prev_trading_day(sday), session=sess,
                                           thin=thin, grace=grace)
    ck["missing_days"] = C.check_missing_days(now, ints, thin=thin, grace=grace)
    return res


# ───────────────────────────────────────────────────────────── one cycle

@dataclass
class Cycle:
    at: int
    phase: str
    observations: dict = field(default_factory=dict)   # key -> (failing, detail)
    verdicts: dict = field(default_factory=dict)       # key -> Verdict (aggregate checks)
    latency_p90: dict = field(default_factory=dict)    # label -> ms
    pairs: int = 0
    requests: int = 0
    duration_s: float = 0.0
    aborted: Optional[str] = None


def fold_pair_results(results: list[dict]) -> dict:
    """Per (check, series label): failing tickers → one observation. Only FAIL fails; WARN
    (thin / quiet extended minute) and SKIP never page. A (check, label) seen only as SKIP is
    not observed at all (so it can neither open nor resolve)."""
    seen: dict = {}
    for r in results:
        for name, v in r["checks"].items():
            if v.status == C.SKIP:
                continue
            k = f"{name}|{r['label']}"
            s = seen.setdefault(k, {"fail": [], "n": 0})
            s["n"] += 1
            if v.status == C.FAIL:
                s["fail"].append(r["sym"])
    out = {}
    for k, s in seen.items():
        bad = sorted(set(s["fail"]))
        detail = (f"{len(bad)}/{s['n']} tickers: {', '.join(bad[:8])}" + (" …" if len(bad) > 8 else "")
                  if bad else f"0/{s['n']}")
        out[k] = (bool(bad), detail)
    return out


def _fetch_row_fn(http: Http):
    def fetch(sym, tf, t):
        r = http.get_json(f"/api/bars/{sym}?tf={tf}&bars=30&session=eth")
        body = r["body"] if isinstance(r["body"], dict) else None
        if r["status"] != 200 or body is None:
            return "error"
        return next((b for b in body.get("bars") or [] if str(b.get("t")) == str(t)), None)
    return fetch


def stream_verdicts(s: dict) -> dict:
    """SSE sample → aggregate verdicts. 503 'disabled' is a deliberate server state (SKIP);
    401/403 means the service credential is missing on this pod (its own key, so a config
    problem pages once instead of masquerading as a data regression)."""
    st = s.get("status")
    if st == 503:
        return {"stream_connect|1": C.Verdict(C.SKIP, "stream disabled/at capacity (503)")}
    if st in (401, 403):
        return {"stream_auth|-": C.Verdict(C.FAIL, f"HTTP {st}: service credential (PUSH_SECRET) "
                                                    "missing/rejected on the monitor pod")}
    out = {"stream_auth|-": C.Verdict(C.PASS, "ok")} if st == 200 else {}
    if st != 200:
        out["stream_connect|1"] = C.Verdict(C.FAIL, f"status={st} {s.get('error') or ''}".strip())
        return out
    out["stream_connect|1"] = C.Verdict(C.FAIL if s.get("frames", 0) == 0 else C.PASS,
                                        f"frames={s.get('frames')} finals={s.get('finals')} "
                                        f"max_gap={s.get('max_gap_s')}s")
    for tf in STREAM_TFS:
        comps = [c for c in s.get("comparisons", []) if str(c.get("tf")) == tf]
        v = C.check_stream_vs_rest(comps)
        bad = sorted({c["sym"] for c in comps if c.get("price_mismatch") or c.get("row_missing")})
        if bad:
            v = C.Verdict(v.status, v.detail + f" tickers: {', '.join(bad)}")
        out[f"stream_vs_rest|{tf}"] = v
    # H/L regressions while a bucket develops: recorded (summary), WARN only — a known open
    # defect class (brief D6) that the P1-P4 rewrite owns; paging on it would page on a known bug.
    out["stream_hl_monotone|-"] = C.Verdict(C.WARN if s.get("hl_regressions") else C.PASS,
                                            f"hl_regressions={s.get('hl_regressions', 0)}")
    return out


def run_cycle(http: Http, cfg: Config, labels: C.LabelWindow, now_fn: Callable[[], float] = time.time,
              stream_fn=sample_stream, sleep: Callable[[float], None] = time.sleep) -> Cycle:
    t0 = now_fn()
    cyc = Cycle(at=int(t0), phase=C.phase_at(int(t0)))
    market = cyc.phase != "closed"

    stream_out: dict = {}
    th = None
    if market and cfg.stream:
        pairs = [(s, tf) for s in STREAM_TICKERS for tf in STREAM_TFS]

        def _stream():
            try:
                stream_out.update(stream_fn(http, pairs, cfg.stream_seconds, cfg.stream_settle_s,
                                            _fetch_row_fn(http)))
            except Exception as e:  # noqa: BLE001
                stream_out.update({"status": None, "error": type(e).__name__})
        th = threading.Thread(target=_stream, daemon=True, name="chart-monitor-stream")
        th.start()

    # ⛔ A CYCLE HAS A DEADLINE. Sequential probes with 20 s timeouts and retries would let a
    # hanging edge stretch one cycle to hours: the real outage would alert hours late and the
    # dead-man would page a misleading "monitor not running". So: stop at `cycle_deadline_s`, or
    # after `max_transport_fails` CONSECUTIVE transport failures, and mark every pair not probed
    # as an http FAIL (an unreachable/hung edge then opens `http|*` within two cycles).
    results, lat = [], {lab: [] for lab, _, _ in SERIES}
    mono_deadline = time.monotonic() + cfg.cycle_deadline_s
    consecutive_transport, abort = 0, None
    for sym in tuple(cfg.liquid) + tuple(cfg.thin):
        thin = sym in cfg.thin
        for lab, tf, sess in SERIES:
            if abort is None:
                if now_fn() - t0 >= cfg.cycle_deadline_s or time.monotonic() >= mono_deadline:
                    abort = f"not probed: cycle deadline {int(cfg.cycle_deadline_s)}s reached"
                elif consecutive_transport >= cfg.max_transport_fails:
                    abort = f"not probed: {consecutive_transport} consecutive transport failures"
            if abort is not None:
                results.append({"sym": sym, "label": lab, "thin": thin, "ms": None, "status": None,
                                "clean": False, "transport_error": True, "desc": None, "edge": None,
                                "checks": {"http": C.Verdict(C.FAIL, abort)}})
                continue
            n = int(now_fn())
            r = check_series(http, sym, lab, tf, sess, n, thin, cfg.grace_s, sleep=sleep,
                             deadline=mono_deadline)
            results.append(r)
            consecutive_transport = consecutive_transport + 1 if r.get("transport_error") else 0
            # ⛔ latency only from clean answers: a timeout-then-retry is not a member latency
            if r.get("clean") and r["ms"] is not None:
                lat[lab].append(r["ms"])
            if r["status"] == 200 and tf != "D":
                labels.add(n, r["desc"])
    cyc.aborted = abort
    cyc.pairs = len(results)
    cyc.observations.update(fold_pair_results(results))

    for lab, samples in lat.items():
        v = C.check_latency(samples, cfg.latency_p90_ms)
        cyc.verdicts[f"latency_p90|{lab}"] = v
        p90 = C.percentile(samples, 90)
        if p90 is not None:
            cyc.latency_p90[lab] = int(p90)
    cyc.verdicts["serve_labels|intraday"] = C.check_label_budget(labels.counts(now_fn()), cfg.label_budget)

    if th is not None:
        th.join(timeout=max(1.0, min(cfg.stream_seconds + cfg.stream_settle_s + 60,
                                     mono_deadline - time.monotonic() + 30)))
        cyc.verdicts.update(stream_verdicts(stream_out))

    for k, v in cyc.verdicts.items():
        if v.status != C.SKIP:
            cyc.observations[k] = (v.status == C.FAIL, v.detail)
    cyc.requests = http.requests
    cyc.duration_s = round(now_fn() - t0, 1)
    return cyc


# ───────────────────────────────────────────────────────────── daily summary

def _bump_day(state: dict, cyc: Cycle, events: list) -> None:
    sday = C.session_day_for(cyc.at).isoformat()
    day = state.get("day") or {}
    if day.get("date") != sday:
        day = {"date": sday, "runs": 0, "pairs": 0, "fail_cycles": {}, "opened": 0, "p90_max": {}}
    day["runs"] += 1
    day["pairs"] += cyc.pairs
    for k, (failing, _d) in cyc.observations.items():
        if failing:
            day["fail_cycles"][k] = day["fail_cycles"].get(k, 0) + 1
    day["opened"] += sum(1 for e in events if e.kind == "open")
    for lab, ms in cyc.latency_p90.items():
        day["p90_max"][lab] = max(day["p90_max"].get(lab, 0), ms)
    state["day"] = day


def summary_text(day: dict, open_keys: list) -> str:
    fails = sorted(day.get("fail_cycles", {}).items(), key=lambda kv: -kv[1])
    lat = " ".join(f"{k}={v}" for k, v in sorted(day.get("p90_max", {}).items()))
    head = "🟢" if not fails and not open_keys else "🟡"
    lines = [f"{head} **Chart data monitor — daily {day.get('date')}**: runs={day.get('runs', 0)} "
             f"pair-checks={day.get('pairs', 0)} alerts-opened={day.get('opened', 0)} "
             f"open-now={len(open_keys)}",
             f"• worst p90 ms by tf: {lat or 'n/a'}"]
    if fails:
        lines.append("• failing cycles: " + ", ".join(f"`{k}`×{n}" for k, n in fails[:12]))
    if open_keys:
        lines.append("• still open: " + ", ".join(f"`{k}`" for k in open_keys[:12]))
    return "\n".join(lines)[:1900]


def summary_due(state: dict, now: int) -> bool:
    """After the post-session close of the day the stats belong to, once per day."""
    day = state.get("day") or {}
    d = day.get("date")
    if not d or state.get("summary_sent") == d:
        return False
    from datetime import date as _date
    dd = _date.fromisoformat(d)
    return now >= C.et_epoch(dd, C.session_minutes(dd)[3])


# ───────────────────────────────────────────────────────────── heartbeat + loop

_status: dict = {"enabled": None, "started_at": None, "last_run_at": None, "last_duration_s": None,
                 "last_phase": None, "runs": 0, "open_alerts": 0, "last_error": None,
                 "next_due_s": None}
_status_lock = threading.Lock()


def status() -> dict:
    """For the worker's /internal/health. Counts and timestamps only."""
    with _status_lock:
        out = dict(_status)
    la = out.get("last_run_at")
    out["age_s"] = None if la is None else int(time.time() - la)
    return out


def push_heartbeat(cfg: Config, payload: dict, opener=urllib.request.urlopen) -> bool:
    """POST the heartbeat to the web pod's dead-man (service bearer). Never raises."""
    if not cfg.heartbeat_url:
        return False
    headers = {"Content-Type": "application/json", "User-Agent": UA}
    headers.update(service_headers())
    try:
        req = urllib.request.Request(cfg.heartbeat_url, data=json.dumps(payload).encode(),
                                     headers=headers, method="POST")
        with opener(req, timeout=10) as r:
            return 200 <= int(getattr(r, "status", 200)) < 300
    except Exception as e:  # noqa: BLE001
        _log.warning("[chart-monitor] heartbeat push failed: %s", type(e).__name__)
        return False


def interval_for(phase: str, cfg: Config) -> float:
    return cfg.interval_s if phase != "closed" else cfg.offhours_interval_s


def next_phase_boundary(now: float) -> int:
    """The next instant the session phase changes (04:00 / open / close / 20:00 ET on the next
    trading days, half-days included)."""
    from datetime import timedelta as _td
    d = C.et_dt(int(now)).date()
    for _ in range(10):
        if C.is_trading_day(d):
            for m in C.session_minutes(d):
                t = C.et_epoch(d, m)
                if t > now:
                    return t
        d = d + _td(days=1)
    return int(now + 86400)


def sleep_for(phase: str, cfg: Config, started: float, now: float) -> float:
    """Seconds to sleep after a cycle that started at ``started``: the phase's interval, but never
    past the next phase boundary (+5 s), so the hourly off-hours cadence cannot skip 04:00."""
    nominal = interval_for(phase, cfg) - (now - started)
    to_boundary = next_phase_boundary(now) + 5 - now
    return max(30.0, min(nominal, to_boundary)) if to_boundary > 0 else max(30.0, nominal)


def tick(cfg: Config, labels: C.LabelWindow, http: Optional[Http] = None, *,
         post=alerting.post, heartbeat=push_heartbeat, state_path: Optional[str] = None,
         now_fn: Callable[[], float] = time.time, stream_fn=sample_stream,
         sleep: Callable[[float], None] = time.sleep) -> Cycle:
    """One full monitor iteration: cycle → hysteresis → alerts → summary → heartbeat."""
    path = state_path or alerting.state_path()
    http = http or Http(cfg.base, rps=cfg.rps)   # auth=False: REST probes the member path
    cyc = run_cycle(http, cfg, labels, now_fn=now_fn, stream_fn=stream_fn, sleep=sleep)
    state = alerting.load_state(path)
    keys, events = alerting.step(state.get("keys") or {}, cyc.observations, cyc.at,
                                 n_fail=cfg.fail_runs, n_clear=cfg.clear_runs, remind_s=cfg.remind_s)
    state["keys"] = keys
    msg = alerting.format_events(events, cyc.at)
    if msg:
        post(msg)
    for k, (failing, detail) in sorted(cyc.observations.items()):
        if failing:
            _log.info("[chart-monitor] FAIL %s %s", k, detail)
    if cyc.phase != "closed":
        _bump_day(state, cyc, events)
    open_keys = sorted(k for k, v in keys.items() if v.get("open"))
    if summary_due(state, cyc.at):
        if post(summary_text(state["day"], open_keys)):
            state["summary_sent"] = state["day"]["date"]
    state["last_run_at"] = cyc.at
    alerting.save_state(path, state)
    nxt = interval_for(cyc.phase, cfg)
    with _status_lock:
        _status.update(last_run_at=cyc.at, last_duration_s=cyc.duration_s, last_phase=cyc.phase,
                       runs=_status["runs"] + 1, open_alerts=len(open_keys), last_error=None,
                       next_due_s=nxt)
    heartbeat(cfg, {"at": cyc.at, "phase": cyc.phase, "next_due_s": nxt, "open_alerts": len(open_keys),
                    "pairs": cyc.pairs, "duration_s": cyc.duration_s, "v": 1})
    _log.info("[chart-monitor] cycle phase=%s pairs=%d requests=%d failing=%d open=%d %.1fs",
              cyc.phase, cyc.pairs, cyc.requests, sum(1 for f, _ in cyc.observations.values() if f),
              len(open_keys), cyc.duration_s)
    return cyc


def _loop(cfg: Config) -> None:
    labels = C.LabelWindow(window_s=cfg.label_window_s)
    time.sleep(_env_num("CHART_MONITOR_STARTUP_DELAY_S", 120))
    while True:
        t0 = time.time()
        phase = C.phase_at(int(t0))
        try:
            tick(cfg, labels)
        except Exception as e:  # noqa: BLE001 — one bad cycle must never kill the monitor
            _log.warning("[chart-monitor] cycle failed: %s", type(e).__name__, exc_info=True)
            with _status_lock:
                _status["last_error"] = type(e).__name__
        time.sleep(sleep_for(phase, cfg, t0, time.time()))


THREAD_NAME = "chart-data-monitor"


def start(thread_factory=threading.Thread) -> bool:
    """Start the monitor thread (worker boot). Returns True when started. Kill switch:
    ``CHART_MONITOR_ENABLED=0``."""
    with _status_lock:
        _status["enabled"] = enabled()
    cfg = Config.from_env()
    if not enabled():
        _log.info("[chart-monitor] disabled (CHART_MONITOR_ENABLED=0)")
        # tell the dead-man the silence is deliberate, so a thrown kill switch does not page
        thread_factory(target=push_heartbeat, args=(cfg, {"at": int(time.time()), "disabled": True,
                                                          "v": 1}),
                       daemon=True, name="chart-monitor-disabled-beat").start()
        return False
    thread_factory(target=_loop, args=(cfg,), daemon=True, name=THREAD_NAME).start()
    with _status_lock:
        _status["started_at"] = int(time.time())
    _log.info("[chart-monitor] started base=%s tickers=%d+%d interval=%ss offhours=%ss stream=%s",
              cfg.base, len(cfg.liquid), len(cfg.thin), int(cfg.interval_s),
              int(cfg.offhours_interval_s), cfg.stream)
    return True


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="One chart-data monitor cycle (prints no prices).")
    ap.add_argument("--once", action="store_true", help="run one cycle and print the observations")
    ap.add_argument("--base", default=None)
    ap.add_argument("--no-stream", action="store_true")
    ap.add_argument("--alert", action="store_true", help="also apply hysteresis + post (default: dry)")
    a = ap.parse_args(argv)
    cfg = Config.from_env()
    if a.base:
        cfg.base = a.base.rstrip("/")
    if a.no_stream:
        cfg.stream = False
    labels = C.LabelWindow(window_s=cfg.label_window_s)
    if a.alert:
        cyc = tick(cfg, labels)
    else:
        cyc = run_cycle(Http(cfg.base, rps=cfg.rps), cfg, labels)
    print(f"phase={cyc.phase} pairs={cyc.pairs} requests={cyc.requests} duration={cyc.duration_s}s")
    for k, (failing, detail) in sorted(cyc.observations.items()):
        print(f"  {'FAIL' if failing else 'ok  '} {k:<28} {detail}")
    print(f"latency p90 ms: {cyc.latency_p90}")
    return 1 if any(f for f, _ in cyc.observations.values()) else 0


if __name__ == "__main__":
    raise SystemExit(main())
