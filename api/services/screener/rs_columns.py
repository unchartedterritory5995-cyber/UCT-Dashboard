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

⭐ PHASE 3 (unit 3-10; engineering map decision D7): three more columns,
:data:`PHASE3_COLUMNS`, computed by :func:`collect_one` ONLY when the builder
passes ``phase3=True`` (``snapshot_builder.rs_v3_enabled()``; dark by default,
and a dark call returns exactly the ten keys and costs nothing). Each is the
last bar of a `relative_strength` Phase 3 column (unit 3-03):

* ``rrg_quadrant`` — `rrg_columns` on WEEKLY bars, resampled from the row's
  full daily series and from SPY through `bars_fetch._resample_weekly_iso` (the
  one weekly resampler, the one `candles.weekly_candle` uses), named by
  `RRG_QUADRANT_NAMES`. See :func:`_weekly_quadrant` for why only a tail of the
  daily series is resampled first and why that is the full-series answer.
* ``clenow_score`` — `clenow_columns` on DAILY bars, 90 closes, 4 dp.
* ``vars_state`` — `vars_columns` on the same DAILY window as the ten, against
  SPY's own sessions over that window's span, named by :data:`VARS_STATE_NAMES`.

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
import time
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

# ── Phase 3 (unit 3-10, decision D7): three columns, DARK unless asked ─────
#
# ⛔ A SEPARATE TUPLE, NOT AN EXTENSION OF `COLUMNS`: `COLUMNS` is the ten every
# armed RS_V2 build writes (and every rail derived from it); these three exist
# only while RS_V3_ENABLED is armed. `snapshot_db.COLUMNS` holds all thirteen.
PHASE3_COLUMNS = (
    "rrg_quadrant",   # WEEKLY: Leading | Weakening | Lagging | Improving vs SPY (the Terminal's RRG)
    "clenow_score",   # DAILY: Clenow annualised slope x R^2 over 90 closes (a fraction, 4 dp)
    "vars_state",     # DAILY: Strong, rising | Strong, fading | Weak, improving | Weak, falling
)
PHASE3_TEXT_COLUMNS = frozenset({"rrg_quadrant", "vars_state"})
RRG_RATIO_LEN = rs.DEFAULT_RRG_RATIO_LEN           # 10 (the Terminal's RRG_METHOD)
RRG_MOM_LEN = rs.DEFAULT_RRG_MOM_LEN               # 5
CLENOW_WINDOW = rs.DEFAULT_CLENOW_WINDOW           # 90 trading days
#: `clenow_score` is a FRACTION (annualised return x R^2, 0.85 = 85 %), so it
#: keeps four places, where a percent column keeps two.
CLENOW_DP = 4
#: `vars_columns`' ``varsState`` codes 1-4, in code order (its docstring).
VARS_STATE_NAMES = ("Strong, rising", "Strong, fading", "Weak, improving", "Weak, falling")
#: Bars each Phase 3 column needs before it can have a value: WEEKLY bars for
#: the quadrant (`rsMomentum` is first known on the ratio_len + mom_len - 1-th
#: joined week), DAILY bars for the other two (VARS: the ATR's warm-up, then
#: `lookback` changes, then the 50-bar average of VARS).
PHASE3_MIN_BARS: Dict[str, int] = {
    "rrg_quadrant": RRG_RATIO_LEN + RRG_MOM_LEN - 1,                       # 14 weeks
    "clenow_score": CLENOW_WINDOW,                                         # 90 days
    "vars_state": (rs.DEFAULT_ATR_LENGTH + rs.DEFAULT_VARS_LOOKBACK
                   + rs.DEFAULT_VARS_MA_LENGTH - 1),                       # 129 days
}
#: Daily bars resampled for the quadrant before the full series is (see
#: :func:`_weekly_quadrant`): 260 sessions is ~52 weeks, almost four times the
#: 14 the newest quadrant reads.
RRG_DAILY_TAIL = 260

