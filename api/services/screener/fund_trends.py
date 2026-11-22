"""Fundamental trends for the Screener: how a company's quarters are moving, from SEC filings, point in time.

Eight snapshot columns (`COLUMNS`), one writer (the 03:00 ET build reads them from this module's side table
through `read_fields`), computed once each evening by `run_evening` from the point-in-time fundamentals store
the charts and the FUND panel read (`api/services/fundamentals_pit/`). Never a vendor call.

THE DEFINITIONS (pure functions below, tested on invented quarter series in tests/test_screener_fund_trends.py)

  A QUARTER AS KNOWN. The store keeps each series as points `[t_eff, value | None, 'YYYY-MM-DD' period end,
  method]`, ascending by `t_eff` (when the filing became public), one point each time the newest value or the
  period it describes changed; `None` is the store's GAP point (a newer period was filed and the value could
  not be derived for it). At the reference time a series holds the points public by then. Its NEWEST point is
  in force only while its period ended at most `MAX_PERIOD_AGE_DAYS` before the reference day (`asof.py`'s
  staleness rule: a company that stops filing goes blank, never flat). Each older quarter's figure is the LAST
  point published for its period end, so a restatement published while that quarter was the newest replaces
  its first figure; the store never steps back to an older period, so a later restatement of an older quarter
  does not reach it.

  CONSECUTIVE QUARTERS. Two quarter ends `ACCEL_GAP_DAYS` (60 to 120) days apart. A missing quarter (a gap
  point, or a quarter the series never held: a late filer's two 10-Qs at one instant, a fiscal-year change's
  short transition period) breaks a chain; it is never compared across.

  rev_accel_q          How many quarters in a row (0 to `ACCEL_MAX`) year-over-year quarterly revenue growth
                       (`revenue_growth_yoy_q`) rose versus the quarter before. The first step is exactly the
                       group views' "revenue growth accelerating" (PR #2417, `group_stats_calc.accelerating`):
                       the newest quarter's growth in force is higher than the quarter before it, both as known,
                       the two quarter ends consecutive; either missing is no answer (None). Each further step
                       asks the same of the next older pair; the count stops at the first pair that did not rise
                       or cannot be compared, so 2 means two confirmed rises in a row.
  eps_streak_25        How many quarters in a row (0 to `EPS_STREAK_MAX`), from the newest back, year-over-year
                       quarterly diluted EPS growth (`eps_growth_yoy_q`) was at least `EPS_STREAK_THRESHOLD`
                       percent, each quarter consecutive with the one after it. NEGATIVE PRIOR-YEAR EPS: the store
                       leaves growth blank when the year-earlier EPS is zero or negative (a growth rate off a loss
                       is not a number), so such a quarter never counts: it ends a streak, and as the newest
                       quarter it makes the column None (no growth figure to judge), never 0.
  eps_growth_min_{n}q  The LOWEST year-over-year quarterly EPS growth among the newest n consecutive quarters
                       (n in `EPS_MIN_WINDOWS`): "at least X% in each of the last n quarters" for ANY X a member
                       types is this column at X or above. None unless all n quarters carry a growth figure.
                       Growth figures are taken to two decimals before the streak and the minimum are read, so
                       `eps_streak_25 >= n` holds exactly when `eps_growth_min_{n}q >= 25`.
  net_margin_chg_1y    TTM net margin (`net_margin_ttm`, percent) at the newest quarter minus the same at the
  gross_margin_chg_1y  quarter one fiscal year earlier (period ends `YEAR_GAP_DAYS`, 358 to 372 days apart, the
                       store's own `metrics.prior_quarter_end` window), in percentage points; gross margin
                       (`gross_margin_ttm`) only for issuers that report gross profit.
  shares_chg_1y        Cover-page shares outstanding (`shares_outstanding`, on today's share basis, so a split is
                       not dilution) against the cover-page count closest to 365 days earlier within
                       `SHARES_YEAR_DAYS`, in percent: negative is a net reduction (buybacks), positive dilution.

Every value is None (an absent key, so the row's column stays NULL) when it cannot be computed; never 0.

WHEN AND HOW (the evening job, `run_evening`): only in the quiet span `scan_period` keeps whole-universe work to
(weekends, and weekdays before 07:00 or from 20:15 New York time), only for an evening not yet stored, at most
`TRIES_PER_EVENING` attempts an evening, one run at a time, with a pause of `YIELD_S` after every company read,
NEVER on a member's request (the scheduler's ticks in api/main.py are the only caller). The reference time is the
evening session's 16:00 ET close (`asof.close_utc`): a filing counts only if it was public by then. Each
company's artifact is read through the store's own source selection (`serving.current_source`, v4 or v5) but NOT
through its per-company cache, which would hold every company's parsed artifact for five minutes; only the five
series used here are kept, and the rest of the artifact is dropped at once. The answer replaces the side table
in one transaction; the build reads it at 03:00 ET, and a stored evening more than `MAX_LAG_SESSIONS` trading
sessions behind the build's session is withheld (the columns go NULL), never served stale without a word.

SWITCH: `FUNDAMENTALS_PIT_ENABLED`, the one the store's member routes answer behind (read per call). Off, the job
reads nothing and the build's reader serves nothing.
"""
from __future__ import annotations

