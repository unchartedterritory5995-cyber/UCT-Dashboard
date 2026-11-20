"""PRE-BUILT Breadth Monitor rows for the US / Nasdaq / NYSE universes.

The Monitor's universe switcher (UCT / U.S. stocks / Nasdaq / NYSE) must be INSTANT, so a
non-UCT Monitor row is never assembled while a member waits. This module owns a small
SQLite store of finished rows, one per (universe, session):

    umon_rows(universe, date, metrics JSON)      the Monitor row, per-universe columns only
    umon_meta(universe, build_version, source_token, built_at, mode, rows, first, last)

⭐ HOW A ROW IS BUILT (`build_rows`) — only from the canonical authorities, never from UCT:

  • the 35 V2 / Exchange metrics through `breadth_daily_ohlc.history(metric, universe=u)`, which
    already routes US → `breadth_authority` (V2 frozen + validated live), NYSE / Nasdaq →
    `breadth_exchange_authority` (fail closed), and overlays the intraday-basis new highs / lows
    (`breadth_nhnl_intraday`) and the 20 / 150-day SMA family (`breadth_ma_extra`);
  • McClellan (`mcclellan_osc`) and the A/D Line (`adv_decline_cum`) from the universe's own
    RATIO-ADJUSTED McClellan / adline-v1 series (US:MCO / US:AD via `market_indicators.producers`,
    NYSE:/NASDAQ: MCO / AD verbatim from the exchange authority) — a different calculation from
    UCT's raw-net-advances McClellan, and the UI says so;
  • a session exists only where the universe's base row does (`universe_count`), and never before
    the universe's published start (`START`) — an overlay alone can never create a row.

⛔ MARKET-WIDE COLUMNS ARE NOT STORED HERE. VIX, sentiment, the index closes / MA dots, UCT Exp,
distribution days, the ETF ratios and FTD describe the market, not a population; the Monitor
copies them from the UCT row of the same date at serve time (`breadth_monitor.
get_history_universe`), so they are identical across universes by construction.

⛔ NOT AVAILABLE YET for these universes (Phase 3): Up Vol, HVC, >7×ATR, ATH and the drill lists,
plus the UCT-calibrated Health score. They are simply absent here; the UI shows "n/a" / "—".

⭐ REFRESH. `kick_refresh()` runs in a background thread (never on a request): a universe whose
store is empty, or was built by an older `BUILD_VERSION`, is built in full; otherwise, when its
source token (the authority pointer + the overlay identities) has moved, the newest
`TAIL_SESSIONS` sessions are rebuilt from small-limit reads. It is kicked when a V2 publication or
an exchange pointer is adopted and when the overlays extend; `nightly()` rebuilds everything in
full so a historical revision can never hide in the store.
"""
from __future__ import annotations

import json
import math
import os
import sqlite3
import threading
import time
from pathlib import Path
from typing import Callable, Optional

#: The universes this store serves (UCT is the collector's own path and never lands here).
UNIVERSES = ("us", "nasdaq", "nyse")

#: The first session each universe publishes. US = the V2 artifact's start; NYSE / Nasdaq = the
#: Exchange Breadth V1 authority's (`breadth_exchange_authority.START`, venue-ledger membership).
START = {"us": "2008-01-02", "nasdaq": "2008-01-02", "nyse": "2009-06-11"}

#: Bump when the row shape or a build rule changes: every universe is then rebuilt in full.
BUILD_VERSION = 1

#: The per-universe metrics read from the canonical store (the V2 / Exchange 35 + the MA extras).
SOURCE_METRICS = (
    "adv_decline", "advancing", "declining", "down_20pct_5d", "down_25pct_month",
    "down_25pct_quarter", "down_4pct_today", "down_50pct_month", "hi_ratio", "lo_ratio",
    "magna_down", "magna_up", "near_52w_high", "net_new_high_low", "new_20d_highs",
    "new_20d_lows", "new_52w_highs", "new_52w_lows", "pct_above_100sma", "pct_above_10sma",
    "pct_above_200sma", "pct_above_20ema", "pct_above_40sma", "pct_above_50sma",
    "pct_above_5sma", "ratio_10day", "ratio_5day", "stage2_count", "stage4_count",
    "universe_count", "up_20pct_5d", "up_25pct_month", "up_25pct_quarter", "up_4pct_today",
    "up_50pct_month",
    "pct_above_20sma", "pct_above_150sma",
)

#: Monitor keys filled from the universe's own derived series (ratio-adjusted McClellan, A/D line).
DERIVED_KINDS = {"mcclellan_osc": "MCO", "adv_decline_cum": "AD"}

#: Monitor columns with no per-universe source yet. Never stored; the UI says "n/a".
UNAVAILABLE = ("up_vol_ratio", "hvc_52w", "atr_ext_7", "new_ath")

