"""THE HALF-DAY GAP: an early close's 13:01-15:59 ET minutes, rebuilt from the vendor's trades (2026-11-26).

⚰️ On every NYSE half day the store held no intraday row between 13:01 and 15:59 ET, at every timeframe (SPY 2025-11-28
1m: ..12:59, 13:00, then 16:00..), while TradingView draws trades there. The vendor's minute aggregates price a Form T
(condition 12) trade only before 09:30 and after 16:00 ET, by the clock (Massive knowledge base, "Does a Form T trade
update a pre-market minute bar's high, low, open and close?"). After a 13:00 close every print until 16:00 is Form T, so
those minutes get no aggregate at all: not in the history API, not in the AM stream. Our live trade fold never filters
the session codes 12/13 (`trade_conditions._SESSION_CODES`), so a live chart drew them and lost them on the next read.

THE REBUILD. For a half day, the vendor's trades of [13:01, 16:00) ET are folded per minute exactly as the live fold
folds them (`trade_conditions.classify3`; Form T price-eligible), and written ADD-ONLY (`bars_sqlite.AddOnlyBar`: a
vendor row is never replaced):
  * 1m, where the store holds that ticker's 1m for the day;
  * 5m from those minutes (`bars_fetch._resample_derived`), where the store holds 5m for the day, buckets from 13:05
    (the 13:00 bucket is the vendor's row, the closing auction, and stays as it is);
then the day's locally DERIVED timeframes (15m from 5m, 30m / 60m from 15m) are re-derived over the window by the
caller's `rederive` (the settle's own, material rows only), so a 60m bucket that straddles 16:00 carries both halves.
One write per touched series, so its history_rev moves once and a client re-reads it once.

WHEN. Inside the settle pass on a half day (17:30 ET, `bars_live_store.settle_pass`), and once for the half days already
in the store's window (`backfill_pending`, newest first, after the close), both under the settle's share of the vendor
budget (`bars_live_store._settle_take`). Each finished day is kept in bars.db (`halfday_gap_done`), so a restart never
repeats one.
"""
from __future__ import annotations

import logging
import time
import urllib.parse
from datetime import date, datetime, timedelta
from typing import Callable, Optional
from zoneinfo import ZoneInfo

_log = logging.getLogger(__name__)
_ET = ZoneInfo("America/New_York")
GAP_TO_MIN = 16 * 60                       # the vendor prices Form T again from 16:00 ET
TRADES_PAGE_CAP = 20                       # 20 x 50,000 trades: far beyond any name's half-day afternoon
HISTORY_DAYS = 730                         # the store's deepest intraday window worth rebuilding
_DDL = ("CREATE TABLE IF NOT EXISTS halfday_gap_done ("
        "ymd INTEGER PRIMARY KEY, saved_at REAL NOT NULL, tickers INTEGER NOT NULL, rows INTEGER NOT NULL)")


