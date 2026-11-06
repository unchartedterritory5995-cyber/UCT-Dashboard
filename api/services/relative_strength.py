"""UCT Relative Strength — the pure column math behind the `rsLine` server-lane
definition (Phase 1 of docs/superpowers/specs/2026-11-05-uct-relative-strength-
indicator-design.md, §7 "Exact definitions").

⭐ ONE MODULE, PURE, NO I/O. Every function takes aligned Python lists and returns
aligned Python lists. The router (`api/routers/signature.py::_rs_line_provider`)
fetches bars and resolves the benchmark; the screener and the nightly jobs call
the same functions, so the chart, a scan and an alert can never disagree about
what an "RS new high" is (plan §2.3 principle 5).

Notation follows plan §7: ``C[t]`` stock close, ``B[t]`` benchmark close joined
by bar TIME (never index — ``indicator_compute.compute_rs_line_raw`` owns that
join and is reused here), ``rs[t] = C[t] / B[t]``, ``N`` the new-high lookback,
``L`` the moving-average length.

⛔ NEVER INVENT A VALUE (plan §2.3 principle 4). A bar where either close is
missing is ``None`` in every derived column. An event column's domain is
``{0, 1, None}``: ``1`` the event, ``0`` computed-and-did-not-happen, ``None``
the warm-up pad. The chart's marker primitive reads exactly that domain
(`markerPrimitive.js`: "AN EVENT COLUMN'S DOMAIN IS {0, 1, NaN} AND ALL THREE
MEAN SOMETHING"); the wire turns ``None`` into JSON ``null`` and the client
turns ``null`` back into ``NaN``.

⭐ DOT COLUMNS ARE A SECOND SHAPE, ON PURPOSE. A glyph drawn *on the RS line* in
the RS pane rides the plot's own series with ``position: 'inBar'``, which the
binder places at the plotted VALUE (`binder.js`: "THE MARKERS RIDE THE PLOT'S
OWN SERIES … `inBar` means `location.absolute`"), and the marker builder draws
a glyph wherever the column is finite and ``> 0`` (`markerPrimitive.marks`).
So a dot column carries the RS VALUE on event bars and ``None`` elsewhere — a
positive number exactly where a dot belongs, at exactly the height of the
line. The 0/1 event columns stay beside them for scans and alerts.
"""

from __future__ import annotations

import math
from typing import Dict, List, Optional, Sequence

from api.services.indicator_compute import (
    compute_ema,
    compute_rs_line_raw,
    compute_sma,
)

MaybeNum = Optional[float]
Column = List[MaybeNum]

# ── Defaults (plan §6.3; owner decisions D1–D3, D9 accepted 2026-11-05) ─────
DEFAULT_LOOKBACK = 252          # one trading year — what MarketSurge calls "52-week"
DEFAULT_MA_LENGTH = 21          # the curriculum's 21 EMA (video 59)
DEFAULT_MA_TYPE = "EMA"
DEFAULT_PRICE_TOLERANCE_PCT = 2.0   # price "at its high" when within 2 % of it
DEFAULT_RED_DAY_PCT = -0.5          # benchmark closed down at least 0.5 %
MIN_PARTIAL_LOOKBACK = 20           # short-history dots need at least this many bars

# Phase 2a (unit 2a-02). Mansfield's ``n`` is 52 on weekly bars and 200 on daily
# (KB 01-methodologies §2; plan §6.3 `mansfieldLength` 200, the Trend weekly
# preset sets 52). The sensitivity window is plan §7 item 22's 20-bar slope.
DEFAULT_MANSFIELD_LENGTH = 200
DEFAULT_SENSITIVITY_WINDOW = 20

# Clamps the provider applies to raw inputs. `registry_defs.resolve_inputs`
# enforces enum vocabularies only; numbers arrive as the client sent them.
LOOKBACK_RANGE = (20, 500)
MA_LENGTH_RANGE = (2, 200)
PRICE_TOLERANCE_RANGE = (0.0, 10.0)
RED_DAY_RANGE = (-3.0, 0.0)
MANSFIELD_LENGTH_RANGE = (2, 500)


def _clamp(v, lo, hi, default):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return default
    if not math.isfinite(f):
        return default
    return min(hi, max(lo, f))


