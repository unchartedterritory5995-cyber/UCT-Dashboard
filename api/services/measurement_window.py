"""The Wednesday measurement window, read automatically (TERM-007 / TERM-017 / X-15).

WHY THIS EXISTS
---------------
Three ledger rows wait only on one reading taken inside a fixed window:
Wednesday 09:00-11:00 ET, first on 2026-10-14 and then every Wednesday (decision
B1 / T-4, `docs/terminal-research/12-decisions/2026-10-07-owner-delegated-decisions.md`).

  * TERM-007, the quiet window. Its bar (T-4): at least 104 minutes on ONE pod,
    across the 09:30 open, with a heavy job inside it, and no deploy in it.
  * TERM-017, the loop-lag distribution. Read `lag_histogram` from
    `api/event_loop_watchdog.py` across that window (T-9). CARD 18's condition:
    a window spanning an open and a heavy-job window, max lag far below
    `wedge_sec`. Nothing here arms the watchdog.
  * X-15 / RM-N10 clause 2. One valid RTH run of `tools/bars_warmth_gate.py`
    with no-wait n >= `MIN_NOWAIT_N` on every timeframe.

Before this module the reading needed somebody awake at 09:00 ET. Now the web
process's own scheduler takes it:

  * every minute 09:00-10:59 ET and once at 11:00 ET: one SAMPLE row (pod
    identity, the watchdog's cumulative histogram, RSS, and every scheduled job
    that finished since the previous sample);
  * 10:15 ET: ONE run of the bars gate, as a SUBPROCESS (see `run_bars_gate`);
  * from 11:01 ET: `finalize` writes ONE result record per window, posts one
    summary to the ops channel, and is idempotent, so the later catch-up slots
    (11:10, 11:30, 13:00) only fill in a slot a restart swallowed.

THE VERDICTS ARE COMPUTED FROM THE STORED ROWS, NEVER FROM PROCESS MEMORY. A
deploy inside the window restarts this process; the samples taken before it are
on disk with the old pod's identity, so the result honestly says "two pods" and
INVALID instead of quietly measuring the new pod's last few minutes.

WHAT IT DOES NOT SEE, stated: deploys of OTHER services (flow-worker, worker,
bars-api). It reads the web pod's own identity only. The verdict says so.

Store: `<DATA_DIR>/measurement_window.db` (env `MEASUREMENT_WINDOW_DB_PATH`),
declared in `store_retention` as `measurement_window`: rows older than 60 days
and results beyond the newest 104 are pruned.

Kill switch `MEASUREMENT_WINDOW_ENABLED` (unset = ON; 0/false/no/off stops every
job). It is read-only against the product: it writes only its own store and the
one ops-channel message.

⛔ THIS MODULE'S TOP LEVEL IS STDLIB-ONLY. `tools/deploy_freeze.py` (run in CI by
`promote-production.yml`) imports `in_window` from here so the freeze and the
reader share one definition of the window. Every product import is inside a
function.
"""
from __future__ import annotations

import contextlib
import datetime as _dt
import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time

FLAG = "MEASUREMENT_WINDOW_ENABLED"
STORE = "measurement_window"
ROWS = "mw_rows"
RESULTS = "mw_results"

#: The window (decision B1 / T-4). Monday is 0, so Wednesday is 2.
WINDOW_WEEKDAY = 2
WINDOW_START = (9, 0)
WINDOW_END = (11, 0)
MARKET_OPEN = (9, 30)
#: The first window. Earlier Wednesdays are not windows.
FIRST_WINDOW = _dt.date(2026, 10, 14)

#: T-4's bar: ">= 104 min on one pod across the open plus a heavy job".
MIN_SPAN_MIN = 104.0
#: A sample gap longer than this means the reader was not running (a restart).
MAX_GAP_MIN = 5.0
#: How close to 09:00 / 11:00 the first and last samples must be.
EDGE_SLACK_MIN = 5.0
#: This reader's operational definition of "a heavy job" (no other exists in the
#: repo): one scheduled run of at least this long, or with at least this RSS jump.
HEAVY_JOB_MIN_SECONDS = 30.0
HEAVY_JOB_MIN_RSS_MB = 100.0
#: CARD 18's "far below wedge_sec", made a number: the window's max lag bucket
#: must be at most this fraction of wedge_sec. Reported beside TERM-017; it is not
#: what makes the reading valid.
CARD18_FAR_BELOW = 0.10
#: TERM-017 needs most of the expected watchdog checks to have been serviced.
MIN_CHECK_FRACTION = 0.5

