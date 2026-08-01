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
    # kind == "mfi"
    return {"mfi": compute_mfi_raw(bars, int(p.get("period", 14)))}