import json
import logging
import math
import os
import threading
import time
from contextlib import closing
from datetime import date, datetime, timedelta
from typing import Callable, Optional
from zoneinfo import ZoneInfo

log = logging.getLogger(__name__)

ET = ZoneInfo("America/New_York")
LOG_PREFIX = "[screener-fund-trends]"

# ── the definitions' numbers (each the builder's default, not an owner ruling; the methodology reads them) ──
MAX_PERIOD_AGE_DAYS = 200        # asof.MAX_PERIOD_AGE: a newest quarter older than this is no longer in force
ACCEL_GAP_DAYS = (60, 120)       # two quarter ends this many days apart are consecutive (group_stats_calc, PR #2417)
YEAR_GAP_DAYS = (358, 372)       # metrics.prior_quarter_end: the quarter one fiscal year back
SHARES_YEAR_DAYS = (335, 395)    # a cover-page count this many days back stands for "a year earlier"
ACCEL_MAX = 4                    # rev_accel_q counts at most this many rises
EPS_STREAK_THRESHOLD = 25.0      # percent; the EPS Growth filter's "Over 25%" preset, the app's existing default
EPS_STREAK_MAX = 8               # eps_streak_25 counts at most this many quarters (two years)
EPS_MIN_WINDOWS = (2, 3, 4)      # eps_growth_min_{n}q

# ── the evening job's bounds ──
REBUILD_AT_ET = (20, 15)         # a trading day's evening begins here (scan_period's quiet span)
QUIET_HOURS_ET = (7 * 60, 20 * 60 + 15)   # minutes: a weekday between these is busy (scan_period._reuse_quiet_now)
TICK_HOURS_ET = "20-23,0-2"      # the scheduler's ticks (api/main.py), each a no-op once the evening is stored
TICK_MINUTE_ET = 35
YIELD_S = 0.005                  # the job sleeps this long after every company it reads
MAX_SYMBOLS = 20000              # the universe read never exceeds this many symbols
TRIES_PER_EVENING = 3            # attempts an evening before the job waits for the next one
MAX_FAIL_SHARE = 0.2             # more failed reads than this share of the companies found: the answer is not stored
MAX_LAG_SESSIONS = 3             # the build serves a stored evening at most this many sessions behind its own
RUNS_KEEP = 30

