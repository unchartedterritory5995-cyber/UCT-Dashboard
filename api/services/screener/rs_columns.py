"""Screener bar-derived RS columns — the UCT Relative Strength indicator's ten
screener columns (plan §10.1 "Screener columns and presets"; engineering map
§2.5 / §3 row 2a-05), computed INSIDE the nightly snapshot build from the daily
bars the build already holds.

⭐ NO MATHS HERE. Every value is the LAST bar of a column `relative_strength`
already computes for the chart — `compute_phase1_columns` (the RS line, its
21 EMA, the 252-bar new high, "before price", the red-day flag, green-on-red),
`compute_mansfield_columns` (Mansfield over 200 daily bars and its zero-cross
age), `bars_ago_column`, `rolling_count` and `benchmark_agree` — so a scan, a
chart dot and an alert read ONE answer (plan §2.3 principle 5).
`tests/test_screener_rs_columns.py` has the AST rail: this module defines no
average, extreme, slope or ratio of its own.

Pure: no env read, no DB, no builder import. `snapshot_builder.build_row`
calls :func:`collect_one` as ``_step("bars_rs", ...)`` with the row's 400-bar
window and the SPY / RSP bar dicts `_run_build_locked` read ONCE at
``DEEP_BARS``; :func:`collect` is the batch shape for a direct caller (a
backfill, a notebook).

⚠️ JOINED BY BAR TIME, NEVER BY INDEX. The benchmark close for a ticker bar is
the benchmark's close at that bar's ``t`` (`relative_strength.rs_line` →
`indicator_compute.compute_rs_line_raw`): a halted name pairs its own sessions,
and one missing SPY bar is one gap, not a shifted ratio for the whole history.
A bare float close list — the pre-2a ``spy_closes`` shape that
`technicals.rs_line_trend` zips positionally — is still accepted through
:func:`_as_bars`, where it takes the TICKER's trailing bar times, the only
calendar a list can have; the builder never uses that path (it hands bar dicts).

Domain (plan §2.3 principle 4 — never invent a value): a flag is ``1``/``0`` as
an int, an age or a count an int, `mansfield` a float rounded to
:data:`MANSFIELD_DP`; ``None`` wherever the column's window is not full
(:data:`MIN_BARS`), the benchmark has no bar for the ticker's newest time, a
hole sits inside the lookback (`rolling_extreme_event` refuses a window with a
gap), or — for the ages — no event has been seen inside the window.
"""

from __future__ import annotations

import datetime as _dt
import math
from typing import Dict, Optional, Sequence

from api.services import relative_strength as rs

# ── The ten columns (engineering map §2.5 "What 2a must build", bar-derived) ──
#
# The seven history-derived rating columns (`rs_rating_ibd`, `rs_rating_chg_5`,
# …) are unit 2a-06's, read from `rs_history`; they are NOT here.
COLUMNS = (
    "rs_new_high",              # rsNH[-1]: RS line at a 252-bar high (ties count)
    "rs_nh_before_price",       # rsNHbeforePx[-1]: RS high while price is NOT at its own (2 % tolerance)
    "rs_nh_red_day",            # rsNHred[-1]: RS high on a day SPY closed down ≥ 0.5 %
    "rs_nh_bars_ago",           # bars since the last full-lookback RS high (0 = today)
    "green_on_red_20",          # how many of the last 20 bars were up on a red SPY day
    "rs_line_above_ma",         # rsAbove[-1]: RS line ≥ its 21 EMA
    "rs_cross_up_bars_ago",     # bars since the RS line last crossed above its 21 EMA
    "mansfield",                # Mansfield RS over 200 daily bars, percent vs its own average
    "mansfield_cross_bars_ago", # bars since Mansfield last crossed the zero line (either way)
    "rs_benchmark_agree",       # 20-bar RS slope sign agrees vs SPY and vs RSP (equal-weight)
)
FLAG_COLUMNS = frozenset({
    "rs_new_high", "rs_nh_before_price", "rs_nh_red_day",
    "rs_line_above_ma", "rs_benchmark_agree",
})
INT_COLUMNS = frozenset(COLUMNS) - {"mansfield"}     # flags, ages, the count