#: The bars gate's single run inside the window (after the open, pod settled).
GATE_AT = (10, 15)
GATE_TIMEOUT_S = 900
GATE_RESULT_MARKER = "@@MW_GATE@@"

ROW_MAX_AGE_DAYS = 60
RESULT_KEEP = 104

_WRITE_LOCK = threading.Lock()
_INIT_DONE: set[str] = set()
#: Process start, replaced by `register(boot_ts=...)` with api.main's own stamp.
_BOOT_TS = time.time()
_LAST_SAMPLE_TS: list[float] = []


def _et():
    from zoneinfo import ZoneInfo
    return ZoneInfo("America/New_York")


def is_enabled() -> bool:
    return os.environ.get(FLAG, "1").strip().lower() not in ("0", "false", "no", "off")


def db_path() -> str:
    explicit = os.environ.get("MEASUREMENT_WINDOW_DB_PATH")
    if explicit:
        return explicit
    return os.path.join(os.environ.get("DATA_DIR", "/data"), "measurement_window.db")


# ── the window ──────────────────────────────────────────────────────────────

def window_bounds(day: _dt.date) -> tuple[_dt.datetime, _dt.datetime]:
    et = _et()
    start = _dt.datetime(day.year, day.month, day.day, *WINDOW_START, tzinfo=et)
    end = _dt.datetime(day.year, day.month, day.day, *WINDOW_END, tzinfo=et)
    return start, end


def is_window_day(day: _dt.date) -> bool:
    return day.weekday() == WINDOW_WEEKDAY and day >= FIRST_WINDOW


def in_window(now: _dt.datetime | None = None) -> bool:
    """True inside Wednesday 09:00-11:00 ET (half-open). Used by the deploy freeze.

    Independent of FIRST_WINDOW on purpose: the no-deploy convention (B1) is a
    standing Wednesday rule, and a freeze that only starts on 2026-10-14 would
    need the same answer anyway.
    """
    now = (now or _dt.datetime.now(_dt.timezone.utc)).astimezone(_et())
    if now.weekday() != WINDOW_WEEKDAY:
        return False
    start, end = window_bounds(now.date())
    return start <= now < end


def latest_window_day(now: _dt.datetime | None = None) -> _dt.date:
    """The most recent window day on or before `now` (ET)."""
    now = (now or _dt.datetime.now(_dt.timezone.utc)).astimezone(_et())
    d = now.date()
    return d - _dt.timedelta(days=(d.weekday() - WINDOW_WEEKDAY) % 7)


def trading_day(day: _dt.date) -> bool | None:
    """Weekday and not an NYSE full closure. None when the calendar cannot load."""
    if day.weekday() >= 5:
        return False
    try:
        from api.services.nyse_calendar import NYSE_HOLIDAYS_YYYYMMDD
    except Exception:  # noqa: BLE001
        return None
    return (day.year * 10000 + day.month * 100 + day.day) not in NYSE_HOLIDAYS_YYYYMMDD


# ── the store ───────────────────────────────────────────────────────────────

def _connect(path: str) -> sqlite3.Connection:
    c = sqlite3.connect(path, timeout=2.0)
    c.row_factory = sqlite3.Row
    if path not in _INIT_DONE:
        c.execute(f"CREATE TABLE IF NOT EXISTS {ROWS} ("
                  " id INTEGER PRIMARY KEY AUTOINCREMENT, window_date TEXT NOT NULL,"
                  " ts REAL NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL)")
        c.execute(f"CREATE INDEX IF NOT EXISTS ix_{ROWS}_window ON {ROWS}(window_date, ts)")
        c.execute(f"CREATE TABLE IF NOT EXISTS {RESULTS} ("
                  " window_date TEXT PRIMARY KEY, written_at REAL NOT NULL,"
                  " payload TEXT NOT NULL)")
        c.commit()
        _INIT_DONE.add(path)
    return c


def _insert_row(window_date: str, kind: str, payload: dict, ts: float) -> None:
    with _WRITE_LOCK, contextlib.closing(_connect(db_path())) as c:
        c.execute(f"INSERT INTO {ROWS} (window_date, ts, kind, payload) VALUES (?,?,?,?)",
                  (window_date, ts, kind, json.dumps(payload, default=str)))
        c.commit()


