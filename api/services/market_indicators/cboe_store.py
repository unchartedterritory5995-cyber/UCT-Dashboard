"""CBOE VOLATILITY INDICES — the authoritative EOD source, stored locally.

⭐⭐ THIS IS A SOURCE UPGRADE, NOT A SECOND CHART ENGINE. The chart, the pane, the
drawing tools and the discovery UI are all unchanged; what changes is where the numbers
come from and how deep they go. Today `/api/bars/VIX` reaches yfinance through
`api/index_bars.py`, is capped at FIVE YEARS of daily history, serves VIX alone, and
emits `t` as unix seconds — which is why an index added as a second series into a pane
matches zero bars (`engine/symbolProjection.js` joins on exact `t`, and every other
family emits `"YYYY-MM-DD"`). Cboe publish the same indices themselves, with real OHLC,
back to 1990 for VIX and 2006 for VVIX.

⛔⛔ THE SERVE PATH NEVER CALLS CBOE. Ingestion is an explicit tool
(`tools/build_cboe_indices.py`) writing this store; a chart request reads SQLite and
nothing else. A request path that can block on somebody else's CDN is the
unbounded-external-call failure the launch-hardening pass spent a day removing, and
there is no reason to reintroduce it for a series that changes once a day.

⛔ AND `t` IS AN ISO DAY STRING HERE, deliberately matching equities and breadth rather
than `index_bars`' unix seconds. That is what lets a Cboe series compose in a pane with
everything else — it is half the reason this lane exists.

⚠️ LICENSING. These files are published on Cboe's public site for site visitors and are
subject to Cboe website terms. EOD historical index values are widely redisplayed, but
commercial redisplay should be confirmed with Cboe; the real-time Global Indices Feed is
separately licensed and its redistribution is prohibited. This lane is EOD only, by
construction — there is no intraday path in this module and none should be added
without that conversation.
"""
from __future__ import annotations

import contextlib
import logging
import math
import os
import sqlite3
import threading
from typing import Optional

_log = logging.getLogger("market_indicators.cboe")
_WRITE_LOCK = threading.Lock()

#: The one URL shape. A symbol is substituted; nothing else varies.
CSV_URL = "https://cdn.cboe.com/api/global/us_indices/daily_prices/{sym}_History.csv"

#: Symbols this lane knows how to ingest. ⛔ Membership is a registry question, not a
#: loader question — `registry.py` decides what is PUBLISHED; this is only what the
#: builder will try to fetch, and it is deliberately the superset.
KNOWN_SYMBOLS = ("VIX", "VIX9D", "VIX1D", "VIX3M", "VIX6M", "VVIX",
                 "VXN", "RVX", "SKEW", "GVZ", "OVX", "VXTLT", "VXEEM", "VXEFA")


def _db_path() -> str:
    override = os.environ.get("CBOE_INDICES_DB")
    if override:
        return override
    if os.path.exists("/data"):
        return "/data/cboe_indices.db"
    local = os.path.join(os.path.dirname(__file__), "..", "..", "..",
                         "data", "cboe_indices.db")
    os.makedirs(os.path.dirname(local), exist_ok=True)
    return local


@contextlib.contextmanager
def _conn():
    c = sqlite3.connect(_db_path(), timeout=5.0)
    try:
        c.execute("PRAGMA journal_mode=WAL")
        c.execute("PRAGMA busy_timeout=3000")
        yield c
        c.commit()
    finally:
        c.close()


_INIT_DONE = False


def _ensure_init() -> None:
    global _INIT_DONE
    if _INIT_DONE:
        return
    with _WRITE_LOCK:
        if _INIT_DONE:
            return
        with _conn() as c:
            c.execute("""
                CREATE TABLE IF NOT EXISTS cboe_index_bars (
                    symbol TEXT NOT NULL,
                    date   TEXT NOT NULL,          -- 'YYYY-MM-DD', NOT unix seconds
                    o REAL, h REAL, l REAL, c REAL,
                    updated_at TEXT DEFAULT (datetime('now')),
                    PRIMARY KEY (symbol, date)
                )""")
            c.execute("CREATE INDEX IF NOT EXISTS idx_cboe_sym_date "
                      "ON cboe_index_bars(symbol, date)")
        _INIT_DONE = True


def _f(v) -> Optional[float]:
    try:
        x = float(v)
        return x if math.isfinite(x) else None
    except (TypeError, ValueError):
        return None