#: snapshot column -> the store series it is computed from
SERIES = {
    "rev_accel_q": "revenue_growth_yoy_q",
    "eps_streak_25": "eps_growth_yoy_q",
    "eps_growth_min_2q": "eps_growth_yoy_q",
    "eps_growth_min_3q": "eps_growth_yoy_q",
    "eps_growth_min_4q": "eps_growth_yoy_q",
    "net_margin_chg_1y": "net_margin_ttm",
    "gross_margin_chg_1y": "gross_margin_ttm",
    "shares_chg_1y": "shares_outstanding",
}
COLUMNS = tuple(SERIES)
INT_COLUMNS = ("rev_accel_q", "eps_streak_25")
SERIES_NEEDED = tuple(sorted(set(SERIES.values())))

TABLE = "fund_trend_rows"
RUNS_TABLE = "fund_trend_runs"

_lock = threading.Lock()
_tries: dict = {}


# ── the definitions (pure: no reads, no clock) ──────────────────────────────────────────────────

def _finite(v) -> Optional[float]:
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    v = float(v)
    return v if math.isfinite(v) else None


def _day(s) -> Optional[date]:
    try:
        return date.fromisoformat(str(s)[:10])
    except (TypeError, ValueError):
        return None


def _pct2(v) -> Optional[float]:
    f = _finite(v)
    return None if f is None else round(f, 2)


def known_points(points, ref_ts: float) -> list:
    """The store points public by `ref_ts` (unix seconds), in store order (ascending `t_eff`)."""
    out = []
    for p in points or ():
        try:
            t = float(p[0])
        except (TypeError, ValueError, IndexError):
            continue
        if t > ref_ts:
            break
        out.append(p)
    return out


def quarters_as_known(points, ref_ts: float, ref_day: date) -> list:
    """`[(period end, value | None), ...]`, newest first: one entry per period end the series held at `ref_ts`,
    each the LAST value published for that period by then (None for a gap point). Empty when nothing is public,
    or when the newest point is no longer in force (its period ended more than `MAX_PERIOD_AGE_DAYS` before
    `ref_day`). The newest entry is the newest point itself, the one in force."""
    known = known_points(points, ref_ts)
    if not known or len(known[-1]) < 3:
        return []
    newest_end = _day(known[-1][2])
    if newest_end is None or (ref_day - newest_end).days > MAX_PERIOD_AGE_DAYS:
        return []
    by_end: dict = {}
    for p in known:
        if len(p) < 3:
            continue
        end = _day(p[2])
        if end is None or end > newest_end:
            continue
        by_end[end] = _finite(p[1])             # a later point for the same period replaces the earlier one
    by_end[newest_end] = _finite(known[-1][1])
    return sorted(by_end.items(), key=lambda kv: kv[0], reverse=True)


def consecutive(newer: date, older: date) -> bool:
    """Two quarter ends `ACCEL_GAP_DAYS` apart: one quarter after the other, nothing missing between."""
    return ACCEL_GAP_DAYS[0] <= (newer - older).days <= ACCEL_GAP_DAYS[1]


def revenue_acceleration(points, ref_ts: float, ref_day: date) -> Optional[int]:
    """Consecutive quarters (0 to `ACCEL_MAX`), from the newest back, in which y/y revenue growth rose versus the
    quarter before; None when the newest pair cannot be compared (the group views' "accelerating" is None)."""
    qs = quarters_as_known(points, ref_ts, ref_day)
    if len(qs) < 2 or qs[0][1] is None:
        return None
    count = 0
    for i in range(ACCEL_MAX):
        if i + 1 >= len(qs):
            break
        (end_new, v_new), (end_old, v_old) = qs[i], qs[i + 1]
        if v_new is None or v_old is None or not consecutive(end_new, end_old):
            if i == 0:
                return None
            break
        if v_new > v_old:
            count += 1
        else:
            break
    return count


def _growths(points, ref_ts: float, ref_day: date) -> list:
    """The EPS-growth quarters as known, each value taken to two decimals."""
    return [(end, _pct2(v)) for end, v in quarters_as_known(points, ref_ts, ref_day)]