def read_rows(window_date: str) -> list[dict]:
    path = db_path()
    if not os.path.exists(path):
        return []
    with contextlib.closing(_connect(path)) as c:
        rows = c.execute(f"SELECT ts, kind, payload FROM {ROWS} WHERE window_date=?"
                         " ORDER BY ts ASC, id ASC", (window_date,)).fetchall()
    out = []
    for r in rows:
        try:
            p = json.loads(r["payload"])
        except ValueError:
            p = {}
        out.append({"ts": r["ts"], "kind": r["kind"], "payload": p})
    return out


def get_result(window_date: str) -> dict | None:
    path = db_path()
    if not os.path.exists(path):
        return None
    with contextlib.closing(_connect(path)) as c:
        r = c.execute(f"SELECT payload FROM {RESULTS} WHERE window_date=?",
                      (window_date,)).fetchone()
    return json.loads(r["payload"]) if r else None


def latest_result() -> dict | None:
    path = db_path()
    if not os.path.exists(path):
        return None
    with contextlib.closing(_connect(path)) as c:
        r = c.execute(f"SELECT payload FROM {RESULTS} ORDER BY window_date DESC"
                      " LIMIT 1").fetchone()
    return json.loads(r["payload"]) if r else None


def _save_result(window_date: str, record: dict) -> bool:
    """INSERT once per window. False when a result already exists (idempotent)."""
    with _WRITE_LOCK, contextlib.closing(_connect(db_path())) as c:
        cur = c.execute(f"INSERT OR IGNORE INTO {RESULTS} (window_date, written_at, payload)"
                        " VALUES (?,?,?)",
                        (window_date, time.time(), json.dumps(record, default=str)))
        c.commit()
        return cur.rowcount == 1


def prune(*, now: float | None = None) -> int:
    """Rows older than ROW_MAX_AGE_DAYS, results beyond the newest RESULT_KEEP.
    Asks the retention registry first; an undeclared prune deletes nothing."""
    from api.services import store_retention
    now = time.time() if now is None else float(now)
    n = 0
    with _WRITE_LOCK, contextlib.closing(_connect(db_path())) as c:
        if store_retention.may_prune(STORE, ROWS):
            n += c.execute(f"DELETE FROM {ROWS} WHERE ts < ?",
                           (now - ROW_MAX_AGE_DAYS * 86400,)).rowcount
        if store_retention.may_prune(STORE, RESULTS):
            n += c.execute(f"DELETE FROM {RESULTS} WHERE window_date NOT IN"
                           f" (SELECT window_date FROM {RESULTS} ORDER BY window_date DESC"
                           " LIMIT ?)", (RESULT_KEEP,)).rowcount
        c.commit()
    return n


# ── the readings ────────────────────────────────────────────────────────────

def pod_identity() -> dict:
    return {
        "deployment": (os.environ.get("RAILWAY_DEPLOYMENT_ID") or "local")[:40],
        "replica": (os.environ.get("RAILWAY_REPLICA_ID") or "")[:40],
        "commit": (os.environ.get("RAILWAY_GIT_COMMIT_SHA") or "")[:12],
        "pid": os.getpid(),
        "boot_ts": round(_BOOT_TS, 1),
    }


def _identity_key(ident: dict) -> str:
    return f"{ident.get('deployment')}|{ident.get('replica')}|{ident.get('pid')}|{ident.get('boot_ts')}"


def _watchdog() -> dict | None:
    try:
        from api.event_loop_watchdog import get_status
        return get_status()
    except Exception:  # noqa: BLE001
        return None


def take_sample(now: _dt.datetime | None = None) -> dict | None:
    """One sample row, inside the window (and at 11:00 exactly). Never raises."""
    try:
        if not is_enabled():
            return None
        now = (now or _dt.datetime.now(_dt.timezone.utc)).astimezone(_et())
        if not is_window_day(now.date()):
            return None
        start, end = window_bounds(now.date())
        if not (start <= now <= end + _dt.timedelta(seconds=90)):
            return None
        ts = now.timestamp()
        since = _LAST_SAMPLE_TS[-1] if _LAST_SAMPLE_TS else start.timestamp() - 60
        try:
            from api.services import memory_probe
            jobs = memory_probe.recent_job_runs(since, ts)
            rss = memory_probe._rss_mb()
        except Exception:  # noqa: BLE001
            jobs, rss = [], None
        payload = {"identity": pod_identity(), "watchdog": _watchdog(),
                   "rss_mb": rss, "jobs": jobs}
        _insert_row(now.date().isoformat(), "sample", payload, ts)
        _LAST_SAMPLE_TS[:] = [ts]
        return payload
    except Exception as e:  # noqa: BLE001
        print(f"[measurement-window] sample failed (non-fatal): {type(e).__name__}: {e}")
        return None