def gap_window(d: date) -> Optional[tuple[int, int]]:
    """(lo, hi) unix seconds of `d`'s gap [regular close + 1 min, 16:00) ET, or None when `d` is not a half day."""
    from api.services import session_calendar as _sc
    if not _sc.is_half_day(d):
        return None
    close = _sc.close_time(d)
    if close is None:
        return None
    lo = close + timedelta(minutes=1)
    hi = datetime(d.year, d.month, d.day, GAP_TO_MIN // 60, GAP_TO_MIN % 60, tzinfo=_ET)
    return (int(lo.timestamp()), int(hi.timestamp())) if lo < hi else None


def fetch_trades(sym: str, lo: int, hi: int, take: Callable[[], None]) -> list[dict]:
    """The vendor's trades of `sym` in [lo, hi) unix seconds, every page (`take()` before each one: the caller's share
    of the vendor budget). Raises on a provider failure (an error must never read as "no trades")."""
    from api.services.massive import _get_client, _REST_BASE, to_polygon_symbol
    client = _get_client()
    q = urllib.parse.urlencode({"timestamp.gte": int(lo) * 1_000_000_000, "timestamp.lt": int(hi) * 1_000_000_000,
                                "order": "asc", "sort": "timestamp", "limit": 50000, "apiKey": client._api_key})
    url = f"{_REST_BASE}/v3/trades/{urllib.parse.quote(to_polygon_symbol(sym))}?{q}"
    out: list[dict] = []
    for _ in range(TRADES_PAGE_CAP):
        take()
        data = client._get(url)
        out.extend(data.get("results") or [])
        nxt = data.get("next_url")
        if not nxt:
            return out
        url = f"{nxt}{'&' if '?' in nxt else '?'}apiKey={client._api_key}"
    raise RuntimeError(f"{sym}: more than {TRADES_PAGE_CAP} trade pages")


def fold_minutes(trades: list[dict]) -> list[dict]:
    """One bar per minute that has a price-eligible trade, folded as the live fold folds a trade
    (`bar_broadcaster._fold_trade`): size where it updates volume, open/close from the first/last price that updates the
    last, high/low from prices that update them. A minute whose prints set no price (all odd lots) makes no bar."""
    from api.services.trade_conditions import classify3
    mins: dict[int, dict] = {}
    for t in trades:
        try:
            ts_ns = int(t.get("sip_timestamp") or t.get("participant_timestamp"))
            p, s = float(t["price"]), int(t.get("size") or 0)
        except (TypeError, ValueError, KeyError):
            continue
        hl_ok, last_ok, vol_ok = classify3(t.get("conditions"))
        m = ts_ns // 1_000_000_000 // 60 * 60
        st = mins.setdefault(m, {"t": m, "o": None, "o_ts": None, "h": None, "l": None, "c": None, "c_ts": None, "v": 0})
        if vol_ok:
            st["v"] += s
        if last_ok:
            if st["o"] is None or ts_ns < st["o_ts"]:
                st["o"], st["o_ts"] = p, ts_ns
            if st["c"] is None or ts_ns >= st["c_ts"]:
                st["c"], st["c_ts"] = p, ts_ns
        if hl_ok:
            st["h"] = p if st["h"] is None else max(st["h"], p)
            st["l"] = p if st["l"] is None else min(st["l"], p)
    out = []
    for m in sorted(mins):
        st = mins[m]
        if st["o"] is None:
            continue
        hi = max(x for x in (st["h"], st["o"], st["c"]) if x is not None)
        lo = min(x for x in (st["l"], st["o"], st["c"]) if x is not None)
        out.append({"t": m, "o": st["o"], "h": hi, "l": lo, "c": st["c"], "v": st["v"]})
    return out


def _holds(sym: str, tf: str, day_lo: int, day_hi: int) -> bool:
    from api.services import bars_sqlite
    return bars_sqlite._conn().execute(
        "SELECT 1 FROM ohlcv WHERE ticker=? AND tf=? AND ts>=? AND ts<? LIMIT 1",
        (sym.upper(), tf, int(day_lo), int(day_hi))).fetchone() is not None


def rebuild(sym: str, d: date, take: Callable[[], None], checked_at: Optional[float] = None,
            rederive: Optional[Callable[[str, int, int, float], object]] = None) -> dict:
    """Rebuild `sym`'s half-day gap on `d` (see the module doc). {"minutes", "written": {tf: rows}} ({} on a normal
    day). `rederive(sym, lo, hi, checked_at)` re-derives the day's derived timeframes over [lo, hi). Raises on a
    provider failure."""
    from api.services import bars_fetch, bars_sqlite
    win = gap_window(d)
    if win is None:
        return {}
    lo, hi = win
    day_lo = int(datetime(d.year, d.month, d.day, tzinfo=_ET).timestamp())
    day_hi = day_lo + 86400
    mins = [b for b in fold_minutes(fetch_trades(sym, lo, hi, take)) if lo <= b["t"] < hi]
    written: dict[str, int] = {}
    if not mins:
        return {"minutes": 0, "written": written}
    at = time.time() if checked_at is None else float(checked_at)
    plan = []
    if _holds(sym, "1", day_lo, day_hi):
        plan.append(("1", mins))
    if _holds(sym, "5", day_lo, day_hi):
        five = [b for b in bars_fetch._resample_derived("5", mins) if lo + 4 * 60 <= int(b["t"]) < hi]
        if five:
            plan.append(("5", five))
    for tf, rows in plan:
        n = bars_sqlite.put_bars(sym, tf, [bars_sqlite.AddOnlyBar(b) for b in rows], checked_at=at)
        written[tf] = int(n or 0)
    if rederive is not None and "5" in written:
        close = lo - 60                                   # the regular close (13:00): its buckets are re-derived too
        got = rederive(sym, close, hi + 60 * 60, at)       # through 17:00: a bucket straddling 16:00 gets both halves
        n = got[0] if isinstance(got, tuple) else got
        written["derived"] = int(n or 0)
    return {"minutes": len(mins), "written": written}


# ── the per-day ledger (bars.db) ─────────────────────────────────────────────────────────────────────────────────

def done_days() -> set[int]:
    from api.services import bars_sqlite
    try:
        return {int(r[0]) for r in bars_sqlite._conn().execute("SELECT ymd FROM halfday_gap_done").fetchall()}
    except Exception:  # noqa: BLE001 - no table yet
        return set()


def mark_done(ymd: int, tickers: int, rows: int) -> None:
    from api.services import bars_sqlite
    with bars_sqlite._WRITE_LOCK:
        c = bars_sqlite._conn()
        c.execute(_DDL)
        c.execute("INSERT OR REPLACE INTO halfday_gap_done(ymd, saved_at, tickers, rows) VALUES (?, ?, ?, ?)",
                  (int(ymd), time.time(), int(tickers), int(rows)))
        c.commit()


def pending_days(today: date, days: int = HISTORY_DAYS) -> list[date]:
    """Half days in (today - `days`, today], not yet rebuilt, newest first."""
    from api.services import session_calendar as _sc
    done = done_days()
    out = []
    for i in range(days):
        d = today - timedelta(days=i)
        if _sc.is_half_day(d) and int(d.strftime("%Y%m%d")) not in done:
            out.append(d)
    return out


def run_day(d: date, tickers: list[str], take: Callable[[], None], checked_at: Optional[float] = None,
            rederive: Optional[Callable] = None) -> dict:
    """Rebuild `d` for every ticker; mark the day done unless more than max(5, 1%) of the reads failed (then the whole
    day is retried next time: add-only writes and material re-derives make a repeat harmless)."""
    counts = {"tickers": len(tickers), "rows": 0, "failed": 0}
    for sym in tickers:
        try:
            got = rebuild(sym, d, take, checked_at=checked_at, rederive=rederive)
            counts["rows"] += sum((got.get("written") or {}).values())
        except Exception as e:  # noqa: BLE001 - one ticker's failure leaves its rows as they are
            counts["failed"] += 1
            from api.services.log_redaction import redact
            _log.debug("[halfday-gap] %s %s failed: %s", sym, d, redact(str(e)))
    if counts["failed"] <= max(5, len(tickers) // 100):
        mark_done(int(d.strftime("%Y%m%d")), counts["tickers"], counts["rows"])
    _log.info("[halfday-gap] %s: %s", d, counts)
    return counts