def eps_streak(points, ref_ts: float, ref_day: date, threshold: float = EPS_STREAK_THRESHOLD,
               cap: int = EPS_STREAK_MAX) -> Optional[int]:
    """Consecutive quarters, from the newest back, with y/y EPS growth at or above `threshold` percent; None when
    the newest quarter has no growth figure (a zero or negative year-earlier EPS, a gap, or no quarter in force)."""
    qs = _growths(points, ref_ts, ref_day)
    if not qs or qs[0][1] is None:
        return None
    n = 0
    for i, (end, v) in enumerate(qs[:cap]):
        if v is None or v < threshold:
            break
        if i and not consecutive(qs[i - 1][0], end):
            break
        n += 1
    return n


def eps_min_growth(points, ref_ts: float, ref_day: date, n: int) -> Optional[float]:
    """The lowest y/y EPS growth among the newest `n` consecutive quarters, percent to two decimals; None unless
    all `n` are held, consecutive and carry a growth figure."""
    qs = _growths(points, ref_ts, ref_day)
    if n < 1 or len(qs) < n:
        return None
    window = qs[:n]
    if any(v is None for _end, v in window):
        return None
    if any(not consecutive(window[i][0], window[i + 1][0]) for i in range(n - 1)):
        return None
    return min(v for _end, v in window)


def year_ago_change(points, ref_ts: float, ref_day: date) -> Optional[float]:
    """The newest quarter's value minus the value at the quarter one fiscal year earlier (`YEAR_GAP_DAYS`), to two
    decimals (percentage points for a margin); None without both."""
    qs = quarters_as_known(points, ref_ts, ref_day)
    if not qs or qs[0][1] is None:
        return None
    end0, v0 = qs[0]
    for end, v in qs[1:]:
        gap = (end0 - end).days
        if gap > YEAR_GAP_DAYS[1]:
            break
        if gap >= YEAR_GAP_DAYS[0]:
            return None if v is None else round(v0 - v, 2)
    return None


def shares_change(points, ref_ts: float, ref_day: date) -> Optional[float]:
    """Percent change of the newest cover-page share count against the count closest to 365 days earlier within
    `SHARES_YEAR_DAYS`, to two decimals; None without both, or with a count that is not above zero."""
    qs = quarters_as_known(points, ref_ts, ref_day)
    if not qs or qs[0][1] is None or qs[0][1] <= 0:
        return None
    end0, v0 = qs[0]
    best = None
    for end, v in qs[1:]:
        gap = (end0 - end).days
        if SHARES_YEAR_DAYS[0] <= gap <= SHARES_YEAR_DAYS[1]:
            if best is None or abs(gap - 365) < abs((end0 - best[0]).days - 365):
                best = (end, v)
    if best is None or best[1] is None or best[1] <= 0:
        return None
    return round((v0 / best[1] - 1.0) * 100.0, 2)


def stock_trends(metrics: dict, ref_ts: float, ref_day: date) -> dict:
    """{column: value} for one company at one reference time, from its artifact's `metrics`. A column that cannot
    be computed is absent."""
    metrics = metrics or {}
    rev = metrics.get(SERIES["rev_accel_q"])
    eps = metrics.get(SERIES["eps_streak_25"])
    out = {
        "rev_accel_q": revenue_acceleration(rev, ref_ts, ref_day),
        "eps_streak_25": eps_streak(eps, ref_ts, ref_day),
        "net_margin_chg_1y": year_ago_change(metrics.get(SERIES["net_margin_chg_1y"]), ref_ts, ref_day),
        "gross_margin_chg_1y": year_ago_change(metrics.get(SERIES["gross_margin_chg_1y"]), ref_ts, ref_day),
        "shares_chg_1y": shares_change(metrics.get(SERIES["shares_chg_1y"]), ref_ts, ref_day),
        # One literal key per window (EPS_MIN_WINDOWS; a test pins the two together), so the
        # screener's writer census reads each column's writer off this dict.
        "eps_growth_min_2q": eps_min_growth(eps, ref_ts, ref_day, 2),
        "eps_growth_min_3q": eps_min_growth(eps, ref_ts, ref_day, 3),
        "eps_growth_min_4q": eps_min_growth(eps, ref_ts, ref_day, 4),
    }
    return {k: v for k, v in out.items() if v is not None}