# ── RS Exit Warnings (2026-11-13): five columns, the chart's `rsExit` study ─
#
# Mike Webster's Quick Break / Quicksand / Grateful Dead Break on the RS line,
# DAILY bars against SPY at the daily auto lengths (21 / 50 simple averages of
# the RS line, `relative_strength.resolve_exit_lengths("D")`). NO MATHS HERE
# EITHER: the events are `relative_strength.compute_rs_exit_columns` over the
# RS line phase 1 already drew (`rs_values=`, one join), the ages
# `bars_ago_column`, the newest-and-worst `rs_exit_latest` — the functions the
# chart's dots and legend read, so a scan and the chart name the same warning.
# Written by the same RS_V2-gated `bars_rs` step as the ten (they are part of
# that family: `filters.rs_dark_keys` darkens them with it).
#
# Why five and not two: `rs_exit_last` names only the NEWEST warning, so a
# Grateful Dead Break yesterday hides a Quicksand three days ago. "Quicksand in
# the last 5 sessions" needs Quicksand's own age; "any warning in the last 10"
# is `rs_exit_bars_ago`. The three per-warning ages are the minimal set that
# makes every "warning X within N sessions" screen answerable.
EXIT_COLUMNS = (
    "rs_exit_last",              # TEXT: Quick Break | Quicksand | Grateful Dead Break (newest; worse on a tie)
    "rs_exit_bars_ago",          # sessions since that newest warning (0 = the newest bar)
    "rs_quick_break_bars_ago",   # sessions since the last Quick Break
    "rs_quicksand_bars_ago",     # sessions since the last Quicksand
    "rs_dead_break_bars_ago",    # sessions since the last Grateful Dead Break
)
EXIT_TEXT_COLUMNS = frozenset({"rs_exit_last"})
#: The values `rs_exit_last` can hold, mildest first (the order the warnings
#: arrive in a typical cycle): the writer's own words, read by the screener's
#: enum filter rather than retyped there.
EXIT_NAMES = tuple(rs.RS_EXIT_LABELS[k] for k in rs.RS_EXIT_EVENT_COLUMNS)
#: Each per-warning age column and the `rs_exit_events` column it counts back to.
EXIT_AGE_EVENTS: Dict[str, str] = {
    "rs_quick_break_bars_ago": "quickBreak",
    "rs_quicksand_bars_ago": "quicksand",
    "rs_dead_break_bars_ago": "deadBreak",
}
EXIT_FAST, EXIT_SLOW = rs.resolve_exit_lengths("D")   # 21 / 50, the chart's daily auto pair
#: The slow average's warm-up plus the bar before a cross: below this no
#: Grateful Dead Break can be judged, so no column claims "nothing fired".
EXIT_MIN_BARS = EXIT_SLOW + 1

#: Per-column outcomes counted into ``stats`` (the builder's
#: ``sources["bars_rs"]``) when a Phase 3 column comes back ``None``:
#: ``phase3_short:<col>`` when the history is below :data:`PHASE3_MIN_BARS`,
#: ``phase3_none:<col>`` for any other reason (a flat window, no benchmark
#: bar, a VARS of exactly 0).
PHASE3_SHORT = "phase3_short"
PHASE3_NONE = "phase3_none"

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


# ── Phase 3 helpers: shapes and windows only, every number is `rs`'s ───────

def _iso(v) -> Optional[str]:
    """``'YYYY-MM-DD'`` for any date shape :func:`_ymd` reads (the screener's
    bars key by ``YYYYMMDD`` int; the shared weekly resampler keys by ISO)."""
    n = _ymd(v)
    if n is None:
        return None
    return f"{n // 10000:04d}-{n // 100 % 100:02d}-{n % 100:02d}"


def _weekly(bars: Sequence[dict]) -> list:
    """Weekly bars from daily ones through `bars_fetch._resample_weekly_iso`
    (the resampler `candles.weekly_candle` uses; a second bucketing here would
    be a second authority on what a week is). A bar without a date or a finite
    close is skipped; a close-only bar (the float-list compat path) stands in
    its close for O/H/L, which the quadrant never reads."""
    from api.services import bars_fetch
    iso = []
    for b in bars:
        t, c = _iso(b.get("t")), b.get("c")
        if t is None or not _finite(c):
            continue
        hl = {k: (b.get(k) if _finite(b.get(k)) else c) for k in ("o", "h", "l")}
        iso.append({**b, **hl, "t": t})
    return bars_fetch._resample_weekly_iso(iso) if iso else []