# ── Parameters: the curriculum defaults `relative_strength` declares ────────
LOOKBACK = rs.DEFAULT_LOOKBACK                     # 252 — "52-week"
MA_LENGTH = rs.DEFAULT_MA_LENGTH                   # 21 — the curriculum EMA
MA_TYPE = rs.DEFAULT_MA_TYPE                       # EMA
MANSFIELD_LENGTH = rs.DEFAULT_MANSFIELD_LENGTH     # 200 on DAILY bars (52 is the weekly reading)
GREEN_ON_RED_WINDOW = 20                           # the "6 of 20" starter's window
AGREE_WINDOW = rs.DEFAULT_SENSITIVITY_WINDOW       # 20-bar slope (plan §7 item 22)
#: `mansfield` is a PERCENT (distance from its own average), rounded like the
#: table's other percent columns (`chg_pct_*`, `adr_pct`: two places). The
#: chart provider rounds RATIO columns to six; this is not a ratio.
MANSFIELD_DP = 2

#: Bars the window must hold for each column to be computable at all (gaps
#: aside — a hole inside a lookback is `None` whatever the length). Stated once
#: here; the maths returns `None` below these anyway, and :func:`collect_one`
#: applies the rule explicitly so the two cannot drift.
MIN_BARS: Dict[str, int] = {
    "rs_new_high": LOOKBACK + 1,                 # 252 prior bars + the bar itself
    "rs_nh_before_price": LOOKBACK + 1,
    "rs_nh_red_day": LOOKBACK + 1,               # the red-day leg needs 2; the NH leg dominates
    "rs_nh_bars_ago": LOOKBACK + 1,              # an event can exist only from bar 253
    "green_on_red_20": GREEN_ON_RED_WINDOW + 1,  # a day's change needs a prior bar; 20 known days
    "rs_line_above_ma": MA_LENGTH,               # the EMA's warm-up is length − 1
    "rs_cross_up_bars_ago": MA_LENGTH + 1,       # a cross reads above[t] and above[t − 1]
    "mansfield": MANSFIELD_LENGTH,               # the SMA's warm-up is length − 1
    "mansfield_cross_bars_ago": MANSFIELD_LENGTH + 1,
    "rs_benchmark_agree": AGREE_WINDOW,
}
MIN_BARS_FULL = max(MIN_BARS.values())   # 253: every column computable
MIN_BARS_ANY = min(MIN_BARS.values())    # 20: below this, nothing is

#: The per-ticker outcomes :func:`collect_one` counts into ``stats`` — the
#: builder lands them under ``sources["bars_rs"]`` beside any raise.
OUTCOME_RATED = "rated"          # the window is full (every column had its bars)
OUTCOME_SHORT = "short"          # fewer than MIN_BARS_FULL bars: some or all columns None by length
OUTCOME_NO_BENCH = "no_bench"    # no SPY bars, or SPY has no bar at the ticker's newest time


# ── Shapes ──────────────────────────────────────────────────────────────────