# ── the clock ───────────────────────────────────────────────────────────────────────────────────

def now_et() -> datetime:
    return datetime.now(ET)


def quiet(now: datetime) -> bool:
    """Weekends, and weekdays before 07:00 or from 20:15 New York time (`scan_period._reuse_quiet_now`'s span;
    a test pins the two together)."""
    now = now.astimezone(ET)
    if now.weekday() >= 5:
        return True
    hm = now.hour * 60 + now.minute
    return hm < QUIET_HOURS_ET[0] or hm >= QUIET_HOURS_ET[1]


def evening_key(now: datetime) -> str:
    """The newest trading session whose evening (`REBUILD_AT_ET`) has begun at `now`, as an ISO date."""
    from api.services.session_calendar import is_trading_day
    now = now.astimezone(ET)
    d = now.date()
    at = now.replace(hour=REBUILD_AT_ET[0], minute=REBUILD_AT_ET[1], second=0, microsecond=0)
    if not (is_trading_day(d) and now >= at):
        d -= timedelta(days=1)
        while not is_trading_day(d):
            d -= timedelta(days=1)
    return d.isoformat()


def reference(evening: str) -> tuple:
    """(the evening's session day, unix seconds of its 16:00 ET close): a filing counts only if public by then.
    The store's own close (`asof.close_utc`), the time its charts project a daily bar's value at."""
    from api.services.fundamentals_pit.asof import close_utc
    day = date.fromisoformat(evening)
    return day, close_utc(day).timestamp()


def lag_sessions(evening, settled: Optional[date]) -> Optional[int]:
    """Trading sessions after `evening` up to and including `settled`, counting stops past `MAX_LAG_SESSIONS`;
    None when either is unknown or the exchange calendar does not cover the span."""
    if settled is None:
        return None
    start = _day(evening)
    if start is None:
        return None
    from api.services import session_calendar as sc
    n, d = 0, start
    while d < settled and n <= MAX_LAG_SESSIONS:
        d += timedelta(days=1)
        if not sc.covers(d):
            return None
        if sc.is_trading_day(d):
            n += 1
    return n


# ── the reads (each indirected so tests replace it) ─────────────────────────────────────────────

def pit_on() -> bool:
    """The switch the point-in-time routes answer behind (api/routers/fundamentals_pit.py `_enabled`)."""
    return os.environ.get("FUNDAMENTALS_PIT_ENABLED", "0") == "1"


def _universe() -> list:
    from api.services.screener import screener_universe
    return list(screener_universe.symbols())


def _spellings(sym: str) -> tuple:
    s = str(sym).upper()
    return tuple(dict.fromkeys((s, s.replace(".", "-"), s.replace("-", "."))))


def artifact_reader() -> tuple:
    """(read(symbol) -> (artifact | None, found), close(), source tag). The store the series route reads, through
    its own source selection, WITHOUT its per-company cache (the `group_stats` read, PR #2417): each artifact is
    fetched and parsed once and held by nobody after the caller drops it.
    ⚠️ COUPLING, stated: `serving._mode`, `serving._read_key`, `serving._db_conn` and the publish keys
    (`publish.key_for`, `v5_publish.obj_key`); tests/test_screener_fund_trends.py fails by name if one is renamed."""
    from api.services.fundamentals_pit import publish as P
    from api.services.fundamentals_pit import serving as SV
    source = SV.current_source()
    conn = SV._db_conn() if SV._mode() == "db" else None

    def read(sym: str) -> tuple:
        cik = None
        for s in _spellings(sym):
            cik = source.cik_for(s)
            if cik is not None:
                break
        if cik is None:
            return None, False
        if conn is not None:
            return P.artifact(conn, cik, source.version), True
        if source.kind == "v4":
            raw = SV._read_key(P.key_for(cik, source.version))
        else:
            from api.services.fundamentals_pit import v5_publish as VP
            sha = source.object_sha(cik)
            raw = SV._read_key(VP.obj_key(sha)) if sha else None
        return (json.loads(raw) if raw else None), True

    def close() -> None:
        if conn is not None:
            conn.close()

    return read, close, source.tag()