#: Runs `tools/bars_warmth_gate.py`'s own `main()` in a CHILD interpreter and hands
#: back what it measured. ⛔ NEVER IN-PROCESS: the gate imports the repo-root
#: `conftest` at module top, and the live server must never load it
#: (tests/test_ast_conformance_no_conftest_in_server.py; the 2026-10-07 outage).
#: In the child the gate pins the data paths to a sandbox itself before it loads
#: the product clock, so nothing it does can reach the pod's /data.
_GATE_DRIVER = r'''
import importlib.util, json, os, sys
root, base, n, ev = sys.argv[1:5]
sys.path.insert(0, root)
spec = importlib.util.spec_from_file_location(
    "bars_warmth_gate", os.path.join(root, "tools", "bars_warmth_gate.py"))
g = importlib.util.module_from_spec(spec)
spec.loader.exec_module(g)
cap = {"health": None, "samples": {}}
def health_fn(b):
    h = g.read_health(b); cap["health"] = h; return h
def sample_fn(b, tf, n_, bars):
    s = g.sample_timeframe(b, tf, n_, bars); cap["samples"][tf] = s; return s
code = g.main(["--base", base, "--n", n, "--evidence-root", ev],
              health_fn=health_fn, sample_fn=sample_fn)
results = [g.timeframe_result(tf, s, in_rth=True) for tf, s in cap["samples"].items()]
artifact = ""
for dp, _dn, fn in os.walk(ev):
    if "results.md" in fn:
        with open(os.path.join(dp, "results.md"), encoding="utf-8") as f:
            artifact = f.read()
print("@@MW_GATE@@" + json.dumps({"exit": code, "health": cap["health"],
      "results": results, "min_nowait_n": g.MIN_NOWAIT_N, "bar_ms": g.P95_BAR_MS,
      "artifact": artifact[:8000]}, default=str))
'''


def _repo_root() -> str:
    return os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _gate_subprocess(base: str, n: int) -> dict:
    ev = tempfile.mkdtemp(prefix="mw_gate_")
    t0 = time.monotonic()
    try:
        r = subprocess.run([sys.executable or "python", "-c", _GATE_DRIVER,
                            _repo_root(), base, str(n), ev],
                           cwd=_repo_root(), capture_output=True, text=True,
                           encoding="utf-8", errors="replace", timeout=GATE_TIMEOUT_S)
        out = r.stdout or ""
        line = next((ln for ln in reversed(out.splitlines())
                     if ln.startswith(GATE_RESULT_MARKER)), None)
        if line is None:
            return {"exit": None, "error": f"no result line (rc={r.returncode}): "
                    f"{(r.stderr or out)[-600:]}", "seconds": round(time.monotonic() - t0, 1)}
        res = json.loads(line[len(GATE_RESULT_MARKER):])
        res["seconds"] = round(time.monotonic() - t0, 1)
        return res
    except subprocess.TimeoutExpired as e:
        return {"exit": None, "error": f"timed out after {GATE_TIMEOUT_S}s: "
                f"{str(e.stdout or '')[-400:]}", "seconds": GATE_TIMEOUT_S}
    except Exception as e:  # noqa: BLE001
        return {"exit": None, "error": f"{type(e).__name__}: {e}",
                "seconds": round(time.monotonic() - t0, 1)}
    finally:
        try:
            import shutil
            shutil.rmtree(ev, ignore_errors=True)
        except Exception:  # noqa: BLE001
            pass


