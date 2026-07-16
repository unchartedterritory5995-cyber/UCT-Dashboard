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


def apply_tick(
    sym: str,
    price: float,
    ts: int,
    size: int,
    tf: str = "1",
    update_hl: bool = True,
    update_last: bool = True,
) -> list[dict]:
    """Apply a tick to the (sym, tf) candle. Returns list of closed bars (0 or 1).

    update_hl / update_last mirror the SIP condition eligibility of the source
    print: a non-high/low-eligible print (odd-lot, out-of-sequence, form-T, etc.)
    must not extend h/l, and a non-last-sale print must not move the close — while
    its volume still counts. Defaults True (fully eligible) so existing callers are
    unaffected.
    """
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
            # Don't let a print that can't set last AND can't mark high/low DEFINE a
            # fresh bar (its price never really printed as a last sale). Wait for an
            # eligible trade / the authoritative bar to open the candle.
            if not update_last and not update_hl:
                return closed
            _state[key] = {
                "t": bar_start, "o": price, "h": price, "l": price, "c": price,
                "v": size, "last_tick_ts": ts,
            }
            return closed

        # Sanity: extreme deviation
        prev_close = cur["c"]
        if prev_close > 0 and abs(price - prev_close) / prev_close > _TICK_DEVIATION_THRESHOLD:
            return closed

        # Apply — gated by print eligibility (volume always accumulates).
        if update_last:
            cur["c"] = price
        if update_hl and price > cur["h"]:
            cur["h"] = price
        if update_hl and price < cur["l"]:
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


import logging
import asyncio

_logger = logging.getLogger(__name__)
_correction_queue: asyncio.Queue | None = None


def _ensure_queue() -> asyncio.Queue:
    global _correction_queue
    if _correction_queue is None:
        _correction_queue = asyncio.Queue()
    return _correction_queue


def emit_correction_sync(sym: str, tf: str, corrected: dict) -> None:
    """Enqueue a correction event for the SSE generator. Sync-safe."""
    try:
        q = _correction_queue
        if q is not None:
            q.put_nowait({"type": "bar_correction", "sym": sym.upper(), "tf": tf, "bar": corrected})
    except Exception:
        pass


def get_correction_queue():
    return _ensure_queue()


async def reconciliation_worker():
    """Background task: every 60s, run minute-close reconciliation for all tracked candles.

    For each (ticker, tf="1") tracked, fetch the REST snapshot and reconcile.
    On disagreement, replace the bar in state and enqueue a bar_correction event.
    """
    _ensure_queue()
    import os
    from api.services import bars_fetch, candle_reconcile
    if os.environ.get("REALTIME_RECONCILE_ENABLED", "1") != "1":
        _logger.info("[realtime_candle] reconciliation_worker disabled via REALTIME_RECONCILE_ENABLED")
        return
    while True:
        try:
            await asyncio.sleep(60)
            for (sym, tf) in all_keys():
                if tf != "1":
                    continue
                cur = get_current(sym, tf)
                if not cur:
                    continue
                # CRITICAL: fetch_minute_snapshot is a BLOCKING synchronous Massive
                # REST call (httpx, up to a 25s read). This worker runs on the shared
                # main event loop, so calling it inline froze EVERY SSE stream + HTTP
                # request for the duration — the "live quotes + charts freeze every
                # ~60s then recover" bug. Offload it to a thread and bound the wait so
                # the loop is never blocked; yield between symbols so a large tracked
                # set can't monopolize the loop even via the executor hand-offs.
                try:
                    rest_bar = await asyncio.wait_for(
                        asyncio.to_thread(bars_fetch.fetch_minute_snapshot, sym, cur["t"]),
                        timeout=6.0,
                    )
                except Exception:
                    rest_bar = None
                await asyncio.sleep(0)  # cooperative yield between symbols
                decision = candle_reconcile.reconcile(cur, rest_bar)
                if decision["verdict"] == "correction":
                    correction = decision["correction"]
                    replace_bar(sym, tf, correction)
                    emit_correction_sync(sym, tf, correction)
                    _logger.info(
                        "[realtime_candle] %s @ %s reconciled: close_diff=%.4f vol_diff=%.2f",
                        sym, cur["t"], decision.get("close_diff", 0), decision.get("vol_diff", 0),
                    )
        except asyncio.CancelledError:
            break
        except Exception:
            _logger.exception("[realtime_candle] reconciliation_worker iteration failed")