# ── the evening build ───────────────────────────────────────────────────────────────────────────

def build(evening: str, *, symbols: Optional[list] = None, read: Optional[Callable] = None,
          pause: Callable[[float], None] = time.sleep, yield_s: Optional[float] = None,
          source_tag: Optional[str] = None) -> tuple:
    """`(rows, receipt)`: `rows` is {SYMBOL: {column: value}} for every company with at least one value. Runs on
    the calling (scheduler) thread. `read(symbol) -> (artifact | None, found)`."""
    started, cpu0 = time.time(), time.process_time()
    ref_day, ref_ts = reference(evening)
    yield_s = YIELD_S if yield_s is None else yield_s
    symbols = [str(s).upper() for s in (symbols if symbols is not None else _universe())][:MAX_SYMBOLS]
    close_reader: Callable[[], None] = lambda: None
    if read is None:
        read, close_reader, source_tag = artifact_reader()
    counts = {"targets": len(symbols), "covered": 0, "read": 0, "no_artifact": 0, "read_failed": 0,
              "split_withheld": 0, "with_values": 0}
    filled = {c: 0 for c in COLUMNS}
    rows: dict = {}
    t_read = t_calc = 0.0
    try:
        for sym in symbols:
            t0 = time.process_time()
            failed = False
            try:
                art, found = read(sym)
            except Exception:  # noqa: BLE001 -- one company never stops the evening
                art, found, failed = None, True, True
                counts["read_failed"] += 1
            t_read += time.process_time() - t0
            if not found:
                continue
            counts["covered"] += 1
            metrics = art.get("metrics") if isinstance(art, dict) else None
            if not isinstance(metrics, dict):
                if not failed:
                    counts["no_artifact"] += 1
                pause(yield_s)
                continue
            counts["read"] += 1
            if art.get("withheld_split_sensitive"):
                counts["split_withheld"] += 1
            keep = {s: metrics.get(s) for s in SERIES_NEEDED if metrics.get(s)}
            del art, metrics
            t1 = time.process_time()
            vals = stock_trends(keep, ref_ts, ref_day)
            t_calc += time.process_time() - t1
            del keep
            if vals:
                rows[sym] = vals
                counts["with_values"] += 1
                for c in vals:
                    filled[c] += 1
            pause(yield_s)
    finally:
        close_reader()
    receipt = {"evening": evening, "reference_close": datetime.fromtimestamp(ref_ts, ET).isoformat(),
               "source": source_tag, **counts, "filled": filled,
               "seconds": round(time.time() - started, 2), "cpu_seconds": round(time.process_time() - cpu0, 3),
               "cpu_read_seconds": round(t_read, 3), "cpu_calc_seconds": round(t_calc, 3)}
    return rows, receipt


def _short(receipt: dict) -> Optional[str]:
    """Why an evening's answer must not replace the stored one, or None."""
    if not receipt.get("read"):
        return "no company's filings could be read"
    covered = receipt.get("covered") or 0
    if covered and receipt.get("read_failed", 0) > covered * MAX_FAIL_SHARE:
        return f"{receipt['read_failed']} reads failed of {covered} companies found"
    return None


# ── the side table ─────────────────────────────────────────────────────────────────────────────

def _coldef(c: str) -> str:
    return f"{c} {'INTEGER' if c in INT_COLUMNS else 'REAL'}"