#: ⛔ Health is UCT-calibrated: hidden ("—") on every other universe until it is recalibrated.
HIDDEN = ("breadth_score",)

#: ⭐ MARKET-WIDE Monitor keys: copied from the UCT row of the same date, never per universe.
#: (`breadth_metrics` marks every one of these NOT_PORTABLE, or they are a price / index reading.)
MARKET_WIDE = (
    "vix", "cnn_fear_greed", "aaii_bulls", "aaii_neutral", "aaii_bears", "aaii_spread",
    "naaim", "cboe_putcall", "avg_10d_cpc",
    "sp500_close", "qqq_close", "spy_close", "spy_day_pct", "qqq_day_pct",
    "spy_above_10sma", "spy_above_20sma", "spy_above_50sma", "spy_above_200sma",
    "qqq_above_10sma", "qqq_above_20sma", "qqq_above_50sma", "qqq_above_200sma",
    "uct_exposure", "spy_dist_days", "qqq_dist_days",
    "rsp_spy_ratio", "iwm_qqq_ratio", "vix_term_structure",
    "is_ftd", "manual_ftd",
)
#: The as-of / provenance fields the market-wide columns' age labels read.
MARKET_WIDE_SUPPORT = ("aaii_survey_date", "naaim_date")

#: Sessions a tail refresh rebuilds (well inside the authorities' small-limit fast path).
TAIL_SESSIONS = 40
_TAIL_READ = 60

_DERIVED_ID = {"us": "US", "nasdaq": "NASDAQ", "nyse": "NYSE"}


def market_wide_keys(row: dict) -> list:
    """The market-wide keys present on a UCT row, including each one's `<key>_asof` stamp."""
    keys = [k for k in MARKET_WIDE if k in row]
    keys += [k for k in MARKET_WIDE_SUPPORT if k in row]
    keys += [k + "_asof" for k in MARKET_WIDE if (k + "_asof") in row]
    return keys


# ── the store ────────────────────────────────────────────────────────────────

def _db_path() -> str:
    override = os.environ.get("BREADTH_UNIVERSE_MONITOR_DB")
    if override:
        return override
    if os.path.exists("/data"):
        return "/data/breadth_universe_monitor.db"
    local = Path(__file__).parent.parent.parent / "data" / "breadth_universe_monitor.db"
    local.parent.mkdir(exist_ok=True)
    return str(local)


_SCHEMA = """
CREATE TABLE IF NOT EXISTS umon_rows (
    universe TEXT NOT NULL,
    date     TEXT NOT NULL,
    metrics  TEXT NOT NULL,
    PRIMARY KEY (universe, date)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS umon_meta (
    universe      TEXT PRIMARY KEY,
    build_version INTEGER NOT NULL,
    source_token  TEXT NOT NULL,
    built_at      TEXT NOT NULL,
    mode          TEXT NOT NULL,
    rows          INTEGER NOT NULL,
    first         TEXT,
    last          TEXT
);
"""

_INIT: dict = {"path": None}
_WRITE_LOCK = threading.Lock()


def _conn() -> sqlite3.Connection:
    p = _db_path()
    c = sqlite3.connect(p, timeout=10)
    c.execute("PRAGMA busy_timeout=5000")
    if _INIT["path"] != p:
        c.execute("PRAGMA journal_mode=WAL")
        c.executescript(_SCHEMA)
        _INIT["path"] = p
    return c


def _check(universe: str) -> str:
    u = str(universe or "").strip().lower()
    if u not in UNIVERSES:
        raise ValueError(f"not a pre-built Monitor universe: {universe!r}")
    return u


def meta(universe: str) -> Optional[dict]:
    u = _check(universe)
    with _conn() as c:
        r = c.execute("SELECT build_version, source_token, built_at, mode, rows, first, last "
                      "FROM umon_meta WHERE universe=?", (u,)).fetchone()
    if not r:
        return None
    return dict(zip(("build_version", "source_token", "built_at", "mode", "rows", "first", "last"), r))


