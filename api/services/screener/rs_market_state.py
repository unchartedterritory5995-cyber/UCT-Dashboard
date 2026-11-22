"""The market caution state the RS screens print above their lists.

Plan: ``2026-11-14-uct-rs-screens-plan-v2.md`` section 7. Unit U8, item D2.

WHY IT EXISTS. A list of the strongest stocks reads the same in a healthy market and in
the first rebound after a bear market, and it does not behave the same: leadership
reverses hardest in those rebounds, and breakouts fail more often while the indexes are
under their own averages. One gold line above the list says which of those the market
is in. It is a statement about the market, never about a stock, and never advice.

THE THREE STATES (each from daily closes we already hold)
----------------------------------------------------------
* ``caution``:  SPY closed below its 200-day average, OR SPY's return over the last
  504 sessions (two years) is negative.
* ``pressure``: not caution, and SPY closed below its 50-day average OR QQQ closed
  below its 200-day average.
* ``normal``:   neither. No line is shown.

"Below" is strictly below: a close equal to its average is not below it. A "negative"
return is strictly under zero. The average includes the newest close (the chart's own
simple moving average).

FAIL CLOSED. A state is a claim about every condition above it, so it is only made
when each one can be answered:
* a condition that is TRUE decides at once (SPY under its 200-day is caution whatever
  the two-year return would have said, and whatever QQQ is doing);
* otherwise a condition that cannot be computed (too few bars, a hole in the closes,
  QQQ not on SPY's session) leaves NO state: ``classify`` returns ``None``, the payload
  carries no line, and nothing is guessed from the conditions that could be read.

WHERE IT RUNS AND WHERE IT LIVES. :func:`compute` is called by ``rs_post_pass.run`` (the
end of every screener build, and after the 04:15 ET rating job), which stores the
result in its own receipt as ``market``. :func:`served` reads the newest receipt back for
``GET /api/screener/saved-screens``, where it rides as a top-level ``rs_market`` while
``RS_SCREENS_ENABLED`` is on. No new table, no new job, no new request from the client.

The build hands this module the SPY bars it already read (and settled); only QQQ is a
new read, through the build's own reader (``snapshot_builder._read_benchmark_bars``).
``listing_break`` adds nothing for an index fund, and that reader applies it anyway.
"""
from __future__ import annotations

import datetime
import logging
import math

log = logging.getLogger(__name__)

CAUTION, PRESSURE, NORMAL = "caution", "pressure", "normal"
STATES = (CAUTION, PRESSURE, NORMAL)

#: The member-facing sentence of each state (plan section 7, unit brief D2). ``normal``
#: shows no line. Served from here, never from a stored receipt, so a wording change
#: reaches members without waiting for the next build.
TEXT = {
    CAUTION: ("Leadership reverses hardest in rebounds after bear markets. "
              "Treat these lists as watchlists."),
    PRESSURE: "Market under pressure. Build the watchlist; breakouts fail more often.",
    NORMAL: "",
}

BENCHMARK = "SPY"
GROWTH = "QQQ"
#: The two averages, in sessions.
LONG_AVG = 200
SHORT_AVG = 50
#: "Two years": the return from the close this many sessions before the newest one.
RETURN_SESSIONS = 504
#: SPY's newest bar may be this many CALENDAR days before the settled session and still
#: be described as the market's state: one session behind across a three-day weekend is
#: four days. Older than that, the bars store has stopped and no state is claimed.
MAX_AGE_DAYS = 4


# --------------------------------------------------------------------------- #
# pure: closes, sessions, the three conditions
# --------------------------------------------------------------------------- #

def _day(t):
    """A bar's ``t`` (a ``YYYYMMDD`` int or string, or an ISO date) as a date, or None."""
    txt = str(t).strip() if t is not None else ""
    try:
        if len(txt) == 8 and txt.isdigit():
            return datetime.date(int(txt[:4]), int(txt[4:6]), int(txt[6:]))
        return datetime.date.fromisoformat(txt[:10])
    except ValueError:
        return None


def last_session(bars):
    """The date of the newest bar, or None for no bars or a bar with no readable date."""
    return _day(bars[-1].get("t")) if bars else None