def run_bars_gate(now: _dt.datetime | None = None, runner=None, *, force: bool = False) -> dict | None:
    """One gate run inside the window; the result is stored as a `bars_gate` row.

    ⚠️ ONE run per window, never a retry: the gate's sample is the same stratified
    40 names every time, so a second run would read the cache the first one warmed
    and measure the gate, not the product.
    """
    try:
        if not is_enabled() and not force:
            return None
        now = (now or _dt.datetime.now(_dt.timezone.utc)).astimezone(_et())
        if not force:
            if not is_window_day(now.date()):
                return None
            start, end = window_bounds(now.date())
            if not (start <= now < end):
                return None
        wd = now.date().isoformat()
        if not force and any(r["kind"] == "bars_gate" for r in read_rows(wd)):
            return None
        base = os.environ.get("MEASUREMENT_WINDOW_BARS_BASE", "https://uctintelligence.com")
        n = int(os.environ.get("MEASUREMENT_WINDOW_BARS_N", "40") or 40)
        res = (runner or _gate_subprocess)(base, n)
        res["started_et"] = now.isoformat()
        res["identity"] = pod_identity()
        _insert_row(wd, "bars_gate", res, now.timestamp())
        return res
    except Exception as e:  # noqa: BLE001
        print(f"[measurement-window] bars gate failed (non-fatal): {type(e).__name__}: {e}")
        return None


# ── the verdicts (pure: rows in, record out) ────────────────────────────────

def _hist_delta(first: dict | None, last: dict | None) -> list[int] | None:
    try:
        a = first["lag_histogram"]["counts"]
        b = last["lag_histogram"]["counts"]
    except (TypeError, KeyError):
        return None
    if len(a) != len(b):
        return None
    d = [int(y) - int(x) for x, y in zip(a, b)]
    return None if any(v < 0 for v in d) else d


def _percentiles(counts: list[int]) -> dict:
    try:
        from api.event_loop_watchdog import lag_percentiles
        return lag_percentiles(counts)
    except Exception:  # noqa: BLE001
        return {}


def _bounds() -> list:
    try:
        from api.event_loop_watchdog import LAG_BUCKETS_MS
        return list(LAG_BUCKETS_MS)
    except Exception:  # noqa: BLE001
        return []


