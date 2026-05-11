"""Server-side technical indicator compute.

Mirrors the math in ``app/src/components/chart/indicators.js`` so that
indicator-alert evaluation on the backend produces values consistent with
what the user sees on the chart.

All functions return lists aligned to the input length: positions before
the first computable bar are filled with ``None`` so callers can index by
bar position directly (``values[-1]`` is always the latest, or ``None`` if
the input is too short for the chosen period).

Inputs:
    * ``closes`` — list of floats
    * ``bars``   — list of dicts with keys ``h``, ``l``, ``c`` (and ``v`` for MFI)

These match the structure used throughout ``api/services/bars_fetch.py``.
"""

from __future__ import annotations

from math import sqrt
from typing import List, Optional, Tuple

Number = float
MaybeNum = Optional[float]


# ─── helpers ─────────────────────────────────────────────────────────────────

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


# ─── RSI ─────────────────────────────────────────────────────────────────────

def compute_rsi(closes: List[Number], period: int = 14) -> List[MaybeNum]:
    """Wilder-smoothed RSI. Mirrors ``computeRSI`` in indicators.js exactly.

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
            rsi = 100.0
        else:
            rs = avg_gain / avg_loss
            rsi = 100.0 - 100.0 / (1 + rs)
        out[i] = round(rsi, 2)
    return out


# ─── MACD ────────────────────────────────────────────────────────────────────

def compute_macd(
    closes: List[Number],
    fast: int = 12,
    slow: int = 26,
    signal: int = 9,
) -> Tuple[List[MaybeNum], List[MaybeNum], List[MaybeNum]]:
    """Returns (macd_line, signal_line, histogram), each aligned to input length.

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
            macd_out[i] = round(f - s, 5)

    # signal = EMA of macd_dense (length n - (slow-1))
    sig_dense = _ema_core(macd_dense, signal)
    # sig_dense[j] aligns to bars[slow-1 + j]
    for j, sv in enumerate(sig_dense):
        if sv is None:
            continue
        bar_idx = slow - 1 + j
        sig_out[bar_idx] = round(sv, 5)
        m = macd_out[bar_idx]
        if m is not None:
            hist_out[bar_idx] = round(m - sv, 5)
    return macd_out, sig_out, hist_out


# ─── Bollinger Bands ─────────────────────────────────────────────────────────

def compute_bb(
    closes: List[Number],
    period: int = 20,
    stddev: float = 2.0,
) -> Tuple[List[MaybeNum], List[MaybeNum], List[MaybeNum]]:
    """Bollinger Bands using population std-dev (divide by N, not N-1) to
    match the frontend. Returns (upper, middle, lower), aligned to input.
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
        upper[i] = round(avg + stddev * std, 4)
        middle[i] = round(avg, 4)
        lower[i] = round(avg - stddev * std, 4)
    return upper, middle, lower


# ─── Williams %R ─────────────────────────────────────────────────────────────

def compute_williams_r(bars: List[dict], period: int = 14) -> List[MaybeNum]:
    """Williams %R over ``period`` bars. Range [-100, 0].

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
            out[i] = round(-100.0 * (hh - bars[i]["c"]) / rng, 2)
    return out


# ─── CCI ─────────────────────────────────────────────────────────────────────

def compute_cci(bars: List[dict], period: int = 20) -> List[MaybeNum]:
    """Commodity Channel Index.

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
            out[i] = round((tp[i] - sma) / (0.015 * mad), 2)
    return out


# ─── MFI ─────────────────────────────────────────────────────────────────────

def compute_mfi(bars: List[dict], period: int = 14) -> List[MaybeNum]:
    """Money Flow Index. Range [0, 100].

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
            mfi = 100.0
        else:
            mfi = 100.0 - 100.0 / (1 + pmf / nmf)
        out[i] = round(mfi, 2)
    return out


# ─── Stochastic ──────────────────────────────────────────────────────────────

def compute_stoch(
    bars: List[dict],
    k_period: int = 14,
    d_period: int = 3,
) -> Tuple[List[MaybeNum], List[MaybeNum]]:
    """Fast %K + slow %D Stochastic.

    %K = 100 * (close - LL_k) / (HH_k - LL_k)
    %D = SMA(%K, d_period)

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
            k_val = 50.0
        else:
            k_val = (bars[i]["c"] - ll) / rng * 100.0
        k_out[i] = round(k_val, 2)
    # %D = SMA(%K, d_period). First valid %D lands at index (k_period - 1) + (d_period - 1).
    first_d_idx = (k_period - 1) + (d_period - 1)
    if first_d_idx >= n:
        return k_out, d_out
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
            d_out[i] = round(sum(window) / d_period, 2)
    return k_out, d_out
