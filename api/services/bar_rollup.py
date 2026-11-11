"""Aggregate 1-minute bars into multi-minute timeframes.

Polygon/Massive AM events deliver 1-minute OHLCV bars. For each multi-minute
chart we accumulate consecutive 1-min bars in the same bucket and emit when the
bucket closes. Pure functions only — IO and state live in bar_broadcaster.

5/15/30 use UTC-floored buckets (cheap, no DST concerns, matches the
historical session resample which never had to ET-anchor sub-hourly windows).
60-min uses the canonical ET-anchored bucket from bars_fetch — that function is
the single source of truth for hourly bucket alignment, shared with the REST
resample path so the two NEVER drift (the equivalence is by construction).
"""
from functools import lru_cache
from typing import Optional

# Supported intraday timeframes that roll up from 1-min bars.
# D/W are not in this list — those use end-of-day data via the existing prewarmer/SQLite path.
TF_TO_SECONDS = {
    "1":  60,
    "5":  300,
    "15": 900,
    "30": 1800,
    "60": 3600,
}


def bucket_start(ts_ms: int, tf: str) -> int:
    """Return the start-of-bucket timestamp (ms) that contains ts_ms for the given tf.

    For tf=60: delegates to the canonical ET-anchored bucket function so the
    REST resample path and this WS rollup path produce bit-identical
    timestamps. Anything else here (UTC floor) would drift across DST or the
    9:30 RTH-open anchor and plant duplicate candles in SQLite at neighboring
    ``ts`` values — the exact failure shape of the FMP timezone bug.

    Raises ValueError if tf is not one of TF_TO_SECONDS keys.
    """
    if tf not in TF_TO_SECONDS:
        raise ValueError(f"Unsupported timeframe for rollup: {tf!r}")
    if tf == "60":
        # Single source of truth — import lazily to keep this module's tiny
        # import graph clean and avoid any future circular-dep risk.
        from api.services.bars_fetch import bucket_60_et_unix_seconds
        return bucket_60_et_unix_seconds(ts_ms // 1000) * 1000
    sec = TF_TO_SECONDS[tf]
    bucket_sec = (ts_ms // 1000) // sec * sec
    return bucket_sec * 1000


def aggregate(prev: Optional[dict], bar: dict) -> dict:
    """Merge a new 1-min bar into the partial bucket bar.

    `prev` is the in-progress bar for this bucket, or None if this is the first bar.
    `bar` is a single 1-min bar with keys: t (ms), o, h, l, c, v.
    Returns a fresh dict (no mutation of `prev` or `bar`, no aliasing).

    CONTRACT: caller MUST verify `bar` belongs to the same bucket as `prev`
    before calling — this function does NOT validate bucket alignment, and
    mixing buckets silently produces a corrupted bar (sums volume across
    bucket boundaries, keeps wrong `t`). The canonical caller is
    `bar_broadcaster.BarBroadcaster.push_minute_bar`, which uses
    `bucket_start(bar["t"], tf)` to detect bucket transitions and resets
    `prev=None` at boundaries.
    """
    if prev is None:
        return {
            "t": bar["t"],   # bucket start (caller computes via bucket_start before first call)
            "o": bar["o"],
            "h": bar["h"],
            "l": bar["l"],
            "c": bar["c"],
            "v": bar["v"],
        }
    return {
        "t": prev["t"],
        "o": prev["o"],
        "h": max(prev["h"], bar["h"]),
        "l": min(prev["l"], bar["l"]),
        "c": bar["c"],
        "v": prev["v"] + bar["v"],
    }


# ── TradingView-aligned session buckets (the ONE live-candle bucket helper) ──
#
# TradingView builds intraday bars from SESSION START:
#   * RTH view (9:30-16:00 ET): 60m buckets are 9:30, 10:30, ..., 14:30, and a
#     15:30-16:00 half bar. On an NYSE 13:00 early close the session ends at
#     13:00 (12:30-13:00 half bar) and post-close prints use clock hours —
#     they never land in an RTH bucket (`nyse_calendar.NYSE_EARLY_CLOSES_YYYYMMDD`). Outside RTH (a pre/post print the RTH chart hides
#     anyway) we fall back to clock hours, with the 9:00 pre-market hour cut at
#     9:30 so it never overlaps the 9:30 RTH bucket.
#   * ETH view (04:00-20:00 ET): 60m buckets are clock hours 04:00 ... 19:00
#     (the 09:00 bucket spans the open).
#   * 1/5/15/30 are identical in both modes: a plain floor (9:30 and 04:00 are
#     both multiples of 30 min), so they also equal `bucket_start`.
#
# `tv_bucket_bounds` is the single source of truth for the live stream's bucket
# start AND end (bar_broadcaster derives every developing bar from it) AND for
# the REST 60m resample/delta/heal: `bars_fetch.bucket_60_et_unix_seconds`
# delegates here, so the stream and REST never plant neighbouring candles.
SESSIONS = ("rth", "eth")

_RTH_OPEN_MIN = 9 * 60 + 30
_RTH_CLOSE_MIN = 16 * 60


def _et_zone():
    from zoneinfo import ZoneInfo
    return ZoneInfo("America/New_York")


_EARLY_CLOSE_MIN = 13 * 60


def _rth_close_min(ymd: int) -> int:
    """Regular-session close (minutes after ET midnight) for an ET date.

    An unreadable calendar falls back to the FULL day (16:00) and says so loudly —
    a half-day then buckets 13:00-13:59 post-market into the 12:30 bar, which is
    visible, rather than raising out of every 60m bucket call (REST + stream)."""
    try:
        from api.services.nyse_calendar import NYSE_EARLY_CLOSES_YYYYMMDD
    except Exception:  # noqa: BLE001
        import logging
        logging.getLogger(__name__).error(
            "[bar_rollup] NYSE calendar unreadable — 60m buckets assume a FULL day (16:00 close)",
            exc_info=True)
        return _RTH_CLOSE_MIN
    return _EARLY_CLOSE_MIN if ymd in NYSE_EARLY_CLOSES_YYYYMMDD else _RTH_CLOSE_MIN


@lru_cache(maxsize=16384)
def _tv_bounds_cached(minute_ms: int, tf: str, session: str) -> tuple[int, int]:
    from datetime import datetime
    et = _et_zone()
    dt = datetime.fromtimestamp(minute_ms / 1000, tz=et)
    mod = dt.hour * 60 + dt.minute
    close_min = _rth_close_min(dt.year * 10000 + dt.month * 100 + dt.day)
    if session == "rth" and _RTH_OPEN_MIN <= mod < close_min:
        start = _RTH_OPEN_MIN + (mod - _RTH_OPEN_MIN) // 60 * 60
        end = min(start + 60, close_min)
    else:
        start = mod // 60 * 60
        end = start + 60
        if session == "rth" and start < _RTH_OPEN_MIN < end:
            end = _RTH_OPEN_MIN          # 9:00-9:30 pre-market stub

    def _at(mins: int) -> int:
        if mins >= 24 * 60:
            from datetime import timedelta
            nxt = dt + timedelta(days=1)
            return int(datetime(nxt.year, nxt.month, nxt.day, tzinfo=et).timestamp()) * 1000
        return int(datetime(dt.year, dt.month, dt.day, mins // 60, mins % 60, tzinfo=et).timestamp()) * 1000

    return _at(start), _at(end)


def tv_bucket_bounds(ts_ms: int, tf: str, session: str = "rth") -> tuple[int, int]:
    """(start_ms, end_ms) of the TradingView-aligned bucket containing ``ts_ms``.

    ``session`` is ``"rth"`` (regular-hours chart) or ``"eth"`` (extended-hours
    chart); it only changes 60m. End is exclusive. Raises ValueError for an
    unsupported tf or session.
    """
    if tf not in TF_TO_SECONDS:
        raise ValueError(f"Unsupported timeframe for rollup: {tf!r}")
    if session not in SESSIONS:
        raise ValueError(f"Unsupported session: {session!r}")
    minute_ms = int(ts_ms) // 60000 * 60000
    if tf != "60":
        step = TF_TO_SECONDS[tf] * 1000
        start = minute_ms // step * step
        return start, start + step
    return _tv_bounds_cached(minute_ms, tf, session)


def tv_bucket_start(ts_ms: int, tf: str, session: str = "rth") -> int:
    """Start (ms) of the TradingView-aligned bucket containing ``ts_ms``."""
    return tv_bucket_bounds(ts_ms, tf, session)[0]
