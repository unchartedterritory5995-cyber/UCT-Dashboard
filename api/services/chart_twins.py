"""⭐ L4 — HOUSE DEFINITIONS (Studio plan, section 7): a term means one thing.

The Screener already defines a set of nightly columns ("ADR %", "ATR %", "RSI 14", "% from the
50-day"), each by one formula over the daily bars (`screener/technicals.py::compute_technicals`).
On a chart a member asks for the same words, and until now the assistant improvised its own
formula for them: measured on production 2026-11-15, "ADR %" came back as a 20-bar average where
the Screener's is 21. One word, two numbers.

A TWIN is the per-bar chart formula of one Screener column. Each twin here is PROVED EQUAL to its
column by a value test on the same bars (`tests/test_chart_twins_parity.py`), so if either side
moves (a window, a smoothing, a rounding) the test fails rather than the two quietly disagreeing.
That test, not this file's comments, is the authority on the equality.

⛔ ONLY A COLUMN WHOSE CHART FORM IS EXACT GETS A TWIN. A column the chart cannot compute the same
way (a nightly snapshot of fundamentals, a cross-sectional rank) has none, and the assistant says
so instead of approximating it.

The trees use the closed table's own names (`closedTable.json`): no new function is declared here.
"""
from __future__ import annotations

from typing import Any, Dict


def _s(name: str) -> Dict[str, Any]:
    return {"type": "series", "name": name}


def _n(value: float) -> Dict[str, Any]:
    return {"type": "num", "value": value}


def _call(name: str, *args: Dict[str, Any]) -> Dict[str, Any]:
    return {"type": "call", "name": name, "args": list(args)}


def _op(name: str, a: Dict[str, Any], b: Dict[str, Any]) -> Dict[str, Any]:
    return {"type": "op", "name": name, "args": [a, b]}


def _ago(expr: Dict[str, Any], bars: int) -> Dict[str, Any]:
    """`expr` as it was `bars` bars ago (the bounded backward offset, `expr[bars]`)."""
    return {"type": "offset", "value": bars, "args": [expr]}


def _pct_vs(a: Dict[str, Any], b: Dict[str, Any]) -> Dict[str, Any]:
    """How far `a` is from `b`, in percent: (a - b) / b * 100 (the Screener's `_pct`)."""
    return _op("*", _op("/", _op("-", a, b), b), _n(100))


def _pct_from(avg: Dict[str, Any]) -> Dict[str, Any]:
    """How far the close is from `avg`, in percent: (close - avg) / avg * 100."""
    return _pct_vs(_s("close"), avg)


def _adr(period: int) -> Dict[str, Any]:
    """The mean of (high - low) / close over `period` bars, in percent."""
    return _op("*", _call("sma", _op("/", _op("-", _s("high"), _s("low")), _s("close")), _n(period)), _n(100))


#: Screener column -> its per-bar chart formula. Every entry is held equal to the column by
#: `tests/test_chart_twins_parity.py`; add one only with its parity case.
TWINS: Dict[str, Dict[str, Any]] = {
    # Wilder's 14-period RSI of the daily close.
    "rsi14": _call("rsi", _s("close"), _n(14)),
    # ADR %: the mean of (high - low) / close over 21 sessions, x100 (not high/low - 1).
    "adr_pct": _adr(21),
    # ADR % over the last 5 sessions.
    "adr_pct_1w": _adr(5),
    # ATR %: Wilder's 14-bar average TRUE range as a percent of the close (it includes gaps).
    "atr_pct": _op("*", _op("/", _call("atr", _s("high"), _s("low"), _s("close"), _n(14)), _s("close")), _n(100)),
    # How far the close is from its 20-, 50- and 200-day simple averages, in percent.
    "pct_vs_sma20": _pct_from(_call("sma", _s("close"), _n(20))),
    "pct_vs_sma50": _pct_from(_call("sma", _s("close"), _n(50))),
    "pct_vs_sma200": _pct_from(_call("sma", _s("close"), _n(200))),
    # ...and from its 20-day exponential average.
    "pct_vs_ema20": _pct_from(_call("ema", _s("close"), _n(20))),
    # Change in percent over 1, 5 and 21 sessions (a day, a week, a month).
    "chg_pct_1d": _pct_vs(_s("close"), _ago(_s("close"), 1)),
    "chg_pct_1w": _pct_vs(_s("close"), _ago(_s("close"), 5)),
    "chg_pct_1m": _pct_vs(_s("close"), _ago(_s("close"), 21)),
    # The gap: today's open against yesterday's close, in percent.
    "gap_pct": _pct_vs(_s("open"), _ago(_s("close"), 1)),
    # How far the close is from the highest high and the lowest low of the last 20 sessions.
    "dist_20d_high_pct": _pct_vs(_s("close"), _call("highest", _s("high"), _n(20))),
    "dist_20d_low_pct": _pct_vs(_s("close"), _call("lowest", _s("low"), _n(20))),
    # Relative volume: today's volume over the mean of the 30 sessions BEFORE today.
    "vol_ratio": _op("/", _s("volume"), _ago(_call("sma", _s("volume"), _n(30)), 1)),
    # ⭐ 2026-11-17 (backlog 33) -- the 52-week distances: the close against the highest high and the
    # lowest low of the last 252 sessions (today's bar included, as the Screener's window is).
    "dist_52w_high_pct": _pct_vs(_s("close"), _call("highest", _s("high"), _n(252))),
    "dist_52w_low_pct": _pct_vs(_s("close"), _call("lowest", _s("low"), _n(252))),
    # Change in percent over a year: the close against the close 252 sessions ago.
    "chg_pct_1y": _pct_vs(_s("close"), _ago(_s("close"), 252)),
    # Extension above the 50-day simple average in ATR units: (close - SMA 50) / ATR 14.
    "atr_ext_sma50": _op("/", _op("-", _s("close"), _call("sma", _s("close"), _n(50))),
                         _call("atr", _s("high"), _s("low"), _s("close"), _n(14))),
    # ⭐ 2026-11-17 (backlog 47) -- COLUMNS THE FORMULA TABLE LEAVES OUT AND A CHART COMPUTES EXACTLY.
    # As nightly scalars they are not names a formula may read (`CHART_ONLY` below); as per-bar
    # formulas they are ordinary maths, proved equal to the column like every other twin.
    # How far the close is from its 9- and 10-day exponential averages, in percent.
    "pct_vs_ema9": _pct_from(_call("ema", _s("close"), _n(9))),
    "pct_vs_ema10": _pct_from(_call("ema", _s("close"), _n(10))),
    # Average volume over 10 and 50 sessions (today included).
    "avg_volume_10d": _call("sma", _s("volume"), _n(10)),
    "avg_volume_50d": _call("sma", _s("volume"), _n(50)),
    # Volume trend: the 5-session average volume against the 20-session one, in percent.
    "vol_trend_pct": _pct_vs(_call("sma", _s("volume"), _n(5)), _call("sma", _s("volume"), _n(20))),
}

