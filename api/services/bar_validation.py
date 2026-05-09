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


def validate_bar(
    bar: dict,
    prior_close: Optional[float] = None,
    split_ratios: Optional[list[float]] = None,
) -> tuple[bool, list[str]]:
    """Validate a single bar dict. Returns (ok, list_of_failure_reasons)."""
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
        if v < _LOW_VOLUME_THRESHOLD and deviation > 0.05:
            reasons.append(
                f"implausibly low volume ({v}) with {deviation*100:.1f}% move"
            )

    return (len(reasons) == 0), reasons
