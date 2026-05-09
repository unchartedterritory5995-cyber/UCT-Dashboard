"""Pure validation rules for OHLCV bars. No I/O.

Used at every cache write path and by the audit engine.
"""
from typing import Optional


# Threshold for "extreme" price deviation that requires split context to accept.
_DEVIATION_THRESHOLD = 0.5
# Tolerance band around split-adjusted price.
_SPLIT_TOLERANCE = 0.05
# Volume floor — below this with a big price move is suspicious for any liquid ticker.
_LOW_VOLUME_THRESHOLD = 1000
# Wide-bar gate: H-L > 30% of C is suspicious for liquid tickers.
_WIDE_BAR_THRESHOLD = 0.3  # H-L > 30% of C is suspicious for liquid tickers


def validate_bar(
    bar: dict,
    prior_close: Optional[float] = None,
    split_ratios: Optional[list[float]] = None,
    wide_bar_threshold: Optional[float] = None,
    low_volume_threshold: Optional[int] = None,
) -> tuple[bool, list[str]]:
    """Validate a single bar dict. Returns (ok, list_of_failure_reasons).

    Args:
        bar: dict with keys t, o, h, l, c, v.
        prior_close: optional prior bar's close for deviation/low-volume gates.
        split_ratios: optional list of split ratios (e.g. [10.0]) to permit
            split-adjusted price deviations.
        wide_bar_threshold: override for the wide-bar (H-L)/C ratio gate.
            Defaults to ``_WIDE_BAR_THRESHOLD`` (0.30 = 30%). Pass ``0`` to
            disable the gate entirely.
        low_volume_threshold: override for the volume floor used in the
            low-volume + big-move combo check. Defaults to
            ``_LOW_VOLUME_THRESHOLD`` (1000). Plan 2 Task 2 will plug per-ticker
            baselines through this knob.
    """
    reasons: list[str] = []
    o = bar.get("o")
    h = bar.get("h")
    l = bar.get("l")
    c = bar.get("c")
    v = bar.get("v")

    for k in ("t", "o", "h", "l", "c", "v"):
        if bar.get(k) is None:
            reasons.append(f"missing field: {k}")
    if reasons:
        return False, reasons

    if o <= 0 or h <= 0 or l <= 0 or c <= 0:
        reasons.append("zero or negative price")

    if h < l:
        reasons.append("H<L")
    if h < o:
        reasons.append("H<O")
    if h < c:
        reasons.append("H<C")
    if l > o:
        reasons.append("L>O")
    if l > c:
        reasons.append("L>C")

    # Wide-bar gate (range relative to close)
    threshold = _WIDE_BAR_THRESHOLD if wide_bar_threshold is None else wide_bar_threshold
    if threshold > 0 and c is not None and c > 0:
        ratio = (h - l) / c
        if ratio > threshold:
            reasons.append(f"wide-bar range: (h-l)/c = {ratio*100:.1f}% > {threshold*100:.0f}%")

    if v < 0:
        reasons.append("negative volume")

    # Prior-close sanity (only when we have prior context)
    if prior_close is not None and prior_close > 0:
        deviation = abs(o - prior_close) / prior_close
        if deviation > _DEVIATION_THRESHOLD:
            split_ok = False
            for ratio in split_ratios or []:
                adjusted = prior_close / ratio
                if abs(o - adjusted) / adjusted <= _SPLIT_TOLERANCE:
                    split_ok = True
                    break
                # Reverse split
                adjusted = prior_close * ratio
                if abs(o - adjusted) / adjusted <= _SPLIT_TOLERANCE:
                    split_ok = True
                    break
            if not split_ok:
                reasons.append(
                    f"deviation from prior close: {deviation*100:.1f}% "
                    f"(open={o}, prior_close={prior_close})"
                )

        # Low-volume + big-move combo (the QQQ 6.55 fingerprint)
        low_threshold = _LOW_VOLUME_THRESHOLD if low_volume_threshold is None else low_volume_threshold
        if v < low_threshold and deviation > 0.05:
            reasons.append(
                f"implausibly low volume ({v}) with {deviation*100:.1f}% move"
            )

    return (len(reasons) == 0), reasons


# Expected seconds-between-bars per intraday TF
_TF_INTERVAL = {
    "1": 60,
    "5": 300,
    "15": 900,
    "30": 1800,
    "60": 3600,
}


def validate_series(bars: list[dict], tf: str) -> list[dict]:
    """Series-level checks. Returns list of issue dicts: {bar_index, reason, bar_time}."""
    issues: list[dict] = []
    if not bars:
        return issues

    seen_ts = set()
    prev_ts = None
    interval = _TF_INTERVAL.get(tf)

    for i, bar in enumerate(bars):
        ts = bar.get("t")
        if ts is None:
            issues.append({"bar_index": i, "reason": "missing timestamp", "bar_time": None})
            continue
        if ts in seen_ts:
            issues.append({"bar_index": i, "reason": "duplicate timestamp", "bar_time": ts})
        seen_ts.add(ts)
        if prev_ts is not None:
            if ts < prev_ts:
                issues.append({"bar_index": i, "reason": "out of order", "bar_time": ts})
            elif interval is not None:
                # Gap detection — only meaningful for intraday during RTH
                gap = ts - prev_ts
                if gap > interval * 5:
                    issues.append({
                        "bar_index": i,
                        "reason": f"gap {gap}s exceeds 5x expected {interval}s",
                        "bar_time": ts,
                    })
        prev_ts = ts

    return issues