_SQL = (f"CREATE TABLE IF NOT EXISTS {TABLE} (ticker TEXT PRIMARY KEY, evening TEXT NOT NULL, "
        + ", ".join(_coldef(c) for c in COLUMNS) + ") WITHOUT ROWID")
_RUNS_SQL = (f"CREATE TABLE IF NOT EXISTS {RUNS_TABLE} (id INTEGER PRIMARY KEY AUTOINCREMENT, evening TEXT, "
             "started_at REAL, finished_at REAL, stored INTEGER, receipt TEXT)")


def ensure_schema(conn) -> None:
    conn.execute(_SQL)
    conn.execute(_RUNS_SQL)


def _connect():
    from api.services.screener import snapshot_db
    return snapshot_db.connect()


def store(evening: str, rows: dict, receipt: dict, stored: bool) -> None:
    """Record the run; when `stored`, replace the whole table with this evening's rows in ONE transaction (a
    company no longer covered loses its old values with it)."""
    with closing(_connect()) as conn:
        ensure_schema(conn)
        with conn:
            if stored:
                conn.execute(f"DELETE FROM {TABLE}")
                cols = ("ticker", "evening", *COLUMNS)
                conn.executemany(
                    f"INSERT INTO {TABLE} ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})",
                    [(t, evening, *(v.get(c) for c in COLUMNS)) for t, v in sorted(rows.items())])
            conn.execute(f"INSERT INTO {RUNS_TABLE} (evening, started_at, finished_at, stored, receipt) "
                         "VALUES (?, ?, ?, ?, ?)",
                         (evening, receipt.get("started_at"), receipt.get("finished_at"), 1 if stored else 0,
                          json.dumps(receipt, sort_keys=True, default=str)))
            conn.execute(f"DELETE FROM {RUNS_TABLE} WHERE id NOT IN (SELECT id FROM {RUNS_TABLE} "
                         "ORDER BY id DESC LIMIT ?)", (RUNS_KEEP,))


def stored_evening() -> Optional[str]:
    """The evening the table holds, or None (no table, or nothing stored yet)."""
    try:
        with closing(_connect()) as conn:
            row = conn.execute(f"SELECT evening FROM {RUNS_TABLE} WHERE stored = 1 "
                               "ORDER BY id DESC LIMIT 1").fetchone()
    except Exception:  # noqa: BLE001 -- no table yet is "nothing stored"
        return None
    return row[0] if row else None


def last_run() -> Optional[dict]:
    """The newest run's receipt (stored or not), or None."""
    try:
        with closing(_connect()) as conn:
            row = conn.execute(f"SELECT receipt, stored FROM {RUNS_TABLE} ORDER BY id DESC LIMIT 1").fetchone()
    except Exception:  # noqa: BLE001
        return None
    if not row:
        return None
    try:
        out = json.loads(row[0])
    except (TypeError, ValueError):
        out = {}
    out["stored"] = bool(row[1])
    return out


# ── the job ─────────────────────────────────────────────────────────────────────────────────────

def run_evening(now: Optional[datetime] = None, **build_kw) -> dict:
    """One evening's run, or why none ran. Never on a member's request: the scheduler's ticks call it."""
    now = now or now_et()
    if not pit_on():
        return {"skipped": "off"}
    if not quiet(now):
        return {"skipped": "not_quiet"}
    evening = evening_key(now)
    if stored_evening() == evening:
        return {"skipped": "stored", "evening": evening}
    if _tries.get(evening, 0) >= TRIES_PER_EVENING:
        return {"skipped": "tries_spent", "evening": evening}
    if not _lock.acquire(blocking=False):
        return {"skipped": "running", "evening": evening}
    try:
        _tries[evening] = _tries.get(evening, 0) + 1
        started = time.time()
        rows, receipt = build(evening, **build_kw)
        why = _short(receipt)
        receipt.update(started_at=started, finished_at=time.time(), rows=len(rows), not_stored=why)
        store(evening, rows, receipt, stored=why is None)
        line = log_text(receipt)
        (log.warning if why else log.info)("%s %s", LOG_PREFIX, line)
        return receipt
    finally:
        _lock.release()


