"""The LICENSED feed for `realtime_candle`: Massive trades build the developing candle (2026-11-28).

`realtime_candle` is the only producer of the `/api/stream/prices` events `tick`, `bar_close` and
`bar_correction` (api/routers/stream.py `_build_candle_events`, `realtime_candle.reconciliation_worker`).
Until this module its only writer was the Finnhub free-tier trade socket (api/services/realtime_stream.py),
whose terms say "strictly for personal use". Now the Massive stocks feed the web pod already reads writes
it too, so the Finnhub socket can be switched off (FINNHUB_STREAM_ENABLED=0) without those events going
quiet. The Finnhub path is kept (removing a source is the owner's call); it is simply no longer needed.

Two Massive doors, one per feed mode (api/main.py startup):
  * LOCAL (`STREAM_FEED_SOURCE` unset/local): the pod holds the Massive socket (api/services/bar_stream.py).
    `on_trade` is a bar_stream trade listener and sees EVERY T print of every symbol on the T channel, with
    its SIP conditions (classified exactly as the chart's push feed does, trade_conditions.classify3).
  * REMOTE (`STREAM_FEED_SOURCE=remote`): stream-ingest holds the socket and web receives one conflated
    quote per symbol per batch ({price, trade_ts, volume}), not the prints. `on_quotes` folds those in:
    the price is the SIP-filtered last sale, the size is the rise of the cumulative day volume since the
    previous quote. Coarser than prints (extremes inside one batch, ~55 ms, are not seen), and the minute
    reconciliation (realtime_candle.reconciliation_worker) corrects the closed bar against REST as before.
Only symbols someone is watching on /api/stream/prices are fed (realtime_stream's refcounted set), the
same set the Finnhub socket subscribes, so the candle state grows exactly as it did before.

⭐ THE DEDUPE RULE: ONE SOURCE PER SYMBOL AT A TIME, AND A HANDOVER FLOOR.
Both feeds carry the same consolidated tape, so while both run every print arrives twice. Per symbol:
  1. Massive OWNS the symbol whenever it is live for it: any Massive trade (or quote with a new trade
     time) takes ownership at once.
  2. Finnhub may feed the candle only while Massive has been SILENT for that symbol for MASSIVE_SILENT_S
     (socket down, symbol dropped upstream, feed off). Otherwise its trade is refused for the candle (it
     still updates Finnhub's own price store, unchanged).
  3. On every change of owner the new owner's trades are refused until they are HANDOVER_MARGIN_MS past
     the last trade the candle took from the old owner. The two feeds stamp one print about a second apart
     (the same margin api/routers/stream.py FRESHER_SOURCE_MARGIN_MS uses), so a print the old owner
     already counted can never be counted again by the new one. The cost is that a few real prints right
     at a handover may be missed; never that one is counted twice.
With the Massive feed off (STREAM_BARS_ENABLED unset) rule 2 always lets Finnhub through, so the candle is
exactly what it was before this module.

⛔ DARK BEHIND STREAM_CANDLE_MASSIVE_ENABLED (integrator ruling 2026-11-28: it touches every member's live
chart). Read PER CALL (`enabled()`), default OFF: unset / anything but 1 / true / yes / on. Off, `install()`
hooks nothing, `on_trade` / `on_quotes` return at once (a listener hooked while it was on goes quiet without a
restart) and `admit()` lets every Finnhub print through without recording anything, so the candle is the
Finnhub-only candle of master byte for byte. On, the rule above. Arm it BEFORE FINNHUB_STREAM_ENABLED=0.
"""
from __future__ import annotations

import logging
import os
import threading
import time
from typing import Optional

from api.services import trade_conditions

_logger = logging.getLogger(__name__)

SOURCE_MASSIVE = "massive"
SOURCE_FINNHUB = "finnhub"

#: How long Massive must have been quiet for a symbol before Finnhub may feed that symbol's candle.
MASSIVE_SILENT_S = 10.0
#: A new owner's trades start this far past the last trade the old owner gave the candle (see rule 3).
HANDOVER_MARGIN_MS = 2000

#: The timeframes realtime_candle keeps (the Finnhub path feeds the same five).
_TFS = ("1", "5", "15", "30", "60")

_lock = threading.Lock()
_owner: dict[str, str] = {}             # sym -> the source feeding its candle now
_last_applied_ms: dict[str, int] = {}   # sym -> newest trade time (ms) the candle took, any source
_floor_ms: dict[str, int] = {}          # sym -> the current owner's trades start here (rule 3)
_massive_seen: dict[str, float] = {}    # sym -> monotonic s of the last Massive trade/quote for it
_quote_state: dict[str, tuple] = {}     # sym -> (trade_ts, price, day volume) of the last remote quote
_counters = {
    "massive_applied": 0, "massive_floor_refused": 0,
    "finnhub_applied": 0, "finnhub_refused_massive_live": 0, "finnhub_floor_refused": 0,
    "handovers": 0, "quotes_repeat": 0,
}
_installed: dict = {"mode": None}

_ON_WORDS = frozenset({"1", "true", "yes", "on"})


def enabled() -> bool:
    """STREAM_CANDLE_MASSIVE_ENABLED, read per call (one env lookup). Default OFF."""
    return os.environ.get("STREAM_CANDLE_MASSIVE_ENABLED", "").strip().lower() in _ON_WORDS


def _reset() -> None:
    """Test helper."""
    with _lock:
        _owner.clear()
        _last_applied_ms.clear()
        _floor_ms.clear()
        _massive_seen.clear()
        _quote_state.clear()
        for k in _counters:
            _counters[k] = 0
        _installed["mode"] = None