def compute_verdicts(window_date: str, rows: list[dict], *,
                     is_trading_day: bool | None = None) -> dict:
    day = _dt.date.fromisoformat(window_date)
    start, end = window_bounds(day)
    open_at = start.replace(hour=MARKET_OPEN[0], minute=MARKET_OPEN[1])
    samples = [r for r in rows if r["kind"] == "sample"]
    gates = [r for r in rows if r["kind"] == "bars_gate"]
    if is_trading_day is None:
        is_trading_day = trading_day(day)

    # TERM-007 ------------------------------------------------------------
    why: list[str] = []
    idents = {}
    for s in samples:
        k = _identity_key(s["payload"].get("identity") or {})
        idents.setdefault(k, s["payload"].get("identity"))
    first_ts = samples[0]["ts"] if samples else None
    last_ts = samples[-1]["ts"] if samples else None
    span_min = (last_ts - first_ts) / 60.0 if samples else 0.0
    gaps = [(b["ts"] - a["ts"]) / 60.0 for a, b in zip(samples, samples[1:])]
    max_gap = max(gaps) if gaps else None
    heavy = []
    for s in samples:
        for j in s["payload"].get("jobs") or []:
            # ⛔ This reader's own jobs never count: the bars gate run takes
            # minutes and would otherwise satisfy the heavy-job condition itself.
            if j.get("job") in JOB_IDS:
                continue
            if (j.get("seconds") or 0) >= HEAVY_JOB_MIN_SECONDS or \
                    (j.get("rss_delta_mb") or 0) >= HEAVY_JOB_MIN_RSS_MB:
                heavy.append(j)
    all_jobs = [j for s in samples for j in (s["payload"].get("jobs") or [])
                if j.get("job") not in JOB_IDS]
    top_jobs = sorted(all_jobs, key=lambda j: j.get("seconds") or 0, reverse=True)[:5]
    if is_trading_day is False:
        why.append("not a trading day (no 09:30 open)")
    elif is_trading_day is None:
        why.append("the NYSE calendar could not be read, so the open is not established")
    if not samples:
        why.append("no samples were taken (the reader did not run in the window)")
    else:
        if len(idents) != 1:
            why.append(f"{len(idents)} pod identities in the window: a deploy or restart "
                       "happened inside it")
        if first_ts > start.timestamp() + EDGE_SLACK_MIN * 60:
            why.append(f"first sample {_hhmm(first_ts)} ET, later than 09:{int(EDGE_SLACK_MIN):02d}")
        if last_ts < end.timestamp() - EDGE_SLACK_MIN * 60:
            why.append(f"last sample {_hhmm(last_ts)} ET, earlier than "
                       f"10:{60 - int(EDGE_SLACK_MIN):02d}")
        if max_gap is not None and max_gap > MAX_GAP_MIN:
            why.append(f"a {max_gap:.0f}-minute gap between samples (the reader stopped)")
        if span_min < MIN_SPAN_MIN:
            why.append(f"span {span_min:.0f} min on record, under the {MIN_SPAN_MIN:.0f}-min bar")
        if not (first_ts <= open_at.timestamp() <= last_ts):
            why.append("the samples do not cover the 09:30 open")
        if not heavy:
            why.append(f"no heavy job ran (none >= {HEAVY_JOB_MIN_SECONDS:.0f} s or "
                       f">= {HEAVY_JOB_MIN_RSS_MB:.0f} MB RSS)")
    term007_valid = not why
    term007 = {
        "valid": term007_valid,
        "reason": ("held: one pod across the open with a heavy job, no deploy seen"
                   if term007_valid else "; ".join(why)),
        "bar": {"min_span_min": MIN_SPAN_MIN, "single_pod": True, "covers_open": "09:30 ET",
                "heavy_job": f">= {HEAVY_JOB_MIN_SECONDS:.0f} s or >= {HEAVY_JOB_MIN_RSS_MB:.0f} MB"},
        "numbers": {"samples": len(samples), "pod_identities": list(idents.values()),
                    "first_sample_et": _hhmm(first_ts), "last_sample_et": _hhmm(last_ts),
                    "span_min": round(span_min, 1),
                    "max_gap_min": round(max_gap, 1) if max_gap is not None else None,
                    "heavy_jobs": heavy[:10], "top_jobs_by_seconds": top_jobs,
                    "jobs_finished": len(all_jobs),
                    "rss_mb_first": samples[0]["payload"].get("rss_mb") if samples else None,
                    "rss_mb_last": samples[-1]["payload"].get("rss_mb") if samples else None},
        "not_seen": "deploys of other services (flow-worker, worker, bars-api) are not "
                    "visible to this reader; only the web pod's identity is checked",
    }

    # TERM-017 ------------------------------------------------------------
    why17 = [] if term007_valid else ["the window itself was not valid (TERM-007)"]
    wd_first = samples[0]["payload"].get("watchdog") if samples else None
    wd_last = samples[-1]["payload"].get("watchdog") if samples else None
    delta = None
    if not wd_first or not wd_last:
        why17.append("the watchdog status could not be read")
    elif not (wd_first.get("running") and wd_last.get("running")):
        why17.append("the watchdog was not running (WATCHDOG_OBSERVE unset?)")
    elif wd_first.get("started_at") != wd_last.get("started_at"):
        why17.append("the watchdog restarted inside the window")
    else:
        delta = _hist_delta(wd_first, wd_last)
        if delta is None:
            why17.append("the histogram went backwards or changed shape")
    checks = sum(delta) if delta else 0
    check_sec = (wd_last or {}).get("check_sec") or 5.0
    expected = span_min * 60.0 / float(check_sec) if span_min else 0.0
    if delta is not None and expected and checks < MIN_CHECK_FRACTION * expected:
        why17.append(f"only {checks} checks serviced of ~{expected:.0f} expected")
    pct = _percentiles(delta) if delta else {}
    bounds = _bounds()
    max_bucket = None
    if delta:
        top = max((i for i, c in enumerate(delta) if c), default=None)
        if top is not None:
            max_bucket = bounds[top] if top < len(bounds) else f">{bounds[-1] if bounds else '?'}"
    wedge_ms = float((wd_last or {}).get("wedge_sec") or 30.0) * 1000.0
    far_below = (isinstance(max_bucket, (int, float))
                 and max_bucket <= CARD18_FAR_BELOW * wedge_ms)
    term017_valid = not why17
    term017 = {
        "valid": term017_valid,
        "reason": ("distribution read over the valid window" if term017_valid
                   else "; ".join(why17)),
        "bar": {"window": "TERM-007 valid", "card18_far_below": f"window max <= "
                f"{CARD18_FAR_BELOW:.0%} of wedge_sec ({CARD18_FAR_BELOW * wedge_ms:.0f} ms)"},
        "numbers": {"window_counts": delta, "bounds_ms": bounds, "checks": checks,
                    "expected_checks": round(expected), **pct,
                    "window_max_le_ms": max_bucket,
                    "pod_max_lag_ms": (wd_last or {}).get("max_lag_ms"),
                    "wedge_sec": (wd_last or {}).get("wedge_sec"),
                    "card18_far_below_met": bool(far_below) if delta else None,
                    "watchdog_enabled": (wd_last or {}).get("enabled")},
        "note": "a reading only; nothing here arms the watchdog",
    }

    # X-15 ----------------------------------------------------------------
    g = gates[0]["payload"] if gates else None
    if g is None:
        x15 = {"valid": False, "passed": None, "reason": "the bars gate did not run in the window",
               "bar": {"p95_ms": 250, "min_nowait_n": None}, "numbers": {}}
    else:
        code = g.get("exit")
        per_tf = [{"tf": r.get("tf"), "p95_ms": r.get("p95_ms"), "nowait_n": r.get("nowait_n"),
                   "n": r.get("n"), "server_p95_ms": r.get("server_p95_ms"),
                   "tier_alarm": bool(r.get("tier_alarm")),
                   "not_computable": r.get("not_computable")}
                  for r in g.get("results") or []]
        if code in (0, 1):
            reason = ("measured under valid conditions: "
                      + ("WITHIN the bar" if code == 0 else "OVER the bar"))
        elif code == 2:
            refused = _status_line(g.get("artifact") or "")
            reason = "INCONCLUSIVE (exit 2): " + (refused or "a precondition refused or a p95 "
                                                  "was not computable")
            nc = [t for t in per_tf if t.get("not_computable")]
            if nc:
                reason += "; " + "; ".join(f"tf={t['tf']} no-wait n={t['nowait_n']}" for t in nc)
        else:
            reason = "the gate did not complete: " + str(g.get("error") or "unknown")
        x15 = {"valid": code in (0, 1), "passed": (code == 0) if code in (0, 1) else None,
               "reason": reason,
               "bar": {"p95_ms": g.get("bar_ms") or 250, "min_nowait_n": g.get("min_nowait_n")},
               "numbers": {"exit": code, "timeframes": per_tf, "health": g.get("health"),
                           "seconds": g.get("seconds"), "started_et": g.get("started_et")},
               "artifact": (g.get("artifact") or "")[:6000]}

    return {"window_date": window_date, "window": "Wed 09:00-11:00 ET",
            "computed_at": _dt.datetime.now(_dt.timezone.utc).isoformat(),
            "trading_day": is_trading_day,
            "rows": {"TERM-007": term007, "TERM-017": term017, "X-15": x15}}