def scheduled_run() -> None:
    """The scheduler's tick (api/main.py `screener_fund_trends_evening`). Never raises."""
    try:
        out = run_evening()
        if out.get("skipped") not in (None, "off", "not_quiet", "stored"):
            log.info("%s skipped: %s", LOG_PREFIX, out)
    except Exception as e:  # noqa: BLE001
        log.warning("%s run failed: %s: %s", LOG_PREFIX, type(e).__name__, e)


def log_text(receipt: dict) -> str:
    """The one line per run: counts and times only, never a ticker."""
    filled = receipt.get("filled") or {}
    stored = f"no ({receipt['not_stored']})" if receipt.get("not_stored") else "yes"
    return (f"evening={receipt.get('evening')} source={receipt.get('source')} targets={receipt.get('targets')} "
            f"covered={receipt.get('covered')} read={receipt.get('read')} failed={receipt.get('read_failed')} "
            f"no_artifact={receipt.get('no_artifact')} split_withheld={receipt.get('split_withheld')} "
            f"rows={receipt.get('rows')} stored={stored} | "
            + " ".join(f"{c}={filled.get(c, 0)}" for c in COLUMNS)
            + f" | seconds={receipt.get('seconds')} cpu={receipt.get('cpu_seconds')}")


# ── the build's reader (ONE read per build, `snapshot_builder._read_market_source`) ─────────────

def _note(failures, outcome: str, n: int = 1) -> None:
    if failures is None:
        return
    failures.setdefault("fund_trends", {})
    failures["fund_trends"][outcome] = failures["fund_trends"].get(outcome, 0) + n


def read_fields(targets, failures=None, *, settled: Optional[date] = None, receipt: Optional[dict] = None) -> dict:
    """{TICKER: {column: value}} from the stored evening, with PER-COLUMN presence (an absent key = NULL).

    `receipt`, when a dict is passed, is filled with: state ('served' | 'off' | 'missing' | 'empty' |
    'withheld_stale'), the evening served, its lag in sessions behind `settled`, the rows held and how many of
    `targets` matched. `failures` counts a missing table once and a withheld evening by its rows."""
    said = {"state": None, "evening": None, "lag_sessions": None, "rows": 0, "matched": 0}

    def done(state: str, out: dict) -> dict:
        said["state"] = state
        if receipt is not None:
            receipt.clear()
            receipt.update(said)
        return out

    if not pit_on():
        return done("off", {})
    try:
        with closing(_connect()) as conn:
            got = conn.execute(f"SELECT * FROM {TABLE}").fetchall()
    except Exception:  # noqa: BLE001 -- no table before the first evening
        _note(failures, "missing")
        return done("missing", {})
    if not got:
        return done("empty", {})
    held = {}
    for r in got:
        d = dict(r)
        said["evening"] = max(said["evening"] or "", d.get("evening") or "") or None
        held[str(d["ticker"]).upper()] = {c: d.get(c) for c in COLUMNS if d.get(c) is not None}
    said["rows"] = len(held)
    lag = lag_sessions(said["evening"], settled)
    said["lag_sessions"] = lag
    if lag is not None and lag > MAX_LAG_SESSIONS:
        _note(failures, "withheld_stale", len(held))
        log.warning("%s evening %s is %s+ sessions behind %s; %s rows withheld",
                    LOG_PREFIX, said["evening"], lag, settled, len(held))
        return done("withheld_stale", {})
    out = {}
    for t in targets or ():
        T = str(t).upper()
        vals = held.get(T)
        if vals:
            out[T] = dict(vals)
    said["matched"] = len(out)
    return done("served", out)


def reset_for_tests() -> None:
    _tries.clear()