def write_rows(universe: str, rows: dict, *, source_token: str, mode: str = "full",
               replace: bool = True) -> dict:
    """Store `{date: metrics}` for one universe in ONE transaction. `replace` drops the universe's
    other rows (a full build); otherwise rows are upserted and rows inside the rebuilt span that
    the source no longer has are removed (a tail build)."""
    u = _check(universe)
    clean = {d: m for d, m in rows.items() if d >= START[u]}
    payload = [(u, d, json.dumps(m, separators=(",", ":"), allow_nan=False)) for d, m in sorted(clean.items())]
    with _WRITE_LOCK, _conn() as c:
        if replace:
            c.execute("DELETE FROM umon_rows WHERE universe=?", (u,))
        elif clean:
            lo = min(clean)
            c.execute("DELETE FROM umon_rows WHERE universe=? AND date>=? AND date NOT IN (%s)"
                      % ",".join("?" * len(clean)), (u, lo, *sorted(clean)))
        c.executemany("INSERT OR REPLACE INTO umon_rows (universe, date, metrics) VALUES (?,?,?)", payload)
        n, first, last = c.execute("SELECT COUNT(*), MIN(date), MAX(date) FROM umon_rows WHERE universe=?",
                                   (u,)).fetchone()
        c.execute("INSERT OR REPLACE INTO umon_meta (universe, build_version, source_token, built_at, mode,"
                  " rows, first, last) VALUES (?,?,?,?,?,?,?,?)",
                  (u, BUILD_VERSION, source_token, time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                   mode, n, first, last))
    _VIEW.pop(u, None)
    return {"universe": u, "mode": mode, "written": len(payload), "rows": n, "first": first, "last": last}


# ── the served view (request path: READS ONLY) ──────────────────────────────

_VIEW: dict = {}
_VIEW_LOCK = threading.Lock()


def _view(universe: str) -> dict:
    """{dates: [asc], version: str} for one universe, memoised on the store's meta row."""
    u = _check(universe)
    try:
        m = meta(u)
    except Exception:
        m = None
    ver = f"{m['built_at']}:{m['rows']}:{m['source_token']}" if m else "empty"
    hit = _VIEW.get(u)
    if hit and hit["version"] == ver:
        return hit
    with _VIEW_LOCK:
        dates: list = []
        if m:
            with _conn() as c:
                dates = [r[0] for r in c.execute(
                    "SELECT date FROM umon_rows WHERE universe=? ORDER BY date ASC", (u,))]
        hit = {"version": ver, "dates": dates, "meta": m}
        _VIEW[u] = hit
    return hit


def dates(universe: str) -> list:
    """Every stored session for the universe, oldest first."""
    return list(_view(universe)["dates"])


def version(universe: str) -> str:
    """The store identity for one universe — moves on every build (cache keys)."""
    return _view(universe)["version"]


def rows_for_dates(universe: str, want: list) -> dict:
    """`{date: metrics}` for the requested dates (missing dates are simply absent)."""
    u = _check(universe)
    out: dict = {}
    want = list(want)
    with _conn() as c:
        for i in range(0, len(want), 400):
            chunk = want[i:i + 400]
            for d, mj in c.execute("SELECT date, metrics FROM umon_rows WHERE universe=? AND date IN (%s)"
                                   % ",".join("?" * len(chunk)), (u, *chunk)):
                out[d] = json.loads(mj)
    return out


def available(universe: str) -> bool:
    return bool(_view(universe)["dates"])


# ── the builder (background only) ────────────────────────────────────────────

def _finite(v):
    if v is None or isinstance(v, bool):
        return None
    if isinstance(v, int):
        return v
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def _default_history(metric: str, limit: int, universe: str) -> dict:
    from api.services import breadth_daily_ohlc as bdo
    return bdo.history(metric, limit=limit, universe=universe) or {}


def _default_derived(universe: str, kind: str) -> dict:
    """{date: value} of the universe's own McClellan ("MCO") or A/D line ("AD")."""
    sid = f"{_DERIVED_ID[universe]}:{kind}"
    if universe in ("nyse", "nasdaq"):
        from api.services import breadth_exchange_authority as ea
        return ea.derived(sid) or {}
    from api.services.market_indicators import producers
    ds = producers.build(sid)
    if ds is None:
        return {}
    return {d: v for d, v in zip(ds.dates, ds.values) if v is not None}


def build_rows(universe: str, *, limit: int = 8000, since: str = "",
               history: Optional[Callable] = None, derived: Optional[Callable] = None) -> dict:
    """`{date: metrics}` for one universe — canonical sources only (see the module header).

    `history(metric, limit, universe)` / `derived(universe, kind)` are injectable for tests."""
    u = _check(universe)
    history = history or _default_history
    derived = derived or _default_derived
    floor = max(START[u], since or "")
    cols: dict = {}
    for m in SOURCE_METRICS:
        h = history(m, limit, u) or {}
        for d, r in h.items():
            v = _finite((r or {}).get("c"))
            if v is not None and d >= floor:
                cols.setdefault(d, {})[m] = v
    # a session is a date the universe's BASE row has; an overlay alone never creates one
    rows = {d: r for d, r in cols.items() if r.get("universe_count") is not None}
    for key, kind in DERIVED_KINDS.items():
        try:
            series = derived(u, kind) or {}
        except Exception as e:  # noqa: BLE001
            print(f"[breadth_universe_monitor] {u} {kind} unavailable: {type(e).__name__}: {e}", flush=True)
            series = {}
        for d, r in rows.items():
            v = _finite(series.get(d))
            if v is not None:
                r[key] = v
    return rows


