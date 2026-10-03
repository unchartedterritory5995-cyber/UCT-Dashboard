"""COV-07 -- estimate history: how the consensus EPS / revenue estimate for each
upcoming fiscal quarter has moved, day by day. The Research > Estimate history tab.

Why our own snapshots. FMP's `/stable/historical-analyst-estimates` answered 404
on this plan (live probe 2026-10-02), and `/stable/analyst-estimates` returns
only TODAY's consensus. So the history is built here: a scheduled job reads the
current quarterly consensus for each tracked symbol once a day and appends it,
keyed (symbol, snapshot date, fiscal period end). History therefore begins on
the first snapshot and `covers_from` says so; it is never back-filled or
implied to be longer.

Honesty rules, each railed in tests/test_research_cov_05_07_09.py:
  * a revision is shown only once a period has n >= 2 snapshots; with one, the
    period says "collecting" and names the date it started;
  * every point names its source and snapshot date;
  * a day whose read failed is recorded in `estimate_run` and counted as a gap,
    never silently skipped;
  * a symbol with no snapshot is `collecting` with the reason, never an empty table.

Request path: reads the local SQLite store only (plus registering the symbol as
tracked, a local write). No vendor call. DARK behind ESTIMATE_HISTORY_ENABLED:
unset, the route 404s and the daily job does nothing.
"""
from __future__ import annotations

import contextlib
import logging
import os
import sqlite3
import threading
import time
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable, Optional

_logger = logging.getLogger(__name__)

ENABLED_ENV = "ESTIMATE_HISTORY_ENABLED"
SOURCE = "FMP /stable/analyst-estimates (period=quarter), snapshotted daily by UCT"
MAX_SYMBOLS = int(os.environ.get("ESTIMATE_HISTORY_MAX_SYMBOLS", "600"))
PACE_S = float(os.environ.get("ESTIMATE_HISTORY_PACE_S", "1.0"))   # well under the FMP bucket
RUN_BUDGET_S = float(os.environ.get("ESTIMATE_HISTORY_RUN_BUDGET_S", "2700"))
LOOKBACK_DAYS = 95      # a quarter that ended this recently may not have reported yet
MAX_PERIODS = 4
FMP_LIMIT = 12
_WRITE_LOCK = threading.Lock()

_SCHEMA = """
CREATE TABLE IF NOT EXISTS estimate_snapshot (
  symbol      TEXT NOT NULL,
  snap_date   TEXT NOT NULL,
  period_end  TEXT NOT NULL,
  eps_avg     REAL, eps_low REAL, eps_high REAL,
  rev_avg     REAL, rev_low REAL, rev_high REAL,
  n_eps       INTEGER, n_rev INTEGER,
  fetched_at  INTEGER NOT NULL,
  PRIMARY KEY (symbol, snap_date, period_end)
);
CREATE TABLE IF NOT EXISTS estimate_run (
  symbol     TEXT NOT NULL,
  snap_date  TEXT NOT NULL,
  status     TEXT NOT NULL,
  detail     TEXT,
  at         INTEGER NOT NULL,
  PRIMARY KEY (symbol, snap_date)
);
CREATE TABLE IF NOT EXISTS estimate_tracked (
  symbol    TEXT PRIMARY KEY,
  added_at  INTEGER NOT NULL,
  origin    TEXT NOT NULL
);
"""


def is_enabled() -> bool:
    return os.environ.get(ENABLED_ENV, "").strip() == "1"


def db_path() -> str:
    return os.environ.get("ESTIMATE_HISTORY_DB_PATH",
                          os.path.join(os.environ.get("DATA_DIR", "/data"), "estimate_history.db"))


@contextlib.contextmanager
def _conn():
    p = db_path()
    os.makedirs(os.path.dirname(p) or ".", exist_ok=True)
    c = sqlite3.connect(p, timeout=10)
    try:
        c.executescript(_SCHEMA)
        yield c
        c.commit()
    finally:
        c.close()