def _is_num(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


# ── The ratio and its average ───────────────────────────────────────────────

def rs_line(bars: Sequence[dict], benchmark_bars: Sequence[dict]) -> Column:
    """``rs[t] = C[t] / B[t]``, joined by bar time. Delegates to the one RS join
    the repo already has, so there is exactly one answer to "which benchmark
    close belongs to this bar"."""
    return list(compute_rs_line_raw(list(bars), list(benchmark_bars)))


def rs_moving_average(rs: Column, length: int, ma_type: str = DEFAULT_MA_TYPE) -> Column:
    """EMA (default) or SMA of the RS line, aligned to ``rs``.

    ⚠️ GAPS ARE SKIPPED, NOT ZEROED. A ``None`` in ``rs`` (a benchmark bar that
    does not exist for this time) would poison an EMA recursion forever if it
    were fed in as 0. The average is computed over the VALID values in order and
    mapped back to their own indices; gap bars stay ``None``. The first
    ``length − 1`` valid bars are the warm-up pad (plan §7.2).
    """
    n = len(rs)
    out: Column = [None] * n
    idx = [i for i, v in enumerate(rs) if _is_num(v)]
    if len(idx) < max(1, length):
        return out
    values = [float(rs[i]) for i in idx]
    core = compute_ema(values, length) if str(ma_type).upper() == "EMA" else compute_sma(values, length)
    for j, i in enumerate(idx):
        out[i] = core[j]
    return out


def above_column(rs: Column, ma: Column) -> Column:
    """``rsAbove[t] = rs[t] ≥ rsMA[t]`` as {0, 1, None}."""
    out: Column = [None] * len(rs)
    for i, (v, m) in enumerate(zip(rs, ma)):
        if _is_num(v) and _is_num(m):
            out[i] = 1.0 if v >= m else 0.0
    return out


def cross_columns(above: Column) -> Dict[str, Column]:
    """``crossUp[t] = above[t] ∧ ¬above[t−1]``; ``crossDown`` the mirror (plan §7.9)."""
    n = len(above)
    up: Column = [None] * n
    down: Column = [None] * n
    for i in range(1, n):
        a, p = above[i], above[i - 1]
        if a is None or p is None:
            continue
        up[i] = 1.0 if (a == 1.0 and p == 0.0) else 0.0
        down[i] = 1.0 if (a == 0.0 and p == 1.0) else 0.0
    return {"crossUp": up, "crossDown": down}


# ── New highs and lows ─────────────────────────────────────────────────────

def rolling_extreme_event(series: Column, lookback: int, *, high: bool,
                          tolerance_pct: float = 0.0) -> Column:
    """``1`` when ``series[t]`` is at or beyond the extreme of the PRIOR
    ``lookback`` values, ``0`` when it is not, ``None`` until ``lookback`` prior
    values exist AND every one of them is present (plan §7.3–7.4).

    * Ties count as a new extreme — the ChillLax / TradingView convention the
      research recorded (02 §1.3), and the one a member comparing dots against
      a TradingView script will expect.
    * ``tolerance_pct`` loosens the test for PRICE: price is "at its high" when
      ``C[t] ≥ max × (1 − tol)`` (plan §7.4, default 2 %). Zero for the RS line.
    * A gap anywhere in the window makes the bar ``None``, never a guess: a
      window with a hole has no honest maximum.
    """
    n = len(series)
    out: Column = [None] * n
    if lookback <= 0:
        return out
    tol = max(0.0, float(tolerance_pct)) / 100.0
    for t in range(lookback, n):
        v = series[t]
        if not _is_num(v):
            continue
        window = series[t - lookback:t]
        if any(not _is_num(w) for w in window):
            continue
        if high:
            ext = max(window)
            hit = v >= ext * (1.0 - tol)
        else:
            ext = min(window)
            hit = v <= ext * (1.0 + tol)
        out[t] = 1.0 if hit else 0.0
    return out


def partial_extreme_event(series: Column, lookback: int, *, high: bool,
                          min_bars: int = MIN_PARTIAL_LOOKBACK) -> Column:
    """The short-history variant (plan §7.3, `shortHistoryDots`): the same test
    over ALL available prior bars when fewer than ``lookback`` exist, ``None``
    before ``min_bars``. Bars with a full lookback are ``None`` here — the
    full-window column owns them — so the two columns never both fire."""
    n = len(series)
    out: Column = [None] * n
    for t in range(min_bars, min(n, lookback)):
        v = series[t]
        if not _is_num(v):
            continue
        window = [w for w in series[:t] if _is_num(w)]
        if len(window) < min_bars:
            continue
        ext = max(window) if high else min(window)
        out[t] = 1.0 if (v >= ext if high else v <= ext) else 0.0
    return out


def and_not(a: Column, b: Column) -> Column:
    """``a ∧ ¬b`` over {0, 1, None}: ``None`` if either side is ``None``."""
    out: Column = [None] * len(a)
    for i, (x, y) in enumerate(zip(a, b)):
        if x is None or y is None:
            continue
        out[i] = 1.0 if (x == 1.0 and y == 0.0) else 0.0
    return out


def both(a: Column, b: Column) -> Column:
    """``a ∧ b`` over {0, 1, None}."""
    out: Column = [None] * len(a)
    for i, (x, y) in enumerate(zip(a, b)):
        if x is None or y is None:
            continue
        out[i] = 1.0 if (x == 1.0 and y == 1.0) else 0.0
    return out


# ── Red days, green-on-red ────────────────────────────────────────────────

def pct_change(closes: Column) -> Column:
    """``closes[t] / closes[t−1] − 1`` in PERCENT; ``None`` where either is missing."""
    n = len(closes)
    out: Column = [None] * n
    for t in range(1, n):
        c, p = closes[t], closes[t - 1]
        if _is_num(c) and _is_num(p) and p != 0:
            out[t] = (c / p - 1.0) * 100.0
    return out


def red_day_column(benchmark_change_pct: Column, threshold_pct: float = DEFAULT_RED_DAY_PCT) -> Column:
    """``red[t] = Δ%B[t] ≤ threshold`` (plan §7.6; threshold is negative, default −0.5)."""
    out: Column = [None] * len(benchmark_change_pct)
    for i, d in enumerate(benchmark_change_pct):
        if _is_num(d):
            out[i] = 1.0 if d <= threshold_pct else 0.0
    return out


def green_day_column(benchmark_change_pct: Column, threshold_pct: float) -> Column:
    """``green[t] = Δ%B[t] ≥ threshold`` — the mirror of `red_day_column`, with the
    threshold given as a POSITIVE magnitude (default +0.5)."""
    out: Column = [None] * len(benchmark_change_pct)
    for i, d in enumerate(benchmark_change_pct):
        if _is_num(d):
            out[i] = 1.0 if d >= threshold_pct else 0.0
    return out


def up_day_column(stock_change_pct: Column) -> Column:
    out: Column = [None] * len(stock_change_pct)
    for i, d in enumerate(stock_change_pct):
        if _is_num(d):
            out[i] = 1.0 if d > 0 else 0.0
    return out


def down_day_column(stock_change_pct: Column) -> Column:
    """Strictly down (a flat day is neither up nor down)."""
    out: Column = [None] * len(stock_change_pct)
    for i, d in enumerate(stock_change_pct):
        if _is_num(d):
            out[i] = 1.0 if d < 0 else 0.0
    return out


def rolling_count(events: Column, window: int) -> Column:
    """How many of the last ``window`` bars (inclusive) were ``1``; ``None`` until
    ``window`` bars of the event column are known."""
    n = len(events)
    out: Column = [None] * n
    for t in range(window - 1, n):
        seg = events[t - window + 1:t + 1]
        if any(e is None for e in seg):
            continue
        out[t] = float(sum(1 for e in seg if e == 1.0))
    return out


# ── Dot columns (value where the event fired) ───────────────────────────────

def dot_column(values: Column, events: Column) -> Column:
    """``values[t]`` where ``events[t] == 1``, else ``None`` — the shape a marker
    plot with ``position: 'inBar'`` needs to sit ON the line (module header)."""
    out: Column = [None] * len(values)
    for i, (v, e) in enumerate(zip(values, events)):
        if e == 1.0 and _is_num(v) and v > 0:
            out[i] = v
    return out


# ── Benchmark-aligned closes ───────────────────────────────────────────────

def benchmark_closes_aligned(bars: Sequence[dict], benchmark_bars: Sequence[dict]) -> Column:
    """The benchmark close at each STOCK bar's time, ``None`` where the benchmark
    has no bar for that time — the same join `compute_rs_line_raw` performs,
    exposed so red-day logic reads the benchmark on the stock's own calendar."""
    close_at: Dict[object, float] = {}
    for b in benchmark_bars:
        c = b.get("c")
        if _is_num(c):
            close_at[b.get("t")] = float(c)
    out: Column = []
    for bar in bars:
        bc = close_at.get(bar.get("t"))
        out.append(bc if (bc is not None and bc != 0) else None)
    return out


# ── The Phase 1 column set, in one call ─────────────────────────────────────

PHASE1_COLUMNS = (
    "rsLine", "rsMa", "rsAbove",
    "rsNH", "rsNHpartial", "pxNH", "rsNHbeforePx", "rsNHred", "rsNL",
    "gor", "rog", "crossUp", "crossDown",
    "dotNH", "dotNHbeforePx", "dotNHred", "dotNHpartial", "dotNL",
)


def resolve_phase1_inputs(inputs: Optional[dict]) -> dict:
    """Clamp the numeric inputs to the ranges the definition declares (plan §6.3)
    and fill defaults. Enum vocabularies are the server definition's business
    (`registry_defs.resolve_inputs`); this only guards the numbers."""
    src = inputs if isinstance(inputs, dict) else {}
    ma_type = str(src.get("maType") or DEFAULT_MA_TYPE).upper()
    if ma_type not in ("EMA", "SMA"):
        ma_type = DEFAULT_MA_TYPE
    return {
        "lookback": int(_clamp(src.get("lookback"), *LOOKBACK_RANGE, default=DEFAULT_LOOKBACK)),
        "maLength": int(_clamp(src.get("maLength"), *MA_LENGTH_RANGE, default=DEFAULT_MA_LENGTH)),
        "maType": ma_type,
        "priceTolerance": _clamp(src.get("priceTolerance"), *PRICE_TOLERANCE_RANGE,
                                 default=DEFAULT_PRICE_TOLERANCE_PCT),
        "redDayThreshold": _clamp(src.get("redDayThreshold"), *RED_DAY_RANGE,
                                  default=DEFAULT_RED_DAY_PCT),
    }


def compute_phase1_columns(bars: Sequence[dict], benchmark_bars: Sequence[dict],
                           inputs: Optional[dict] = None, *, short_history: bool = False) -> Dict[str, Column]:
    """Every Phase 1 column of plan §8, aligned to ``bars``.

    Pure; the caller rounds for the wire (`indicator_compute` rounds the RS line
    to 6 dp because it is a ratio, not a price — the same rule applies here and
    is applied by the provider, not by this function).

    ``short_history`` — True only when ``bars`` is the stock's WHOLE history
    (the caller asked the store for more bars than exist). The partial-lookback
    dots (`rsNHpartial` / `dotNHpartial`) are meaningful only then: on a long
    history the first bars of a fetched window are an arbitrary slice, and a
    "high over all available bars" at their head would be a dot on nothing
    (review finding, 2026-11-06). Off ⇒ those two columns are all ``None``.
    """
    p = resolve_phase1_inputs(inputs)
    n = len(bars)
    if n == 0:
        return {k: [] for k in PHASE1_COLUMNS}

    closes: Column = [float(b["c"]) if _is_num(b.get("c")) else None for b in bars]
    bench: Column = benchmark_closes_aligned(bars, benchmark_bars)

    rs = rs_line(bars, benchmark_bars)
    ma = rs_moving_average(rs, p["maLength"], p["maType"])
    above = above_column(rs, ma)
    crosses = cross_columns(above)

    rs_nh = rolling_extreme_event(rs, p["lookback"], high=True)
    rs_nh_partial = (partial_extreme_event(rs, p["lookback"], high=True) if short_history
                     else [None] * n)
    rs_nl = rolling_extreme_event(rs, p["lookback"], high=False)
    px_nh = rolling_extreme_event(closes, p["lookback"], high=True, tolerance_pct=p["priceTolerance"])
    nh_before_px = and_not(rs_nh, px_nh)

    # ⭐ RED ON GREEN IS THE MIRROR OF GREEN ON RED, in both halves (plan §7.9): a
    # "green" benchmark day is up by at least the same magnitude the red-day
    # threshold asks for, and the stock must be DOWN, not merely not-up. The
    # earlier shape ("not red" and "not up") fired on flat and −0.4 % benchmark
    # days and on flat stock days — a different, looser event wearing the name.
    bench_chg = pct_change(bench)
    stock_chg = pct_change(closes)
    red = red_day_column(bench_chg, p["redDayThreshold"])
    green = green_day_column(bench_chg, -p["redDayThreshold"])
    up = up_day_column(stock_chg)
    down = down_day_column(stock_chg)
    gor = both(red, up)
    rog = both(green, down)
    nh_red = both(rs_nh, red)

    return {
        "rsLine": rs,
        "rsMa": ma,
        "rsAbove": above,
        "rsNH": rs_nh,
        "rsNHpartial": rs_nh_partial,
        "pxNH": px_nh,
        "rsNHbeforePx": nh_before_px,
        "rsNHred": nh_red,
        "rsNL": rs_nl,
        "gor": gor,
        "rog": rog,
        "crossUp": crosses["crossUp"],
        "crossDown": crosses["crossDown"],
        "dotNH": dot_column(rs, rs_nh),
        "dotNHbeforePx": dot_column(rs, nh_before_px),
        "dotNHred": dot_column(rs, nh_red),
        "dotNHpartial": dot_column(rs, rs_nh_partial),
        "dotNL": dot_column(rs, rs_nl),
    }


# ── Phase 2a (unit 2a-02): Mansfield RS, bars-ago ages, benchmark agreement ─
#
# Plan §7 item 13 (Mansfield) and item 22 (benchmark sensitivity); engineering
# map §2.5 / §2.6 name what the screener (`mansfield`, `mansfield_cross_bars_ago`,
# `rs_nh_bars_ago`, `rs_cross_up_bars_ago`, `rs_benchmark_agree`) and the alert
# lane (`rs_line.mansfield`, condition `cross_zero`) read from here. Same
# contract as everything above: pure, aligned to the input, no I/O, and a bar
# whose benchmark close is missing is ``None`` in every derived column.

def mansfield_column(rs: Column, length: int) -> Column:
    """Mansfield Relative Strength over the RS ratio (KB 01-methodologies §2):

        RP[t]  = rs[t] × 100                           the "relative performance" line
        MRS[t] = (RP[t] / SMA(RP, n)[t] − 1) × 100     n = ``length``

    The zero line is the flattened n-bar average of the ratio; above it the
    stock is outperforming its own trend against the benchmark. Weinstein's
    ``n`` is 52 on weekly bars and 200 on daily — the caller picks (plan §6.3
    `mansfieldLength`). The ×100 is kept so the column IS the published formula
    rather than an algebraic equivalent of it.

    ⚠️ GAPS ARE SKIPPED, NOT ZEROED. The SMA runs over the VALID bars in order
    (`rs_moving_average`), so the first ``length − 1`` valid bars are the
    warm-up pad and a gap bar (``rs[t] is None``) is ``None`` here without
    resetting the average. ``None`` also where the average is zero — impossible
    for a positive ratio, refused rather than divided by.
    """
    n = len(rs)
    rp: Column = [float(v) * 100.0 if _is_num(v) else None for v in rs]
    sma = rs_moving_average(rp, length, "SMA")
    out: Column = [None] * n
    for i in range(n):
        p, m = rp[i], sma[i]
        if _is_num(p) and _is_num(m) and m != 0:
            out[i] = (p / m - 1.0) * 100.0
    return out


def mansfield_state_column(mrs: Column) -> List[Optional[int]]:
    """The three-state Mansfield read (plan §7 item 13's shading; the
    stageanalysis convention KB §2 records), as INTS:

         1  bull    — above zero AND rising   (mrs[t] > 0 and mrs[t] > mrs[t−1])
        -1  bear    — below zero AND falling  (mrs[t] < 0 and mrs[t] < mrs[t−1])
         0  neutral — every other computable bar: above but falling, below but
                      rising, exactly zero, or unchanged
      None  — mrs[t] or mrs[t−1] is None: the warm-up pad, a gap bar, and the
              bar after a gap (no honest prior to compare against — the same
              strict prior-bar rule `cross_columns` applies)

    ⚠️ THE ONE INT-VALUED COLUMN IN THIS MODULE. Every event column is
    {0.0, 1.0, None} by type because the marker primitive reads "finite and
    > 0" as a glyph; this column is a CLASSIFICATION — the screener stores it
    in `_INT`, the chart shades the pane by it — so it carries −1 / 0 / 1 as
    Python ints and no marker plot may name it. Domain: {-1, 0, 1, None}.
    """
    n = len(mrs)
    out: List[Optional[int]] = [None] * n
    for t in range(1, n):
        v, p = mrs[t], mrs[t - 1]
        if not (_is_num(v) and _is_num(p)):
            continue
        if v > 0 and v > p:
            out[t] = 1
        elif v < 0 and v < p:
            out[t] = -1
        else:
            out[t] = 0
    return out


def above_zero_column(mrs: Column) -> Column:
    """``mrs[t] ≥ 0`` as {0, 1, None} — the same ``≥`` `above_column` uses for
    the RS line against its MA, so "crossed the zero line" and "crossed the
    average" are one rule in two places."""
    out: Column = [None] * len(mrs)
    for i, v in enumerate(mrs):
        if _is_num(v):
            out[i] = 1.0 if v >= 0 else 0.0
    return out


def mansfield_cross_column(mrs: Column) -> Dict[str, Column]:
    """``crossUp[t] = (mrs[t] ≥ 0) ∧ (mrs[t−1] < 0)``; ``crossDown`` the mirror —
    the same shape, and the same code, as `cross_columns` (plan §7.9), over the
    zero line instead of the MA. Both ``None`` where either bar's MRS is
    ``None`` (warm-up, a gap bar, the bar after it)."""
    return cross_columns(above_zero_column(mrs))


def either(a: Column, b: Column) -> Column:
    """``a ∨ b`` over {0, 1, None}: ``None`` if either side is ``None`` — the
    rule `both` and `and_not` already apply, so the three combinators agree
    about a hole."""
    out: Column = [None] * len(a)
    for i, (x, y) in enumerate(zip(a, b)):
        if x is None or y is None:
            continue
        out[i] = 1.0 if (x == 1.0 or y == 1.0) else 0.0
    return out


def bars_ago_column(events: Column) -> Column:
    """How many bars since the last ``1`` in an event column: ``0`` on the
    event bar itself, one more on each bar after it, ``None`` before the first
    event. Floats, like `rolling_count`.

    This is the AGE the screener ranges over — `rs_nh_bars_ago`,
    `rs_cross_up_bars_ago`, `mansfield_cross_bars_ago` (engineering map §2.5,
    "crossed above 21 EMA within 5 bars") — computed from the same event column
    the chart draws, so the preset and the dot can never disagree.

    ⚠️ A ``None`` IN THE EVENT COLUMN IS "NO EVENT SEEN HERE", NOT A RESET. The
    count keeps running through ``0`` and ``None`` bars alike: the distance to
    the last event the column SAW is still known. An event hidden inside a hole
    can only make the age too LARGE, never claim a cross that did not happen —
    the safe direction for a scan. Callers that want the hole itself blank
    mask it (`compute_mansfield_columns` does, on the gap bar).
    """
    out: Column = [None] * len(events)
    last: Optional[int] = None
    for i, e in enumerate(events):
        if e == 1.0:
            last = i
        if last is not None:
            out[i] = float(i - last)
    return out


def _slope(values: Sequence[MaybeNum]) -> MaybeNum:
    """Ordinary least-squares slope of ``values`` against ``0, 1, …, n−1``;
    ``None`` with fewer than two values or any value missing."""
    n = len(values)
    if n < 2 or any(not _is_num(v) for v in values):
        return None
    x_mean = (n - 1) / 2.0
    y_mean = sum(float(v) for v in values) / n
    num = sum((i - x_mean) * (float(v) - y_mean) for i, v in enumerate(values))
    den = sum((i - x_mean) ** 2 for i in range(n))
    return num / den


def benchmark_agree(rs_vs_a: Column, rs_vs_b: Column, rs_vs_c: Column,
                    window: int = DEFAULT_SENSITIVITY_WINDOW) -> Column:
    """Plan §7 item 22 (benchmark sensitivity) as a per-bar {0, 1, None}:
    ``1`` when the sign of the ``window``-bar least-squares slope of each RS
    series agrees — all rising or all falling — ``0`` when they disagree (a
    FLAT slope on any of them is neither, so it disagrees), ``None`` until
    ``window`` bars exist or while any series' window holds a gap.

    The three series are the stock's RS against SPY, RSP and its sector ETF,
    each aligned to the stock's bars; "leaders vs equal-weight too" is this
    column at 1 (engineering map §2.5 starter copy).
    """
    series = (list(rs_vs_a), list(rs_vs_b), list(rs_vs_c))
    n = len(series[0])
    out: Column = [None] * n
    if window < 2:
        return out
    for t in range(window - 1, n):
        slopes: List[float] = []
        for s in series:
            sl = _slope(s[t - window + 1:t + 1]) if len(s) > t else None
            if sl is None:
                break
            slopes.append(sl)
        if len(slopes) != len(series):
            continue
        signs = {1 if sl > 0 else (-1 if sl < 0 else 0) for sl in slopes}
        out[t] = 1.0 if signs in ({1}, {-1}) else 0.0
    return out


# ⛔ A SECOND TUPLE, NOT AN EXTENSION OF THE FIRST. `PHASE1_COLUMNS` is the
# `rsLine` definition's wire contract at `compute.rev: 2`, pinned by
# `tests/test_rs_columns_provider.py` and the `rs_events_default` fixture;
# growing it would bump the rev for every client. Unit 2a-14 joins these to the
# columns list when it bumps the rev to 3 (engineering map §4.1 item 7).
PHASE2A_COLUMNS = (
    "mansfield", "mansfieldState", "mansfieldCrossUp", "mansfieldCrossDown", "mansfieldCrossBarsAgo",
)


def compute_mansfield_columns(bars: Sequence[dict], benchmark_bars: Sequence[dict],
                              length: int = DEFAULT_MANSFIELD_LENGTH) -> Dict[str, Column]:
    """The Phase 2a Mansfield column set, aligned to ``bars`` — what the Trend
    preset plots (plan §6.7 "Mansfield zero cross"), the screener stores as
    `mansfield` / `mansfield_cross_bars_ago` and the alert lane addresses as
    `rs_line.mansfield` (`cross_zero`). One call, so all three read one answer.

    ``length`` is clamped to ``MANSFIELD_LENGTH_RANGE`` the way Phase 1 clamps
    ``maLength``. Every column is ``None`` on a gap bar, the age included (a
    bar with no benchmark close has no Mansfield reading to be the age OF).
    """
    n_len = int(_clamp(length, *MANSFIELD_LENGTH_RANGE, default=DEFAULT_MANSFIELD_LENGTH))
    if len(bars) == 0:
        return {k: [] for k in PHASE2A_COLUMNS}
    rs = rs_line(bars, benchmark_bars)
    mrs = mansfield_column(rs, n_len)
    crosses = mansfield_cross_column(mrs)
    age = bars_ago_column(either(crosses["crossUp"], crosses["crossDown"]))
    age = [None if mrs[i] is None else v for i, v in enumerate(age)]
    return {
        "mansfield": mrs,
        "mansfieldState": mansfield_state_column(mrs),
        "mansfieldCrossUp": crosses["crossUp"],
        "mansfieldCrossDown": crosses["crossDown"],
        "mansfieldCrossBarsAgo": age,
    }


# ── Payload scalars (plan §8, the parts Phase 1 can answer) ─────────────────

def last_rs_high(columns: Dict[str, Column], times: Sequence) -> Optional[dict]:
    """``{"index", "time", "beforePrice", "redDay", "barsAgo"}`` for the most
    recent full-lookback RS new high, or ``None`` when there is none yet."""
    nh = columns.get("rsNH") or []
    for i in range(len(nh) - 1, -1, -1):
        if nh[i] == 1.0:
            bp = columns.get("rsNHbeforePx") or []
            rd = columns.get("rsNHred") or []
            return {
                "index": i,
                "time": times[i] if i < len(times) else None,
                "beforePrice": bool(bp[i] == 1.0) if i < len(bp) and bp[i] is not None else None,
                "redDay": bool(rd[i] == 1.0) if i < len(rd) and rd[i] is not None else None,
                "barsAgo": len(nh) - 1 - i,
            }
    return None


def legend_scalars(columns: Dict[str, Column]) -> dict:
    """What the legend chip says in words (plan §6.6): % distance from the MA,
    the MA's slope sign, and the RS-above flag, for the LAST bar."""
    rs = columns.get("rsLine") or []
    ma = columns.get("rsMa") or []
    out = {"pctFromMa": None, "maSlope": None, "above": None}
    if not rs or not ma:
        return out
    v, m = rs[-1], ma[-1]
    if _is_num(v) and _is_num(m) and m != 0:
        out["pctFromMa"] = (v / m - 1.0) * 100.0
        out["above"] = v >= m
    if len(ma) >= 2 and _is_num(ma[-1]) and _is_num(ma[-2]):
        d = ma[-1] - ma[-2]
        out["maSlope"] = 1 if d > 0 else (-1 if d < 0 else 0)
    return out
