"""In-memory state and subscriber routing for real-time bars.

For each (symbol, timeframe) we maintain:
- An in-progress bar (latest bucket, possibly still being filled by 1-min bars)
- A set of asyncio Queues, one per connected SSE client subscribed to that pair

Phase 4.5: handles both AM (authoritative 1-min closes) and A (per-second aggregates).
- AM events replace the partial with authoritative values at minute close (source-of-truth).
- A events fold into the current partial for sub-second chart flicker between AM closes.

Phase 4.6: handles T (per-trade ticks) for true tick-by-tick Bloomberg/TradingView-feel.
- T events carry {t, p, s} (trade price/size/timestamp), not OHLCV bars.
- Each trade updates c=price, extends h/l, and sums volume for all (sym, tf) partials.
- T events are throttled to 10 Hz per (sym, tf) for SSE bandwidth control. The partial
  state is always updated; only the SSE emission is gated by the throttle.
- AM events bypass the throttle (authoritative, infrequent, must always emit).

When a fresh aggregate/trade event arrives:
- For tf in (1, 5, 15, 30, 60): bucket it into the (sym, tf) in-progress bar and
  emit the partial bucket bar to subscribers. "1" buckets to the minute (so A/T
  sub-minute events develop ONE minute bar instead of spawning a candle per tick);
  when a new minute closes a bucket the next event starts a new bucket. 60-min uses
  the canonical ET-anchored bucket (bars_fetch.bucket_60_et_unix_seconds).

Reference counting: subscribe() returns a Queue. Caller must call unsubscribe() with the
same queue when done. on_last_unsubscribe is invoked when (sym, *) drops to zero
subscribers across all timeframes — used to tell bar_stream.py to unsubscribe upstream.
"""
from __future__ import annotations

import asyncio
import logging
import threading
import time as _time
from typing import Callable, Optional

from api.services.bar_rollup import TF_TO_SECONDS, aggregate, bucket_start
from api.services import trade_conditions

_logger = logging.getLogger(__name__)

ROLLUP_TFS = ("5", "15", "30", "60")  # "1" is bucketed via ("1",)+ROLLUP_TFS in both the T and AM/A paths (was a raw pass-through until the per-second-candle fix). "60" added 2026-05-22 via canonical ET-anchored bucket (bars_fetch.bucket_60_et_unix_seconds).


# ── Telemetry (GIL-atomic plain ints/floats, off the _lock hot path) ──
# The single clearest "push is silently dead — everyone fell back to Finnhub" signal is
# bars_emitted_total flat + last_emit_at old while stream_bars connections > 0 during RTH.
_bars_emitted_total = 0     # AM/A/T emits actually dispatched to >=1 subscriber
_bars_dropped_total = 0     # slow-consumer QueueFull drops (was silently swallowed)
_last_emit_at = 0.0         # epoch seconds of the last dispatch


