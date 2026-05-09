"""Compare WS-built candle to REST snapshot at minute close. Server-authoritative.

Used by realtime_candle's reconciliation_worker. Returns a verdict that tells
the caller whether to keep the WS-built bar (accept) or override with the REST
snapshot (correction).
"""

_CLOSE_TOLERANCE = 0.0005  # 0.05%
_VOLUME_TOLERANCE = 0.05   # 5%


def _close_diff(a: float, b: float) -> float:
    if a == 0:
        return 1.0 if b != 0 else 0.0
    return abs(a - b) / a


def _vol_diff(a: float, b: float) -> float:
    if max(a, b) == 0:
        return 0.0
    return abs(a - b) / max(a, b)


def reconcile(ws_bar: dict, rest_bar: dict | None) -> dict:
    """Compare ws_bar to rest_bar.

    Returns:
      {"verdict": "accept"} when within tolerance — keep WS-built bar
      {"verdict": "correction", "correction": rest_bar, "close_diff": float, "vol_diff": float}
        when out of tolerance — replace with rest_bar
      {"verdict": "skipped"} when rest_bar unavailable
    """
    if not rest_bar:
        return {"verdict": "skipped"}
    cd = _close_diff(ws_bar.get("c", 0), rest_bar.get("c", 0))
    vd = _vol_diff(ws_bar.get("v", 0), rest_bar.get("v", 0))
    if cd <= _CLOSE_TOLERANCE and vd <= _VOLUME_TOLERANCE:
        return {"verdict": "accept"}
    return {
        "verdict": "correction",
        "correction": rest_bar,
        "close_diff": cd,
        "vol_diff": vd,
    }