def _finite(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def _ymd(v) -> Optional[int]:
    """``YYYYMMDD`` as an int from an int, a ``'YYYYMMDD'`` / ``'YYYY-MM-DD'``
    string or a date; ``None`` for anything else (an intraday epoch, a synthetic
    index, a blank) — so a comparison is only ever made between two dates."""
    if v is None or isinstance(v, bool):
        return None
    if isinstance(v, _dt.date):
        return v.year * 10000 + v.month * 100 + v.day
    s = str(v).strip().replace("-", "")
    return int(s) if (len(s) == 8 and s.isdigit()) else None


def _as_bars(series, like: Optional[Sequence[dict]] = None) -> list:
    """Bar dicts from either shape the build holds.

    Bar dicts (``t``, ``c``, …) pass through untouched. A bare close list
    becomes bar dicts dated by ``like``'s TRAILING bar times — positional,
    oldest-first, tail-aligned, exactly the zip `technicals.rs_line_trend` does
    — or by ``0 … n−1`` when there is no ``like``. That is the only calendar a
    list can carry; it is the compat path, not the build's.
    """
    if not series:
        return []
    first = series[0]
    if isinstance(first, dict):
        return list(series)
    vals = list(series)
    if like:
        times = [b.get("t") for b in like][-len(vals):]
        vals = vals[-len(times):]
    else:
        times = list(range(len(vals)))
    return [{"t": t, "c": c} for t, c in zip(times, vals)]


def _clip(bars: Sequence[dict], session) -> list:
    """The bars at or before ``session`` (a ``YYYYMMDD`` session key). Values
    FOR a session never read past it; ``None`` means the newest bar. A bar whose
    ``t`` is not a date (the compat index calendar) is never dropped."""
    s = _ymd(session)
    if s is None:
        return list(bars)
    out = []
    for b in bars:
        t = _ymd(b.get("t"))
        if t is None or t <= s:
            out.append(b)
    return out


def _trim_to(bench: list, times) -> list:
    """The benchmark bars whose ``t`` is one of ``times`` (the ticker window's
    bar times), in their own order — review finding #5, 2026-11-07.

    The build hands every row the SAME 5,000-bar SPY / RSP lists; each RS join
    (`rs_line`, `benchmark_closes_aligned`) maps the whole benchmark by time
    and then reads only the window's ~400 times. Trimming once per ticker hands
    every join just the bars it can match, so the answer is identical: the time
    join reads the same close for every window bar (duplicates keep their
    order, so the last one still wins), and a bar the window does not hold was
    never read. ``times`` is ``None`` when a window time cannot be hashed — the
    join itself refuses that, so the benchmark goes through untouched and the
    join answers exactly as before; a benchmark bar whose own time cannot be
    hashed is kept for the same reason.
    """
    if times is None:
        return bench
    out = []
    for b in bench:
        try:
            keep = b.get("t") in times
        except TypeError:
            keep = True
        if keep:
            out.append(b)
    return out


def _times_of(win: Sequence[dict]):
    try:
        return {b.get("t") for b in win}
    except TypeError:
        return None


def _flag(v) -> Optional[int]:
    """{0.0, 1.0, None} → {0, 1, None}."""
    if v is None:
        return None
    return 1 if v == 1.0 else 0


def _int(v) -> Optional[int]:
    return int(v) if _finite(v) else None


def _real(v, dp: int) -> Optional[float]:
    return round(float(v), dp) if _finite(v) else None


def _count(stats: Optional[dict], key: str) -> None:
    if stats is not None:
        stats[key] = stats.get(key, 0) + 1


# ── The collector ───────────────────────────────────────────────────────────

def _blank() -> dict:
    return {
        "rs_new_high": None,
        "rs_nh_before_price": None,
        "rs_nh_red_day": None,
        "rs_nh_bars_ago": None,
        "green_on_red_20": None,
        "rs_line_above_ma": None,
        "rs_cross_up_bars_ago": None,
        "mansfield": None,
        "mansfield_cross_bars_ago": None,
        "rs_benchmark_agree": None,
    }


def collect_one(bars, spy_bars, rsp_bars=None, *, session=None,
                stats: Optional[dict] = None) -> dict:
    """The ten columns for ONE ticker — ``{column: value}``, every key present.

    ``bars`` is the ticker's daily window (the builder's sanitized 400 bars, or
    a float close list); ``spy_bars`` / ``rsp_bars`` the benchmark bar dicts
    (or float lists, see :func:`_as_bars`). ``session`` is the session the
    values are for (``YYYYMMDD``; bars after it are not read; ``None`` = the
    newest bar). ``stats`` is an optional out-dict that receives one of
    :data:`OUTCOME_RATED` / :data:`OUTCOME_SHORT` / :data:`OUTCOME_NO_BENCH`.

    Never raises on a short or empty input; a malformed bar (no ``c``) is a
    ``None`` in every derived column, as everywhere in `relative_strength`.
    """
    values = _blank()
    win = _clip(_as_bars(bars), session)
    n = len(win)
    if n == 0:
        _count(stats, OUTCOME_SHORT)
        return values
    spy = _as_bars(spy_bars, like=win)
    if not spy:
        _count(stats, OUTCOME_NO_BENCH)
        return values
    times = _times_of(win)
    spy = _trim_to(spy, times)

    p1 = rs.compute_phase1_columns(win, spy)      # defaults: 252 / EMA 21 / 2 % / −0.5 %
    rs_spy = p1["rsLine"]
    if rs_spy[-1] is None:
        # SPY holds no bar at the ticker's newest time: no ratio to read today.
        _count(stats, OUTCOME_NO_BENCH)
        return values

    # ONE RS join per benchmark (review finding #5): Mansfield reads the line
    # phase 1 already drew — the same `rs_line` over the same inputs.
    mans = rs.compute_mansfield_columns(win, spy, MANSFIELD_LENGTH, rs_values=rs_spy)
    nh_age = rs.bars_ago_column(p1["rsNH"])
    cross_age = rs.bars_ago_column(p1["crossUp"])
    gor_20 = rs.rolling_count(p1["gor"][-GREEN_ON_RED_WINDOW:], GREEN_ON_RED_WINDOW)

    agree = None
    rsp = _as_bars(rsp_bars, like=win)
    if rsp:
        rs_rsp = rs.rs_line(win, _trim_to(rsp, times))
        # `benchmark_agree` is the plan's THREE-leg sensitivity (SPY, RSP, sector
        # ETF); the screener build holds no sector-ETF series (engineering map
        # §2.5 reads RSP only), so the third leg repeats RSP. The agreement is a
        # SET of slope signs, so a repeated leg changes nothing: this is exactly
        # "the 20-bar RS slope has one sign against SPY and against RSP".
        # Only the newest bar's answer is stored, and it reads exactly the last
        # AGREE_WINDOW bars of each line, so it is asked of those bars alone
        # rather than of every window in the history (review finding #5).
        tail = -AGREE_WINDOW
        agree = rs.benchmark_agree(rs_spy[tail:], rs_rsp[tail:], rs_rsp[tail:], AGREE_WINDOW)[-1]

    values["rs_new_high"] = _flag(p1["rsNH"][-1])
    values["rs_nh_before_price"] = _flag(p1["rsNHbeforePx"][-1])
    values["rs_nh_red_day"] = _flag(p1["rsNHred"][-1])
    values["rs_nh_bars_ago"] = _int(nh_age[-1])
    values["green_on_red_20"] = _int(gor_20[-1])
    values["rs_line_above_ma"] = _flag(p1["rsAbove"][-1])
    values["rs_cross_up_bars_ago"] = _int(cross_age[-1])
    values["mansfield"] = _real(mans["mansfield"][-1], MANSFIELD_DP)
    values["mansfield_cross_bars_ago"] = _int(mans["mansfieldCrossBarsAgo"][-1])
    values["rs_benchmark_agree"] = _flag(agree)

    # The window rule, applied once and explicitly: a column whose minimum the
    # window does not meet is None whatever came back (the maths already says
    # None there; stating it here is what keeps MIN_BARS honest).
    for col, need in MIN_BARS.items():
        if n < need:
            values[col] = None
    _count(stats, OUTCOME_SHORT if n < MIN_BARS_FULL else OUTCOME_RATED)
    return values


def collect(tickers, bars_by_ticker, spy_closes, rsp_closes, *, session,
            stats: Optional[dict] = None) -> Dict[str, dict]:
    """``{TICKER: {column: value}}`` for every ticker named — the batch shape.

    ``bars_by_ticker`` maps a ticker to its daily window (bar dicts or a float
    close list); ``spy_closes`` / ``rsp_closes`` are read ONCE by the caller and
    shared by every ticker (bar dicts at DEEP_BARS, or float lists). A ticker
    with no bars is counted :data:`OUTCOME_SHORT` and gets a row of ``None``,
    never a missing key, so the caller can tell "not computed" from "not asked".
    """
    out: Dict[str, dict] = {}
    for t in tickers or ():
        key = str(t or "").strip().upper()
        if not key or key in out:
            continue
        bars = (bars_by_ticker or {}).get(key)
        if bars is None:
            bars = (bars_by_ticker or {}).get(t)
        out[key] = collect_one(bars or [], spy_closes, rsp_closes,
                               session=session, stats=stats)
    return out