class BarBroadcaster:
    def __init__(self,
                 on_first_subscribe: Optional[Callable[[str], None]] = None,
                 on_last_unsubscribe: Optional[Callable[[str], None]] = None):
        self._partials: dict[tuple[str, str], dict] = {}     # (sym, tf) -> in-progress bar (may include A/T events)
        # Phase 4.5: AM-only baseline partials, used to reset _partials when AM fires.
        # Tracks only AM-aggregated OHLCV so that AM-close correctly discards A-event
        # accumulation without corrupting multi-AM-bar-in-bucket volume.
        self._am_partials: dict[tuple[str, str], dict] = {}  # (sym, tf) -> AM-only partial
        # C1: store (queue, loop) tuples so _emit can use call_soon_threadsafe
        self._subscribers: dict[tuple[str, str], set[tuple[asyncio.Queue, asyncio.AbstractEventLoop]]] = {}
        # Quote-feed INTEREST refcount (per symbol). The live-price SSE
        # (/api/stream/prices) needs Massive ticks for watchlist/theme/header
        # symbols, but it reads the developing bar directly (get_last_price) and
        # must NOT create a per-(sym,tf) subscriber queue — that would dispatch a
        # throttled tick into the request event loop for every watched symbol
        # (the 524 surface). Interest keeps the symbol subscribed upstream + its
        # partial alive, WITHOUT any queue dispatch.
        self._interest: dict[str, int] = {}
        # Latest ACCUMULATED day volume per symbol (Massive `av` on AM/A aggregate
        # events) — a live-ticking source for the quote feed's Volume column,
        # served via get_last_price. Lock-free (atomic int assignment / read).
        self._day_volume: dict[str, int] = {}
        self._lock = threading.Lock()
        self._on_first_subscribe = on_first_subscribe or (lambda sym: None)
        self._on_last_unsubscribe = on_last_unsubscribe or (lambda sym: None)
        # Phase 4.6: throttle SSE emission for A/T events to 10 Hz per (sym, tf)
        # AM events bypass throttle (authoritative; infrequent). Partial state is
        # always updated regardless of throttle — only SSE emission is gated.
        self._last_emit_ms: dict[tuple[str, str], int] = {}
        self._emit_throttle_ms: int = 100  # 10 Hz max per (sym, tf)

    # ── Subscription management (called from SSE endpoint coroutines) ──

    def subscribe(self, sym: str, tf: str) -> asyncio.Queue:
        sym = sym.upper()
        if tf != "1" and tf not in ROLLUP_TFS:
            raise ValueError(f"Unsupported tf: {tf!r}")
        q: asyncio.Queue = asyncio.Queue(maxsize=64)
        # C1: capture the calling coroutine's loop so _emit can dispatch safely
        loop = asyncio.get_running_loop()
        key = (sym, tf)
        with self._lock:
            had_any = self._symbol_wanted(sym)
            self._subscribers.setdefault(key, set()).add((q, loop))
        if not had_any:
            try:
                self._on_first_subscribe(sym)
            except Exception as e:
                _logger.warning("[bar_broadcaster] on_first_subscribe(%s) failed: %s", sym, e)
        return q

    def unsubscribe(self, sym: str, tf: str, q: asyncio.Queue) -> None:
        sym = sym.upper()
        key = (sym, tf)
        with self._lock:
            subs = self._subscribers.get(key)
            # C1: subs now contains (queue, loop) tuples — find by queue identity
            if subs:
                match = next((t for t in subs if t[0] is q), None)
                if match:
                    subs.discard(match)
                    if not subs:
                        self._subscribers.pop(key, None)
            still_any = self._symbol_wanted(sym)
        if not still_any:
            # I1: clean up partial state — no subscribers watching anymore
            with self._lock:
                for tf_to_clear in ("1",) + ROLLUP_TFS:
                    self._partials.pop((sym, tf_to_clear), None)
                    self._am_partials.pop((sym, tf_to_clear), None)
                self._day_volume.pop(sym, None)
            try:
                self._on_last_unsubscribe(sym)
            except Exception as e:
                _logger.warning("[bar_broadcaster] on_last_unsubscribe(%s) failed: %s", sym, e)

    def _symbol_has_any_subscriber(self, sym: str) -> bool:
        return any(s == sym for (s, _tf) in self._subscribers.keys())

    def _symbol_wanted(self, sym: str) -> bool:
        """A symbol must stay subscribed upstream while ANY chart is streaming it
        (a subscriber queue) OR the quote feed holds interest in it."""
        return self._interest.get(sym, 0) > 0 or self._symbol_has_any_subscriber(sym)

    # ── Quote-feed interest (no queues; keeps the partial alive for get_last_price) ──

    def add_interest(self, symbols) -> None:
        """Register live-price interest in symbols (refcounted). Triggers the
        upstream Massive subscription (via on_first_subscribe) so tick-by-tick
        trades start flowing into the developing bar, readable via get_last_price."""
        for raw in symbols:
            sym = str(raw).upper()
            if not sym:
                continue
            with self._lock:
                was_wanted = self._symbol_wanted(sym)
                self._interest[sym] = self._interest.get(sym, 0) + 1
            if not was_wanted:
                try:
                    self._on_first_subscribe(sym)
                except Exception as e:
                    _logger.warning("[bar_broadcaster] on_first_subscribe(%s) failed: %s", sym, e)

    def remove_interest(self, symbols) -> None:
        """Release live-price interest. When a symbol has no interest AND no chart
        subscriber left, unsubscribe it upstream and drop its partials."""
        for raw in symbols:
            sym = str(raw).upper()
            if not sym:
                continue
            with self._lock:
                cur = self._interest.get(sym, 0)
                if cur <= 1:
                    self._interest.pop(sym, None)
                else:
                    self._interest[sym] = cur - 1
                still = self._symbol_wanted(sym)
                if not still:
                    for tf_to_clear in ("1",) + ROLLUP_TFS:
                        self._partials.pop((sym, tf_to_clear), None)
                        self._am_partials.pop((sym, tf_to_clear), None)
                    self._day_volume.pop(sym, None)
            if not still:
                try:
                    self._on_last_unsubscribe(sym)
                except Exception as e:
                    _logger.warning("[bar_broadcaster] on_last_unsubscribe(%s) failed: %s", sym, e)

    def get_last_price(self, sym: str) -> Optional[dict]:
        """Latest Massive-derived live quote for a symbol, or None if no tick yet.

        Reads the developing 1-min partial (updated tick-by-tick by T events) for
        the live `price`, and the cumulative day `volume` (Massive `av`, updated
        ~1 Hz by A events). The frontend recomputes the day % from the live price
        + the REST prev close; `volume` overlays the 15s REST value so the Volume
        column ticks live too. `volume` may be None until the first A event."""
        su = sym.upper()
        p = self._partials.get((su, "1"))
        if not p:
            return None
        c = p.get("c")
        if c is None:
            return None
        return {"price": c, "ts": p.get("t"), "volume": self._day_volume.get(su)}

    # ── Inbound from bar_stream ──

    def push_aggregate(self, sym: str, payload: dict, kind: str) -> None:
        """Called from bar_stream's on_bar callback (background asyncio loop).

        `kind` is "AM" (authoritative 1-min close), "A" (per-second aggregate, Phase 4.5),
        or "T" (per-trade tick, Phase 4.6).

        For AM/A: `payload` is a bar dict {t, o, h, l, c, v}.
        For T:    `payload` is a trade dict {t, p, s} (timestamp ms, price, size in shares).

        Two-track design (Phase 4.5):
        - _am_partials tracks the AM-authoritative bucket state — only AM events update it.
          Consecutive AM bars within the same bucket aggregate normally (correct multi-minute
          OHLCV). This track is never contaminated by A or T events.
        - _partials is the broadcast partial that includes A/T sub-second flicker on top.
          When AM fires for a minute, _partials is reset to the AM baseline (_am_partials),
          discarding any A/T accumulation for that minute. This prevents double-counting.
        - A events fold into _partials only (not _am_partials) for sub-second chart flicker.
        - T events (Phase 4.6) update c=price, extend h/l, sum volume into _partials.
          If no partial exists yet for the current minute bucket, one is created with
          o=h=l=c=trade_p, v=trade_s anchored at bucket_start(trade_t, tf).

        Throttle (Phase 4.6): AM events always emit (throttle=False). A and T events are
        throttled to 10 Hz per (sym, tf). The _partials state is ALWAYS updated; only the
        SSE emission is gated — so next AM/A event reflects the latest trade state.

        The stale-bar guard (C2) applies to AM/A kinds — out-of-order events are dropped.
        T events are not stale-checked (trades can arrive slightly out of order; the last
        price wins and c/h/l/v accumulation handles it gracefully).
        """
        sym = sym.upper()

        if kind == "T":
            # Trade tick path — payload is {t, p, s, c?}
            trade_t = payload["t"]
            trade_p = payload["p"]
            trade_s = payload["s"]
            # SIP sale-condition gate (matches TC2000/TradingView tape filtering):
            # an odd-lot / out-of-sequence / form-T / average-priced print may NOT
            # extend the candle's high/low (hl_ok) or move its last/close (last_ok).
            # Missing conditions / disabled filter → (True, True) = fully eligible.
            hl_ok, last_ok = trade_conditions.classify(payload.get("c"))
            # 1-min bucket: create or update partial from trade
            for tf in ("1",) + ROLLUP_TFS:
                new_start = bucket_start(trade_t, tf)
                key = (sym, tf)
                with self._lock:
                    prev = self._partials.get(key)
                    if prev is None or prev["t"] != new_start:
                        # No partial for the current minute yet. Do NOT let a
                        # non-last-sale print (odd-lot/OOS/etc.) DEFINE a new bar's
                        # open/high/low/close — wait for an eligible trade or the AM
                        # baseline reset. Volume-only prints simply don't seed a bar.
                        if not last_ok and not hl_ok:
                            continue
                        next_partial = {
                            "t": new_start,
                            "o": trade_p,
                            "h": trade_p,
                            "l": trade_p,
                            "c": trade_p,
                            "v": trade_s,
                        }
                    else:
                        # Update existing partial: extend h/l + move close ONLY for
                        # eligible prints; volume accumulates for every print (odd-lots
                        # count toward volume on the consolidated tape).
                        next_partial = {
                            "t": prev["t"],
                            "o": prev["o"],
                            "h": max(prev["h"], trade_p) if hl_ok else prev["h"],
                            "l": min(prev["l"], trade_p) if hl_ok else prev["l"],
                            "c": trade_p if last_ok else prev["c"],
                            "v": prev["v"] + trade_s,
                        }
                    self._partials[key] = next_partial
                    emit_bar = dict(next_partial)
                self._emit(sym, tf, emit_bar, throttle=True)
            return

        # AM / A aggregate path — payload is a bar dict {t, o, h, l, c, v, av?}
        bar = payload
        # Record the authoritative cumulative day volume for the quote feed's live
        # Volume column (atomic assignment; get_last_price reads it lock-free).
        av = bar.get("av")
        if av is not None:
            try:
                self._day_volume[sym] = int(av)
            except (TypeError, ValueError):
                pass
        throttle = (kind != "AM")  # AM always emits; A is throttled
        # 1-min + 5/15/30/60: two-track bucket-aggregate.
        #
        # "1" was historically a RAW pass-through here (`self._emit(sym, "1", bar)`),
        # a leftover from Phase 4 when the only aggregate event was AM (= one bar
        # per minute, so pass-through was correct). Phase 4.5 added A (per-SECOND)
        # events but never updated this path: an A event's `t` is that second's
        # window start and its `v` is that one second's volume, so the pass-through
        # emitted a distinct (sym,"1") bar EVERY SECOND at a sub-minute timestamp.
        # Downstream (StockChart Writer B) that appended a brand-new candle per tick
        # and collided second/minute-stamped writes in the volume series (the
        # phantom 1-min volume spike). The T-event path above already minute-buckets
        # "1" via `("1",) + ROLLUP_TFS`; fold AM/A through the same loop so the
        # 1-min chart develops ONE minute bar (AM authoritative baseline + A/T
        # sub-second flicker) exactly like 5/15/30/60. bucket_start(_, "1") floors
        # to the minute — a no-op for an already-minute-aligned AM bar.
        for tf in ("1",) + ROLLUP_TFS:
            new_start = bucket_start(bar["t"], tf)
            key = (sym, tf)
            with self._lock:
                prev = self._partials.get(key)
                # C2: drop stale/out-of-order bars to prevent bucket overwrite
                if prev is not None and bar["t"] < prev["t"]:
                    continue
                if kind == "AM":
                    # Update the AM-only baseline: aggregate AM bars normally within a bucket.
                    # This correctly accumulates multi-minute AM data (open from first bar,
                    # extended h/l, close from latest, summed volume — one AM bar per minute).
                    am_prev = self._am_partials.get(key)
                    if am_prev is None or am_prev["t"] != new_start:
                        # New bucket or first AM event: start the AM baseline fresh
                        next_am = aggregate(None, {**bar, "t": new_start})
                    else:
                        # Same bucket: fold this AM minute into the AM baseline
                        next_am = aggregate(am_prev, bar)
                    self._am_partials[key] = next_am
                    # Reset _partials to the AM baseline, discarding any A/T accumulation
                    # for the bucket so far. This is the authoritative source-of-truth reset.
                    next_partial = dict(next_am)
                else:
                    # A event: fold into the current broadcast partial for sub-second flicker
                    if prev is None or prev["t"] != new_start:
                        # New bucket (no AM baseline yet for this bucket): start fresh
                        next_partial = aggregate(None, {**bar, "t": new_start})
                    else:
                        # Same bucket: fold this second into the existing partial
                        next_partial = aggregate(prev, bar)
                self._partials[key] = next_partial
                emit_bar = dict(next_partial)
            self._emit(sym, tf, emit_bar, throttle=throttle)

    def push_minute_bar(self, sym: str, bar: dict) -> None:
        """Backward-compat alias — delegates to push_aggregate with kind="AM".

        Kept so existing callers (stream_bars_test.py E2E test, etc.) continue to
        work without modification. New code should call push_aggregate directly.
        """
        self.push_aggregate(sym, bar, "AM")

    # ── Internal: dispatch to subscriber queues ──

    @staticmethod
    def _safe_put(q: asyncio.Queue, msg: dict) -> None:
        """Runs on the queue's owner loop via call_soon_threadsafe."""
        global _bars_dropped_total
        try:
            q.put_nowait(msg)
        except asyncio.QueueFull:
            # Slow consumer — drop the oldest, push the new. Real-time data:
            # freshness > completeness. Count it (was silently swallowed = invisible loss).
            try:
                q.get_nowait()
                q.put_nowait(msg)
                _bars_dropped_total += 1
            except Exception:
                pass

    def _emit(self, sym: str, tf: str, bar: dict, throttle: bool = True) -> None:
        """Dispatch bar to all subscribers for (sym, tf).

        `throttle=True` (default, used for A and T events): gate emission to 10 Hz per
        (sym, tf). The partial state was already updated by the caller before this call,
        so even if we drop this emit the next unthrottled emit carries latest state.

        `throttle=False` (used for AM events): always emit — AM is authoritative and
        infrequent (once per minute per sym per tf).
        """
        key = (sym, tf)
        if throttle:
            now_ms = int(_time.time() * 1000)
            with self._lock:
                last = self._last_emit_ms.get(key, 0)
                if now_ms - last < self._emit_throttle_ms:
                    return  # throttle: skip emit; partial already updated
                self._last_emit_ms[key] = now_ms
        with self._lock:
            # C1: snapshot (queue, loop) pairs
            pairs = list(self._subscribers.get(key, ()))
        msg = {"sym": sym, "tf": tf, "bar": bar}
        for (q, loop) in pairs:
            # C1: dispatch via call_soon_threadsafe — safe from any thread
            try:
                loop.call_soon_threadsafe(self._safe_put, q, msg)
            except RuntimeError:
                # Loop already closed — subscriber's session is dead. Skip.
                pass
        if pairs:
            global _bars_emitted_total, _last_emit_at
            _bars_emitted_total += 1
            _last_emit_at = _time.time()

    def get_status(self) -> dict:
        with self._lock:
            return {
                "subscriber_pairs": len(self._subscribers),
                "quote_interest_symbols": len(self._interest),
                "tracked_partials": len(self._partials),
                "symbols": sorted({s for (s, _) in self._subscribers.keys()}),
                "bars_emitted_total": _bars_emitted_total,
                "bars_dropped_total": _bars_dropped_total,
                "last_emit_at": _last_emit_at,
                "last_emit_age_s": (round(_time.time() - _last_emit_at, 1) if _last_emit_at else None),
            }


# Module-level singleton — initialized at app startup, importable everywhere
_singleton: Optional[BarBroadcaster] = None


def get_broadcaster() -> BarBroadcaster:
    global _singleton
    if _singleton is None:
        raise RuntimeError("BarBroadcaster not initialized — call init_broadcaster() first")
    return _singleton


def init_broadcaster(*, on_first_subscribe=None, on_last_unsubscribe=None) -> BarBroadcaster:
    global _singleton
    # I4: guard against double-init — would orphan in-flight subscriber queues
    if _singleton is not None:
        raise RuntimeError("BarBroadcaster already initialized — call once at app startup")
    _singleton = BarBroadcaster(
        on_first_subscribe=on_first_subscribe,
        on_last_unsubscribe=on_last_unsubscribe,
    )
    return _singleton


def reset_broadcaster_for_tests() -> None:
    """Test-only: clear the singleton so init_broadcaster can be called again."""
    global _singleton
    _singleton = None