#: The twins of columns the formula table deliberately does not carry. On the chart door the
#: Screener's own label for one of these ("Avg Volume (50d)", "EMA9 Distance") used to answer "not
#: available", beside an indicator the chart could draw exactly. There it is a term with this
#: formula (`definition_conversation._chart_lexicon`); the Screener's planner still says what is true
#: for a SCREEN, where the column itself is not a formula name.
CHART_ONLY = frozenset({"pct_vs_ema9", "pct_vs_ema10", "avg_volume_10d", "avg_volume_50d", "vol_trend_pct"})


def _distance_phrases(leads, windows, edge):
    return tuple(" ".join(w for w in (lead, art, win, edge) if w)
                 for lead in leads for art in ("", "the", "its", "a") for win in windows)


_FROM_HIGH = ("distance from", "dist from", "percent from", "pct from", "percent off", "percent below",
              "how far from", "how far off", "how far below")
_FROM_LOW = ("distance from", "dist from", "percent from", "pct from", "percent off", "percent above",
             "how far from", "how far off", "how far above")
_W52 = ("52 week", "52w", "52wk", "52 wk")
_D20 = ("20 day", "20d")
_YEAR = ("1 year", "one year", "1y", "1yr", "12 month")
_SMA50 = ("50 sma", "50sma", "50 day sma", "50 day", "50 dma", "50 day ma", "50 day moving average",
          "50 day simple moving average")
_ATR_LEADS = ("atr extension from", "atr extension vs", "atr extension above", "atr extension over",
              "atr multiple from", "atr multiples from", "atr multiple above", "atr multiples above",
              "atrs above", "atrs from")

#: ⭐ 2026-11-17 -- THE WORDS MEMBERS USE FOR A HOUSE TERM. The Screener's own label ("Volume Ratio",
#: "Dist from 52W High") is how the firm words a column in its UI; a member on a chart writes
#: "relative volume" or "distance from the 52 week high", and until now those reached the assistant
#: with no house definition (measured: of fifteen such phrasings only "ADR" and "gap" were recognised).
#: Each phrase names ONE column that has a twin. ⛔ A phrase is listed only when it carries the term's
#: own numbers ("52 week", "the 50 day"): "ATR extension from the 21 EMA" is the member's own measure
#: and matches nothing here. Read by the chart door's lexicon only; the Screener's planner is unchanged.
SPOKEN: Dict[str, tuple] = {
    "vol_ratio": ("relative volume", "relative vol", "rel volume", "rel vol", "rvol"),
    "dist_52w_high_pct": _distance_phrases(_FROM_HIGH, _W52, "high"),
    "dist_52w_low_pct": _distance_phrases(_FROM_LOW, _W52, "low"),
    "dist_20d_high_pct": _distance_phrases(_FROM_HIGH, _D20, "high"),
    "dist_20d_low_pct": _distance_phrases(_FROM_LOW, _D20, "low"),
    "chg_pct_1y": tuple(p for y in _YEAR for p in (
        f"{y} change", f"{y} percent change", f"{y} performance", f"{y} return",
        f"change over {y}", f"percent change over {y}", f"performance over {y}", f"return over {y}")),
    "atr_ext_sma50": tuple(" ".join(w for w in (lead, art, tail) if w)
                           for lead in _ATR_LEADS for art in ("", "the", "its") for tail in _SMA50),
}


def spoken_phrases():
    """Every (phrase, column) pair of `SPOKEN`, for the chart door's lexicon."""
    return tuple((phrase, column) for column, phrases in SPOKEN.items() for phrase in phrases)


def twin_of(column: str):
    """The chart formula (a tree) for one Screener column, or None when it has none."""
    return TWINS.get(column)
