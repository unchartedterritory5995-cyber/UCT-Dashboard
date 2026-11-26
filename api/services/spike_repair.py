"""THE STORED-BAR SPIKE REPAIR: a vendor bar whose wick came from a print TradingView (and our live fold) never counts
(2026-11-26, the spike probe).

The vendor's own aggregates count derivatively priced (10), sold out of sequence (32/33) and contingent (52/53) prints
toward a bar's high/low (SPY 2025-12-22 15:00 low, 2026-08-28 15:00 high; RDDT 2024-05-20 13:30 low, trades reported
four hours late). The live fold now pins them out (`trade_conditions._HL_PINNED`), but a STORED bar is the vendor's,
and re-reading the vendor (the settle) returns the same wick. Only the bar's trades can repair it, so the repair is
TARGETED:

  * FLAG a stored bar only when its high reaches above max(open, close), or its low below min(open, close), by MORE
    than max(3 x that ET day's median bar range for the same timeframe, 0.3% of the price) (coordinator's rule);
  * RE-AGGREGATE a flagged bar's high/low from the vendor's trades of its bucket with the live fold's rule
    (`trade_conditions.classify3`, the pinned codes included), clamped to its own open/close;
  * REPLACE only the FLAGGED side (the high, the low, or both) and only when that differs; open, close, volume and an
    unflagged extreme stay the vendor's. One write per series (one history_rev bump when the day is held history).

Where the day holds 5m, the base rows are repaired (1m too, where held) and the day's 15m/30m/60m are re-derived by the
caller's `rederive` (the settle's own, material rows only); a day without 5m (older history) repairs its 15m and
re-derives 30m/60m from it. No statistical filter: an extreme that every eligible trade supports is a real move and
stays (TradingView's pre-market bad-tick filter is a documented definition difference, as is the same-timestamp tie).

WHEN. Inside the settle (`bars_live_store.settle_pass`, today, every covered ticker) and as a one-off backfill of the
last HISTORY_DAYS trading days, newest first, one day per settle-loop turn after the close; both under the settle's
share of the vendor budget. A finished day is kept in bars.db (`spike_repair_done`).
"""
from __future__ import annotations

import logging
import statistics
import time
from datetime import date, datetime, timedelta
from typing import Callable, Optional
from zoneinfo import ZoneInfo

_log = logging.getLogger(__name__)
_ET = ZoneInfo("America/New_York")
FLAG_RANGE_MULT = 3.0
FLAG_PRICE_PCT = 0.003
HISTORY_DAYS = 30                          # trading days the one-off backfill reaches back
_DDL = ("CREATE TABLE IF NOT EXISTS spike_repair_done ("
        "ymd INTEGER PRIMARY KEY, saved_at REAL NOT NULL, tickers INTEGER NOT NULL, flagged INTEGER NOT NULL, "
        "replaced INTEGER NOT NULL)")


def flag_sides(rows) -> list:
    """[(row, high_flagged, low_flagged)] for the rows (ts, o, h, l, c, v) of ONE ET day and ONE timeframe whose wick
    beyond the body exceeds max(FLAG_RANGE_MULT x the day's median bar range, FLAG_PRICE_PCT x the price)."""
    good = [r for r in rows if None not in r[1:5]]
    if not good:
        return []
    med = statistics.median(float(r[2]) - float(r[3]) for r in good)
    out = []
    for r in good:
        o, h, l, c = (float(x) for x in r[1:5])
        thr = max(FLAG_RANGE_MULT * med, FLAG_PRICE_PCT * (o + c) / 2.0)
        up, dn = h - max(o, c) > thr, min(o, c) - l > thr
        if up or dn:
            out.append((r, up, dn))
    return out


def flag(rows) -> list:
    """The flagged rows of `flag_sides`."""
    return [r for r, _up, _dn in flag_sides(rows)]


def minute_extremes(pages) -> dict[int, tuple[float, float]]:
    """{minute start (unix s): (high, low)} of the prints whose conditions update high/low (`trade_conditions.classify3`,
    the live fold's rule, the pinned codes included), page by page: only per-minute extremes are kept, never the trades.
    A minute with no qualifying print is absent. A page that raises propagates."""
    from api.services.trade_conditions import classify3
    mins: dict[int, tuple[float, float]] = {}
    for page in pages:
        for t in page:
            try:
                p = float(t["price"])
                m = int(t.get("sip_timestamp") or t.get("participant_timestamp")) // 1_000_000_000 // 60 * 60
            except (TypeError, ValueError, KeyError):
                continue
            hl_ok, _last_ok, _vol_ok = classify3(t.get("conditions"))
            if not hl_ok:
                continue
            hi_lo = mins.get(m)
            mins[m] = (p, p) if hi_lo is None else (max(hi_lo[0], p), min(hi_lo[1], p))
        page = None
    return mins


def window_hl(mins: dict, lo: int, hi: int) -> Optional[tuple[float, float]]:
    """(high, low) over the minutes of `minute_extremes` in [lo, hi); None when none qualifies."""
    got = [v for m, v in mins.items() if lo <= m < hi]
    return (max(v[0] for v in got), min(v[1] for v in got)) if got else None


def reaggregate_hl(pages) -> Optional[tuple[float, float]]:
    """(high, low) of all the qualifying prints in `pages` (see `minute_extremes`); None when no print qualifies."""
    return window_hl(minute_extremes(pages), 0, 1 << 62)