def _bench_weekly(bench: Sequence[dict], session, cache: Optional[dict],
                  owner=None) -> list:
    """The benchmark's weekly bars as of ``session`` (the ticker's newest daily
    bar: the benchmark's daily bars at or before it, so a ticker whose newest bar is a Wednesday pairs with SPY's
    week-to-Wednesday, never SPY's Friday close). ``cache`` is the builder's
    per-build dict: one resample per (benchmark list, session), not per row.
    The key holds the ``id`` of ``owner`` (the CALLER's benchmark object, which
    the build holds for its whole life, so the id cannot be reused; ``bench``
    itself is a fresh list per call) plus its length and end times."""
    src = bench if owner is None else owner
    key = (id(src), len(bench), bench[0].get("t") if bench else None,
           bench[-1].get("t") if bench else None, _ymd(session))
    if cache is not None and key in cache:
        return cache[key]
    out = _weekly(_clip(bench, session))
    if cache is not None:
        cache[key] = out
    return out


def _weekly_quadrant(full: Sequence[dict], bench: Sequence[dict],
                     cache: Optional[dict], owner=None):
    """``(code, weekly_bars_read)``: the newest `rrg_columns` quadrant on weekly
    bars of ``full`` (the row's whole daily series) against ``bench`` as of
    ``full``'s newest bar.

    ⭐ THE TAIL IS THE FULL-SERIES ANSWER, EXACTLY. Resampling ~5,000 daily bars
    costs ~55 ms a row and the RRG over ~1,000 weeks ~23 ms (measured on a
    5,000-bar fixture), for one quadrant that reads only the newest
    ``ratio_len + mom_len - 1`` joined weeks. So the last :data:`RRG_DAILY_TAIL`
    daily bars are resampled first. Every week in that tail has the close the
    full resample gives it (a week's close is its LAST daily close, and the tail
    ends on the series' last bar; only the first week's O/H/L can differ, which
    the quadrant does not read), and both averages are window RE-SUMS
    (`compute_sma`), so the newest values depend on the newest joined weeks
    alone. When the tail cannot produce a quadrant and the series is longer,
    the full series is resampled and asked instead, so the answer is always
    the full series' answer (`tests/test_screener_rs_phase3_columns.py`)."""
    tail = full[-RRG_DAILY_TAIL:]
    b_week = _bench_weekly(bench, full[-1].get("t"), cache, owner)
    for part in ((tail, full) if len(full) > len(tail) else (full,)):
        weeks = _weekly(part)
        if not weeks:
            continue
        got = rs.rrg_columns(weeks, _trim_to(b_week, _times_of(weeks)),
                             RRG_RATIO_LEN, RRG_MOM_LEN)["quadrant"][-1]
        if got is not None or part is full:
            return got, len(weeks)
    return None, 0


def _closes_suffix(bars: Sequence[dict], k: int) -> list:
    """The shortest suffix of ``bars`` holding ``k`` finite positive closes:
    exactly the closes `clenow_columns` reads for the newest bar (it skips a
    bar with no positive close), so asking it of this suffix is its newest
    answer over the whole window, at one fit instead of one per bar."""
    seen = 0
    for i in range(len(bars) - 1, -1, -1):
        c = bars[i].get("c")
        if _finite(c) and c > 0:
            seen += 1
            if seen >= k:
                return list(bars[i:])
    return list(bars)