def _hhmm(ts: float | None) -> str | None:
    if ts is None:
        return None
    return _dt.datetime.fromtimestamp(ts, _et()).strftime("%H:%M")


def _status_line(artifact: str) -> str:
    for ln in artifact.splitlines():
        if ln.startswith("* INCONCLUSIVE"):
            return ln[2:].split(". ")[0][:300]
    return ""


def summary_text(record: dict) -> str:
    r = record["rows"]
    t7, t17, x15 = r["TERM-007"], r["TERM-017"], r["X-15"]
    n17 = t17["numbers"]

    def mark(ok):
        return "VALID" if ok else "INVALID"
    lines = [f"Measurement window {record['window_date']} (Wed 09:00-11:00 ET)",
             f"TERM-007 quiet window: {mark(t7['valid'])}. {t7['reason']}. "
             f"Span {t7['numbers']['span_min']} min, {t7['numbers']['samples']} samples.",
             f"TERM-017 loop lag: {mark(t17['valid'])}. {t17['reason']}. "
             f"p50<={n17.get('p50_le_ms')} p90<={n17.get('p90_le_ms')} "
             f"p99<={n17.get('p99_le_ms')} ms, window max<={n17.get('window_max_le_ms')} ms, "
             f"wedge {n17.get('wedge_sec')} s.",
             f"X-15 bars p95: {mark(x15['valid'])}. {x15['reason']}."]
    for t in x15.get("numbers", {}).get("timeframes") or []:
        lines.append(f"  tf={t['tf']} p95={t['p95_ms']} ms, no-wait n={t['nowait_n']}/{t['n']}")
    lines.append("Full record: GET /api/admin/measurement-window/latest")
    return "\n".join(lines)


