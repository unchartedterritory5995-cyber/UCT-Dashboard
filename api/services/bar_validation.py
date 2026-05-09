"""Pure validation rules for OHLCV bars. No I/O.

Used at every cache write path and by the audit engine.
"""
from typing import Optional


def validate_bar(bar: dict, prior_close: Optional[float] = None) -> tuple[bool, list[str]]:
    """Validate a single bar dict. Returns (ok, list_of_failure_reasons).

    Required fields: t (epoch seconds), o, h, l, c (floats), v (int/float).
    """
    reasons: list[str] = []
    o = bar.get("o")
    h = bar.get("h")
    l = bar.get("l")
    c = bar.get("c")
    v = bar.get("v")

    # Field presence
    for k in ("t", "o", "h", "l", "c", "v"):
        if bar.get(k) is None:
            reasons.append(f"missing field: {k}")
    if reasons:
        return False, reasons

    # Structural: prices > 0
    if o <= 0 or h <= 0 or l <= 0 or c <= 0:
        reasons.append("zero or negative price")

    # Structural: H >= max(O, C, L), L <= min(O, C, H)
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

    # Volume
    if v < 0:
        reasons.append("negative volume")

    return (len(reasons) == 0), reasons
