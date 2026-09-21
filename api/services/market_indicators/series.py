"""THE CANONICAL TIME-SERIES SEAM — one door, every market indicator.

⭐⭐ ONE FUNCTION SERVES ALL FIVE SOURCE TYPES. A breadth-derived oscillator, a weekly
survey and a Cboe volatility index reach the chart through `build_bars()` and come back
in the bar shape the chart already consumes. There is no second chart engine, no
per-indicator widget and no branch in the renderer — the differences live in METADATA
(`registry.py`) and in how this module turns a source's native cadence into bars.

⛔⛔ `t` IS ALWAYS `"YYYY-MM-DD"`. Equities and breadth pseudo-tickers already emit ISO
days; `api/index_bars.py` emits unix seconds, and because `engine/symbolProjection.js`
joins a secondary series onto the chart's bars by EXACT `t`, that mismatch means an
index added into a pane matches ZERO bars. Every series this module serves uses the ISO
form so it composes with everything else. That is not a style choice; it is the reason
the volatility lane exists at all.

⛔ AND THE SERVE PATH TOUCHES NO NETWORK. Cboe history is ingested by a tool; breadth is
read from the local canonical store; NAAIM is read from its own store. A chart request
that can block on somebody else's CDN is the unbounded-external-call failure this
codebase already paid for once.
"""
from __future__ import annotations

import datetime as _dt
import logging
import math
from typing import Optional

from api.services.market_indicators import registry as reg

_log = logging.getLogger("market_indicators.series")

#: Timeframes a market indicator can be served at. ⛔ INTRADAY COLLAPSES TO DAILY rather
#: than erroring: every source here is EOD or weekly, so a 5-minute request has no
#: honest answer finer than the day, and refusing it would break a chart whose timeframe
#: the member changed for a different series in the same workspace.
TIMEFRAMES = ("D", "W", "M")

#: How long a WEEKLY observation may be carried across daily bars before the series is
#: treated as having a hole rather than a standing level. Matches
#: `breadth_sentiment_history._MAX_CARRY_DAYS`, deliberately — two surfaces carrying the
#: same survey for different lengths is how a tile and a chart come to disagree.
MAX_CARRY_DAYS = 12


def _iso(d: _dt.date) -> str:
    return d.isoformat()


def _finite(v) -> Optional[float]:
    try:
        f = float(v)
        return f if math.isfinite(f) else None
    except (TypeError, ValueError):
        return None


# ── Scalar series → bars ─────────────────────────────────────────────────────

def scalar_to_bars(points: list[dict]) -> list[dict]:
    """`[{t, v}]` → close-to-close bodies `[{t,o,h,l,c,v}]`.

    ⛔⛔ THE BODY SPANS YESTERDAY'S VALUE TO TODAY'S AND THE RANGE IS DERIVED FROM THE
    PAIR — there is no observed high or low, because a derived indicator has one value
    per session. This is the same synthetic shape `breadth_symbols.build_breadth_bars`
    produces and it is honest ONLY because the capability gate refuses to draw it as a
    candlestick: `registry.Series.ohlc_capable` is False for every source type but
    security and volatility, so a member sees a line. Remove that gate and this shape
    becomes a lie a member cannot detect by looking.
    """
    out = []
    prev = None
    for p in points:
        v = _finite(p.get("v"))
        if v is None:
            continue
        o = prev if prev is not None else v
        out.append({"t": p["t"], "o": o, "h": max(o, v), "l": min(o, v), "c": v, "v": 0})
        prev = v
    return out


def step_to_daily(points: list[dict], calendar: list[str],
                  max_carry_days: int = MAX_CARRY_DAYS) -> list[dict]:
    """A WEEKLY observation series rendered across a DAILY session calendar.

    ⭐⭐ HOLD-LAST-KNOWN-VALUE, AND THAT IS NOT INTERPOLATION. NAAIM's Wednesday reading
    IS the exposure managers reported, and it remains the most recent such reading until
    the next survey — so a Thursday bar carrying it states a fact rather than inventing
    one. What would be invention is drawing a sloped line between two observations, or
    manufacturing a high and a low for a week that produced one number. Neither happens
    here: every carried bar is flat (`o == h == l == c`) and the registry marks the
    series `frequency: weekly` and `presentation: step` so the consumer knows.

    ⛔ AND THE CARRY IS CAPPED. Beyond `max_carry_days` the series has a HOLE, not a
    standing level — one reading must never paper over a source that stopped. That is
    the rule `breadth_sentiment_history` already applies server-side, and the rule the
    put/call series was removed from the fill list for violating.
    """
    if not points:
        return []
    obs = sorted(({"t": p["t"], "v": _finite(p.get("v"))} for p in points),
                 key=lambda p: p["t"])
    obs = [p for p in obs if p["v"] is not None]
    if not obs:
        return []
    if not calendar:
        # No session calendar available — serve the observations themselves rather than
        # nothing. Honest: the member sees exactly the weeks that were measured.
        return scalar_to_bars(obs)

    out = []
    i = 0
    cur: Optional[dict] = None
    prev_close: Optional[float] = None
    for day in calendar:
        while i < len(obs) and obs[i]["t"] <= day:
            cur = obs[i]
            i += 1
        if cur is None:
            continue                                  # before the first observation
        try:
            age = (_dt.date.fromisoformat(day) - _dt.date.fromisoformat(cur["t"])).days
        except ValueError:
            continue
        if age > max_carry_days:
            prev_close = None                          # the hole breaks the body chain
            continue
        v = cur["v"]
        o = prev_close if prev_close is not None else v
        out.append({"t": day, "o": o, "h": max(o, v), "l": min(o, v), "c": v, "v": 0})
        prev_close = v
    return out


