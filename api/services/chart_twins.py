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
}


def twin_of(column: str):
    """The chart formula (a tree) for one Screener column, or None when it has none."""
    return TWINS.get(column)