def closes(bars, need: int):
    """The newest ``need`` closes, oldest first, or None when there are fewer or any of
    them is not a positive finite number. An average over a series with a hole in it
    would be a number about some other window, so it is refused whole."""
    tail = (bars or [])[-need:]
    if need <= 0 or len(tail) < need:
        return None
    out = []
    for b in tail:
        c = b.get("c") if isinstance(b, dict) else None
        if isinstance(c, bool) or not isinstance(c, (int, float)) or not math.isfinite(c) or c <= 0:
            return None
        out.append(float(c))
    return out


def below_average(bars, n: int):
    """True when the newest close is strictly below the average of the newest ``n``
    closes (itself included), False when it is not, None when that cannot be said."""
    cs = closes(bars, n)
    if cs is None:
        return None
    return cs[-1] < sum(cs) / n


def negative_return(bars, sessions: int):
    """True when the newest close is strictly below the close ``sessions`` sessions
    earlier, False when it is not, None when the series does not reach that far."""
    cs = closes(bars, sessions + 1)
    if cs is None:
        return None
    return cs[-1] < cs[0]


def _state(state: str, asof: datetime.date) -> dict:
    return {"state": state, "text": TEXT[state], "asof": asof.isoformat()}


def classify(spy_bars, qqq_bars):
    """``{"state", "text", "asof"}`` from the two series of daily bar dicts (oldest
    first, ``t`` a ``YYYYMMDD`` and ``c`` the close), or ``None`` when no state can be
    claimed (module docstring, FAIL CLOSED). ``asof`` is SPY's newest session. Pure."""
    asof = last_session(spy_bars)
    if asof is None:
        return None
    under_long = below_average(spy_bars, LONG_AVG)
    losing = negative_return(spy_bars, RETURN_SESSIONS)
    if under_long is True or losing is True:
        return _state(CAUTION, asof)
    if under_long is None or losing is None:
        return None                       # caution cannot be ruled out
    under_short = below_average(spy_bars, SHORT_AVG)
    # QQQ answers only for the session SPY's answer is about.
    same_session = last_session(qqq_bars) == asof
    growth_under = below_average(qqq_bars, LONG_AVG) if same_session else None
    if under_short is True or growth_under is True:
        return _state(PRESSURE, asof)
    if under_short is None or growth_under is None:
        return None                       # pressure cannot be ruled out
    return _state(NORMAL, asof)


# --------------------------------------------------------------------------- #
# the read (the build's own reader) and the served copy
# --------------------------------------------------------------------------- #

def compute(*, spy_bars=None, now=None):
    """The state as of the screener's settled session, or ``None``. Never raises.

    ``spy_bars`` is the build's own SPY read when a build calls (it read and settled
    them once already); any other caller leaves it out and SPY is read here, through
    the same reader. Both series are cut at the settled session, so a bar the market
    is still trading is never called a close."""
    try:
        from . import snapshot_builder                       # noqa: PLC0415 - lazy: no cycle
        settled = snapshot_builder.settled_session(now)
        if settled is None:
            return None
        through = int(settled.strftime("%Y%m%d"))
        if spy_bars is None:
            spy_bars = snapshot_builder._read_benchmark_bars(BENCHMARK)
        spy = snapshot_builder.bars_through(spy_bars, through)
        qqq = snapshot_builder.bars_through(
            snapshot_builder._read_benchmark_bars(GROWTH), through)
        asof = last_session(spy)
        if asof is None or (settled - asof).days > MAX_AGE_DAYS:
            return None
        return classify(spy, qqq)
    except Exception as e:                                   # noqa: BLE001 - a line, never a build
        log.warning("[rs_market_state] not computed: %s: %s", type(e).__name__, e)
        return None


def served():
    """What the saved-screens payload carries as ``rs_market``: the newest post-pass
    receipt's state with this module's own words, or ``None`` (the screens are off, no
    pass has run, the pass could claim no state, or the receipt is not one of ours).
    Read-only and never raises."""
    try:
        from . import rs_post_pass                           # noqa: PLC0415 - lazy: no cycle
        if not rs_post_pass.enabled():
            return None
        market = (rs_post_pass.last_run() or {}).get("market")
        if not isinstance(market, dict):
            return None
        state, asof = market.get("state"), _day(market.get("asof"))
        if state not in STATES or asof is None:
            return None
        return _state(state, asof)
    except Exception:                                        # noqa: BLE001
        return None
