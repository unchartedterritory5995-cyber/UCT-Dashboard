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

⭐ PHASE 3 (unit 3-03): ROTATION, QUALITY AND VARS. Three more pure readings,
added at the bottom of this module; none of them touches a Phase 1 or Phase 2a
function, so `compute_phase1_columns` and `compute_mansfield_columns` stay
byte-identical (the no-move rail in `tests/test_rs_phase3_math.py`). The
choices the plan leaves open, each with its source:

* **Rotation is the Terminal's formula, not plan §7.14** (engineering map 2026-
  11-08, decision D1). `rrg_columns` is a line-for-line port of `rrgPath` in
  `app/src/pages/terminal/panels/relativeMath.js` (`RRG_METHOD = { ratioLen:
  10, momLen: 5, tail: 8 }`): ``RS = 100 × C / B``, ``RS-Ratio = 100 × RS /
  SMA(RS, ratioLen)``, ``RS-Momentum = 100 × RS-Ratio / SMA(RS-Ratio,
  momLen)``, quadrants split at 100 with ``≥`` on both axes (`quadrantOf`). The
  two series are compared only on bars BOTH have (`alignCloses`), which is this
  module's join-by-time-and-skip-the-gap rule. The SMA is the backend's one
  window mean (re-summed, `compute_sma`); the Terminal's rolling accumulator
  differs from it by float noise only (~1e-15), and `rs_rrg.json` is read by
  both lanes at rel-tol 1e-9 so the two cannot drift. A non-positive close on
  either side is a missing bar here, where `rrgPath` restarts its average; no
  real close is non-positive and `closesFromBars` drops such bars anyway.
* **Quality (Clenow)** is plan §7.15 as the map's contract spells it: OLS of
  ``ln C`` on the bar ordinal over the last ``window`` valid closes,
  ``annual = (1 + b)^252 − 1`` (a FRACTION: 0.42 is 42 % a year; KB
  01-methodologies §4 notes 250 or 260 in other sources, the map fixes 252),
  ``score = annual × R²``. The gap flag is Clenow's "a move > 15 % in the past
  90 days" (KB §4): ``|C[t] − C[t−1]| / C[t−1] × 100 > gap_pct`` for any
  consecutive pair INSIDE the window, strict, so exactly 15 % does not flag.
  The move is written as a difference over the prior close (not ``C/C₋₁ − 1``)
  so a 100 → 115 step is exactly 15.0 and the threshold is decidable. A window
  whose ``ln C`` has zero variance (a frozen tape) has no R²: all four columns
  are None there rather than a score of 0 (the zero-movement ruling of
  `indicator_compute.rsi_from_wilder_averages`, applied to a regression).
* **VARS** follows OANDA's published form (KB 01-methodologies §9):
  ``ShareChg[t] = (C[t] − C[t−1]) / ATR_C[t]``, ``IndexChg[t] = (B[t] −
  B[t−1]) / ATR_B[t]``, ``VARS = Σ_lookback ShareChg − Σ_lookback IndexChg``,
  and its four states against an SMA of VARS (50 in OANDA's case studies). The
  ATR is the repo's one Wilder ATR, `indicator_compute.compute_atr_raw` (TR
  from bar 1, seeded with the simple mean of the first ``atr_length`` TRs,
  landing on the ``atr_length``-th bar), each series on ITS OWN calendar and
  read at the joined bar; ``ATR[t]`` includes bar t's own range, as OANDA's
  ``ATR_t`` does. ``t − 1`` is the previous bar BOTH series have (the
  Terminal's alignment rule). A close-only series (the equal-weight
  composite, `rs_benchmarks.equal_weight_composite`, emits ``{t, c}``) has no
  intrabar range, so its bars are given ``h = l = c`` and the true range is
  the close-to-close move, which is exactly what Wilder's TR reduces to. A
  VARS of exactly 0 (the stock IS its benchmark) has no state.

