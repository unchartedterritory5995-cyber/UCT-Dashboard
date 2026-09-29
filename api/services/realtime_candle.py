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

# ── bar_correction fan-out: one bounded queue PER CONNECTION ─────────────────
# ⚰️ This was ONE process-wide `asyncio.Queue()` that every /api/stream/prices
# connection drained with `get_nowait()`, so a correction reached exactly ONE
# connected client -- whichever generator woke first -- and could be taken by a
# connection not even watching that symbol. Every other chart kept the
# uncorrected bar. With no connection open it also grew without bound.
#
# The shape is copied from `bar_broadcaster.BarBroadcaster`: each subscriber is
# a bounded `asyncio.Queue(maxsize)` plus the loop that owns it, a put is
# dispatched with `call_soon_threadsafe`, and a full queue drops its OLDEST item
# (a correction is a last-value-wins overwrite of a bar, so freshness beats
# completeness). Keyed by SYMBOL -- the /prices stream subscribes by ticker, not
# by (sym, tf), and corrections are only produced for tf="1"; the event still
# carries its tf and the client applies it by (sym, tf). This matches how the
# same stream already scopes `tick`/`bar_close` to a connection's tickers.
# Drops are counted here, NOT in `bar_broadcaster._bars_dropped_total`, which is
# bars-lane telemetry read by the bars rail monitor.
#
# In-process state, like every other SSE registry on the web pod: ONE uvicorn
# process. A second process would hold its own registry.
CORRECTION_QUEUE_MAXSIZE = 64

_correction_lock = threading.Lock()
# queue -> (owner loop, frozenset of upper-cased symbols it watches)
_correction_subscribers: dict = {}
_corrections_dropped_total = 0


def subscribe_corrections(symbols) -> asyncio.Queue:
    """Register one SSE connection for corrections to `symbols`. Must be called
    from the coroutine that will drain the queue (its running loop owns it).
    Pair with `unsubscribe_corrections(q)` in that coroutine's `finally`."""
    q: asyncio.Queue = asyncio.Queue(maxsize=CORRECTION_QUEUE_MAXSIZE)
    loop = asyncio.get_running_loop()
    syms = frozenset(str(s).upper() for s in symbols if str(s).strip())
    with _correction_lock:
        _correction_subscribers[q] = (loop, syms)
    return q


def unsubscribe_corrections(q) -> None:
    """Drop a subscriber. Idempotent; `None` is a no-op."""
    if q is None:
        return
    with _correction_lock:
        _correction_subscribers.pop(q, None)


def correction_subscriber_count() -> int:
    with _correction_lock:
        return len(_correction_subscribers)


def _safe_put_correction(q: asyncio.Queue, msg: dict) -> None:
    """Runs on the queue's owner loop via call_soon_threadsafe. Drop-oldest on
    a full queue, exactly as `BarBroadcaster._safe_put` does for bars."""
    global _corrections_dropped_total
    try:
        q.put_nowait(msg)
    except asyncio.QueueFull:
        try:
            q.get_nowait()
            q.put_nowait(msg)
            _corrections_dropped_total += 1
        except Exception:
            pass


def emit_correction_sync(sym: str, tf: str, corrected: dict) -> None:
    """Fan a correction out to EVERY connection watching `sym`. Sync-safe and
    never blocks: a slow consumer's full queue drops its oldest item."""
    sym_u = sym.upper()
    msg = {"type": "bar_correction", "sym": sym_u, "tf": tf, "bar": corrected}
    with _correction_lock:
        targets = [(q, loop) for q, (loop, syms) in _correction_subscribers.items()
                   if sym_u in syms]
    for q, loop in targets:
        try:
            loop.call_soon_threadsafe(_safe_put_correction, q, msg)
        except RuntimeError:
            # Owner loop already closed -- that connection is gone. Skip.
            pass


async def reconciliation_worker():
    """Background task: every 60s, run minute-close reconciliation for all tracked candles.

    For each (ticker, tf="1") tracked, fetch the REST snapshot and reconcile.
    On disagreement, replace the bar in state and fan a bar_correction event
    out to every connection watching the symbol.
    """
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