def session_calendar(universe: str = "us", since: str = "") -> list[str]:
    """Trading sessions, from the canonical breadth store. READ-ONLY.

    ⭐ THE BREADTH STORE IS ALREADY A TRADING CALENDAR and it is the one this product's
    other series are dated on, so a survey rendered against it lands on exactly the days
    its neighbours have bars. Inventing a calendar from weekday arithmetic would put
    NAAIM bars on market holidays.
    """
    try:
        from api.services import breadth_daily_ohlc as store
        return store.dates_since(universe=universe, since=since or "") or []
    except Exception:
        return []


# ── Resampling ───────────────────────────────────────────────────────────────

def _friday_of_week(d: _dt.date) -> _dt.date:
    return d + _dt.timedelta(days=(4 - d.weekday()))


def resample(daily: list[dict], tf: str) -> list[dict]:
    """Daily bodies → weekly / monthly OHLC.

    ⚠️ DELIBERATELY THE SAME BUCKETING AS `breadth_symbols._resample`: weekly bars are
    keyed to the week's FRIDAY and monthly to the month's first. Two resamplers that
    disagree about which day a weekly bar belongs to would put two series in one pane on
    different x-positions, which reads as a data error and is a bucketing error.
    """
    if tf == "D" or not daily:
        return daily
    buckets: dict[str, dict] = {}
    order: list[str] = []
    for c in daily:
        try:
            d = _dt.date.fromisoformat(c["t"])
        except (ValueError, KeyError, TypeError):
            continue
        key = (_friday_of_week(d).isoformat() if tf == "W"
               else f"{d.year:04d}-{d.month:02d}-01")
        b = buckets.get(key)
        if b is None:
            buckets[key] = {"t": key, "o": c["o"], "h": c["h"], "l": c["l"],
                            "c": c["c"], "v": 0}
            order.append(key)
        else:
            b["h"] = max(b["h"], c["h"])
            b["l"] = min(b["l"], c["l"])
            b["c"] = c["c"]
    return [buckets[k] for k in order]


# ── The one builder ──────────────────────────────────────────────────────────

def daily_bars(series_id: str) -> list[dict]:
    """Daily bars for a canonical series id, oldest first. `[]` when unavailable.

    ⛔ AN EMPTY LIST IS "WE CANNOT SERVE THIS", never "the market was flat". Every
    caller renders empty as an absence, and nothing here fabricates a point to avoid it.
    """
    row = reg.get(series_id)
    if row is None:
        return []

    if row.source_type == reg.SRC_VOLATILITY:
        from api.services.market_indicators import cboe_store
        return cboe_store.bars(row.symbol)

    if row.source_type == reg.SRC_SURVEY:
        from api.services.market_indicators import naaim_store
        obs = naaim_store.observations()
        pts = [{"t": o["observed_on"], "v": o["value"]} for o in obs]
        if not pts:
            return []
        cal = session_calendar("us", since=pts[0]["t"])
        return step_to_daily(pts, cal)

    if row.source_type == reg.SRC_BREADTH_DERIVED:
        from api.services.market_indicators import producers
        ds = producers.build(row.id)
        if ds is None:
            return []
        return scalar_to_bars(ds.as_points())

    return []


def build_bars(symbol: str, tf: str = "D", bars: int = 5000) -> dict:
    """`/api/bars`-shaped payload for a market indicator. THE serving entry point.

    Mirrors `breadth_symbols.build_breadth_bars`' contract exactly — same keys, same
    `t` format, same intraday-collapses-to-daily rule — so the bars router's new branch
    is one line and the client needs no new handling.
    """
    tf = (tf or "D").upper()
    if tf not in TIMEFRAMES:
        tf = "D"
    row = reg.resolve(symbol)
    if row is None:
        # ⛔ An unresolved or DORMANT identity serves an empty series, never another
        # series' numbers. `resolve()` hides dormant rows, so NYMO lands here.
        return {"ticker": (symbol or "").upper(), "tf": tf, "bars": []}
    out = resample(daily_bars(row.id), tf)
    if bars and len(out) > bars:
        out = out[-int(bars):]
    return {"ticker": row.symbol, "tf": tf, "bars": out}


def availability() -> dict:
    """`{series_id: {first, last, points}}` for every PUBLISHED series.

    ⭐ WHAT ACTUALLY EXISTS, not what the catalogue describes. The two are different
    questions and conflating them is how a member finds an identity with no history.
    """
    out = {}
    for row in reg.published_rows():
        try:
            b = daily_bars(row.id)
        except Exception:
            b = []
        out[row.id] = {"first": b[0]["t"] if b else None,
                       "last": b[-1]["t"] if b else None,
                       "points": len(b)}
    return out