def parse_csv(text: str) -> tuple[list[dict], bool]:
    """Cboe's daily-price CSV → `([{date, o, h, l, c}], has_real_ohlc)`, oldest first.

    ⛔⛔ CBOE PUBLISHES TWO DIFFERENT SHAPES AND THE DIFFERENCE IS NOT COSMETIC.
    `VIX_History.csv` is `DATE,OPEN,HIGH,LOW,CLOSE`; `VVIX_History.csv` and
    `SKEW_History.csv` are `DATE,<SYM>` — one close per session and nothing else.
    A parser that assumed five columns silently returned ZERO ROWS for the close-only
    families (measured: VVIX and SKEW both ingested 0 while reporting success), and a
    parser that assumed two would have thrown away VIX's real high and low.

    ⭐ SO THE SHAPE IS DETECTED AND RETURNED, because it decides something a member can
    see: only a series with a genuine open, high and low may be drawn as CANDLES. A
    close-only series synthesised into `o=h=l=c` passes every structural test there is
    and renders a tidy candlestick whose body and range mean nothing — which is exactly
    the trap `engine/ohlcCapability.js` was written for.

    ⚠️ CBOE'S DATE COLUMN IS `M/D/YYYY`, NOT ISO, and older files pad it to
    `MM/DD/YYYY`. Parsed by split rather than fixed width so a 1990 row and a 2026 row
    take the same path.
    """
    import csv as _csv
    import io as _io
    out = []
    has_ohlc = False
    rdr = _csv.reader(_io.StringIO(text))
    for row in rdr:
        if not row or len(row) < 2:
            continue
        raw = (row[0] or "").strip()
        if not raw or not raw[0].isdigit():
            continue                                   # header / preamble
        parts = raw.split("/")
        if len(parts) != 3:
            continue
        try:
            m, d, y = int(parts[0]), int(parts[1]), int(parts[2])
            date = f"{y:04d}-{m:02d}-{d:02d}"
        except ValueError:
            continue

        if len(row) >= 5:
            o, h, l, c = (_f(row[1]), _f(row[2]), _f(row[3]), _f(row[4]))
            if c is None or c <= 0:
                continue
            # ⚠️ Cboe's earliest VIX rows carry 0 for open/high/low — those are absent
            # values, not prints. Fall back to the close so the bar is an honest body
            # rather than a candle with a fabricated wick down to zero.
            if all(x is not None and x > 0 for x in (o, h, l)):
                has_ohlc = True
            else:
                o = h = l = c
        else:
            c = _f(row[1])
            if c is None or c <= 0:
                continue
            o = h = l = c
        if not (h >= max(o, c) and l <= min(o, c)):
            continue                                   # inverted bar: refuse it
        out.append({"date": date, "o": o, "h": h, "l": l, "c": c})
    out.sort(key=lambda r: r["date"])
    return out, has_ohlc


def upsert(symbol: str, bars: list[dict]) -> int:
    _ensure_init()
    sym = (symbol or "").strip().upper()
    if not sym or not bars:
        return 0
    with _WRITE_LOCK:
        with _conn() as c:
            c.executemany(
                "INSERT INTO cboe_index_bars(symbol, date, o, h, l, c, updated_at) "
                "VALUES(?,?,?,?,?,?, datetime('now')) "
                "ON CONFLICT(symbol, date) DO UPDATE SET "
                "o=excluded.o, h=excluded.h, l=excluded.l, c=excluded.c, "
                "updated_at=datetime('now')",
                [(sym, b["date"], b["o"], b["h"], b["l"], b["c"]) for b in bars])
    return len(bars)


def bars(symbol: str, limit: int = 20000) -> list[dict]:
    """`[{t, o, h, l, c, v}]` oldest first, `t` an ISO day. Empty when unknown.

    `v` is 0 because a volatility index has no volume — present so the bar shape
    matches every other series the chart consumes rather than special-casing it.
    """
    _ensure_init()
    sym = (symbol or "").strip().upper()
    if not sym:
        return []
    try:
        with _conn() as c:
            rows = c.execute(
                "SELECT date, o, h, l, c FROM cboe_index_bars WHERE symbol=? "
                "ORDER BY date ASC LIMIT ?", (sym, int(limit))).fetchall()
    except Exception:
        return []
    return [{"t": r[0], "o": r[1], "h": r[2], "l": r[3], "c": r[4], "v": 0}
            for r in rows]


def coverage() -> dict:
    _ensure_init()
    try:
        with _conn() as c:
            return {r[0]: {"rows": r[1], "first": r[2], "last": r[3]}
                    for r in c.execute(
                        "SELECT symbol, COUNT(*), MIN(date), MAX(date) "
                        "FROM cboe_index_bars GROUP BY symbol")}
    except Exception:
        return {}