def _span(bench: Sequence[dict], win: Sequence[dict]) -> list:
    """The benchmark's OWN sessions from the window's first bar to its last
    (by date). VARS reads each series' own ATR, so the benchmark keeps its own
    calendar inside the span (a ticker's halt does not thin SPY's ATR) and its
    ATR warms up from the same date the ticker's does. A bar whose time is not
    a date is kept (the compat index calendar)."""
    lo, hi = _ymd(win[0].get("t")), _ymd(win[-1].get("t"))
    if lo is None or hi is None:
        return list(bench)
    out = []
    for b in bench:
        t = b.get("t")
        # The build's bars carry YYYYMMDD ints: compare those directly (5,000
        # benchmark bars a row), and parse any other shape through `_ymd`.
        if not (type(t) is int and 10000101 <= t <= 99991231):
            t = _ymd(t)
        if t is None or lo <= t <= hi:
            out.append(b)
    return out


def _name(code, names) -> Optional[str]:
    """A 1-based classification code -> its name; ``None`` for anything else."""
    if isinstance(code, int) and not isinstance(code, bool) and 1 <= code <= len(names):
        return names[code - 1]
    return None


def _phase3(win: list, full: list, spy_all: list,
            stats: Optional[dict], cache: Optional[dict], owner=None) -> dict:
    """The three Phase 3 columns for one ticker, with their short/none counts."""
    quad, weeks = _weekly_quadrant(full, spy_all, cache, owner)
    clen = rs.clenow_columns(_closes_suffix(win, CLENOW_WINDOW), CLENOW_WINDOW)
    vrs = rs.vars_columns(win, _span(spy_all, win))
    out = {
        "rrg_quadrant": _name(quad, rs.RRG_QUADRANT_NAMES),
        "clenow_score": _real(clen["clenowScore"][-1], CLENOW_DP),
        "vars_state": _name(vrs["varsState"][-1], VARS_STATE_NAMES),
    }
    have = {"rrg_quadrant": weeks, "clenow_score": len(win), "vars_state": len(win)}
    for col in PHASE3_COLUMNS:
        if out[col] is None:
            short = have[col] < PHASE3_MIN_BARS[col]
            _count(stats, f"{PHASE3_SHORT if short else PHASE3_NONE}:{col}")
    return out


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
        **{c: None for c in EXIT_COLUMNS},
    }


def _exit_values(win: list, spy: list, rs_spy: list) -> dict:
    """The five RS Exit Warning columns for one ticker's daily window (see
    :data:`EXIT_COLUMNS`): every value read off `relative_strength`'s columns.
    ``None`` throughout below :data:`EXIT_MIN_BARS`; an age is ``None`` when its
    warning has not fired inside the window, and `rs_exit_last` is ``None`` when
    none has."""
    out = {c: None for c in EXIT_COLUMNS}
    if len(win) < EXIT_MIN_BARS:
        return out
    cols = rs.compute_rs_exit_columns(win, spy, EXIT_FAST, EXIT_SLOW, rs_values=rs_spy)
    for col, event in EXIT_AGE_EVENTS.items():
        out[col] = _int(rs.bars_ago_column(cols[event])[-1])
    kind, idx = rs.rs_exit_latest(cols)
    if kind is not None:
        out["rs_exit_last"] = rs.RS_EXIT_LABELS[kind]
        out["rs_exit_bars_ago"] = len(win) - 1 - idx
    return out


