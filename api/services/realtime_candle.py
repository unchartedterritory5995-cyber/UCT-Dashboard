"""Server-authoritative real-time candle state.

Maintains the developing candle for every (ticker, tf) currently subscribed.
Hooked into the WS tick handler — every trade tick updates the candle's
high/low/close/volume. At period boundaries, the previous candle is finalized
and a new one starts.
"""
import threading
from typing import Optional


_TF_INTERVAL = {
    "1": 60,
    "5": 300,
    "15": 900,
    "30": 1800,
    "60": 3600,
}

_TICK_DEVIATION_THRESHOLD = 0.05  # 5% per-tick deviation from current close = anomaly

_lock = threading.RLock()
# {(ticker, tf): {"t","o","h","l","c","v","last_tick_ts"}}
_state: dict[tuple[str, str], dict] = {}


def _reset():
    """Test helper."""
    with _lock:
        _state.clear()


def _bar_start_for(ts: int, tf: str) -> int:
    """Return the bar-start timestamp for `ts` at timeframe `tf`."""
    interval = _TF_INTERVAL.get(tf, 60)
    return (ts // interval) * interval


def apply_tick(sym: str, price: float, ts: int, size: int, tf: str = "1") -> list[dict]:
    """Apply a tick to the (sym, tf) candle. Returns list of closed bars (0 or 1)."""
    sym = sym.upper()
    bar_start = _bar_start_for(ts, tf)
    closed: list[dict] = []
    with _lock:
        key = (sym, tf)
        cur = _state.get(key)

        # Out-of-order drop
        if cur and cur.get("last_tick_ts", 0) > ts:
            return closed

        # Period boundary
        if cur and cur["t"] != bar_start:
            closed.append(dict(cur))
            cur = None

        if cur is None:
            _state[key] = {
                "t": bar_start, "o": price, "h": price, "l": price, "c": price,
                "v": size, "last_tick_ts": ts,
            }
            return closed

        # Sanity: extreme deviation
        prev_close = cur["c"]
        if prev_close > 0 and abs(price - prev_close) / prev_close > _TICK_DEVIATION_THRESHOLD:
            return closed

        # Apply
        cur["c"] = price
        if price > cur["h"]:
            cur["h"] = price
        if price < cur["l"]:
            cur["l"] = price
        cur["v"] = (cur.get("v", 0) or 0) + size
        cur["last_tick_ts"] = ts

    return closed


def get_current(sym: str, tf: str) -> Optional[dict]:
    sym = sym.upper()
    with _lock:
        cur = _state.get((sym, tf))
        return dict(cur) if cur else None


def force_close(sym: str, tf: str) -> Optional[dict]:
    """Manually close the current bar. Returns the closed bar."""
    sym = sym.upper()
    with _lock:
        key = (sym, tf)
        cur = _state.pop(key, None)
        return dict(cur) if cur else None


def replace_bar(sym: str, tf: str, corrected: dict) -> None:
    """Replace current bar state (used by minute-close reconciliation)."""
    sym = sym.upper()
    with _lock:
        _state[(sym, tf)] = dict(corrected)


def all_keys() -> list[tuple[str, str]]:
    with _lock:
        return list(_state.keys())