All three join by bar time, skip gaps, and return None (never 0) during their
warm-up and on any bar the benchmark does not carry.
"""

from __future__ import annotations

import math
import operator
from collections import deque
from typing import Dict, List, Optional, Sequence

from api.services.indicator_compute import (
    compute_atr_raw,
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

# The clamp ranges. `registry_defs.resolve_inputs` clamps and rounds first; this
# is the pure-function guard for direct callers and reads the same constants
# (the Python row in `registry_defs._rs_line_row` reads its min/max/default
# from here, and `resolve_phase1_inputs` rounds exactly as `_clamp_number`
# does — `int(round(f))` — so the two paths cannot disagree about an input).
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

    ⭐ O(n), NOT O(n × lookback) (review finding #10, 2026-11-07). The window's
    extreme is the head of a monotonic deque of indices, and "is the window
    whole" is "the last gap sits before the window's first bar" — one pass, no
    per-bar rescan of 252 values. The answer is unchanged, bar for bar: the
    deque head is the window's ``max``/``min`` by exact comparison, a tie is
    still a new extreme, and the tolerance product is the same float
    expression (`tests/test_rs_fix_u2_kernel_parity.py` holds the previous
    implementation as its oracle).
    """
    n = len(series)
    out: Column = [None] * n
    if lookback <= 0:
        return out
    tol = max(0.0, float(tolerance_pct)) / 100.0
    lookback = operator.index(lookback)     # the old `range(lookback, n)` refused a float too
    scale = (1.0 - tol) if high else (1.0 + tol)
    window: deque = deque()     # indices of the run since the last gap; values monotone from the head
    last_gap = -1               # index of the newest non-number seen so far
    for t in range(n):
        start = t - lookback
        if start >= 0 and last_gap < start:
            # The prior `lookback` values are all numbers; drop what fell out.
            while window[0] < start:
                window.popleft()
            v = series[t]
            if _is_num(v):
                ext = series[window[0]]
                hit = (v >= ext * scale) if high else (v <= ext * scale)
                out[t] = 1.0 if hit else 0.0
        w = series[t]
        if not _is_num(w):
            last_gap = t
            window.clear()
            continue
        if high:
            while window and series[window[-1]] < w:
                window.pop()
        else:
            while window and series[window[-1]] > w:
                window.pop()
        window.append(t)
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
    (`registry_defs.resolve_inputs`); this only guards the numbers, and rounds
    the integer ones the way `registry_defs._clamp_number` does (``int(round)``,
    not truncation) so a direct caller and the route agree on 20.6 → 21."""
    src = inputs if isinstance(inputs, dict) else {}
    ma_type = str(src.get("maType") or DEFAULT_MA_TYPE).upper()
    if ma_type not in ("EMA", "SMA"):
        ma_type = DEFAULT_MA_TYPE
    return {
        "lookback": int(round(_clamp(src.get("lookback"), *LOOKBACK_RANGE, default=DEFAULT_LOOKBACK))),
        "maLength": int(round(_clamp(src.get("maLength"), *MA_LENGTH_RANGE, default=DEFAULT_MA_LENGTH))),
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
                              length: int = DEFAULT_MANSFIELD_LENGTH, *,
                              rs_values: Optional[Column] = None) -> Dict[str, Column]:
    """The Phase 2a Mansfield column set, aligned to ``bars`` — what the Trend
    preset plots (plan §6.7 "Mansfield zero cross"), the screener stores as
    `mansfield` / `mansfield_cross_bars_ago` and the alert lane addresses as
    `rs_line.mansfield` (`cross_zero`). One call, so all three read one answer.

    ``length`` is clamped to ``MANSFIELD_LENGTH_RANGE`` the way Phase 1 clamps
    ``maLength``. Every column is ``None`` on a gap bar, the age included (a
    bar with no benchmark close has no Mansfield reading to be the age OF).

    ``rs_values`` — the caller's ``rs_line(bars, benchmark_bars)`` when it has
    already joined them (the screener reads `compute_phase1_columns(...)
    ["rsLine"]`, the same function over the same inputs), so one ticker pays for
    one join, not two (review finding #5, 2026-11-07). It is used only when it
    is aligned to ``bars``; anything else is ignored and the line recomputed.
    """
    n_len = int(_clamp(length, *MANSFIELD_LENGTH_RANGE, default=DEFAULT_MANSFIELD_LENGTH))
    if len(bars) == 0:
        return {k: [] for k in PHASE2A_COLUMNS}
    if rs_values is not None and len(rs_values) == len(bars):
        rs = list(rs_values)
    else:
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
    the MA's slope sign, and the RS-above flag, read at the LAST BAR WITH A
    FINITE RS VALUE (visual round A8, 2026-11-06).

    That is the last bar whenever both closes exist there, so a normal chart
    reads exactly what it always did. When the newest bar has no ratio (the
    benchmark is missing a recent bar) the reading comes from the last bar that
    has one instead of going blank; ``index`` names that bar and ``lastValue``
    is the ratio there (six places), so the caller can date it and say so.
    ``index`` and ``lastValue`` are None when no bar has a finite ratio."""
    rs = columns.get("rsLine") or []
    ma = columns.get("rsMa") or []
    out = {"pctFromMa": None, "maSlope": None, "above": None, "index": None, "lastValue": None}
    if not rs or not ma:
        return out
    i = next((j for j in range(len(rs) - 1, -1, -1) if _is_num(rs[j])), None)
    at = len(rs) - 1 if i is None else i
    if i is not None:
        out["index"] = i
        out["lastValue"] = round(float(rs[i]), 6)
    v = rs[at]
    m = ma[at] if at < len(ma) else None
    if _is_num(v) and _is_num(m) and m != 0:
        out["pctFromMa"] = (v / m - 1.0) * 100.0
        out["above"] = v >= m
    if 1 <= at < len(ma) and _is_num(ma[at]) and _is_num(ma[at - 1]):
        d = ma[at] - ma[at - 1]
        out["maSlope"] = 1 if d > 0 else (-1 if d < 0 else 0)
    return out


# ── Phase 3 (unit 3-03): Rotation, Quality and VARS ─────────────────────────
#
# Plan §7 items 14-16 with the engineering map's decision D1 (the Terminal's
# RRG formula) and its 3-03 contract. The module header records every choice
# the plan leaves open and where it came from. Same contract as everything
# above: pure, aligned to ``bars``, no I/O, ``None`` (never 0) in the warm-up
# and on any bar whose benchmark close is missing.

# ⭐ THE TERMINAL'S `RRG_METHOD`, NOT A SECOND OPINION OF IT. `relativeMath.js`
# owns `{ ratioLen: 10, momLen: 5 }`; `rs_rrg.json` carries the same two numbers
# as its `params`, and BOTH lanes assert their constant equals the fixture's, so
# a change on either side is red until the other moves with it.
DEFAULT_RRG_RATIO_LEN = 10
DEFAULT_RRG_MOM_LEN = 5
# Quadrant code = index + 1; the same order as `relativeMath.QUADRANTS`, pinned
# by `rs_rrg.json`'s `quadrantNames` in both lanes.
RRG_QUADRANT_NAMES = ("Leading", "Weakening", "Lagging", "Improving")

# Clenow (KB 01-methodologies §4; plan §6.3 `clenowWindow` 90, `clenowGapPct` 15).
DEFAULT_CLENOW_WINDOW = 90
DEFAULT_CLENOW_GAP_PCT = 15.0
CLENOW_ANNUALISATION_BARS = 252

# VARS (KB 01-methodologies §9; plan §6.3 `atrLength` 20, `varsLookback` 60;
# OANDA's case studies read VARS against its 50-bar SMA).
DEFAULT_ATR_LENGTH = 20
DEFAULT_VARS_LOOKBACK = 60
DEFAULT_VARS_MA_LENGTH = 50

# ⛔ A THIRD TUPLE, NOT AN EXTENSION OF THE FIRST TWO (the PHASE2A_COLUMNS rule):
# unit 3-05 joins these to the `rsLine` row when it bumps `compute.rev` to 4.
PHASE3_COLUMNS = (
    "rsRatio", "rsMomentum", "quadrant",
    "clenowScore", "clenowAnnual", "clenowR2", "clenowGap",
    "vars", "varsMa", "varsState",
)


def _length_or_none(v, minimum: int = 1) -> Optional[int]:
    """A window length as an int (``int(round(f))``, the `resolve_phase1_inputs`
    rounding), or ``None`` when it is not a finite number ``≥ minimum`` — a
    degenerate length yields an all-``None`` column, never a raise or a guess."""
    if not _is_num(v):
        return None
    n = int(round(float(v)))
    return n if n >= minimum else None


def _positive_closes(bars: Sequence[dict]) -> Column:
    """``C[t]`` where it is a finite positive number, else ``None`` (a missing
    bar). ``ln C`` and a ratio need a positive close; `closesFromBars` applies
    the same ``c > 0`` filter on the Terminal's side."""
    return [float(b["c"]) if _is_num(b.get("c")) and b["c"] > 0 else None for b in bars]


def _quadrant_code(ratio: MaybeNum, momentum: MaybeNum) -> Optional[int]:
    """`relativeMath.quadrantOf` as a code: 1 Leading, 2 Weakening, 3 Lagging,
    4 Improving, ``None`` when either coordinate is missing. ``≥ 100`` counts
    as the upper side on both axes, exactly as the Terminal splits them."""
    if not (_is_num(ratio) and _is_num(momentum)):
        return None
    if ratio >= 100:
        return 1 if momentum >= 100 else 2
    return 4 if momentum >= 100 else 3


def rrg_columns(bars: Sequence[dict], benchmark_bars: Sequence[dict],
                ratio_len: int = DEFAULT_RRG_RATIO_LEN,
                mom_len: int = DEFAULT_RRG_MOM_LEN) -> Dict[str, list]:
    """The rotation reading (decision D1: the Terminal's `rrgPath`), aligned to
    ``bars``:

        RS[t]          = 100 × C[t] / B[t]
        rsRatio[t]     = 100 × RS[t] / SMA(RS, ratio_len)[t]
        rsMomentum[t]  = 100 × rsRatio[t] / SMA(rsRatio, mom_len)[t]
        quadrant[t]    = 1 Leading (ratio ≥ 100, momentum ≥ 100),
                         2 Weakening (ratio ≥ 100, momentum < 100),
                         3 Lagging (ratio < 100, momentum < 100),
                         4 Improving (ratio < 100, momentum ≥ 100)

    Both averages run over the bars BOTH series have, in order — a bar the
    benchmark does not carry is ``None`` in all three columns and is skipped,
    not zeroed and not a restart (`alignCloses` drops it on the Terminal's side,
    the same thing). Warm-up: ``rsRatio`` from the ``ratio_len``-th joined bar,
    ``rsMomentum`` and ``quadrant`` from the ``(ratio_len + mom_len − 1)``-th.
    The Terminal plots a point only where both coordinates exist; the column
    carries the ratio from its own warm-up on, because it is known there.
    ``quadrant`` is an int code (a classification, like `mansfieldState`);
    ``RRG_QUADRANT_NAMES[code − 1]`` is its name.
    """
    n = len(bars)
    empty = {"rsRatio": [None] * n, "rsMomentum": [None] * n, "quadrant": [None] * n}
    r_len = _length_or_none(ratio_len)
    m_len = _length_or_none(mom_len)
    if n == 0 or r_len is None or m_len is None:
        return empty
    closes = _positive_closes(bars)
    bench = benchmark_closes_aligned(bars, benchmark_bars)
    rs100: Column = [100.0 * c / b if (c is not None and b is not None and b > 0) else None
                     for c, b in zip(closes, bench)]
    rs_avg = rs_moving_average(rs100, r_len, "SMA")
    ratio: Column = [100.0 * v / a if (_is_num(v) and _is_num(a) and a != 0) else None
                     for v, a in zip(rs100, rs_avg)]
    ratio_avg = rs_moving_average(ratio, m_len, "SMA")
    momentum: Column = [100.0 * v / a if (_is_num(v) and _is_num(a) and a != 0) else None
                        for v, a in zip(ratio, ratio_avg)]
    quadrant = [_quadrant_code(x, y) for x, y in zip(ratio, momentum)]
    return {"rsRatio": ratio, "rsMomentum": momentum, "quadrant": quadrant}


def _r_squared(values: Sequence[float], slope: float) -> MaybeNum:
    """R² of the least-squares line through ``values`` against ``0 … n−1`` whose
    slope is ``slope`` (from `_slope`, the module's one OLS slope):
    ``R² = b² · Sxx / Syy``. ``None`` when ``Syy`` is 0 — a flat series has no
    variance for a line to explain (module header). The flat test is on the
    values themselves, not on ``Syy``: the float mean of n equal values can miss
    them by an ulp, leaving a ``Syy`` of 1e-31 that would divide noise by noise."""
    n = len(values)
    if max(values) == min(values):
        return None
    y_mean = sum(values) / n
    syy = sum((v - y_mean) ** 2 for v in values)
    if syy <= 0:
        return None
    x_mean = (n - 1) / 2.0
    sxx = sum((i - x_mean) ** 2 for i in range(n))
    return min(1.0, slope * slope * sxx / syy)


def clenow_columns(bars: Sequence[dict], window: int = DEFAULT_CLENOW_WINDOW,
                   gap_pct: float = DEFAULT_CLENOW_GAP_PCT) -> Dict[str, Column]:
    """Clenow's momentum quality (*Stocks on the Move*; plan §7.15), aligned to
    ``bars``. Over the last ``window`` VALID closes ending at bar t:

        b             = OLS slope of ln C on the bar ordinal 0 … window−1
        clenowAnnual  = (1 + b)^252 − 1                    a fraction
        clenowR2      = R² of that fit
        clenowScore   = clenowAnnual × clenowR2
        clenowGap     = 1.0 when any consecutive pair inside the window moved
                        |C[t] − C[t−1]| / C[t−1] × 100 > gap_pct, else 0.0

    A bar with no positive close is ``None`` in every column and is skipped by
    the windows (the ordinal counts valid closes only). ``None`` for the first
    ``window − 1`` valid closes, and on a window whose ``ln C`` is flat (no R²,
    module header). ``window`` below 2 has no line and is all ``None``.
    """
    n = len(bars)
    out = {k: [None] * n for k in ("clenowScore", "clenowAnnual", "clenowR2", "clenowGap")}
    w = _length_or_none(window, 2)
    if n == 0 or w is None:
        return out
    threshold = float(gap_pct) if _is_num(gap_pct) else DEFAULT_CLENOW_GAP_PCT
    closes = _positive_closes(bars)
    idx = [i for i, c in enumerate(closes) if c is not None]
    for j in range(w - 1, len(idx)):
        seg = [closes[i] for i in idx[j - w + 1:j + 1]]
        logs = [math.log(c) for c in seg]
        b = _slope(logs)
        r2 = _r_squared(logs, b) if b is not None else None
        if r2 is None:
            continue
        annual = (1.0 + b) ** CLENOW_ANNUALISATION_BARS - 1.0
        moves = (abs(seg[k] - seg[k - 1]) / seg[k - 1] * 100.0 for k in range(1, w))
        t = idx[j]
        out["clenowAnnual"][t] = annual
        out["clenowR2"][t] = r2
        out["clenowScore"][t] = annual * r2
        out["clenowGap"][t] = 1.0 if any(m > threshold for m in moves) else 0.0
    return out


def _atr_by_time(bars: Sequence[dict], length: int) -> Dict[object, float]:
    """``{t: ATR}`` from `indicator_compute.compute_atr_raw` (the one Wilder ATR)
    over the series' OWN valid bars, in order. A bar without a finite positive
    close is skipped; a bar without ``h``/``l`` (a close-only composite) gets
    ``h = l = c``, so its true range is the close-to-close move (module header)."""
    clean: List[dict] = []
    for b in bars:
        c = b.get("c")
        if not (_is_num(c) and c > 0):
            continue
        h, lo = b.get("h"), b.get("l")
        if not (_is_num(h) and _is_num(lo)):
            h = lo = c
        clean.append({"t": b.get("t"), "h": float(h), "l": float(lo), "c": float(c)})
    atr = compute_atr_raw(clean, length)
    return {b["t"]: a for b, a in zip(clean, atr) if _is_num(a)}


def vars_columns(bars: Sequence[dict], benchmark_bars: Sequence[dict],
                 atr_length: int = DEFAULT_ATR_LENGTH,
                 lookback: int = DEFAULT_VARS_LOOKBACK,
                 ma_length: int = DEFAULT_VARS_MA_LENGTH) -> Dict[str, list]:
    """Volatility-adjusted relative strength (OANDA VARS; plan §7.16), aligned
    to ``bars``. On the bars BOTH series have, in order (``p`` the previous
    such bar):

        d[t]       = (C[t] − C[p]) / ATR_C[t] − (B[t] − B[p]) / ATR_B[t]
        vars[t]    = Σ d over the last ``lookback`` joined bars
                   = Σ ShareChg − Σ IndexChg
        varsMa[t]  = SMA(vars, ma_length) over the valid vars values in order
        varsState  = 1  vars > 0 and vars > MA   strong and gaining
                     2  vars > 0 and vars ≤ MA   strong but fading
                     3  vars < 0 and vars > MA   weak but improving
                     4  vars < 0 and vars ≤ MA   weak
                     None  vars or MA missing, or vars exactly 0

    ATR is each series' own Wilder ATR (`_atr_by_time`), first known on its
    ``atr_length``-th bar after the first; ``d`` needs both ATRs positive.
    ``vars`` needs ``lookback`` consecutive joined ``d`` values; a bar the
    benchmark does not carry is ``None`` in all three columns and is skipped.
    The window is re-summed on every bar (one window sum, no rolling
    accumulator — `tests/test_single_authority_rails.py`). ``varsState`` is an
    int code, like `quadrant` and `mansfieldState`.
    """
    n = len(bars)
    out = {"vars": [None] * n, "varsMa": [None] * n, "varsState": [None] * n}
    a_len = _length_or_none(atr_length)
    look = _length_or_none(lookback)
    ma_len = _length_or_none(ma_length)
    if n == 0 or a_len is None or look is None or ma_len is None:
        return out
    closes = _positive_closes(bars)
    bench = benchmark_closes_aligned(bars, benchmark_bars)
    atr_c = _atr_by_time(bars, a_len)
    atr_b = _atr_by_time(benchmark_bars, a_len)
    joined = [i for i in range(n) if closes[i] is not None and bench[i] is not None and bench[i] > 0]
    d: Column = [None] * len(joined)
    for j in range(1, len(joined)):
        i, p = joined[j], joined[j - 1]
        t = bars[i].get("t")
        ac, ab = atr_c.get(t), atr_b.get(t)
        if not (ac is not None and ab is not None and ac > 0 and ab > 0):
            continue
        d[j] = (closes[i] - closes[p]) / ac - (bench[i] - bench[p]) / ab
    vars_col: Column = [None] * n
    for j in range(look - 1, len(joined)):
        seg = d[j - look + 1:j + 1]
        if any(v is None for v in seg):
            continue
        vars_col[joined[j]] = sum(seg)
    ma = rs_moving_average(vars_col, ma_len, "SMA")
    state: List[Optional[int]] = [None] * n
    for i in range(n):
        v, m = vars_col[i], ma[i]
        if not (_is_num(v) and _is_num(m)) or v == 0:
            continue
        if v > 0:
            state[i] = 1 if v > m else 2
        else:
            state[i] = 3 if v > m else 4
    out["vars"], out["varsMa"], out["varsState"] = vars_col, ma, state
    return out


# ── RS split, unit U4 (2026-11-09): UCT RS Phases and UCT RS vs 21 EMA ──────
#
# Two more pure readings for the two new server rows (`registry_defs`
# `rsPhases` / `rsVsEma`; engineering map docs at
# projects/rs-split-handoff-2026-11-09/engineering-map.md §(d)). Same contract
# as everything above: aligned to ``bars``, no I/O, ``None`` (never 0) in the
# warm-up and on any bar the benchmark does not carry. Nothing here touches a
# Phase 1 / 2a / 3 function, so every earlier rail holds.
#
# * The EMAs are `rs_moving_average`'s: `indicator_compute.compute_ema` seeded
#   with the SMA of the first n valid values, nulls before the seed, GAPS
#   SKIPPED (a benchmark bar missing for this time is left out of the
#   recursion and stays None in the output). Both the ratio's and the
#   benchmark's trends use it, so the two sides are smoothed identically.
# * `dist` is `legend_scalars`'s ``pctFromMa`` at every bar, so the RS vs 21
#   EMA histogram and the RS line readout's "above its 21 EMA by X%" can never
#   disagree: one formula, ``100 · (R / EMA_21(R) − 1)``.
# * The divergence z-score reads the spread's population standard deviation
#   over its last `PHASES_SIGMA_WINDOW` VALID values (gap-skipping, like the
#   EMAs that feed it); a window of zero variance has no z-score (None, never
#   0 or infinity), the frozen-tape ruling `clenow_columns` applies.

DEFAULT_PHASES_SHORT = 3        # Deepvue's "short-term trend smoothing"
DEFAULT_PHASES_LONG = 10        # Deepvue's "long-term trend smoothing"
PHASES_SHORT_RANGE = (2, 20)
PHASES_LONG_RANGE = (3, 60)
PHASES_SIGMA_WINDOW = 63        # a quarter of sessions: the z-score's own scale
PHASES_Z_CLAMP = 3.0            # |z| is capped so one wild day cannot own the pane

DEFAULT_VS_EMA_LENGTH = DEFAULT_MA_LENGTH   # the RS line's own 21 EMA, by construction
DEFAULT_VS_EMA_FAST = 3         # Deepvue's "Webby RS Line" EMA 3 of the distance
DEFAULT_VS_EMA_SLOW = 13        # ... and its EMA 13

#: Every column `compute_rs_phases_columns` returns. The wire carries `phase`
#: and `divergence` (`registry_defs.RS_PHASES_WIRE_COLUMNS`); the two trend
#: series stay here for the readout and for tests.
RS_PHASES_COLUMNS = ("phase", "divergence", "rsTrend", "benchTrend")
RS_VS_EMA_COLUMNS = ("dist", "fast", "slow")


def ema_ratio_trend(series: Column, short: int, long: int) -> Column:
    """``EMA_short(x) / EMA_long(x) − 1`` per bar: positive while the short
    average leads the long one (the series is trending up). Scale-free, so a
    stock's ratio and the benchmark's price read on one scale. None until both
    averages exist and on any gap bar; None where the long average is 0."""
    s = rs_moving_average(series, int(short), "EMA")
    l = rs_moving_average(series, int(long), "EMA")
    out: Column = [None] * len(series)
    for i, (a, b) in enumerate(zip(s, l)):
        if _is_num(a) and _is_num(b) and b != 0:
            out[i] = a / b - 1.0
    return out


def rolling_zscore_clamped(series: Column, window: int = PHASES_SIGMA_WINDOW,
                           clamp: float = PHASES_Z_CLAMP) -> Column:
    """``clamp(x_t / σ_window(x)_t, −clamp, +clamp)``: the value against the
    population standard deviation of the last ``window`` VALID values ending
    at t (inclusive). None until ``window`` valid values exist, on gap bars,
    and when σ is 0."""
    n = len(series)
    out: Column = [None] * n
    w = int(window)
    if w < 1:
        return out
    idx = [i for i, v in enumerate(series) if _is_num(v)]
    vals = [float(series[i]) for i in idx]
    for j in range(w - 1, len(vals)):
        seg = vals[j - w + 1:j + 1]
        mean = sum(seg) / w
        var = sum((v - mean) ** 2 for v in seg) / w
        sd = math.sqrt(var)
        if sd <= 0:
            continue
        out[idx[j]] = max(-float(clamp), min(float(clamp), vals[j] / sd))
    return out


def compute_rs_phases_columns(bars: Sequence[dict], benchmark_bars: Sequence[dict],
                              short: int = DEFAULT_PHASES_SHORT,
                              long: int = DEFAULT_PHASES_LONG) -> Dict[str, Column]:
    """UCT RS Phases (map §(d)), aligned to ``bars``::

        rsTrend_t    = EMA_short(R)_t / EMA_long(R)_t − 1
        benchTrend_t = EMA_short(B)_t / EMA_long(B)_t − 1
        phase_t      = 1 if rsTrend > 0 and benchTrend < 0   (RS up, market down)
                     = 0 if rsTrend < 0 and benchTrend > 0   (RS down, market up)
                     = None otherwise                        (no shading)
        divergence_t = clamp((rsTrend − benchTrend) / σ63(spread), −3, +3)

    ``B`` is the benchmark close on the stock's own calendar
    (`benchmark_closes_aligned`), so a bar the benchmark lacks is None in every
    column. The two lengths are taken as given: `registry_defs.resolve_inputs`
    clamps them to `PHASES_SHORT_RANGE` / `PHASES_LONG_RANGE` first."""
    n = len(bars)
    if n == 0:
        return {k: [] for k in RS_PHASES_COLUMNS}
    rs = rs_line(bars, benchmark_bars)
    bench = benchmark_closes_aligned(bars, benchmark_bars)
    rs_trend = ema_ratio_trend(rs, short, long)
    bench_trend = ema_ratio_trend(bench, short, long)
    phase: Column = [None] * n
    spread: Column = [None] * n
    for i in range(n):
        a, b = rs_trend[i], bench_trend[i]
        if not (_is_num(a) and _is_num(b)):
            continue
        spread[i] = a - b
        if a > 0 and b < 0:
            phase[i] = 1.0
        elif a < 0 and b > 0:
            phase[i] = 0.0
    return {
        "phase": phase,
        "divergence": rolling_zscore_clamped(spread),
        "rsTrend": rs_trend,
        "benchTrend": bench_trend,
    }


def rs_phase_flip_columns(cols: Dict[str, Column]) -> Dict[str, Column]:
    """RS Phases flip events (alert lane, RS split lane S2), over the columns
    `compute_rs_phases_columns` returns::

        flipBlue[t] = 1 if phase[t] == 1 and phase[t-1] != 1     (RS turned blue)
        flipRed[t]  = 1 if phase[t] == 0 and phase[t-1] != 0     (RS turned red)

    ``phase[t-1] != x`` includes the neutral (None) bar before it: neutral to blue
    is a flip. {0, 1, None}: None where either bar cannot be judged, i.e. a bar
    whose ``rsTrend`` or ``benchTrend`` is None (warm-up, a gap bar) -- so the
    first judged bar never reads as a flip out of nothing. Same convention as
    `cross_columns`: a flip is an edge, a held phase is 0 after its first bar."""
    phase, rs_t, b_t = cols["phase"], cols["rsTrend"], cols["benchTrend"]
    n = len(phase)
    blue: Column = [None] * n
    red: Column = [None] * n
    for i in range(1, n):
        if not (_is_num(rs_t[i]) and _is_num(b_t[i]) and _is_num(rs_t[i - 1]) and _is_num(b_t[i - 1])):
            continue
        blue[i] = 1.0 if (phase[i] == 1.0 and phase[i - 1] != 1.0) else 0.0
        red[i] = 1.0 if (phase[i] == 0.0 and phase[i - 1] != 0.0) else 0.0
    return {"flipBlue": blue, "flipRed": red}


def compute_rs_vs_ema_columns(bars: Sequence[dict], benchmark_bars: Sequence[dict],
                              ema: int = DEFAULT_VS_EMA_LENGTH,
                              fast: int = DEFAULT_VS_EMA_FAST,
                              slow: int = DEFAULT_VS_EMA_SLOW) -> Dict[str, Column]:
    """UCT RS vs 21 EMA (map §(d)), aligned to ``bars``::

        dist_t = 100 · (R_t / EMA_ema(R)_t − 1)    # percent above (+) / below (−)
        fast_t = EMA_fast(dist)_t
        slow_t = EMA_slow(dist)_t

    ``dist`` at the last bar with a ratio IS `legend_scalars(...)["pctFromMa"]`
    for the RS line's default average (the rail in tests/test_rs_vs_ema_math.py
    holds the two equal), so the histogram and the readout never disagree."""
    n = len(bars)
    if n == 0:
        return {k: [] for k in RS_VS_EMA_COLUMNS}
    rs = rs_line(bars, benchmark_bars)
    ma = rs_moving_average(rs, int(ema), "EMA")
    dist: Column = [None] * n
    for i, (v, m) in enumerate(zip(rs, ma)):
        if _is_num(v) and _is_num(m) and m != 0:
            dist[i] = (v / m - 1.0) * 100.0
    return {
        "dist": dist,
        "fast": rs_moving_average(dist, int(fast), "EMA"),
        "slow": rs_moving_average(dist, int(slow), "EMA"),
    }


# ── RS Exit Warnings (2026-11-12): UCT RS Exit Warnings (`rsExit`) ──────────
#
# Mike Webster's three warnings on the RS line (Quick Break, Quicksand, Grateful
# Dead Break), as a fifth RS indicator beside `rsLine`, `rsRating`, `rsPhases`
# and `rsVsEma`. Same contract as everything above: aligned to ``bars``, no I/O,
# ``None`` (never 0) in the warm-up and on any bar the benchmark does not carry.
#
# ⭐ OUR READING OF A PUBLISHED IDEA, NOT A PUBLISHED FORMULA. The three names and
# their one-line meanings are public (the TradingView script "Webby's Quick &
# Grateful Dead RS" by Amphibiantrading, a community summary of Webster's video):
#   Quick Break          the RS line drops below its fast moving average
#   Quicksand            the RS line falls lower than it was at the Quick Break
#   Grateful Dead Break  the RS line drops below its slow moving average
# The exact mechanics (bar-close or intraday, how a cycle ends, whether a signal
# repeats) are NOT published, so the rules below are ours, stated once here and
# in the PR so they can be argued with. The averages are SIMPLE averages OF THE
# RS LINE (not of price): daily 21 and 50, weekly 8 and 21, the lengths the same
# community summary credits to Webster; both are inputs.
#
# THE RULES, on closed bars, left to right. ``below(t)`` is ``rs[t] < fast[t]``;
# "at or above" is everything else, so a flat line sitting exactly on its average
# is NOT below it (the `above_column` convention, ``rs >= ma``).
#   quickBreak[t]  = 1 if below(t) and not below(t-1)           (a fresh cross down)
#                    and remembers ``level = rs[t]``
#   quicksand[t]   = 1 on the FIRST bar after a quickBreak, in the same cycle,
#                    where below(t) and rs[t] < level; once per cycle
#   cycle ends     on the first bar that is at or above the fast average: the
#                    level is forgotten and both warnings are armed again
#   deadBreak[t]   = 1 if rs[t] < slow[t] and rs[t-1] >= slow[t-1]
#                    (a fresh cross down through the slow average; it does not need
#                    a Quick Break first and has no cycle of its own)
# {0, 1, None}: None where the bar or the one before it cannot be judged (warm-up,
# a bar the benchmark lacks). A gap bar inside a cycle abandons the cycle (the
# level is forgotten) because continuity cannot be vouched for: a missing Quicksand
# is the safe error, an invented one is not. A series that STARTS below its fast
# average has no Quick Break (nothing to cross from) and so no Quicksand until it
# has been at or above the average once and crossed down again.

EXIT_AUTO_LENGTHS: Dict[str, tuple] = {"D": (21, 50), "W": (8, 21)}
EXIT_LENGTH_RANGE = (2, 400)
#: Closed bars of cycle history the alert lane reads beyond the slow average, so a
#: Quicksand can see the Quick Break it is measured from. A break older than this
#: before the alert bar is not seen (documented in the alert's help text).
EXIT_CYCLE_HISTORY = 120      # about six months of sessions; NOT 126, which beside 63 is the RS weighting table's fingerprint

#: Every column `compute_rs_exit_columns` returns. The wire carries the line, the
#: two averages and the three dots (`registry_defs.RS_EXIT_WIRE_COLUMNS`); the
#: three 0/1 event columns stay here for the legend, the alerts and the tests.
RS_EXIT_COLUMNS = ("rsLine", "fast", "slow", "quickBreak", "quicksand", "deadBreak",
                   "dotQuick", "dotQuicksand", "dotDead")
RS_EXIT_EVENT_COLUMNS = ("quickBreak", "quicksand", "deadBreak")


def resolve_exit_lengths(store_tf: str, fast=0, slow=0) -> tuple:
    """``(fast, slow)`` in bars for a store timeframe. 0 (or anything that is not
    a number of at least 1) means AUTO: daily 21 / 50, weekly 8 / 21 (`EXIT_AUTO_LENGTHS`;
    any other timeframe reads the daily pair). A given length is rounded and clamped
    to `EXIT_LENGTH_RANGE`; the slow average is kept longer than the fast one (a
    slow average at or under the fast one cannot mean "slow"), raised to fast + 1."""
    auto_fast, auto_slow = EXIT_AUTO_LENGTHS.get(str(store_tf or "").upper(), EXIT_AUTO_LENGTHS["D"])
    lo, hi = EXIT_LENGTH_RANGE

    def one(v, auto):
        try:
            f = float(v)
        except (TypeError, ValueError):
            return auto
        if not math.isfinite(f) or f < 1:
            return auto
        return int(round(min(hi, max(lo, f))))

    f, s = one(fast, auto_fast), one(slow, auto_slow)
    if f >= hi:
        f = hi - 1
    if s <= f:
        s = f + 1
    return f, s


def rs_exit_events(rs: Column, fast_ma: Column, slow_ma: Column) -> Dict[str, Column]:
    """``{quickBreak, quicksand, deadBreak}`` over an RS line and its two averages
    (all aligned, ``None`` where unknown). The rules are the section header's."""
    n = len(rs)
    quick: Column = [None] * n
    sand: Column = [None] * n
    dead: Column = [None] * n
    level = None
    sand_done = False
    for i in range(n):
        r, f, s = rs[i], fast_ma[i], slow_ma[i]
        prev_ok = i > 0 and _is_num(rs[i - 1])
        # ── the fast average: Quick Break and Quicksand, with the cycle ──
        if _is_num(r) and _is_num(f):
            if prev_ok and _is_num(fast_ma[i - 1]):
                below = r < f
                prev_below = rs[i - 1] < fast_ma[i - 1]
                q = 0.0
                qs = 0.0
                if below:
                    if not prev_below:
                        q = 1.0
                        level = float(r)
                        sand_done = False
                    elif level is not None and not sand_done and r < level:
                        qs = 1.0
                        sand_done = True
                else:
                    level = None
                    sand_done = False
                quick[i], sand[i] = q, qs
            else:
                level, sand_done = None, False      # continuity unknown: abandon the cycle
        else:
            level, sand_done = None, False
        # ── the slow average: Grateful Dead Break, no cycle ──
        if _is_num(r) and _is_num(s) and prev_ok and _is_num(slow_ma[i - 1]):
            dead[i] = 1.0 if (r < s and rs[i - 1] >= slow_ma[i - 1]) else 0.0
    return {"quickBreak": quick, "quicksand": sand, "deadBreak": dead}


def compute_rs_exit_columns(bars: Sequence[dict], benchmark_bars: Sequence[dict],
                            fast: int = 21, slow: int = 50) -> Dict[str, Column]:
    """UCT RS Exit Warnings, aligned to ``bars``: the RS line (`rs_line`), a SIMPLE
    average of it at each of the two lengths (`rs_moving_average`, gaps skipped),
    the three events (`rs_exit_events`) and the three dot columns (the RS value on
    an event bar, ``None`` elsewhere: a dot sits exactly on the line). The lengths
    are taken as given: `resolve_exit_lengths` resolves them first."""
    n = len(bars)
    if n == 0:
        return {k: [] for k in RS_EXIT_COLUMNS}
    rs = rs_line(bars, benchmark_bars)
    fast_ma = rs_moving_average(rs, int(fast), "SMA")
    slow_ma = rs_moving_average(rs, int(slow), "SMA")
    ev = rs_exit_events(rs, fast_ma, slow_ma)
    return {
        "rsLine": rs, "fast": fast_ma, "slow": slow_ma,
        "quickBreak": ev["quickBreak"], "quicksand": ev["quicksand"], "deadBreak": ev["deadBreak"],
        "dotQuick": dot_column(rs, ev["quickBreak"]),
        "dotQuicksand": dot_column(rs, ev["quicksand"]),
        "dotDead": dot_column(rs, ev["deadBreak"]),
    }