def collect_one(bars, spy_bars, rsp_bars=None, *, session=None,
                stats: Optional[dict] = None, phase3: bool = False,
                full=None, weekly_cache: Optional[dict] = None,
                timing: Optional[dict] = None,
                phase1_out: Optional[dict] = None) -> dict:
    """The ten columns for ONE ticker, plus the five :data:`EXIT_COLUMNS` —
    ``{column: value}``, every key present (and :data:`PHASE3_COLUMNS` as well
    with ``phase3=True``).

    ``bars`` is the ticker's daily window (the builder's sanitized 400 bars, or
    a float close list); ``spy_bars`` / ``rsp_bars`` the benchmark bar dicts
    (or float lists, see :func:`_as_bars`). ``session`` is the session the
    values are for (``YYYYMMDD``; bars after it are not read; ``None`` = the
    newest bar). ``stats`` is an optional out-dict that receives one of
    :data:`OUTCOME_RATED` / :data:`OUTCOME_SHORT` / :data:`OUTCOME_NO_BENCH`.

    ``phase3`` (the builder passes ``rs_v3_enabled()``) adds the three Phase 3
    columns; ``full`` is the row's whole sanitized daily series for the WEEKLY
    quadrant (``None`` = ``bars``); ``weekly_cache`` the builder's per-build
    dict for the benchmark's weekly resample; ``timing`` an optional out-dict
    whose ``phase3_ms`` accumulates the Phase 3 share of this call. A blank
    Phase 3 column lands in ``stats`` as ``phase3_short:<col>`` (history below
    :data:`PHASE3_MIN_BARS`) or ``phase3_none:<col>``, beside the row's own
    outcome; a row with no benchmark ratio at all is ``no_bench`` alone. With
    ``phase3=False`` none of it runs and the result is exactly the ten keys and
    the five exit keys.

    ``phase1_out`` (RS screens unit U4) is an optional out-dict that receives the
    Phase 1 columns this call computed, under ``"phase1"``, so the builder can hand
    them to :func:`screen_fields` instead of paying for a second Phase 1 pass
    (measured 2026-11-14: 0.10 ms a ticker handed in, 2.67 ms recomputed). Left
    empty when the call returned before Phase 1 ran. It changes no value.

    Never raises on a short or empty input; a malformed bar (no ``c``) is a
    ``None`` in every derived column, as everywhere in `relative_strength`.
    """
    values = _blank()
    if phase3:
        values.update({c: None for c in PHASE3_COLUMNS})
    win = _clip(_as_bars(bars), session)
    n = len(win)
    if n == 0:
        _count(stats, OUTCOME_SHORT)
        if phase3:
            for col in PHASE3_COLUMNS:
                _count(stats, f"{PHASE3_SHORT}:{col}")
        return values
    spy_all = _as_bars(spy_bars, like=win)
    if not spy_all:
        _count(stats, OUTCOME_NO_BENCH)
        return values
    times = _times_of(win)
    spy = _trim_to(spy_all, times)

    p1 = rs.compute_phase1_columns(win, spy)      # defaults: 252 / EMA 21 / 2 % / −0.5 %
    if phase1_out is not None:
        phase1_out["phase1"] = p1
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
    # RS Exit Warnings: the chart's rsExit maths over the line drawn above.
    values.update(_exit_values(win, spy, rs_spy))

    # The window rule, applied once and explicitly: a column whose minimum the
    # window does not meet is None whatever came back (the maths already says
    # None there; stating it here is what keeps MIN_BARS honest).
    for col, need in MIN_BARS.items():
        if n < need:
            values[col] = None
    _count(stats, OUTCOME_SHORT if n < MIN_BARS_FULL else OUTCOME_RATED)

    if phase3:
        t0 = time.perf_counter()
        whole = _as_bars(full) if full else win
        last, s = (_ymd(whole[-1].get("t")) if whole else None), _ymd(session)
        if whole is not win and not (last is not None and (s is None or last <= s)):
            # Only a series that runs PAST the session (or is not dated) needs
            # the per-bar clip; the builder's `bars_full` ends on the session.
            whole = _clip(whole, session)
        values.update(_phase3(win, whole or win, spy_all, stats, weekly_cache,
                              owner=spy_bars))
        if timing is not None:
            timing["phase3_ms"] = (timing.get("phase3_ms", 0.0)
                                   + (time.perf_counter() - t0) * 1000.0)
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


