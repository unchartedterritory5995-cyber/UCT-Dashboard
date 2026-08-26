"""Server-side technical indicator compute.

Mirrors the math in ``app/src/components/chart/indicators.js`` so that
indicator-alert evaluation on the backend produces values consistent with
what the user sees on the chart.

Two layers, and the difference between them is load-bearing:

**Precise core — ``compute_<name>_raw``.** The math, *unrounded*, aligned to the
input length with ``None`` before the first computable bar. These are what the
shared golden fixtures in ``tests/fixtures/indicators/`` are generated from and
asserted against, so they stay in step with ``indicators.js`` at rel-tol 1e-9.
New callers — the Phase B indicator engine included — want these.

**Delivery layer — ``compute_<name>``.** Thin wrappers that round to the
precision this module has always rounded to. They exist for one reason: two
LIVE consumers compare these numbers against user-set thresholds —
``indicator_alert_evaluator`` (armed indicator alerts) and ``strategy_templates``
(the backtester). Dropping the rounding underneath them shifts every value by up
to half a unit in the last place, which can flip a comparison at a boundary, so
already-armed alerts would start firing differently the day it shipped. The
Phase B1 ruling is **round at delivery, not in compute** — these wrappers *are*
that delivery boundary, which is how compute got precise without
``indicator_alert_evaluator.py`` (the Phase C seam) being touched at all.
Retiring them is Phase C's call.

Two wrappers do more than round, because the original code rounded MID-pipeline
and that is observable in the output: ``compute_stoch``'s %D is the SMA of the
**rounded** %K, and ``compute_macd``'s histogram is (**rounded** MACD − raw
signal). Both quirks are reproduced exactly rather than quietly corrected — same
reason as above.

Alignment rule (both layers): every returned list is the length of the input.
Positions before the first computable bar are ``None`` so callers can index by
bar position directly (``values[-1]`` is always the latest, or ``None`` if the
input is too short for the chosen period).

Inputs:
    * ``closes`` — list of floats
    * ``bars``   — list of dicts with keys ``h``, ``l``, ``c`` (and ``v`` for MFI)

These match the structure used throughout ``api/services/bars_fetch.py``.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from math import sqrt
from typing import Dict, List, Optional, Tuple

Number = float
MaybeNum = Optional[float]


# ─── helpers ─────────────────────────────────────────────────────────────────

def _round_series(seq: List[MaybeNum], ndigits: int) -> List[MaybeNum]:
    """Round every non-None entry, preserving the None-padding and length."""
    return [None if v is None else round(v, ndigits) for v in seq]


def _ema_core(values: List[Number], period: int) -> List[MaybeNum]:
    """EMA with None-padded prefix. First value at index ``period - 1`` is the
    SMA of the first ``period`` values; subsequent values use Wilder-free EMA
    smoothing with ``k = 2 / (period + 1)``.

    Mirrors ``_ema`` in the frontend, but returned aligned to the input.
    """
    n = len(values)
    out: List[MaybeNum] = [None] * n
    if period <= 0 or n < period:
        return out
    k = 2.0 / (period + 1)
    seed = sum(values[:period]) / period
    out[period - 1] = seed
    prev = seed
    for i in range(period, n):
        prev = prev * (1 - k) + values[i] * k
        out[i] = prev
    return out


# ─── moving averages ─────────────────────────────────────────────────────────
# These two never rounded, so there is no delivery wrapper to keep — the `_raw`
# aliases exist purely so a caller can spell every precise function the same way.

def compute_sma(closes: List[Number], period: int) -> List[MaybeNum]:
    """Simple moving average. Aligned to input length with None-prefix.

    ⛔ THE MATHS IS NOT HERE, AND THAT IS THE FIX. This function used to carry a
    ROLLING SUBTRACT-AND-ADD accumulator (``window_sum += closes[i] -
    closes[i - period]``) while ``ast_interpret``'s ``sma``, ``interpret.js``'s
    ``windowMean`` and ``StockChart.computeSMA`` all RE-SUM the full window. Two
    Python implementations of one value — this repo's most repeated defect — and
    they disagreed on **33,913 of 37,761 bars (89.8%)** measured over 25 symbols
    × {20,50,200}. Float noise until a comparison sits on the value, and then it
    is observable:

      * **CAN 2025-12-09, close 0.96** — the rolling lane's MA20 came out
        ``0.9599999999999987`` (price **above** the MA) where the re-sum lane
        gives exactly ``0.96`` (**not** above). Same bars, opposite verdict.
      * **GETY's 50/200 golden cross fired 2025-10-24 on the rolling lane and
        2025-10-23 on the re-sum lane.**

    The re-sum is the survivor because it is what the frozen conformance digests
    pin (``tools/ast_conformance.py --check``) and because it is the more
    accurate of the two against exact rational arithmetic (5.7e-16 vs 1.13e-14):
    a rolling accumulator carries every earlier bar's rounding forward, so its
    answer depends on how far back the caller happened to start.

    So this is now an ADAPTER, not an implementation: it reads
    ``ast_interpret.FN["sma"]`` — the registry the interpreter itself iterates —
    and converts that lane's NaN pad to this module's ``None`` pad. There is
    exactly ONE window mean in the Python backend, and
    ``tests/test_single_authority_rails.py`` fails by name if a second one
    appears.
    """
    # The MODULE, never `from … import _window_mean` — a from-import binds a
    # snapshot and severs this lane from changes to the one it delegates to
    # (`lesson_from_import_severs_a_module_from_its_guards`). Function-local so
    # `indicator_compute` keeps its stdlib-only import graph at module load.
    from api.services import ast_interpret

    n = len(closes)
    out: List[MaybeNum] = [None] * n
    # The guards stay HERE: `_rolling` is written for the interpreter, where a
    # degenerate period is refused upstream by `defSchema`. `params_json` on a
    # stored alert row is user-supplied and unvalidated, so this lane keeps its
    # own door (see the DEGENERATE PERIODS note further down this file).
    if period <= 0 or n < period:
        return out
    for i, v in enumerate(ast_interpret.FN["sma"](list(closes), period)):
        # `v != v` is the NaN test — the interpreter's "not computable yet" pad,
        # which is this module's `None` pad under another name.
        out[i] = None if v != v else v
    return out


def compute_ema(closes: List[Number], period: int) -> List[MaybeNum]:
    """Exponential moving average. ``k = 2 / (period + 1)``. Seed = SMA of
    the first ``period`` values. Aligned to input length with None-prefix."""
    return _ema_core(list(closes), period)


compute_sma_raw = compute_sma
compute_ema_raw = compute_ema


# ─── RSI ─────────────────────────────────────────────────────────────────────

def rsi_from_wilder_averages(avg_gain: float, avg_loss: float) -> MaybeNum:
    """The RSI value for one pair of Wilder averages — ``None`` when there is
    nothing to measure.

    ⭐ THE ZERO-MOVEMENT DECISION LIVES HERE AND NOWHERE ELSE. Every RSI in the
    Python backend routes through this one function, and
    ``tests/test_single_authority_rails.py`` reads the source with an AST and
    fails BY NAME if a second site ever decides it again.

    🔴 WHAT WAS WRONG. The rule used to be a bare ``if avg_loss == 0: return
    100``, which fires when gains **and** losses are zero. A stock that has not
    moved at all therefore read as MAXIMALLY OVERBOUGHT. Live in the artifact on
    2026-08-09: **SIM, TMTS, CWEN-A, DRDB and OBA all carried ``rsi14 = 100.0``
    with ``chg_pct_1d = 0.00``** and a near-zero ADR, so an "RSI > 70" screen
    surfaced five frozen tickers as the most overbought names in the universe.

    ⭐ THE TWO CASES ARE DIFFERENT FACTS AND ARE ANSWERED DIFFERENTLY:

      * ``avg_loss == 0`` with ``avg_gain > 0`` — a genuine unbroken advance.
        Every diff in the window is a gain; RS is unbounded and the textbook
        answer is exactly **100.0**. That branch is pinned by
        ``tests/fixtures/indicators/rsi_ramp_14.json`` in BOTH lanes and is
        deliberately unchanged.
      * ``avg_loss == 0`` AND ``avg_gain == 0`` — nothing moved. ``0/0`` is not
        a number; the honest column entry is the same ``None`` the warm-up pad
        uses, not the top of the scale. (Pine's ``ta.rsi`` yields NaN here, and
        ``indicators.js`` leaves its ``NA`` for the same reason.)

    ⛔ ``None`` IS NOT "NO SIGNAL", IT IS "NOT COMPUTABLE", and the difference is
    what the whole phase turns on: ``_last_finite`` skips it, so an armed
    ``rsi > 70`` alert on a frozen ticker now declines to answer instead of
    answering "yes".
    """
    if avg_loss == 0:
        # Both zero ⇒ 0/0. Not overbought, not oversold — not computable.
        if avg_gain == 0:
            return None
        return 100.0
    return 100.0 - 100.0 / (1 + avg_gain / avg_loss)


def compute_rsi_raw(closes: List[Number], period: int = 14) -> List[MaybeNum]:
    """Wilder-smoothed RSI, unrounded. Mirrors ``computeRSI`` in indicators.js.

    First RSI value lands at index ``period`` (needs ``period`` price diffs
    starting at i=1). Output aligned to input length.

    ⚠️ A ``None`` CAN NOW APPEAR PAST THE WARM-UP PAD. ``rsi_from_wilder_averages``
    refuses the ``0/0`` bar (a window in which nothing moved at all), so this
    column's ``None``s mean "not computable here", which is what they have always
    meant — they are simply no longer confined to a prefix. Callers already index
    by bar position and already skip ``None``.
    """
    n = len(closes)
    out: List[MaybeNum] = [None] * n
    if period <= 0 or n < period + 1:
        return out
    avg_gain = 0.0
    avg_loss = 0.0
    for i in range(1, period + 1):
        diff = closes[i] - closes[i - 1]
        if diff > 0:
            avg_gain += diff
        else:
            avg_loss -= diff
    avg_gain /= period
    avg_loss /= period
    for i in range(period, n):
        if i > period:
            diff = closes[i] - closes[i - 1]
            gain = diff if diff > 0 else 0.0
            loss = -diff if diff < 0 else 0.0
            avg_gain = (avg_gain * (period - 1) + gain) / period
            avg_loss = (avg_loss * (period - 1) + loss) / period
        out[i] = rsi_from_wilder_averages(avg_gain, avg_loss)
    return out


def compute_rsi(closes: List[Number], period: int = 14) -> List[MaybeNum]:
    """DELIVERY wrapper (2dp) — see the module docstring before changing."""
    return _round_series(compute_rsi_raw(closes, period), 2)


# ─── MACD ────────────────────────────────────────────────────────────────────

def compute_macd_raw(
    closes: List[Number],
    fast: int = 12,
    slow: int = 26,
    signal: int = 9,
) -> Tuple[List[MaybeNum], List[MaybeNum], List[MaybeNum]]:
    """Returns (macd_line, signal_line, histogram) unrounded, each aligned to
    input length.

    MACD = EMA(fast) - EMA(slow).
    Signal = EMA of MACD over ``signal`` periods.
    Histogram = MACD - Signal.

    ⛔ THE START BAR IS ``max(fast, slow) - 1``, NOT ``slow - 1``. The settings
    form does not enforce ``fast < slow`` — Fast's declared max is 100 and Slow's
    is 200 — so a member can set Fast above Slow. This loop used to start at
    ``slow - 1``, where the FAST EMA is still ``None`` for
    ``slow-1 <= i < fast-1``, and pushed ``0.0`` placeholders into ``macd_dense``
    for those bars under a comment asserting it could not happen. ``macd_out``
    was correctly left ``None`` there, so the LINE looked right while the SIGNAL
    was an EMA **seeded on invented zeros**, decaying out of that error slowly and
    returning numbers that look reasonable and are wrong.

    The frontend's `computeMACD` had the mirror-image bug (negative index → NaN),
    so the two lanes disagreed on the same inputs: the browser drew nothing, this
    lane served a wrong number presented as right. Gate:
    ``tests/test_indicator_macd_alignment.py``, whose oracle is the antisymmetry
    ``macd(f,s) == -macd(s,f)`` — a property of the definition, so it cannot be
    satisfied by clamping or swapping the inputs.
    """
    n = len(closes)
    macd_out: List[MaybeNum] = [None] * n
    sig_out: List[MaybeNum] = [None] * n
    hist_out: List[MaybeNum] = [None] * n
    long_period = max(fast, slow)
    if n < long_period + signal:
        return macd_out, sig_out, hist_out

    fast_ema = _ema_core(list(closes), fast)
    slow_ema = _ema_core(list(closes), slow)

    # macd line is defined wherever BOTH EMAs are → from i = max(fast, slow) - 1
    macd_dense: List[Number] = []   # condensed list aligned to bars[long_period-1:]
    for i in range(long_period - 1, n):
        f = fast_ema[i]
        s = slow_ema[i]
        if f is None or s is None:
            # Unreachable by construction now that the start bar is the LONGER
            # period. Stop rather than fabricate: a placeholder here is what
            # corrupted the signal seed, and truncating keeps every value that
            # does get emitted aligned to its bar.
            break
        macd_dense.append(f - s)
        macd_out[i] = f - s

    # signal = EMA of macd_dense (length n - (long_period-1))
    sig_dense = _ema_core(macd_dense, signal)
    # sig_dense[j] aligns to bars[long_period-1 + j]
    for j, sv in enumerate(sig_dense):
        if sv is None:
            continue
        bar_idx = long_period - 1 + j
        sig_out[bar_idx] = sv
        m = macd_out[bar_idx]
        if m is not None:
            hist_out[bar_idx] = m - sv
    return macd_out, sig_out, hist_out


def compute_macd(
    closes: List[Number],
    fast: int = 12,
    slow: int = 26,
    signal: int = 9,
) -> Tuple[List[MaybeNum], List[MaybeNum], List[MaybeNum]]:
    """DELIVERY wrapper (5dp) — see the module docstring before changing.

    The histogram deliberately reproduces the original mid-pipeline rounding:
    it is (**rounded** MACD − **raw** signal), then rounded. Not a typo.
    """
    macd_raw, sig_raw, _hist_raw = compute_macd_raw(closes, fast, slow, signal)
    macd_out = _round_series(macd_raw, 5)
    sig_out = _round_series(sig_raw, 5)
    hist_out: List[MaybeNum] = [None] * len(macd_out)
    for i, sv in enumerate(sig_raw):
        if sv is None:
            continue
        m = macd_out[i]
        if m is not None:
            hist_out[i] = round(m - sv, 5)
    return macd_out, sig_out, hist_out


# ─── Bollinger Bands ─────────────────────────────────────────────────────────

def compute_bb_raw(
    closes: List[Number],
    period: int = 20,
    stddev: float = 2.0,
) -> Tuple[List[MaybeNum], List[MaybeNum], List[MaybeNum]]:
    """Bollinger Bands using population std-dev (divide by N, not N-1) to
    match the frontend. Returns (upper, middle, lower) unrounded, aligned to
    input.
    """
    n = len(closes)
    upper: List[MaybeNum] = [None] * n
    middle: List[MaybeNum] = [None] * n
    lower: List[MaybeNum] = [None] * n
    if period <= 0 or n < period:
        return upper, middle, lower
    for i in range(period - 1, n):
        window = closes[i - period + 1: i + 1]
        avg = sum(window) / period
        sq_sum = sum((c - avg) ** 2 for c in window)
        std = sqrt(sq_sum / period)
        upper[i] = avg + stddev * std
        middle[i] = avg
        lower[i] = avg - stddev * std
    return upper, middle, lower


def compute_bb(
    closes: List[Number],
    period: int = 20,
    stddev: float = 2.0,
) -> Tuple[List[MaybeNum], List[MaybeNum], List[MaybeNum]]:
    """DELIVERY wrapper (4dp) — see the module docstring before changing."""
    upper, middle, lower = compute_bb_raw(closes, period, stddev)
    return (
        _round_series(upper, 4),
        _round_series(middle, 4),
        _round_series(lower, 4),
    )


# ─── Williams %R ─────────────────────────────────────────────────────────────

def compute_williams_r_raw(bars: List[dict], period: int = 14) -> List[MaybeNum]:
    """Williams %R over ``period`` bars, unrounded. Range [-100, 0].

    %R = -100 * (HH - close) / (HH - LL)
    """
    n = len(bars)
    out: List[MaybeNum] = [None] * n
    if period <= 0 or n < period:
        return out
    for i in range(period - 1, n):
        hh = float("-inf")
        ll = float("inf")
        for j in range(i - period + 1, i + 1):
            h = bars[j]["h"]
            l = bars[j]["l"]
            if h > hh:
                hh = h
            if l < ll:
                ll = l
        rng = hh - ll
        if rng == 0:
            out[i] = 0.0
        else:
            out[i] = -100.0 * (hh - bars[i]["c"]) / rng
    return out


def compute_williams_r(bars: List[dict], period: int = 14) -> List[MaybeNum]:
    """DELIVERY wrapper (2dp) — see the module docstring before changing."""
    return _round_series(compute_williams_r_raw(bars, period), 2)


# ─── CCI ─────────────────────────────────────────────────────────────────────

def compute_cci_raw(bars: List[dict], period: int = 20) -> List[MaybeNum]:
    """Commodity Channel Index, unrounded.

    typical = (h + l + c) / 3
    SMA of typical over ``period``
    MAD     = mean(|typical - SMA|) over period
    CCI     = (typical - SMA) / (0.015 * MAD)

    When MAD == 0 (constant trend), returns 0.0 to match the frontend.
    """
    n = len(bars)
    out: List[MaybeNum] = [None] * n
    if period <= 0 or n < period:
        return out
    tp = [(b["h"] + b["l"] + b["c"]) / 3.0 for b in bars]
    for i in range(period - 1, n):
        window = tp[i - period + 1: i + 1]
        sma = sum(window) / period
        mad = sum(abs(t - sma) for t in window) / period
        if mad == 0:
            out[i] = 0.0
        else:
            out[i] = (tp[i] - sma) / (0.015 * mad)
    return out


def compute_cci(bars: List[dict], period: int = 20) -> List[MaybeNum]:
    """DELIVERY wrapper (2dp) — see the module docstring before changing."""
    return _round_series(compute_cci_raw(bars, period), 2)


# ─── MFI ─────────────────────────────────────────────────────────────────────

def compute_mfi_raw(bars: List[dict], period: int = 14) -> List[MaybeNum]:
    """Money Flow Index, unrounded. Range [0, 100].

    typical price = (h + l + c) / 3
    money flow   = typical * volume
    PMF accumulates when typical[i] > typical[i-1]; NMF when <.
    MFI = 100 - 100 / (1 + PMF / NMF) over rolling ``period``.
    """
    n = len(bars)
    out: List[MaybeNum] = [None] * n
    if period <= 0 or n < period + 1:
        return out
    tp = [(b["h"] + b["l"] + b["c"]) / 3.0 for b in bars]
    flow = [tp[i] * (bars[i].get("v") or 0) for i in range(n)]
    for i in range(period, n):
        pmf = 0.0
        nmf = 0.0
        for j in range(i - period + 1, i + 1):
            if tp[j] > tp[j - 1]:
                pmf += flow[j]
            elif tp[j] < tp[j - 1]:
                nmf += flow[j]
        if nmf == 0:
            out[i] = 100.0
        else:
            out[i] = 100.0 - 100.0 / (1 + pmf / nmf)
    return out


def compute_mfi(bars: List[dict], period: int = 14) -> List[MaybeNum]:
    """DELIVERY wrapper (2dp) — see the module docstring before changing."""
    return _round_series(compute_mfi_raw(bars, period), 2)


# ─── Stochastic ──────────────────────────────────────────────────────────────

def compute_stoch_raw(
    bars: List[dict],
    k_period: int = 14,
    d_period: int = 3,
) -> Tuple[List[MaybeNum], List[MaybeNum]]:
    """Fast %K + slow %D Stochastic, unrounded.

    %K = 100 * (close - LL_k) / (HH_k - LL_k)
    %D = SMA(%K, d_period)     ← of the RAW %K here (the delivery wrapper uses
                                 the rounded %K, matching the frontend's own
                                 rounded-%K %D; both lanes do the same thing).

    Both lists aligned to input length. Returns 50.0 when range is zero
    (matches the frontend's safety branch).
    """
    n = len(bars)
    k_out: List[MaybeNum] = [None] * n
    d_out: List[MaybeNum] = [None] * n
    if k_period <= 0 or d_period <= 0 or n < k_period:
        return k_out, d_out
    for i in range(k_period - 1, n):
        ll = float("inf")
        hh = float("-inf")
        for j in range(i - k_period + 1, i + 1):
            if bars[j]["l"] < ll:
                ll = bars[j]["l"]
            if bars[j]["h"] > hh:
                hh = bars[j]["h"]
        rng = hh - ll
        if rng == 0:
            k_out[i] = 50.0
        else:
            k_out[i] = (bars[i]["c"] - ll) / rng * 100.0
    # %D = SMA(%K, d_period). First valid %D lands at index (k_period - 1) + (d_period - 1).
    first_d_idx = (k_period - 1) + (d_period - 1)
    for i in range(first_d_idx, n):
        window: List[float] = []
        ok = True
        for j in range(i - d_period + 1, i + 1):
            v = k_out[j]
            if v is None:
                ok = False
                break
            window.append(v)
        if ok:
            d_out[i] = sum(window) / d_period
    return k_out, d_out


def compute_stoch(
    bars: List[dict],
    k_period: int = 14,
    d_period: int = 3,
) -> Tuple[List[MaybeNum], List[MaybeNum]]:
    """DELIVERY wrapper (2dp) — see the module docstring before changing.

    %D is deliberately the SMA of the **rounded** %K, reproducing the original
    mid-pipeline rounding (and the frontend, which does exactly the same).
    """
    k_raw, _d_raw = compute_stoch_raw(bars, k_period, d_period)
    k_out = _round_series(k_raw, 2)
    d_out: List[MaybeNum] = [None] * len(k_out)
    if d_period <= 0:
        return k_out, d_out
    first_d_idx = (k_period - 1) + (d_period - 1)
    for i in range(max(first_d_idx, 0), len(k_out)):
        window = k_out[i - d_period + 1: i + 1]
        if len(window) == d_period and all(v is not None for v in window):
            d_out[i] = round(sum(window) / d_period, 2)
    return k_out, d_out


# ═════════════════════════════════════════════════════════════════════════════
# THE SEVEN THAT ONLY EXISTED IN JS  (B5 alerts-gap)
# ═════════════════════════════════════════════════════════════════════════════
#
# `vwap`, `atr`, `sar`, `ichimoku`, `adx`, `obv` and `donchian` are engine
# definitions with no Python lane, which is why an alert naming one could be
# STORED and could never FIRE — `indicator_alert_evaluator._evaluate_one` returns
# `(None, False)` on an `INDICATOR_FUNCS` miss. These close that.
#
# ⛔ THEY ARE TRANSCRIPTIONS OF `indicators.js`, NOT RE-DERIVATIONS. Where the JS
# deviates from the textbook the deviation is COPIED, because the two lanes have
# to agree at 1e-9 against one shared fixture and because the chart's picture is
# the shipped behaviour. Four such quirks are load-bearing and each is marked
# ⚠️ PRESERVED QUIRK at the site that carries it:
#
#   1. `obv` seeds bar 0 with 0.0 rather than the None pad (B1 pinned it).
#   2. `ichimoku`'s spanA/spanB are NOT forward-displaced 26 bars, and `chikou`
#      IS back-shifted 26 — so its column has a TRAILING pad, the only column in
#      this module that does.
#   3. `sar` carries a second output (`isUptrend`) alongside its price.
#   4. `vwap` anchors on the ET SESSION (owner decision `VWAP_SESSION_ANCHOR`,
#      2026-08-03, `compute.rev` 2), NOT the UTC calendar day. Porting the
#      retired UTC bucketing would reintroduce a defect measured at $14.45 at a
#      session open.
#
# ⚠️ FLOAT ORDER IS PART OF THE TRANSCRIPTION. 1e-9 across two languages only
# holds if the accumulations happen in the same order with the same associativity
# — `sum(xs[:period])` matches JS's `reduce((s, x) => s + x, 0)` left-fold, and
# volumes are coerced to `float` so Python's arbitrary-precision ints cannot
# quietly out-compute JS's float64 on a long OBV or VWAP run.
#
# ⚠️ DEGENERATE PERIODS GUARD RATHER THAN MIRROR. `_schema.md` puts degenerate
# inputs outside the fixture contract, and the two languages fail differently
# there: a `period` of 0 makes JS produce `Infinity`, while Python raises
# `ZeroDivisionError`; a period LARGER than the window makes JS read `bars[-1]`
# as `undefined` and throw, while Python's negative indexing silently wraps to
# the end of the series and returns a plausible wrong number. Silent-and-wrong is
# the one outcome neither lane may have, so these return the all-None column
# instead. `params_json` on an alert row is user-supplied and unvalidated, so
# this is a live path, not a hypothetical.


# ─── ATR ─────────────────────────────────────────────────────────────────────

def compute_atr_raw(bars: List[dict], period: int = 14) -> List[MaybeNum]:
    """Wilder-smoothed Average True Range, unrounded. Mirrors ``computeATR``.

    TR = max(h-l, |h - prev_c|, |l - prev_c|), defined from bar 1. The seed is
    the simple mean of the first ``period`` TRs and lands on ``bars[period]``.
    """
    n = len(bars)
    out: List[MaybeNum] = [None] * n
    if period <= 0 or n < period + 1:
        return out
    trs: List[float] = []
    for i in range(1, n):
        prev_c = bars[i - 1]["c"]
        trs.append(max(
            bars[i]["h"] - bars[i]["l"],
            abs(bars[i]["h"] - prev_c),
            abs(bars[i]["l"] - prev_c),
        ))
    atr = sum(trs[:period]) / period
    out[period] = atr
    for i in range(period, len(trs)):
        atr = (atr * (period - 1) + trs[i]) / period
        out[i + 1] = atr
    return out


def compute_atr(bars: List[dict], period: int = 14) -> List[MaybeNum]:
    """DELIVERY wrapper (4dp — a price-scale value, like BB)."""
    return _round_series(compute_atr_raw(bars, period), 4)


# ─── ADX / DMI ───────────────────────────────────────────────────────────────

def compute_adx_raw(
    bars: List[dict],
    period: int = 14,
) -> Tuple[List[MaybeNum], List[MaybeNum], List[MaybeNum]]:
    """Returns (adx, plus_di, minus_di) unrounded. Mirrors ``computeADX``.

    +DI / -DI first land on ``bars[period]``; ADX is a second Wilder smoothing
    of DX and first lands on ``bars[2 * period - 1]``. All three are bar-aligned
    and the same length — the JS lane used to return ``adx`` shorter than its DIs.
    """
    n = len(bars)
    adx_out: List[MaybeNum] = [None] * n
    plus_di: List[MaybeNum] = [None] * n
    minus_di: List[MaybeNum] = [None] * n
    if period <= 0 or n < 2 * period:
        return adx_out, plus_di, minus_di

    plus_dm = [0.0] * n
    minus_dm = [0.0] * n
    tr = [0.0] * n
    for i in range(1, n):
        up = bars[i]["h"] - bars[i - 1]["h"]
        down = bars[i - 1]["l"] - bars[i]["l"]
        plus_dm[i] = up if (up > down and up > 0) else 0.0
        minus_dm[i] = down if (down > up and down > 0) else 0.0
        prev_c = bars[i - 1]["c"]
        tr[i] = max(
            bars[i]["h"] - bars[i]["l"],
            abs(bars[i]["h"] - prev_c),
            abs(bars[i]["l"] - prev_c),
        )

    # Seed = SUM (not mean) of the first `period` values, indices 1..period.
    s_plus = 0.0
    s_minus = 0.0
    s_tr = 0.0
    for i in range(1, period + 1):
        s_plus += plus_dm[i]
        s_minus += minus_dm[i]
        s_tr += tr[i]

    dx: List[MaybeNum] = [None] * n

    def _push(idx: int) -> None:
        pdi = 0.0 if s_tr == 0 else 100.0 * s_plus / s_tr
        mdi = 0.0 if s_tr == 0 else 100.0 * s_minus / s_tr
        total = pdi + mdi
        plus_di[idx] = pdi
        minus_di[idx] = mdi
        dx[idx] = 0.0 if total == 0 else 100.0 * abs(pdi - mdi) / total

    _push(period)
    for i in range(period + 1, n):
        s_plus = s_plus - s_plus / period + plus_dm[i]
        s_minus = s_minus - s_minus / period + minus_dm[i]
        s_tr = s_tr - s_tr / period + tr[i]
        _push(i)

    # DX is defined from index `period`, so the ADX seed spans
    # bars[period .. 2*period-1] and the first ADX lands on bars[2*period - 1].
    adx = 0.0
    for i in range(period, 2 * period):
        adx += dx[i]
    adx /= period
    adx_out[2 * period - 1] = adx
    for i in range(2 * period, n):
        adx = (adx * (period - 1) + dx[i]) / period
        adx_out[i] = adx
    return adx_out, plus_di, minus_di


def compute_adx(
    bars: List[dict],
    period: int = 14,
) -> Tuple[List[MaybeNum], List[MaybeNum], List[MaybeNum]]:
    """DELIVERY wrapper (2dp — a 0-100 scale, like RSI)."""
    adx, plus_di, minus_di = compute_adx_raw(bars, period)
    return (
        _round_series(adx, 2),
        _round_series(plus_di, 2),
        _round_series(minus_di, 2),
    )


# ─── OBV ─────────────────────────────────────────────────────────────────────

def compute_obv_raw(bars: List[dict]) -> List[MaybeNum]:
    """On-Balance Volume, unrounded. Mirrors ``computeOBV``.

    ⚠️ PRESERVED QUIRK — THE ZERO SEED. Bar 0 is ``0.0``, not the None pad, so
    the line starts at zero on the first bar rather than a bar later. B1 pinned
    it deliberately; correcting it is a separate, measured, owner-facing change.

    ⚠️ Volume is coerced to ``float``. Python ints are arbitrary-precision, so a
    long series would accumulate EXACTLY here while JS's float64 rounds — the two
    lanes would drift past 2^53 and the 1e-9 fixture would be unreachable.
    """
    n = len(bars)
    if n == 0:
        return []
    out: List[MaybeNum] = [None] * n
    out[0] = 0.0
    obv = 0.0
    for i in range(1, n):
        v = float(bars[i].get("v") or 0)
        if bars[i]["c"] > bars[i - 1]["c"]:
            obv += v
        elif bars[i]["c"] < bars[i - 1]["c"]:
            obv -= v
        out[i] = obv
    return out


def compute_obv(bars: List[dict]) -> List[MaybeNum]:
    """DELIVERY wrapper (2dp). A no-op for whole-share volumes, kept so every
    public ``compute_*`` in this module rounds — the delivery boundary is a rule,
    not a per-indicator judgement call."""
    return _round_series(compute_obv_raw(bars), 2)


# ─── Donchian Channels ───────────────────────────────────────────────────────

def compute_donchian_raw(
    bars: List[dict],
    period: int = 20,
) -> Tuple[List[MaybeNum], List[MaybeNum], List[MaybeNum]]:
    """Returns (upper, middle, lower) unrounded. Mirrors ``computeDonchian``.

    upper = highest high over ``period``; lower = lowest low; middle = their mean.
    """
    n = len(bars)
    upper: List[MaybeNum] = [None] * n
    middle: List[MaybeNum] = [None] * n
    lower: List[MaybeNum] = [None] * n
    if period <= 0 or n < period:
        return upper, middle, lower
    for i in range(period - 1, n):
        hi = float("-inf")
        lo = float("inf")
        for j in range(i - period + 1, i + 1):
            if bars[j]["h"] > hi:
                hi = bars[j]["h"]
            if bars[j]["l"] < lo:
                lo = bars[j]["l"]
        upper[i] = hi
        middle[i] = (hi + lo) / 2
        lower[i] = lo
    return upper, middle, lower


def compute_donchian(
    bars: List[dict],
    period: int = 20,
) -> Tuple[List[MaybeNum], List[MaybeNum], List[MaybeNum]]:
    """DELIVERY wrapper (4dp — price-scale)."""
    upper, middle, lower = compute_donchian_raw(bars, period)
    return (
        _round_series(upper, 4),
        _round_series(middle, 4),
        _round_series(lower, 4),
    )


# ─── Ichimoku ────────────────────────────────────────────────────────────────

def compute_ichimoku_raw(
    bars: List[dict],
    tenkan_period: int = 9,
    kijun_period: int = 26,
    senkou_b_period: int = 52,
) -> Tuple[List[MaybeNum], List[MaybeNum], List[MaybeNum], List[MaybeNum], List[MaybeNum]]:
    """Returns (tenkan, kijun, span_a, span_b, chikou) unrounded.

    Mirrors ``computeIchimoku``, including BOTH of its deliberate deviations:

    ⚠️ PRESERVED QUIRK — NO FORWARD DISPLACEMENT. Standard Ichimoku pushes the
    cloud 26 bars into the FUTURE. These spans sit over the price that produced
    them. The chart has always drawn it this way.

    ⚠️ PRESERVED QUIRK — CHIKOU IS BACK-SHIFTED, so this is the ONE column in
    this module with a TRAILING pad: bar ``i``'s close is written to index
    ``i - kijun_period``, which leaves the last ``kijun_period`` slots None. Any
    consumer that assumes "None prefix, then values to the end" is wrong here,
    and the golden fixture declares the trailing pad explicitly rather than
    letting it look like a hole.
    """
    n = len(bars)
    tenkan: List[MaybeNum] = [None] * n
    kijun: List[MaybeNum] = [None] * n
    span_a: List[MaybeNum] = [None] * n
    span_b: List[MaybeNum] = [None] * n
    chikou: List[MaybeNum] = [None] * n
    # ⛔ THE FIRST COMPUTABLE BAR IS THE LONGEST PERIOD, AND SENKOU B IS NOT
    # ALWAYS IT. The form does not enforce tenkan <= kijun <= senkou_b:
    # `tenkanPeriod` declares max 75, `kijunPeriod` declares max 200, and
    # `senkouBPeriod` goes down to 1.
    #
    # 🔴 THIS USED TO BAIL — five all-None series, drawing nothing, with no error —
    # under a comment naming the FRONTEND crash as the reason ("a period past the
    # window would read a negative index, which JS throws on and Python would
    # silently wrap"). So the crash was known and the workaround was put in the
    # OTHER lane, which left the two disagreeing on the same inputs: the browser
    # raised a TypeError out of its render path while this one quietly returned
    # nothing. `computeIchimoku` now starts at the longest period too, so neither
    # can index behind the start of the series and both compute the same thing.
    #
    # The result was always well defined — the three lines are midpoints of three
    # independent look-back windows, and nothing in the definition requires one to
    # be longer than another. At the shipped 9/26/52 `longest` IS `senkou_b`, so
    # every value on every existing chart is unchanged.
    longest = max(tenkan_period, kijun_period, senkou_b_period)
    if min(tenkan_period, kijun_period, senkou_b_period) <= 0:
        return tenkan, kijun, span_a, span_b, chikou
    if n < longest:
        return tenkan, kijun, span_a, span_b, chikou

    def _period_mid(end: int, period: int) -> float:
        hi = float("-inf")
        lo = float("inf")
        for j in range(end - period + 1, end + 1):
            if bars[j]["h"] > hi:
                hi = bars[j]["h"]
            if bars[j]["l"] < lo:
                lo = bars[j]["l"]
        return (hi + lo) / 2

    displacement = kijun_period
    for i in range(longest - 1, n):
        tk = _period_mid(i, tenkan_period)
        kj = _period_mid(i, kijun_period)
        tenkan[i] = tk
        kijun[i] = kj
        span_a[i] = (tk + kj) / 2
        span_b[i] = _period_mid(i, senkou_b_period)
        if i >= displacement:
            chikou[i - displacement] = bars[i]["c"]
    return tenkan, kijun, span_a, span_b, chikou


def compute_ichimoku(
    bars: List[dict],
    tenkan_period: int = 9,
    kijun_period: int = 26,
    senkou_b_period: int = 52,
) -> Tuple[List[MaybeNum], List[MaybeNum], List[MaybeNum], List[MaybeNum], List[MaybeNum]]:
    """DELIVERY wrapper (4dp — every column is price-scale)."""
    cols = compute_ichimoku_raw(bars, tenkan_period, kijun_period, senkou_b_period)
    return tuple(_round_series(c, 4) for c in cols)  # type: ignore[return-value]


# ─── Parabolic SAR ───────────────────────────────────────────────────────────

def compute_sar_raw(
    bars: List[dict],
    step: float = 0.02,
    max_step: float = 0.2,
) -> Tuple[List[MaybeNum], List[MaybeNum]]:
    """Returns (sar, trend) unrounded. Mirrors ``computeParabolicSAR``.

    ⚠️ PRESERVED QUIRK — THE SECOND OUTPUT. The JS lane rides an ``isUptrend``
    boolean along on each point and the chart consumer strips it before handing
    data to LWC. It is carried here as a NUMERIC ``trend`` column (+1 up, -1
    down) so the shared golden fixture can pin it: the fixture compare is
    numeric, and a boolean that no fixture reads is a behaviour with no oracle.

    Bar 0 has no SAR — the trend seed consumes it — so index 0 is the None pad
    in both columns.
    """
    n = len(bars)
    sar_out: List[MaybeNum] = [None] * n
    trend_out: List[MaybeNum] = [None] * n
    if n < 2:
        return sar_out, trend_out

    is_uptrend = bars[1]["c"] > bars[0]["c"]
    sar = bars[0]["l"] if is_uptrend else bars[0]["h"]
    ep = bars[0]["h"] if is_uptrend else bars[0]["l"]
    af = step

    for i in range(1, n):
        bar = bars[i]
        next_sar = sar + af * (ep - sar)
        if is_uptrend:
            # SAR must sit at or below the two prior lows.
            if i >= 2:
                next_sar = min(next_sar, bars[i - 1]["l"], bars[i - 2]["l"])
            else:
                next_sar = min(next_sar, bars[i - 1]["l"])
            if bar["l"] < next_sar:
                is_uptrend = False
                next_sar = ep
                ep = bar["l"]
                af = step
            elif bar["h"] > ep:
                ep = bar["h"]
                af = min(af + step, max_step)
        else:
            # …or at or above the two prior highs.
            if i >= 2:
                next_sar = max(next_sar, bars[i - 1]["h"], bars[i - 2]["h"])
            else:
                next_sar = max(next_sar, bars[i - 1]["h"])
            if bar["h"] > next_sar:
                is_uptrend = True
                next_sar = ep
                ep = bar["h"]
                af = step
            elif bar["l"] < ep:
                ep = bar["l"]
                af = min(af + step, max_step)
        sar = next_sar
        sar_out[i] = sar
        trend_out[i] = 1.0 if is_uptrend else -1.0
    return sar_out, trend_out


def compute_sar(
    bars: List[dict],
    step: float = 0.02,
    max_step: float = 0.2,
) -> Tuple[List[MaybeNum], List[MaybeNum]]:
    """DELIVERY wrapper (4dp on the price; the trend flag is ±1 and untouched)."""
    sar, trend = compute_sar_raw(bars, step, max_step)
    return _round_series(sar, 4), trend


def compute_sar_events(
    bars: List[dict],
    step: float = 0.02,
    max_step: float = 0.2,
) -> Tuple[List[MaybeNum], List[MaybeNum]]:
    """``(price_crossed_sar, trend_flipped)`` as ``{0.0, 1.0, None}`` columns.

    ⚠️ DERIVED FROM ``compute_sar_raw``, NOT RE-IMPLEMENTED. The ``trend`` column
    is already ±1 and already pinned by ``tests/fixtures/indicators/sar_default``
    in BOTH lanes, so not one fixture byte is reseeded to add these and neither
    lane can re-baseline under the other. A second SAR loop here would be the
    twin this whole programme retires.

    WHY SAR HAS EVENTS AT ALL. ``sar`` is deliberately not alertable by a fixed
    threshold — the value JUMPS TO THE OTHER SIDE OF PRICE at every flip, so the
    same number means "trailing below an uptrend" on one bar and "above a
    downtrend" on the next (``indicator_alert_evaluator._SAR_IS_NOT_OFFERED``).
    These two are what a trader actually watches for instead:

    * ``price_crossed_sar`` — the CLOSE moved to the other side of the stop.
    * ``trend_flipped``     — the SAR itself jumped sides.

    THEY ARE NOT THE SAME COLUMN. In an uptrend that does not reverse
    ``close >= sar`` always holds (SAR is clamped at or below the two prior lows
    and the reversal test is ``low < sar``); a downtrend keeps ``close <= sar`` by
    symmetry. So a side change without a trend change is only reachable around a
    reversal bar — and there it IS reachable: on reversal the new SAR is the prior
    leg's extreme point, which an OUTSIDE bar can close beyond. That bar flips the
    trend without flipping the side; the next flips the side without the trend.

    ⚠️ THE DOMAIN IS ``{0.0, 1.0, None}`` AND ``None`` IS NOT "NO EVENT". It is
    the warmup pad: bar 0 has no SAR at all (the trend seed consumes it), so there
    is nothing to have crossed. ``0.0`` is "computed, did not happen" — including
    bar 1, which is computable and has no prior side or trend to have moved away
    from.

    ⚠️ ``close > sar`` IS STRICT, and the JS lane
    (``indicators.computeParabolicSAREvents``) makes the identical choice — the
    two are asserted against one fixture at rel-tol 1e-9, so a tie-break that
    disagreed would show up as a changed number rather than as a shrug.

    ⛔ THERE IS DELIBERATELY NO ``_raw`` / delivery PAIR. Every other indicator has
    one because the delivery layer ROUNDS for the two live consumers that compare
    against user thresholds. This column's whole domain is ``{0, 1, None}``:
    there are no decimals to round, so a ``compute_sar_events_raw`` would be a
    second name for one function and an invitation to make them differ.
    """
    sar, trend = compute_sar_raw(bars, step, max_step)
    n = len(bars)
    crossed: List[MaybeNum] = [None] * n
    flipped: List[MaybeNum] = [None] * n
    if n < 2:
        return crossed, flipped

    def _above(i: int) -> Optional[bool]:
        s = sar[i]
        if s is None:
            return None
        return bars[i]["c"] > s

    for i in range(1, n):
        t, prev_t = trend[i], trend[i - 1]
        side, prev_side = _above(i), _above(i - 1)
        # Bar 1 has a trend and a side but no PRIOR of either — the seed bar is
        # the pad. "Nothing happened" is the honest answer, not a gap.
        if t is not None:
            flipped[i] = 1.0 if (prev_t is not None and prev_t != t) else 0.0
        if side is not None:
            crossed[i] = 1.0 if (prev_side is not None and prev_side != side) else 0.0
    return crossed, flipped


# ─── VWAP ────────────────────────────────────────────────────────────────────

_ET_ZONE = None
_ET_ZONE_ERROR: Optional[str] = None


def _et_zone():
    """``America/New_York``, resolved once and cached.

    ⛔ RAISES rather than falling back to UTC. A missing tz database is a
    deployment fault; silently bucketing by UTC would reproduce the exact defect
    `VWAP_SESSION_ANCHOR` retired, and it would do it invisibly. The alert
    evaluator wraps every compute in try/except and logs, so a raise here is
    LOUD in the logs and produces no value — never a wrong one.
    """
    global _ET_ZONE, _ET_ZONE_ERROR
    if _ET_ZONE is not None:
        return _ET_ZONE
    if _ET_ZONE_ERROR is not None:
        raise RuntimeError(_ET_ZONE_ERROR)
    try:
        import zoneinfo
        _ET_ZONE = zoneinfo.ZoneInfo("America/New_York")
    except Exception as exc:  # noqa: BLE001
        _ET_ZONE_ERROR = (
            "compute_vwap needs the IANA tz database to anchor sessions on the ET "
            "calendar day (pip install tzdata). Bucketing by UTC instead is the "
            "retired VWAP_SESSION_ANCHOR defect, measured at $14.45 at a session open."
        )
        raise RuntimeError(_ET_ZONE_ERROR) from exc
    return _ET_ZONE


#: The earliest instant a bar's ``t`` may carry and still be believed as a real
#: point in time: 1990-01-01T00:00:00Z. Anything below it is not an instant, it
#: is a number in some OTHER unit that happens to fit in the same field.
#:
#: ⛔ THIS CONSTANT EXISTS BECAUSE THE LIVE ALERT LANE HANDED THIS FUNCTION DAYS
#: AND IT ANSWERED. `bars_sqlite` stores daily/weekly/monthly timestamps as
#: ``YYYYMMDD`` INTS (its own module docstring says so) and intraday ones as unix
#: seconds; `indicator_alert_evaluator._fetch_bars_for_alert` passes the store's
#: value through verbatim as ``t``, which is correct — `bar_close_epoch` and
#: `closed_bar_index` READ that calendar encoding and would break if it were
#: rewritten under them. What was wrong is that a compute documented in SECONDS
#: accepted it: ``20250101`` read as unix seconds is **1970-08-23**, two years of
#: daily bars span 11,130 of those seconds, and every bar therefore landed in one
#: ET calendar day. A 400-bar daily VWAP was ONE session beginning in 1970, and
#: because it never raised, nothing anywhere surfaced it.
#:
#: ⛔ THE REFUSAL IS AN ALL-``None`` COLUMN, NOT A PLAUSIBLE ANSWER, AND THAT IS
#: THE WHOLE POINT. "One bucket for the whole series" IS the defect's output, so a
#: fallback shaped like it could never be told apart from it. Neither is the
#: answer a *converted* column: a session VWAP whose session is a whole daily bar
#: is just that bar's typical price wearing an indicator's name — a plausible
#: number for a question that has none. The chart lane says the same thing by
#: construction (`eligibility.VWAP_TIMEFRAMES` is intraday-only); this is that
#: gate, restated where it cannot be routed around.
VWAP_MIN_INSTANT = 631152000


def compute_vwap_raw(bars: List[dict]) -> List[MaybeNum]:
    """Session-anchored VWAP, unrounded. Mirrors ``computeVWAP``.

    ⛔ REFUSES THE WHOLE COLUMN when any bar's ``t`` is not a real instant —
    see ``VWAP_MIN_INSTANT``. Both doors are closed by the one check: the alert
    lane's ``20250101`` date-shaped INT and the chart lane's ``'2026-08-05'``
    date STRING. The string used to reach a stable ``'invalid'`` bucket, which
    is one bucket for the series, which is the defect by another name.

    ⚠️ PRESERVED (CORRECTED) BEHAVIOUR — THE SESSION IS THE ET CALENDAR DAY.
    Owner decision `VWAP_SESSION_ANCHOR`, accepted 2026-08-03 at a measured 2,590
    changed pixels (`docs/decisions/2026-08-02-vwap-utc-day-bucketing.md`), which
    is why this port takes the CORRECTED logic and not the UTC-day bucketing the
    chart shipped for years. Regular hours never notice — 09:30-16:00 ET is
    always inside one UTC day — but on extended hours 20:00 ET is 00:00 UTC the
    next day, so the accumulator was wiped on the last bar of a session that had
    not ended, and the following 04:00 ET open was then not a UTC boundary at all
    and a whole session piled onto the previous evening's post-market volume,
    opening **$14.45** from the session mean.

    ET midnight IS the extended-hours boundary for US equity bars (first print
    04:00 ET), and it is deliberately NOT 09:30, which would reset a pre-market
    session that is already running.

    The zone is resolved PER INSTANT from the IANA database, not from one offset
    captured at import: a fixed offset is correct for half the year and silently
    an hour wrong for the other half, which is the same class of defect.

    A one-entry memo on the UTC hour makes this cheap and is exact rather than an
    approximation — every ``America/New_York`` offset is a whole number of hours
    and every transition lands on a whole UTC hour, so the ET date cannot change
    inside one UTC hour.
    """
    n = len(bars)
    if n == 0:
        return []
    # THE UNIT GATE. It runs BEFORE `_et_zone()` so a refused series costs no tz
    # lookup, and before any accumulation so the answer is all-or-nothing — a
    # per-bar skip would leave the surviving bars in one bucket, which is the
    # shape being refused.
    for bar in bars:
        t = bar.get("t")
        if isinstance(t, bool) or not isinstance(t, (int, float)) or t < VWAP_MIN_INSTANT:
            return [None] * n
    out: List[MaybeNum] = [None] * n
    cum_pv = 0.0
    cum_vol = 0.0
    current_day = None
    memo_hour = None
    memo_key = None
    zone = _et_zone()
    for i, bar in enumerate(bars):
        # `t` is a real instant: the gate above already refused everything else,
        # so there is no defensive branch here to fall through to.
        t = bar["t"]
        hour = int(t // 3600)
        if hour == memo_hour:
            day_key = memo_key
        else:
            day_key = datetime.fromtimestamp(t, zone).strftime("%Y-%m-%d")
            memo_hour = hour
            memo_key = day_key
        if day_key != current_day:
            cum_pv = 0.0
            cum_vol = 0.0
            current_day = day_key
        tp = (bar["h"] + bar["l"] + bar["c"]) / 3
        v = float(bar.get("v") or 0)
        cum_pv += tp * v
        cum_vol += v
        if cum_vol > 0:
            out[i] = cum_pv / cum_vol
    return out


def compute_vwap(bars: List[dict]) -> List[MaybeNum]:
    """DELIVERY wrapper (4dp — price-scale)."""
    return _round_series(compute_vwap_raw(bars), 4)


# ═════════════════════════════════════════════════════════════════════════════
# PHASE C TASK 14 — Anchored VWAP · ATR bands · the RS line
# ═════════════════════════════════════════════════════════════════════════════

#: The anchors ``compute_avwap_raw`` accepts, in the order the definition's
#: ``enum`` declares them. ONE list, read by the maths and asserted against the
#: JS lane's ``AVWAP_ANCHORS`` — a second copy is how an option a user can pick
#: becomes an anchor the maths does not know.
#:
#: ⭐ AN ``enum``, NOT A ``time`` (decision A3). Spec §3.1 reserves ``time`` and
#: ``defSchema`` fails closed on it; click-to-anchor already ships as the DRAWING
#: TOOL, which is anchored by a click and needs no definition.
AVWAP_ANCHORS: Tuple[str, ...] = (
    "session", "week", "month", "quarter", "year", "swingHigh", "swingLow",
)

#: 🔴 THE UNIT GUARD — ``1990-01-01T00:00:00Z``.
#:
#: A bar older than this is not a bar this application has ever served
#: (``bars_fetch`` caps daily/weekly lookback at 30 years), so a ``t`` below it
#: is a **unit error** — a value that is not unix seconds at all — and never "a
#: very old bar".
#:
#: It existed because the defect WAS LIVE in this repo and MEASURED: the daily
#: call site ``_fetch_bars_for_alert`` handed ``compute_vwap`` the store's
#: ``YYYYMMDD`` integer (``20250101``) where real unix seconds are expected, so
#: the anchor resolved to **1970-08-23**, two years of daily bars spanned 11,130
#: seconds, and 56 bars of "daily VWAP" produced exactly ONE reset — at index 0.
#: Nothing raised, so nothing surfaced it: the line was plausible and wrong.
#:
#: ⭐ IT IS NOW ``VWAP_MIN_INSTANT`` ITSELF, NOT A COPY OF ITS VALUE, AND THAT IS
#: LOAD-BEARING. ``compute_avwap_raw(bars, "session")`` is documented to be
#: ``compute_vwap_raw(bars)`` bar for bar; while only one of them validated the
#: unit that promise was FALSE on precisely the inputs that carry the defect —
#: AVWAP refused a daily series while VWAP answered 1970. Two constants that
#: happen to be equal today is how that gap reopens, so there is one.
#:
#: ⚠️ THE ANCHOR IS STILL ENCODED BY CALENDAR SEMANTICS, NEVER BY MAGNITUDE.
#: This constant does not decide *which* anchor a bar falls in; it decides
#: whether the bar carries an INSTANT at all, and refuses the whole column when
#: it does not. Validating the unit is what makes "encode by timeframe, never by
#: magnitude" obeyable — a date-shaped integer answers every calendar question
#: with 1970 and never argues.
#:
#: ⛔ THE REFUSAL IS AN ALL-``None`` COLUMN, NOT A PLAUSIBLE ANSWER. A "one
#: bucket for the whole series" fallback is exactly what the live defect
#: produces, so it could not be told apart from it.
AVWAP_MIN_INSTANT = VWAP_MIN_INSTANT


def _et_anchor_key(t: float, anchor: str, zone) -> str:
    """The anchor bucket ``t`` falls in, as a string key.

    ⚠️ THE ZONE IS RESOLVED PER INSTANT from the IANA database, never from one
    offset captured at import — a fixed offset is correct for half the year and
    silently an hour wrong for the other half.

    The ``week`` key is the ET civil date of the preceding MONDAY, computed with
    plain civil arithmetic on the already-resolved date so it cannot re-enter a
    timezone and pick up an offset twice.
    """
    dt = datetime.fromtimestamp(t, zone)
    if anchor == "session":
        return f"{dt.year}-{dt.month}-{dt.day}"
    if anchor == "month":
        return f"{dt.year}-{dt.month}"
    if anchor == "quarter":
        return f"{dt.year}-Q{(dt.month - 1) // 3 + 1}"
    if anchor == "year":
        return f"{dt.year}"
    monday = dt.date() - timedelta(days=dt.weekday())
    return f"W{monday.year}-{monday.month}-{monday.day}"


def compute_avwap_raw(bars: List[dict], anchor: str = "session") -> List[MaybeNum]:
    """Anchored VWAP, unrounded. Mirrors ``computeAVWAP`` in indicators.js.

    The session VWAP's accumulator, restarted at a NAMED anchor.
    ``session`` is the same boundary ``compute_vwap_raw`` uses (the ET calendar
    day), so on a one-session series the two are the same number bar for bar.
    ``week``/``month``/``quarter``/``year`` restart on the ET calendar boundary;
    ``swingHigh``/``swingLow`` restart at every bar that makes a NEW RUNNING
    EXTREME — causal, no lookahead, so bar ``i``'s value never changes when bar
    ``i+1`` arrives.

    ⚠️ ONLY THE CALENDAR ANCHORS TOUCH TIME AT ALL, so the two swing anchors are
    unaffected by ``AVWAP_MIN_INSTANT`` — a guard that fired on them would refuse
    a column it has no reason to doubt.
    """
    n = len(bars)
    if n == 0:
        return []
    # Fail CLOSED on an anchor the maths does not know. `defSchema` refuses an
    # out-of-vocabulary enum at registration; this is the second door, because
    # `params_json` on a stored alert row is user-supplied and unvalidated.
    if anchor not in AVWAP_ANCHORS:
        return [None] * n

    by_price = anchor in ("swingHigh", "swingLow")
    if not by_price:
        for bar in bars:
            t = bar.get("t")
            if isinstance(t, bool) or not isinstance(t, (int, float)) or t < AVWAP_MIN_INSTANT:
                return [None] * n

    out: List[MaybeNum] = [None] * n
    cum_pv = 0.0
    cum_vol = 0.0
    anchor_key = None
    memo_hour = None
    memo_key = None
    extreme = None
    swing_at = 0
    zone = None if by_price else _et_zone()
    for i, bar in enumerate(bars):
        if by_price:
            if anchor == "swingHigh":
                if extreme is None or bar["h"] > extreme:
                    extreme = bar["h"]
                    swing_at = i
            elif extreme is None or bar["l"] < extreme:
                extreme = bar["l"]
                swing_at = i
            key = swing_at
        else:
            hour = int(bar["t"] // 3600)
            if hour == memo_hour:
                key = memo_key
            else:
                key = _et_anchor_key(bar["t"], anchor, zone)
                memo_hour = hour
                memo_key = key
        if key != anchor_key:
            cum_pv = 0.0
            cum_vol = 0.0
            anchor_key = key
        tp = (bar["h"] + bar["l"] + bar["c"]) / 3
        v = float(bar.get("v") or 0)
        cum_pv += tp * v
        cum_vol += v
        if cum_vol > 0:
            out[i] = cum_pv / cum_vol
    return out


def compute_avwap(bars: List[dict], anchor: str = "session") -> List[MaybeNum]:
    """DELIVERY wrapper (4dp — price-scale, like ``compute_vwap``)."""
    return _round_series(compute_avwap_raw(bars, anchor), 4)


# ─── THE BAR CLOCK — the closed table's ``clock`` section ─────────────────────
#
# ⭐ THE PYTHON SIBLING OF ``indicators.js::computeClock``, and it lives HERE for
# the same reason every other compute in this file does: ``ast_interpret`` owns
# no maths, so a private calendar there would be a second authority over values
# the two lanes are required to agree on at 1e-9.
#
# ⚠️ NO ``compute_clock`` DELIVERY WRAPPER, DELIBERATELY. The rounding layer at
# the top of this module exists because two live consumers compare indicator
# values against user thresholds; a calendar field is an integer already and
# rounding it would be a wrapper that cannot change anything, which is exactly
# the kind of ceremony a reader later mistakes for a meaningful boundary.

#: The timeframe codes this platform ships, and the ones that are intraday.
#:
#: ⛔ ANYTHING ELSE IS NOT CLASSIFIED, IT IS REFUSED — see the same two lists in
#: ``indicators.js``, which cannot import the manifest (``interpret.test.js``
#: pins it as a leaf with no imports at all), so the codes are literals in each
#: lane. That is a hand copy and the only honest answer to a hand copy is to
#: MEASURE it: ``tests/fixtures/ast/clock_parity.json``'s ``tf_booleans`` block
#: probes every code and five NON-codes through both lanes.
CLOCK_INTRADAY_TFS = ("1", "5", "15", "30", "60")
CLOCK_TIMEFRAMES = CLOCK_INTRADAY_TFS + ("D", "W", "M")

#: The eight columns that read the bar's ``t`` — and therefore the eight the
#: unit gate refuses together.
CLOCK_TIME_DERIVED = ("time", "year", "month", "dayofmonth", "dayofweek",
                      "hour", "minute", "sessionfirst")

#: Every column ``compute_clock`` produces. The CLOSED TABLE is the authority
#: over which of these names a formula may spell; this module is the authority
#: over what each one MEANS, and ``ast_interpret`` raises by name when the two
#: disagree.
CLOCK_COLUMNS = CLOCK_TIME_DERIVED + ("barindex", "isintraday", "isdaily",
                                      "isweekly", "ismonthly")


def compute_clock(bars: List[dict], tf: Optional[str] = None) -> Dict[str, List[MaybeNum]]:
    """The clock columns for a bar series, aligned to ``bars``.

    Mirrors ``computeClock`` in ``indicators.js``, value for value.

    ``time`` is the bar's own ``t`` IN UNIX SECONDS — this platform's unit
    everywhere a bar carries one — and NOT Pine's milliseconds.

    ``dayofweek`` is 1 on Sunday through 7 on Saturday, which IS Pine's
    convention (``dayofweek.sunday == 1``) and deliberately not
    ``datetime.weekday()``'s 0=Monday. The table's whole import story is Pine,
    and two conventions for one name is the defect ``williams_r`` /
    ``williamsR`` already cost this repo once.

    ⛔ THE UNIT GATE IS ``compute_vwap_raw``'S, AND IT IS PARTIAL ON PURPOSE.
    ``bars_sqlite`` stores daily/weekly/monthly ``t`` as ``YYYYMMDD`` INTS and
    ``indicator_alert_evaluator`` passes them through, and ``20250101`` read as
    unix seconds is 1970-08-23. So a series that is not in seconds refuses the
    eight time-derived columns, all-or-nothing — a per-bar skip would leave the
    survivors in one ET day, which IS the shape being refused — and leaves
    ``barindex`` and the four timeframe booleans alone, because those read no
    ``t`` at all and a guard firing on them would refuse a column it has no
    reason to doubt.

    ⛔ AND AN ABSENT ``tf`` FAILS CLOSED, NEVER TO A DEFAULT. A guessed ``"D"``
    makes ``isdaily`` a confident 1 on a 5-minute chart, which is a wrong answer
    wearing a right one's clothes; ``None`` is "nobody told me".
    """
    n = len(bars)
    cols: Dict[str, List[MaybeNum]] = {name: [None] * n for name in CLOCK_COLUMNS}
    if n == 0:
        return cols

    # The timeframe half reads no bar, so it is decided ONCE and written flat.
    # ``known`` is a MEMBERSHIP TEST over the declared codes, never a parse.
    known = tf in CLOCK_TIMEFRAMES
    for name, code in (("isintraday", None), ("isdaily", "D"),
                       ("isweekly", "W"), ("ismonthly", "M")):
        if not known:
            continue
        hit = (tf in CLOCK_INTRADAY_TFS) if code is None else (tf == code)
        cols[name] = [1.0 if hit else 0.0] * n

    # ``barindex`` is the loop counter and nothing else. It is here rather than
    # in ``ast_interpret`` so the clock has ONE owner: a second place that knew
    # what bar number a bar is would be a second authority over a compared value.
    cols["barindex"] = [float(i) for i in range(n)]

    # THE UNIT GATE — before ``_et_zone()``, so a refused series costs no tz
    # lookup, and before any accumulation so the answer is all-or-nothing.
    for bar in bars:
        t = bar.get("t") if isinstance(bar, dict) else None
        if isinstance(t, bool) or not isinstance(t, (int, float)) or t < VWAP_MIN_INSTANT:
            return cols

    zone = _et_zone()
    time_col: List[MaybeNum] = [None] * n
    year: List[MaybeNum] = [None] * n
    month: List[MaybeNum] = [None] * n
    dom: List[MaybeNum] = [None] * n
    dow: List[MaybeNum] = [None] * n
    hour: List[MaybeNum] = [None] * n
    minute: List[MaybeNum] = [None] * n
    first: List[MaybeNum] = [None] * n

    # One-entry memo on the UTC hour, exactly as ``compute_vwap_raw`` does and
    # EXACT for the same reason: every ``America/New_York`` offset is a whole
    # number of hours and every transition lands on a whole UTC hour, so no ET
    # field down to the hour can change inside one UTC hour. ⚠️ THE MINUTE IS
    # NOT IN THE MEMO — it changes inside the hour by definition — so it is
    # derived from the instant in hand rather than formatted.
    memo_hour = None
    memo = None
    prev_day = -1
    for i, bar in enumerate(bars):
        t = bar["t"]
        utc_hour = int(t // 3600)
        if utc_hour == memo_hour:
            y, mo, d, wd, h = memo
        else:
            dt = datetime.fromtimestamp(t, zone)
            # ``isoweekday()`` is 1=Monday..7=Sunday; Pine's day is
            # 1=Sunday..7=Saturday, so Sunday's 7 wraps to 1 and every other day
            # shifts up by one. Written as ``% 7 + 1`` so there is no table.
            y, mo, d, wd, h = (dt.year, dt.month, dt.day,
                               dt.isoweekday() % 7 + 1, dt.hour)
            memo_hour = utc_hour
            memo = (y, mo, d, wd, h)
        time_col[i] = float(t)
        year[i] = float(y)
        month[i] = float(mo)
        dom[i] = float(d)
        dow[i] = float(wd)
        hour[i] = float(h)
        # ET minutes ARE UTC minutes: every ET offset is a whole number of
        # hours. Derived rather than formatted, which keeps the memo exact.
        minute[i] = float(int((t - utc_hour * 3600) // 60))
        # The ET calendar day as ONE number, so the comparison is numeric and no
        # string key is built per bar.
        #
        # ⛔⛔ THE OLDEST BAR IS None, NOT 1, AND THAT IS THE WHOLE OF WHY THIS
        # COLUMN DECLARES ``lookback: 1``. It is a function of TWO bars -- this
        # bar's ET day against the previous bar's -- exactly as ``change(close)``
        # is. While bar 0 answered 1 the value depended on the WINDOW rather than
        # on the tape: slice the same series anywhere and its leading bar claimed
        # to open a session whether or not it did (measured -- ``bars[1:]`` and
        # ``bars[4:]`` both read 1 where the full series read 0). The blank is the
        # same warm-up pad every windowed entry in this table carries, and it is
        # what makes every bar this column DOES answer for window-independent.
        day = y * 10000 + mo * 100 + d
        first[i] = None if prev_day < 0 else (0.0 if day == prev_day else 1.0)
        prev_day = day

    cols["time"] = time_col
    cols["year"] = year
    cols["month"] = month
    cols["dayofmonth"] = dom
    cols["dayofweek"] = dow
    cols["hour"] = hour
    cols["minute"] = minute
    cols["sessionfirst"] = first
    return cols


def compute_atr_bands_raw(
    bars: List[dict],
    period: int = 14,
    multiplier: float = 2.0,
) -> Tuple[List[MaybeNum], List[MaybeNum], List[MaybeNum]]:
    """``(upper, middle, lower)`` = close ± ``multiplier`` × ATR(``period``).

    ⭐ IT COSTS NO NEW MATHS AND THAT IS DELIBERATE. Every number is
    ``compute_atr_raw``'s, which ``tests/fixtures/indicators/atr_14.json`` has
    pinned in BOTH lanes at rel-tol 1e-9 since B5 — so ``atr_bands_14_2.json``
    points at ``atr_14.json`` with ``barsFrom`` and both lanes re-derive these
    three columns from that already-pinned ``atr``. The oracle is older than
    either implementation, exactly as it is for SAR's two event columns, and a
    reseed of ``atr_14`` turns this case red.

    ⚠️ THE MIDDLE IS THE CLOSE AND IT SHARES THE EDGES' PAD. A middle that
    existed where the edges did not would be a band with nothing to draw between.

    ⚠️ ``multiplier`` IS AN INPUT READ BY THE COMPUTE, not a ``$ref`` in a plot:
    ``$<inputKey>`` substitution is legal in ``color``/``width``/``levels``/
    ``lineStyle`` only, and a band's WIDTH IN PRICE is none of those.
    """
    n = len(bars)
    upper: List[MaybeNum] = [None] * n
    middle: List[MaybeNum] = [None] * n
    lower: List[MaybeNum] = [None] * n
    atr = compute_atr_raw(bars, period)
    for i, a in enumerate(atr):
        if a is None:
            continue
        c = bars[i]["c"]
        middle[i] = c
        upper[i] = c + multiplier * a
        lower[i] = c - multiplier * a
    return upper, middle, lower


def compute_atr_bands(
    bars: List[dict],
    period: int = 14,
    multiplier: float = 2.0,
) -> Tuple[List[MaybeNum], List[MaybeNum], List[MaybeNum]]:
    """DELIVERY wrapper (4dp — price-scale, like ``compute_bb``)."""
    upper, middle, lower = compute_atr_bands_raw(bars, period, multiplier)
    return (_round_series(upper, 4), _round_series(middle, 4), _round_series(lower, 4))


def compute_rs_line_raw(
    bars: List[dict],
    benchmark_bars: List[dict],
) -> List[MaybeNum]:
    """The relative-strength line — this symbol's close over the BENCHMARK's.

    ⛔ IT TAKES A SECOND SYMBOL, WHICH IS WHY ITS DEFINITION IS
    ``compute.kind: 'server'`` AND NOT A NATIVE, AND WHY THERE IS NO ``rs_line``
    ENTRY IN ``_CASE_COLUMNS``. The compute contract (spec §4) is
    ``compute({bars, inputs, prevState, barstate})`` — ONE ``bars`` — and
    ``compute_case(kind, bars, params)`` is the same shape one level down. A
    native adapter could only ever hand this function the chart's own series, and
    ``close / close`` is **1.0 on every bar**: a single-symbol RS line is a flat
    line at one, and it looks exactly like an indicator that is working.

    Extending either signature to smuggle a second series through would make the
    dispatch lie about its own shape, so ``rs_line_spy.json`` is read by a
    dedicated test in each lane instead — the same reason ``vwap`` is deliberately
    absent from the dispatch, applied to a different constraint.

    ⚠️ JOINED BY BAR TIME, NEVER BY INDEX. A benchmark series missing one bar
    would shift every subsequent ratio under an index join, and the line would be
    plausible and wrong for the whole history rather than absent for one bar.
    """
    n = len(bars)
    out: List[MaybeNum] = [None] * n
    if n == 0 or not benchmark_bars:
        return out
    close_at: Dict[object, float] = {}
    for b in benchmark_bars:
        c = b.get("c")
        if isinstance(c, (int, float)) and not isinstance(c, bool):
            close_at[b.get("t")] = float(c)
    for i, bar in enumerate(bars):
        bc = close_at.get(bar.get("t"))
        if bc is None or bc == 0:
            continue
        out[i] = bar["c"] / bc
    return out


def compute_rs_line(
    bars: List[dict],
    benchmark_bars: List[dict],
) -> List[MaybeNum]:
    """DELIVERY wrapper (6dp).

    ⚠️ SIX, NOT FOUR. Every other price-scale wrapper rounds to 4 because it
    delivers a PRICE; this delivers a RATIO that sits near 1 for a benchmark-like
    name and near 0.02 for a cheap one, so 4dp would quantise a real RS move into
    nothing. The wrappers are the boundary user thresholds are compared at
    (decision A4), which is exactly why the precision has to suit the scale of
    the number rather than the habit of the module.
    """
    return _round_series(compute_rs_line_raw(bars, benchmark_bars), 6)


# ─── golden-fixture dispatch ─────────────────────────────────────────────────
# Pure dispatch, no math of its own. Both test lanes read the SAME fixture JSON
# in tests/fixtures/indicators/; this maps a fixture's `kind` onto the precise
# core and names the output columns. See tests/fixtures/indicators/_schema.md.

_CASE_COLUMNS: Dict[str, Tuple[str, ...]] = {
    "rsi": ("rsi",),
    "macd": ("macd", "signal", "histogram"),
    "bb": ("upper", "middle", "lower"),
    "stoch": ("k", "d"),
    "williams_r": ("williams_r",),
    "cci": ("cci",),
    "mfi": ("mfi",),
    # ── B5: the seven that used to be JS-only ──
    "atr": ("atr",),
    "adx": ("adx", "plusDI", "minusDI"),
    "obv": ("obv",),
    "donchian": ("upper", "middle", "lower"),
    "ichimoku": ("tenkan", "kijun", "spanA", "spanB", "chikou"),
    "sar": ("sar", "trend"),
    # ── Phase C: SAR's two EVENT columns ──
    # A SEPARATE kind, not two more columns on `sar`. Adding them there would
    # have changed `sar_default`'s column set, and `test_python_lane_matches_the_
    # golden_columns` asserts `set(got) == set(case["expected"])` — so the fixture
    # whose `trend` column makes these two derivable in the first place would have
    # had to be reseeded to add them. It was not: `sar_events_default` points at
    # `sar_default`'s bars with `barsFrom` and both lanes read both files.
    "sar_events": ("priceCrossedSar", "trendFlipped"),
    # ── Phase C Task 14 ──
    # `avwap` and `atr_bands` dispatch normally: both take ONE `bars` and their
    # own params, which is exactly the shape this table describes.
    "avwap": ("avwap",),
    "atr_bands": ("upper", "middle", "lower"),
    # ⛔ `rs_line` is NOT here, and the reason is structural rather than
    # historical. `compute_case(kind, bars, params)` carries ONE series, and the
    # RS line needs TWO — its own and the benchmark's. That is the same
    # constraint decision A3 used to make the definition `compute.kind: 'server'`
    # (spec §4's `compute({bars, inputs, …})` cannot reach a second symbol), so
    # honouring it here keeps ONE story: a lane with one `bars` does not answer
    # for an indicator with two. Smuggling the benchmark through `params` would
    # make this table's contract a lie at exactly one row.
    # `rs_line_spy.json` is read by a DEDICATED test in each lane instead —
    # `test_rs_line_matches_the_golden_column` / the vitest case of the same
    # name — so the fixture is still a cross-language agreement at 1e-9.
    # `vwap` is NOT here and must not be: the two pre-existing vwap fixtures
    # carry `"expected": null` because Python had no VWAP when they were written,
    # and `test_vwap_session_fixtures_carry_a_real_trap` asserts exactly that.
    # A `kind: "vwap"` entry would make `compute_case` answer for those two cases
    # and quietly invite a reseed of fixtures whose whole value is that they were
    # NEVER reseeded. The new `vwap_session_expected` case uses kind `vwap_series`.
    "vwap_series": ("vwap",),
}


def case_columns(kind: str) -> Tuple[str, ...]:
    """Column names ``compute_case`` returns for ``kind`` (empty if unknown)."""
    return _CASE_COLUMNS.get(kind, ())


def compute_case(
    kind: str,
    bars: List[dict],
    params: Optional[dict] = None,
) -> Dict[str, List[MaybeNum]]:
    """Run one golden-fixture case through the PRECISE core.

    ``kind`` is the fixture's ``kind`` field; ``bars`` its ``bars`` array;
    ``params`` its ``params`` object. Every returned column is aligned to
    ``len(bars)`` with ``None`` before the first computable bar.

    Raises ``KeyError`` for an unknown kind — a fixture naming an indicator
    this dispatch does not know must fail loudly, not return ``{}``.
    """
    p = params or {}
    if kind not in _CASE_COLUMNS:
        raise KeyError(f"compute_case: unknown fixture kind {kind!r}")
    closes = [b["c"] for b in bars]

    if kind == "rsi":
        return {"rsi": compute_rsi_raw(closes, int(p.get("period", 14)))}
    if kind == "macd":
        macd, signal, hist = compute_macd_raw(
            closes,
            int(p.get("fast", 12)),
            int(p.get("slow", 26)),
            int(p.get("signal", 9)),
        )
        return {"macd": macd, "signal": signal, "histogram": hist}
    if kind == "bb":
        upper, middle, lower = compute_bb_raw(
            closes, int(p.get("period", 20)), float(p.get("stddev", 2.0)),
        )
        return {"upper": upper, "middle": middle, "lower": lower}
    if kind == "stoch":
        k, d = compute_stoch_raw(
            bars, int(p.get("k_period", 14)), int(p.get("d_period", 3)),
        )
        return {"k": k, "d": d}
    if kind == "williams_r":
        return {"williams_r": compute_williams_r_raw(bars, int(p.get("period", 14)))}
    if kind == "cci":
        return {"cci": compute_cci_raw(bars, int(p.get("period", 20)))}
    if kind == "mfi":
        return {"mfi": compute_mfi_raw(bars, int(p.get("period", 14)))}

    # ── B5: the seven that used to be JS-only ──
    if kind == "atr":
        return {"atr": compute_atr_raw(bars, int(p.get("period", 14)))}
    if kind == "adx":
        adx, plus_di, minus_di = compute_adx_raw(bars, int(p.get("period", 14)))
        return {"adx": adx, "plusDI": plus_di, "minusDI": minus_di}
    if kind == "obv":
        return {"obv": compute_obv_raw(bars)}
    if kind == "donchian":
        upper, middle, lower = compute_donchian_raw(bars, int(p.get("period", 20)))
        return {"upper": upper, "middle": middle, "lower": lower}
    if kind == "ichimoku":
        tenkan, kijun, span_a, span_b, chikou = compute_ichimoku_raw(
            bars,
            int(p.get("tenkan_period", 9)),
            int(p.get("kijun_period", 26)),
            int(p.get("senkou_b_period", 52)),
        )
        return {"tenkan": tenkan, "kijun": kijun,
                "spanA": span_a, "spanB": span_b, "chikou": chikou}
    if kind == "sar":
        sar, trend = compute_sar_raw(
            bars, float(p.get("step", 0.02)), float(p.get("max_step", 0.2)),
        )
        return {"sar": sar, "trend": trend}
    if kind == "sar_events":
        crossed, flipped = compute_sar_events(
            bars, float(p.get("step", 0.02)), float(p.get("max_step", 0.2)),
        )
        return {"priceCrossedSar": crossed, "trendFlipped": flipped}

    # ── Phase C Task 14 ──
    if kind == "avwap":
        return {"avwap": compute_avwap_raw(bars, str(p.get("anchor", "session")))}
    if kind == "atr_bands":
        upper, middle, lower = compute_atr_bands_raw(
            bars, int(p.get("period", 14)), float(p.get("multiplier", 2.0)),
        )
        return {"upper": upper, "middle": middle, "lower": lower}

    # kind == "vwap_series" — deliberately not "vwap"; see _CASE_COLUMNS.
    return {"vwap": compute_vwap_raw(bars)}