def admit(sym: str, source: str, trade_ms: int, now: Optional[float] = None) -> bool:
    """May this trade from `source` go into `sym`'s candle? Applies the dedupe rule (module docstring)
    and records the trade as taken when it answers True. Thread-safe; cheap (one dict pass)."""
    if not enabled():
        return source != SOURCE_MASSIVE     # switched off: master's Finnhub-only candle, nothing recorded
    su = sym.upper()
    t = int(trade_ms)
    mono = time.monotonic() if now is None else now
    with _lock:
        if source == SOURCE_MASSIVE:
            _massive_seen[su] = mono
        else:
            seen = _massive_seen.get(su)
            if seen is not None and mono - seen < MASSIVE_SILENT_S:
                _counters["finnhub_refused_massive_live"] += 1
                return False
        owner = _owner.get(su)
        if owner != source:
            if owner is not None:
                _counters["handovers"] += 1
                last = _last_applied_ms.get(su)
                if last is not None:
                    _floor_ms[su] = last + HANDOVER_MARGIN_MS
                else:
                    _floor_ms.pop(su, None)
            _owner[su] = source
        floor = _floor_ms.get(su)
        if floor is not None and t < floor:
            _counters["massive_floor_refused" if source == SOURCE_MASSIVE else "finnhub_floor_refused"] += 1
            return False
        prev = _last_applied_ms.get(su)
        _last_applied_ms[su] = t if prev is None else max(prev, t)
        _counters["massive_applied" if source == SOURCE_MASSIVE else "finnhub_applied"] += 1
        return True


def _apply(sym: str, price: float, ts_s: int, size: int, hl_ok: bool, last_ok: bool) -> None:
    from api.services import realtime_candle
    for tf in _TFS:
        realtime_candle.apply_tick(sym, price=price, ts=ts_s, size=size, tf=tf,
                                   update_hl=hl_ok, update_last=last_ok)


def _watched(sym: str) -> bool:
    """Is `sym` on /api/stream/prices right now (realtime_stream's refcounted set)?"""
    from api.services import realtime_stream
    return sym in realtime_stream._subscribed


def on_trade(sym: str, trade: dict) -> None:
    """LOCAL mode: a bar_stream trade listener (runs on the socket thread; must stay minimal and never
    raise). `trade` = {t: ms, p, s, c}, as ingest_core.parse_aggregate_event hands it out."""
    try:
        if not enabled():
            return
        su = str(sym).upper()
        if not _watched(su):
            return
        t = int(trade["t"])
        price = float(trade["p"])
        if not price > 0:
            return
        hl_ok, last_ok, vol_ok = trade_conditions.classify3(trade.get("c"))
        if not admit(su, SOURCE_MASSIVE, t):
            return
        size = int(trade.get("s") or 0) if vol_ok else 0
        _apply(su, price, t // 1000, size, hl_ok, last_ok)
    except Exception:  # noqa: BLE001 - a listener never breaks the bars feed
        pass


def on_quotes(quotes: dict) -> None:
    """REMOTE mode: RemoteBroadcaster.candle_sink, once per ingest batch, with that batch's quotes
    {sym: {price, ts, trade_ts, volume}}. Never raises."""
    try:
        if not enabled():
            return
        for sym, q in quotes.items():
            su = str(sym).upper()
            if not isinstance(q, dict) or not _watched(su):
                continue
            price, tts, vol = q.get("price"), q.get("trade_ts"), q.get("volume")
            try:
                price = float(price)
                tts = int(tts)
            except (TypeError, ValueError):
                continue                    # no trade time: an AM-only close, nothing printed to place
            if not price > 0 or tts <= 0:
                continue
            with _lock:
                prev = _quote_state.get(su)
                _quote_state[su] = (tts, price, vol)
            if prev is not None and prev[0] == tts and prev[1] == price and prev[2] == vol:
                with _lock:
                    _counters["quotes_repeat"] += 1
                continue                    # the same quote again: no new print
            size = 0
            if prev is not None and isinstance(vol, (int, float)) and isinstance(prev[2], (int, float)):
                size = max(0, int(vol) - int(prev[2]))      # a lower day volume (new day / epoch): 0
            if not admit(su, SOURCE_MASSIVE, tts):
                continue
            _apply(su, price, tts // 1000, size, True, True)
    except Exception:  # noqa: BLE001 - the candle feed never breaks the bars mirror
        pass


def install(bb) -> Optional[str]:
    """Wire the Massive door for the running broadcaster. Idempotent; called by /api/stream/prices on
    each connection. A RemoteBroadcaster gets `candle_sink`; the in-process BarBroadcaster gets a
    bar_stream trade listener; anything else (no feed, a test stub) gets nothing."""
    if bb is None or not enabled():
        return None
    if hasattr(bb, "candle_sink"):
        if getattr(bb, "candle_sink", None) is not on_quotes:
            bb.candle_sink = on_quotes
        _installed["mode"] = "remote"
        return "remote"
    from api.services import bar_broadcaster
    if isinstance(bb, bar_broadcaster.BarBroadcaster):
        from api.services import bar_stream
        bar_stream.add_trade_listener(on_trade)      # idempotent
        _installed["mode"] = "local"
        return "local"
    return None


def status() -> dict:
    """Counters for /api/stream/status (additive key `candle_feed`)."""
    with _lock:
        owners = list(_owner.values())
        return {
            "enabled": enabled(),
            "massive_door": _installed["mode"],
            "symbols_massive": owners.count(SOURCE_MASSIVE),
            "symbols_finnhub": owners.count(SOURCE_FINNHUB),
            **dict(_counters),
        }