# ── RS screens (2026-11-14): six last-bar measures for the five RS lists ────
#
# Plan 2026-11-14 v2, sections 1.2 (RS New Highs) and 1.3 (RS New High Before
# Price). Screener columns since unit U4, NOT written by `collect_one`: the
# builder's own `bars_rs_screens` step stores them, only while RS_SCREENS_ENABLED
# is on (`snapshot_builder.build_row`). NO MATHS HERE EITHER: each value is
# a `relative_strength` helper asked of the Phase 1 columns `collect_one`
# already computes, so a list, the chart's dot and the ten columns above read
# one RS-new-high rule and one before-price rule.
SCREEN_COLUMNS = (
    "rs_nh_count_20",       # RS new highs in the last 20 sessions
    "rs_nh_quiet",          # sessions between the newest RS new high and the one before it
    "rs_nh_red_bars_ago",   # sessions since the newest RS new high on a market down day
    "px_below_high_pct",    # close vs its highest close of 252 sessions, percent, <= 0
    "rs_nhbp_age",          # sessions since an RS new high that price has not followed yet
    "rs_nh_span",           # today is an RS new high: the highest in this many sessions
)
SCREEN_INT_COLUMNS = frozenset(SCREEN_COLUMNS) - {"px_below_high_pct"}
SCREEN_NH_COUNT_WINDOW = rs.SCREEN_NH_COUNT_WINDOW     # 20
SCREEN_NHBP_WINDOW = rs.SCREEN_NHBP_WINDOW             # 63 sessions counting today: ages 0-62
#: `px_below_high_pct` is a PERCENT, rounded like `mansfield` and the table's
#: other percent columns.
PX_BELOW_HIGH_DP = 2
#: The Phase 1 columns `screen_fields` reads. A caller's ``phase1`` is used only
#: when it carries all four at the window's length.
SCREEN_PHASE1_READS = ("rsLine", "rsNH", "rsNHred", "pxNH")


def screen_fields(bars, spy_bars, *, session=None, phase1=None) -> dict:
    """The six :data:`SCREEN_COLUMNS` for ONE ticker's newest bar, every key
    present. ``bars`` / ``spy_bars`` / ``session`` are `collect_one`'s (hand it
    the same RS window, `snapshot_builder.RS_WINDOW_BARS` deep, so an RS new
    high up to 400 sessions old can be seen).

    ``phase1`` is the caller's ``rs.compute_phase1_columns(window, spy)`` when
    it already holds it (`collect_one` does): the six then cost a few backward
    walks instead of a second Phase 1 pass. It is used only when aligned to the
    window; anything else is ignored and recomputed (the ``rs_values``
    convention of `compute_mansfield_columns`).

    ``None`` per measure, never per row: ``px_below_high_pct`` reads the stock
    alone and needs 252 closes; the five RS measures are ``None`` when SPY has
    no bar at the newest time, and each is ``None`` on its own when the series
    is too short or the event rule could not judge a bar it would have to read
    (see the `relative_strength` helpers). ``rs_nh_red_bars_ago`` follows
    ``rs_nh_bars_ago``: it counts back to the newest event the column saw.
    """
    values = {c: None for c in SCREEN_COLUMNS}
    win = _clip(_as_bars(bars), session)
    if not win:
        return values
    below = _real(rs.close_below_high_pct_last([b.get("c") for b in win], LOOKBACK),
                  PX_BELOW_HIGH_DP)
    # `+ 0.0`: a close a hair under the high rounds to 0.0, never a stored "-0.0".
    values["px_below_high_pct"] = None if below is None else below + 0.0

    spy_all = _as_bars(spy_bars, like=win)
    if not spy_all:
        return values
    p1 = phase1
    if not (isinstance(p1, dict)
            and all(len(p1.get(k) or ()) == len(win) for k in SCREEN_PHASE1_READS)):
        p1 = rs.compute_phase1_columns(win, _trim_to(spy_all, _times_of(win)))
    line, nh = p1["rsLine"], p1["rsNH"]
    if line[-1] is None:
        # SPY holds no bar at the ticker's newest time: no RS reading for today.
        return values

    count = rs.rolling_count(nh[-SCREEN_NH_COUNT_WINDOW:], SCREEN_NH_COUNT_WINDOW)
    values["rs_nh_count_20"] = _int(count[-1])
    values["rs_nh_quiet"] = rs.event_gap_last(nh)
    values["rs_nh_red_bars_ago"] = _int(rs.bars_ago_column(p1["rsNHred"])[-1])
    values["rs_nhbp_age"] = rs.event_age_unbroken_last(nh, p1["pxNH"], SCREEN_NHBP_WINDOW)
    if nh[-1] == 1.0:
        values["rs_nh_span"] = rs.level_span_last(line)
    return values