def _f(v: Any) -> Optional[float]:
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def _i(v: Any) -> Optional[int]:
    return int(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None


# ── tracking ────────────────────────────────────────────────────────────────

def track(sym: str, origin: str) -> bool:
    """Add a symbol to the daily snapshot universe. False when the universe is full."""
    with _WRITE_LOCK, _conn() as c:
        if c.execute("SELECT 1 FROM estimate_tracked WHERE symbol=?", (sym,)).fetchone():
            return True
        if c.execute("SELECT COUNT(*) FROM estimate_tracked").fetchone()[0] >= MAX_SYMBOLS:
            return False
        c.execute("INSERT INTO estimate_tracked VALUES (?,?,?)", (sym, int(time.time()), origin))
        return True


def tracked() -> list[str]:
    with _conn() as c:
        return [r[0] for r in c.execute("SELECT symbol FROM estimate_tracked ORDER BY added_at, symbol")]


# ── the daily snapshot ──────────────────────────────────────────────────────

def _fetch_fmp(sym: str) -> tuple[str, Any, Optional[str]]:
    from api.services import fmp_client
    try:
        res = fmp_client.get_analyst_estimates(sym, period="quarter", limit=FMP_LIMIT, timeout=15)
    except fmp_client.FMPNotFound:
        return "empty", [], "FMP returned no quarterly estimates"
    except Exception as exc:  # noqa: BLE001 -- recorded in estimate_run, never silent
        return "error", None, f"{type(exc).__name__}: {exc}"[:300]
    if res.degraded is not None:
        return "error", None, f"FMP endpoint degraded ({res.degraded})"
    return "ok", res.value, None


def snapshot_symbol(sym: str, snap_date: str, *, fetch: Optional[Callable] = None) -> str:
    """Read today's consensus for one symbol and append it. Returns the run status."""
    status, raw, detail = (fetch or _fetch_fmp)(sym)
    now = int(time.time())
    rows = []
    if status == "ok":
        for r in raw if isinstance(raw, list) else []:
            if not isinstance(r, dict) or not r.get("date"):
                continue
            rows.append((sym, snap_date, str(r["date"])[:10],
                         _f(r.get("epsAvg")), _f(r.get("epsLow")), _f(r.get("epsHigh")),
                         _f(r.get("revenueAvg")), _f(r.get("revenueLow")), _f(r.get("revenueHigh")),
                         _i(r.get("numAnalystsEps")), _i(r.get("numAnalystsRevenue")), now))
        if not rows:
            status, detail = "empty", "FMP answered with no dated rows"
    with _WRITE_LOCK, _conn() as c:
        c.executemany("INSERT OR REPLACE INTO estimate_snapshot VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", rows)
        c.execute("INSERT OR REPLACE INTO estimate_run VALUES (?,?,?,?,?)",
                  (sym, snap_date, status, detail, now))
    return status


def _seed_sp500() -> int:
    if os.environ.get("ESTIMATE_HISTORY_SEED_SP500", "1").strip() == "0":
        return 0
    from api.services import fmp_client
    try:
        res = fmp_client.get_sp500_constituents(timeout=15)
    except Exception as exc:  # noqa: BLE001
        _logger.warning("estimate_history: S&P 500 seed unavailable: %s", exc)
        return 0
    n = 0
    for r in res.value if isinstance(res.value, list) else []:
        s = (r.get("symbol") or "").upper().strip() if isinstance(r, dict) else ""
        if s and track(s, "sp500"):
            n += 1
    return n


def run_daily(*, today: Optional[date] = None, fetch: Optional[Callable] = None,
              sleep: Callable[[float], None] = time.sleep, seed: bool = True) -> dict:
    """The scheduled job. Idempotent per day: a symbol already read OK today is
    skipped. Bounded by MAX_SYMBOLS, PACE_S between vendor calls and RUN_BUDGET_S."""
    if not is_enabled():
        return {"skipped": "flag off"}
    snap_date = (today or datetime.now(timezone.utc).date()).isoformat()
    if seed:
        _seed_sp500()
    with _conn() as c:
        done = {r[0] for r in c.execute(
            "SELECT symbol FROM estimate_run WHERE snap_date=? AND status IN ('ok','empty')", (snap_date,))}
    started = time.monotonic()
    out = {"snap_date": snap_date, "ok": 0, "empty": 0, "error": 0, "skipped_done": 0, "budget_cut": 0}
    for i, sym in enumerate(tracked()[:MAX_SYMBOLS]):
        if sym in done:
            out["skipped_done"] += 1
            continue
        if time.monotonic() - started > RUN_BUDGET_S:
            out["budget_cut"] += 1
            continue
        out[snapshot_symbol(sym, snap_date, fetch=fetch)] += 1
        sleep(PACE_S)
    return out


# ── the read (request path) ─────────────────────────────────────────────────

def _change(a: Optional[float], b: Optional[float]) -> dict:
    if a is None or b is None:
        return {"abs": None, "pct": None}
    return {"abs": round(b - a, 6), "pct": round((b - a) / abs(a) * 100, 2) if a else None}


def history(sym: str, *, today: Optional[date] = None, register: bool = True) -> dict:
    sym = (sym or "").upper().strip()
    today = today or datetime.now(timezone.utc).date()
    tracked_ok = track(sym, "viewed") if register else True
    with _conn() as c:
        snaps = c.execute(
            "SELECT snap_date, period_end, eps_avg, eps_low, eps_high, rev_avg, rev_low, rev_high, n_eps, n_rev "
            "FROM estimate_snapshot WHERE symbol=? ORDER BY period_end, snap_date", (sym,)).fetchall()
        runs = c.execute("SELECT snap_date, status, detail FROM estimate_run WHERE symbol=? ORDER BY snap_date",
                         (sym,)).fetchall()
    base = {"ticker": sym, "source": SOURCE, "tracked": tracked_ok}
    gaps = [{"snap_date": d, "status": s, "detail": det} for d, s, det in runs if s == "error"]
    if not snaps:
        reason = ("not tracked: the daily snapshot universe is full" if not tracked_ok else
                  "no snapshot yet: the daily job adds one each evening, and history begins with the first")
        return {**base, "state": "collecting", "reason": reason, "covers_from": None,
                "snapshot_days": 0, "periods": [], "failed_days": gaps}
    dates = sorted({s[0] for s in snaps})
    floor = (today - timedelta(days=LOOKBACK_DAYS)).isoformat()
    by_period: dict[str, list] = {}
    for s in snaps:
        if s[1] >= floor:
            by_period.setdefault(s[1], []).append(s)
    periods = []
    for pe in sorted(by_period)[:MAX_PERIODS]:
        pts = [{"snap_date": s[0], "eps_avg": s[2], "eps_low": s[3], "eps_high": s[4],
                "rev_avg": s[5], "rev_low": s[6], "rev_high": s[7], "n_eps": s[8], "n_rev": s[9],
                "source": SOURCE} for s in by_period[pe]]
        p = {"period_end": pe, "n": len(pts), "first_snapshot": pts[0]["snap_date"], "points": pts}
        if len(pts) >= 2:
            p["state"] = "revisions"
            p["eps_change"] = _change(pts[0]["eps_avg"], pts[-1]["eps_avg"])
            p["rev_change"] = _change(pts[0]["rev_avg"], pts[-1]["rev_avg"])
        else:
            p["state"] = "collecting"
            p["reason"] = f"one snapshot so far ({pts[0]['snap_date']}); a revision needs two"
        periods.append(p)
    out = {**base, "state": "ok" if periods else "no_upcoming_periods", "covers_from": dates[0],
           "last_snapshot": dates[-1], "snapshot_days": len(dates), "periods": periods, "failed_days": gaps}
    if not periods:
        out["reason"] = "the snapshots hold no fiscal period ending after " + floor
    return out