def _day_rows(sym: str, tf: str, lo: int, hi: int) -> list:
    from api.services import bars_sqlite
    return bars_sqlite._conn().execute(
        "SELECT ts, o, h, l, c, v FROM ohlcv WHERE ticker=? AND tf=? AND ts>=? AND ts<? ORDER BY ts",
        (sym.upper(), tf, int(lo), int(hi))).fetchall()


def repair_day(sym: str, d: date, take: Callable[[], None], checked_at: Optional[float] = None,
               rederive: Optional[Callable] = None, trade_pages: Optional[Callable] = None) -> dict:
    """Flag and repair `sym`'s stored bars of ET day `d` (see the module doc). {"flagged", "replaced"}. Raises on a
    provider failure (nothing of that ticker is written then)."""
    from api.services import bars_sqlite
    if trade_pages is None:
        from api.services.halfday_gap import trade_pages
    day_lo = int(datetime(d.year, d.month, d.day, tzinfo=_ET).timestamp())
    day_hi = int((datetime(d.year, d.month, d.day, tzinfo=_ET) + timedelta(days=1)).timestamp())
    held = {tf: _day_rows(sym, tf, day_lo, day_hi) for tf in ("1", "5", "15")}
    tfs = [tf for tf in ("1", "5") if held[tf]] if held["5"] else (["15"] if held["15"] else [])
    flagged = replaced = 0
    plan: dict[str, list] = {}
    # One read per bucket: on a day holding 5m a spike flags its 1m AND its 5m bar, so both are judged from ONE read of
    # the 5m bucket (its per-minute extremes; #2825 review). A 15m-only day reads the 15m bucket.
    read = 900 if tfs == ["15"] else 300
    reads: dict[int, dict] = {}
    for tf in tfs:
        step = int(tf) * 60
        for r, up, dn in flag_sides(held[tf]):
            flagged += 1
            t0 = int(r[0])
            b0 = t0 // read * read
            if b0 not in reads:
                reads[b0] = minute_extremes(trade_pages(sym, b0, b0 + read, take))
            hl = window_hl(reads[b0], t0, t0 + step)
            if hl is None:
                continue
            o, h, l, c, v = (float(r[1]), float(r[2]), float(r[3]), float(r[4]), r[5])
            # only the FLAGGED side moves: the other extreme stays the vendor's
            nh = max(hl[0], o, c) if up else h
            nl = min(hl[1], o, c) if dn else l
            if round(nh, 4) == round(h, 4) and round(nl, 4) == round(l, 4):
                continue
            plan.setdefault(tf, []).append({"t": t0, "o": o, "h": nh, "l": nl, "c": c, "v": v})
    at = time.time() if checked_at is None else float(checked_at)
    for tf, rows in plan.items():
        bars_sqlite.put_bars(sym, tf, rows, checked_at=at)
        replaced += len(rows)
    if plan and rederive is not None:
        rederive(sym, day_lo, day_hi, at)
    return {"flagged": flagged, "replaced": replaced}


def run_day(d: date, tickers: list[str], take: Callable[[], None], rederive: Optional[Callable] = None,
            checked_at: Optional[float] = None) -> dict:
    """`repair_day` for every ticker; counts flagged / replaced / failed."""
    counts = {"tickers": len(tickers), "flagged": 0, "replaced": 0, "failed": 0}
    for sym in tickers:
        try:
            got = repair_day(sym, d, take, checked_at=checked_at, rederive=rederive)
            counts["flagged"] += got["flagged"]
            counts["replaced"] += got["replaced"]
        except Exception as e:  # noqa: BLE001 - one ticker's failure leaves its rows as they are
            counts["failed"] += 1
            from api.services.log_redaction import redact
            _log.debug("[spike-repair] %s %s failed: %s", sym, d, redact(str(e)))
    # the day counts as repaired (the backfill never re-reads it) unless more than max(5, 1%) of the reads failed;
    # the settle's same-day run marks today so (#2825 review), as the backfill marks a past day
    if counts["failed"] <= max(5, len(tickers) // 100):
        mark_done(d, counts)
    _log.info("[spike-repair] %s: %s", d, counts)
    return counts


# ── the one-off backfill's per-day ledger (bars.db) ──────────────────────────────────────────────────────────────

def done_days() -> set[int]:
    from api.services import bars_sqlite
    try:
        return {int(r[0]) for r in bars_sqlite._conn().execute("SELECT ymd FROM spike_repair_done").fetchall()}
    except Exception:  # noqa: BLE001 - no table yet
        return set()


def mark_done(d: date, counts: dict) -> None:
    from api.services import bars_sqlite
    with bars_sqlite._WRITE_LOCK:
        c = bars_sqlite._conn()
        c.execute(_DDL)
        c.execute("INSERT OR REPLACE INTO spike_repair_done(ymd, saved_at, tickers, flagged, replaced) "
                  "VALUES (?, ?, ?, ?, ?)", (int(d.strftime("%Y%m%d")), time.time(), int(counts.get("tickers", 0)),
                                             int(counts.get("flagged", 0)), int(counts.get("replaced", 0))))
        c.commit()


def pending_days(today: date, days: int = HISTORY_DAYS) -> list[date]:
    """The last `days` trading days before `today` not yet repaired, newest first."""
    from api.services import session_calendar as _sc
    done = done_days()
    out, seen, d = [], 0, today - timedelta(days=1)
    while seen < days and d > today - timedelta(days=days * 2 + 14):
        if _sc.is_trading_day(d):
            seen += 1
            if int(d.strftime("%Y%m%d")) not in done:
                out.append(d)
        d -= timedelta(days=1)
    return out