def source_token(universe: str) -> str:
    """The identity of everything a universe's rows are built from. Moves when an authority
    adopts a publication / pointer or an overlay series extends."""
    u = _check(universe)
    parts = [f"b{BUILD_VERSION}"]
    try:
        if u == "us":
            from api.services import breadth_authority as ba
            parts.append(ba.token())
        else:
            from api.services import breadth_exchange_authority as ea
            parts.append(ea.token())
    except Exception:
        parts.append("auth?")
    for mod in ("breadth_nhnl_intraday", "breadth_ma_extra"):
        try:
            m = __import__(f"api.services.{mod}", fromlist=["token"])
            parts.append(m.token())
        except Exception:
            parts.append(f"{mod}?")
    return "|".join(parts)


def _sources_ready(universe: str) -> bool:
    try:
        if universe == "us":
            from api.services import breadth_authority as ba
            return bool(ba.serves("us") and ba.available()[0])
        from api.services import breadth_exchange_authority as ea
        return bool(ea.serves(universe))
    except Exception:
        return False


def build(universe: str, *, full: bool = True) -> dict:
    """Build (full) or tail-refresh one universe's rows into the store."""
    u = _check(universe)
    token = source_token(u)
    if full:
        rows = build_rows(u)
        if not rows:
            return {"universe": u, "mode": "full", "skipped": "no source rows"}
        return write_rows(u, rows, source_token=token, mode="full", replace=True)
    have = dates(u)
    since = have[-TAIL_SESSIONS] if len(have) >= TAIL_SESSIONS else (have[0] if have else "")
    rows = build_rows(u, limit=_TAIL_READ, since=since)
    if not rows:
        return {"universe": u, "mode": "tail", "skipped": "no source rows"}
    return write_rows(u, rows, source_token=token, mode="tail", replace=False)


def refresh(universe: str) -> dict:
    """Bring one universe's store up to its sources. Never raises."""
    u = _check(universe)
    try:
        if not _sources_ready(u):
            return {"universe": u, "skipped": "sources not served"}
        m = meta(u)
        if not m or m["build_version"] != BUILD_VERSION or not m["rows"]:
            return build(u, full=True)
        if m["source_token"] == source_token(u):
            return {"universe": u, "skipped": "current"}
        return build(u, full=False)
    except Exception as e:  # noqa: BLE001
        return {"universe": u, "error": f"{type(e).__name__}: {e}"}


_JOB: dict = {"running": False, "last": None, "at": None, "pending": set(), "pending_full": False}
_JOB_LOCK = threading.Lock()


def _run(universes, full: bool) -> None:
    while True:
        res = {}
        try:
            for u in universes:
                res[u] = (build(u, full=True) if (full and _sources_ready(u)) else refresh(u))
        except Exception as e:  # noqa: BLE001
            res["error"] = f"{type(e).__name__}: {e}"
        # ⭐ No cache wipe: every non-UCT Monitor cache key carries `version(u)`, which this build
        # just moved, so the next read is a new key. UCT's caches are untouched.
        print(f"[breadth_universe_monitor] {'full' if full else 'refresh'}: {res}", flush=True)
        with _JOB_LOCK:
            _JOB.update(last=res, at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
            if not _JOB["pending"]:
                _JOB["running"] = False
                return
            # a kick that arrived while this ran: run it now rather than dropping it
            universes = tuple(u for u in UNIVERSES if u in _JOB["pending"])
            full = _JOB["pending_full"]
            _JOB.update(pending=set(), pending_full=False)


def kick_refresh(universes=UNIVERSES, *, full: bool = False) -> bool:
    """Start ONE background refresh (or full rebuild). A kick while one runs is queued and runs
    right after it — never dropped, never concurrent. Never on a request."""
    with _JOB_LOCK:
        if _JOB["running"]:
            _JOB["pending"] |= set(universes)
            _JOB["pending_full"] = _JOB["pending_full"] or full
            return False
        _JOB["running"] = True
    threading.Thread(target=_run, args=(tuple(universes), full), daemon=True,
                     name="breadth_universe_monitor").start()
    return True


def nightly() -> bool:
    """The nightly full rebuild (scheduler)."""
    return kick_refresh(UNIVERSES, full=True)


def status() -> dict:
    job = {k: (sorted(v) if isinstance(v, set) else v) for k, v in _JOB.items()}
    out = {"build_version": BUILD_VERSION, "job": job, "universes": {}}
    for u in UNIVERSES:
        try:
            out["universes"][u] = meta(u)
        except Exception as e:  # noqa: BLE001
            out["universes"][u] = {"error": type(e).__name__}
    return out
