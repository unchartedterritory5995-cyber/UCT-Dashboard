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

from datetime import datetime
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
    """Simple moving average. Aligned to input length with None-prefix."""
    n = len(closes)
    out: List[MaybeNum] = [None] * n
    if period <= 0 or n < period:
        return out
    window_sum = sum(closes[:period])
    out[period - 1] = window_sum / period
    for i in range(period, n):
        window_sum += closes[i] - closes[i - period]
        out[i] = window_sum / period
    return out


def compute_ema(closes: List[Number], period: int) -> List[MaybeNum]:
    """Exponential moving average. ``k = 2 / (period + 1)``. Seed = SMA of
    the first ``period`` values. Aligned to input length with None-prefix."""
    return _ema_core(list(closes), period)


compute_sma_raw = compute_sma
compute_ema_raw = compute_ema


# ─── RSI ─────────────────────────────────────────────────────────────────────

def compute_rsi_raw(closes: List[Number], period: int = 14) -> List[MaybeNum]:
    """Wilder-smoothed RSI, unrounded. Mirrors ``computeRSI`` in indicators.js.

    First RSI value lands at index ``period`` (needs ``period`` price diffs
    starting at i=1). Output aligned to input length.
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
        if avg_loss == 0:
            out[i] = 100.0
        else:
            rs = avg_gain / avg_loss
            out[i] = 100.0 - 100.0 / (1 + rs)
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
    """
    n = len(closes)
    macd_out: List[MaybeNum] = [None] * n
    sig_out: List[MaybeNum] = [None] * n
    hist_out: List[MaybeNum] = [None] * n
    if n < slow + signal:
        return macd_out, sig_out, hist_out

    fast_ema = _ema_core(list(closes), fast)
    slow_ema = _ema_core(list(closes), slow)

    # macd line is defined wherever both EMAs are defined → from i = slow-1
    macd_dense: List[Number] = []   # condensed list aligned to bars[slow-1:]
    for i in range(slow - 1, n):
        f = fast_ema[i]
        s = slow_ema[i]
        if f is None or s is None:
            macd_dense.append(0.0)  # placeholder; should not happen for i>=slow-1
        else:
            macd_dense.append(f - s)
            macd_out[i] = f - s

    # signal = EMA of macd_dense (length n - (slow-1))
    sig_dense = _ema_core(macd_dense, signal)
    # sig_dense[j] aligns to bars[slow-1 + j]
    for j, sv in enumerate(sig_dense):
        if sv is None:
            continue
        bar_idx = slow - 1 + j
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
    # See the section header: a period past the window would read a negative
    # index, which JS throws on and Python would silently wrap.
    if min(tenkan_period, kijun_period, senkou_b_period) <= 0:
        return tenkan, kijun, span_a, span_b, chikou
    if max(tenkan_period, kijun_period) > senkou_b_period:
        return tenkan, kijun, span_a, span_b, chikou
    if n < senkou_b_period:
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
    for i in range(senkou_b_period - 1, n):
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


def compute_vwap_raw(bars: List[dict]) -> List[MaybeNum]:
    """Session-anchored VWAP, unrounded. Mirrors ``computeVWAP``.

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
    out: List[MaybeNum] = [None] * n
    cum_pv = 0.0
    cum_vol = 0.0
    current_day = None
    memo_hour = None
    memo_key = None
    zone = _et_zone()
    for i, bar in enumerate(bars):
        t = bar.get("t")
        if isinstance(t, bool) or not isinstance(t, (int, float)):
            # A non-numeric `t` (a 'YYYY-MM-DD' daily bar). The JS lane yields a
            # stable 'invalid' sentinel here rather than throwing and blanking the
            # column; the intraday gate keeps VWAP off those timeframes anyway.
            day_key = "invalid"
        else:
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
    # kind == "vwap_series" — deliberately not "vwap"; see _CASE_COLUMNS.
    return {"vwap": compute_vwap_raw(bars)}
