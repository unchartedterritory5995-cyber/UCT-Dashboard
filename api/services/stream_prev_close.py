"""The licensed previous close for the price stream's day % fields (2026-11-28).

/api/stream/prices has always sent `change_pct` and `change` on each symbol's entry. They came from the
Finnhub trade socket (api/services/realtime_stream.py), computed against a baseline that socket never
seeded properly, which is why every client strips them and recomputes the day % from the REST previous
close (app/src/lib/liveQuoteMerge.js `_streamSafe`). With the Finnhub socket off
(FINNHUB_STREAM_ENABLED=0) an entry is the Massive overlay alone and those two fields would disappear;
this module fills them from the Massive snapshot's previous close instead, the same number
/api/live-prices serves as `prev_close`.

How the number is got: `get(sym)` answers from module memory only (never a network call on the
request loop). A symbol that is missing, or was read more than REFRESH_S ago, is queued with `want()`;
ONE background thread (never the shared default executor) reads the queue in batches of up to
BATCH_MAX through `api.routers.live_prices.get_live_prices`, the same function the Notebook widgets and
the journal call, so the read rides that route's per-ticker cache, its semaphore and its herd collapse
(no new vendor door). A symbol tried in the last RETRY_S is not queued again, whatever the result, so a
symbol the vendor does not list costs one read per RETRY_S at most. A value older than MAX_AGE_S is
dropped: a missing day % is shown as missing, never as a stale one.
"""
from __future__ import annotations

import logging
import threading
import time
from typing import Iterable, Optional

_logger = logging.getLogger(__name__)

REFRESH_S = 600.0       # re-read a known previous close after 10 minutes (a new session moves it)
RETRY_S = 60.0          # never ask for one symbol more than once a minute
MAX_AGE_S = 12 * 3600.0
BATCH_MAX = 250         # /api/live-prices' own per-request cap

_lock = threading.Lock()
_known: dict[str, tuple[float, float]] = {}   # sym -> (prev_close, monotonic read time)
_tried: dict[str, float] = {}                 # sym -> monotonic time last queued
_pending: set[str] = set()
_worker: dict = {"running": False}
_counters = {"reads": 0, "read_errors": 0, "symbols_filled": 0}


def _reset() -> None:
    """Test helper."""
    with _lock:
        _known.clear()
        _tried.clear()
        _pending.clear()
        _worker["running"] = False
        for k in _counters:
            _counters[k] = 0


def get(sym: str, now: Optional[float] = None) -> Optional[float]:
    """The remembered previous close for `sym`, or None (unknown, or older than MAX_AGE_S)."""
    mono = time.monotonic() if now is None else now
    with _lock:
        row = _known.get(sym.upper())
    if row is None or mono - row[1] > MAX_AGE_S:
        return None
    return row[0]


def remember(sym: str, prev_close, now: Optional[float] = None) -> bool:
    """Store a previous close (a positive number only). Returns whether it was stored."""
    try:
        pc = float(prev_close)
    except (TypeError, ValueError):
        return False
    if not pc > 0:
        return False
    mono = time.monotonic() if now is None else now
    with _lock:
        _known[sym.upper()] = (pc, mono)
    return True


def _fetch(symbols: list[str]) -> dict:
    """One batch read through the live-prices route function (its caches, semaphore, herd collapse)."""
    from api.routers import live_prices
    got = live_prices.get_live_prices(tickers=",".join(symbols), user=None, response=None)
    return got if isinstance(got, dict) else {}


def want(symbols: Iterable[str], now: Optional[float] = None, start: bool = True) -> int:
    """Queue the symbols whose previous close is missing or due a refresh; start the one worker.
    Cheap and non-blocking (safe on the event loop). Returns how many were queued."""
    mono = time.monotonic() if now is None else now
    queued = 0
    with _lock:
        for raw in symbols:
            su = str(raw).upper()
            if not su:
                continue
            row = _known.get(su)
            if row is not None and mono - row[1] < REFRESH_S:
                continue
            last = _tried.get(su)
            if last is not None and mono - last < RETRY_S:
                continue
            _tried[su] = mono
            _pending.add(su)
            queued += 1
        go = start and bool(_pending) and not _worker["running"]
        if go:
            _worker["running"] = True
    if go:
        threading.Thread(target=_drain, daemon=True, name="stream-prev-close").start()
    return queued


def _drain() -> None:
    """The worker: read the queue in batches until it is empty, then stop."""
    while True:
        with _lock:
            if not _pending:
                _worker["running"] = False
                return
            batch = sorted(_pending)[:BATCH_MAX]
            _pending.difference_update(batch)
        try:
            rows = _fetch(batch)
            with _lock:
                _counters["reads"] += 1
            for sym, row in rows.items():
                if isinstance(row, dict) and remember(sym, row.get("prev_close")):
                    with _lock:
                        _counters["symbols_filled"] += 1
        except Exception as e:  # noqa: BLE001 - a failed read leaves the fields missing, never wrong
            with _lock:
                _counters["read_errors"] += 1
            _logger.debug("[stream_prev_close] read failed: %s", type(e).__name__)


def fill_day_change(entry: dict, prev_close: Optional[float]) -> bool:
    """Give a stream entry that has no `change_pct` the day % against the licensed previous close,
    plus `timestamp` (the trade time in ms, as the Finnhub entry carried it) when it has none.
    An entry that already has `change_pct` (Finnhub's own) is left exactly as it is. Without a price or
    a previous close nothing is added: a missing number stays missing. Returns whether it filled."""
    if not isinstance(entry, dict):
        return False
    if "timestamp" not in entry and entry.get("trade_ts"):
        entry["timestamp"] = int(entry["trade_ts"])
    if "change_pct" in entry:
        return False
    try:
        px = float(entry.get("price"))
    except (TypeError, ValueError):
        return False
    if not (px > 0 and prev_close and prev_close > 0):
        return False
    entry["change_pct"] = round((px - prev_close) / prev_close * 100, 4)
    entry["change"] = round(px - prev_close, 4)
    return True


def status() -> dict:
    with _lock:
        return {"known": len(_known), "pending": len(_pending), "worker": _worker["running"], **_counters}