def _post_ops(text: str) -> bool:
    try:
        from api.services.alert_destination import ops_webhook
        webhook = (ops_webhook() or "").strip()
    except Exception:  # noqa: BLE001
        return False
    if not webhook:
        return False
    try:
        import urllib.request as _u
        data = json.dumps({"content": text[:1900]}).encode()
        req = _u.Request(webhook, data=data, headers={"Content-Type": "application/json",
                                                      "User-Agent": "uct-measurement-window/1"})
        with _u.urlopen(req, timeout=10) as resp:
            resp.read(64)
        return True
    except Exception as e:  # noqa: BLE001
        print(f"[measurement-window] ops post failed: {type(e).__name__}: {e}")
        return False


def finalize(now: _dt.datetime | None = None, *, post: bool = True,
             window_date: str | None = None) -> dict | None:
    """Write the window's ONE result record after 11:00 ET. Idempotent. Never raises."""
    try:
        if not is_enabled():
            return None
        now = (now or _dt.datetime.now(_dt.timezone.utc)).astimezone(_et())
        day = _dt.date.fromisoformat(window_date) if window_date else latest_window_day(now)
        if not is_window_day(day):
            return None
        _start, end = window_bounds(day)
        if now < end:
            return None
        wd = day.isoformat()
        existing = get_result(wd)
        if existing is not None:
            return existing
        record = compute_verdicts(wd, read_rows(wd))
        record["posted"] = False
        if _save_result(wd, record):
            if post:
                record["posted"] = _post_ops(summary_text(record))
                if record["posted"]:
                    with _WRITE_LOCK, contextlib.closing(_connect(db_path())) as c:
                        c.execute(f"UPDATE {RESULTS} SET payload=? WHERE window_date=?",
                                  (json.dumps(record, default=str), wd))
                        c.commit()
            try:
                prune()
            except Exception:  # noqa: BLE001
                pass
            return record
        return get_result(wd)
    except Exception as e:  # noqa: BLE001
        print(f"[measurement-window] finalize failed (non-fatal): {type(e).__name__}: {e}")
        return None


def status(now: _dt.datetime | None = None) -> dict:
    """What the admin route serves beside the latest result."""
    now = (now or _dt.datetime.now(_dt.timezone.utc)).astimezone(_et())
    day = latest_window_day(now)
    nxt = day if (is_window_day(day) and now < window_bounds(day)[1]) else \
        day + _dt.timedelta(days=7)
    while not is_window_day(nxt):
        nxt += _dt.timedelta(days=7)
    rows = read_rows(day.isoformat()) if is_window_day(day) else []
    return {"enabled": is_enabled(), "now_et": now.isoformat(), "in_window": in_window(now),
            "next_window": nxt.isoformat(), "current_window": day.isoformat(),
            "current_window_samples": sum(1 for r in rows if r["kind"] == "sample"),
            "current_window_gate_runs": sum(1 for r in rows if r["kind"] == "bars_gate"),
            "identity": pod_identity()}


# ── scheduler wiring ────────────────────────────────────────────────────────

JOB_IDS = ("measurement_window_sample", "measurement_window_sample_close",
           "measurement_window_bars_gate", "measurement_window_finalize")


def register(scheduler, boot_ts: float | None = None) -> None:
    """Add the four jobs. Each one is a no-op outside its window and when the
    kill switch is off, so they register unconditionally."""
    global _BOOT_TS
    if boot_ts:
        _BOOT_TS = float(boot_ts)
    from apscheduler.triggers.cron import CronTrigger
    et = _et()
    scheduler.add_job(take_sample, trigger=CronTrigger(day_of_week="wed", hour="9-10",
                      minute="*", second=5, timezone=et),
                      id="measurement_window_sample", max_instances=1, coalesce=True,
                      replace_existing=True)
    scheduler.add_job(take_sample, trigger=CronTrigger(day_of_week="wed", hour=11, minute=0,
                      second=5, timezone=et),
                      id="measurement_window_sample_close", max_instances=1, coalesce=True,
                      replace_existing=True)
    scheduler.add_job(run_bars_gate, trigger=CronTrigger(day_of_week="wed", hour=GATE_AT[0],
                      minute=GATE_AT[1], timezone=et),
                      id="measurement_window_bars_gate", max_instances=1, coalesce=True,
                      misfire_grace_time=600, replace_existing=True)
    scheduler.add_job(finalize, trigger=CronTrigger(day_of_week="wed", hour="11,13",
                      minute="1,10,30", timezone=et),
                      id="measurement_window_finalize", max_instances=1, coalesce=True,
                      replace_existing=True)
