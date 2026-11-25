"""Web side of stream-ingest (PR5a): the BarBroadcaster the web pod uses in REMOTE mode.

With STREAM_FEED_SOURCE=remote the web pod opens NO Massive socket. The stream-ingest
service holds it and sends `batch` messages (feed_protocol) over the internal feed;
`feed_client.FeedClient` receives them on the uvicorn event loop and hands each one to
`RemoteBroadcaster.apply_batch`. This class keeps the SAME interface every web caller
already uses (subscribe / unsubscribe / add_interest / remove_interest /
get_last_price / get_partial / ensure_seeded / last_tick_age / get_status), so the SSE
routes, the D3 price arm and the journal reads do not change.

What it holds (a MIRROR, nothing derived here):
  * per (sym, key): the bars ingest sent, latest per bucket start t (a few buckets)
  * per sym: the latest quote {price, ts, trade_ts, volume} and when it arrived
  * the subscriber queues of the bar SSE, with the web relay's v2/legacy older-t filter
    and the bar-contract `rev` stamp (feed_protocol.LegacyFilter / RevClock): both live
    HERE, on web, so an ingest restart (a new epoch) can never rewind or reset them.

Frames reach subscriber queues with `put_nowait` on the queue's own loop: the feed
client runs on the uvicorn loop, so there is no cross-thread hop at all (the hop that
starved the in-web reader is gone, not moved).

What it wants (the control plane): `desired_keys()` = every (sym, key) with a chart
subscriber. Symbol interest goes through `on_first_subscribe` / `on_last_unsubscribe`
exactly as in local mode (bar_stream.subscribe_symbols_one, owner "bars"); in remote
mode bar_stream only RECORDS owners, and the feed client sends them as `owners`.

Freshness: get_last_price answers None once no batch has arrived for STALE_S (5 s), so
the quote feed falls back to Finnhub instead of serving a frozen price. (Ingest sends a
status batch at least once a second, so a healthy feed is never 5 s quiet.)
"""
from __future__ import annotations

import asyncio
import logging
import threading
import time as _time
from typing import Callable, Optional

from api.services import feed_protocol as fp

log = logging.getLogger("api.services.remote_broadcaster")

STALE_S = 5.0
#: Buckets kept per (sym, key) in the mirror (the developing one + recent finals).
_KEEP_BUCKETS = 4
_QUEUE_MAX = 64


class _BarQueue(asyncio.Queue):
    """One chart subscription's queue (one symbol and timeframe) that CONFLATES.

    ⭐ 2026-11-17, measured on production: 304,113 of 1.68 M bar frames (18%) were dropped from full
    64-slot queues in one session, and a connection that fell behind (web's loop stalls after a restart)
    then drained up to 64 STALE frames, oldest first, before the newest price: trade -> browser p50
    6-12 s for minutes. The drop-oldest rule could also drop a minute's FINAL bar.

    A forming (non-final) frame is last-value-wins for its candle: when the newest frame still waiting
    is a forming frame of the SAME candle (`bar.t`), the new frame takes its place instead of queueing
    behind it. Order is otherwise untouched (a final is never replaced or overtaken, a new candle is
    appended), so a slow reader gets the CURRENT value of the forming candle plus every final, and the
    queue stays a few frames deep instead of filling."""

    def conflate(self, msg: dict) -> bool:
        if not self._queue:
            return False
        last = self._queue[-1]
        lb = last.get("bar") if isinstance(last, dict) else None
        nb = msg.get("bar") if isinstance(msg, dict) else None
        if not isinstance(lb, dict) or not isinstance(nb, dict):
            return False
        if lb.get("final") or lb.get("t") is None or lb.get("t") != nb.get("t"):
            return False
        self._queue[-1] = msg
        return True


def _key_for(tf: str, session: str = "rth") -> str:
    from api.services.bar_broadcaster import _key_for as kf
    return kf(tf, session)


class RemoteBroadcaster:
    def __init__(self, on_first_subscribe: Optional[Callable[[str], None]] = None,
                 on_last_unsubscribe: Optional[Callable[[str], None]] = None, *,
                 clock_ms: Optional[Callable[[], int]] = None,
                 monotonic: Callable[[], float] = _time.monotonic,
                 stale_s: float = STALE_S):
        self._on_first = on_first_subscribe or (lambda s: None)
        self._on_last = on_last_unsubscribe or (lambda s: None)
        self._clock_ms = clock_ms or (lambda: int(_time.time() * 1000))
        self._mono = monotonic
        self.stale_s = float(stale_s)
        # Callers reach this from request handlers (the loop) AND from worker threads
        # (the D3 arm, journal reads, the quote poller): one lock, held briefly.
        self._lock = threading.RLock()
        self._subs: dict = {}            # (sym, key) -> {(queue, v2)}
        self._sym_keys: dict = {}        # sym -> {key}
        self._interest: dict = {}        # sym -> refcount
        self._bars: dict = {}            # (sym, key) -> {t: bar dict incl. final}
        self._prices: dict = {}          # sym -> {price, ts, trade_ts, volume}
        self._tick_mono: dict = {}       # sym -> monotonic s of its last price/bar
        self.legacy = fp.LegacyFilter()
        self.revs = fp.RevClock()
        self._fresh_mono: Optional[float] = None   # last batch of any kind
        self._vendor_up: Optional[bool] = None     # ingest's word on its Massive socket (status `connect`)
        # What ingest was last told (FeedClient.sent_desired): the mirror keeps data
        # for these, and prunes the rest only once ingest knows (finding: a re-add
        # inside the debounce would otherwise never get a snapshot back).
        self._sent_keys: frozenset = frozenset()
        self._sent_syms: frozenset = frozenset()
        self._last_emit_wall: Optional[float] = None
        self.on_change: Callable[[], None] = lambda: None   # the feed client's "desired changed"
        # ⭐ Pushed list prices (api/services/quote_hub.py, additive 2026-11-25): called once per batch, on
        # this loop, with the quotes this batch updated ({sym: {price, ts, trade_ts, volume}}), AFTER the
        # lock is released. None = nobody listens (the default; the quote stream is behind a flag).
        self.quote_sink: Optional[Callable[[dict], None]] = None
        self.counters = {"batches": 0, "bars_in": 0, "frames_out": 0, "dropped": 0,
                         "conflated": 0, "prices_in": 0, "mirror_resets": 0}

    # ── subscription management (the SSE routes, the quote feed) ─────────────

    def subscribe(self, sym: str, tf: str, session: str = "rth", v2: bool = False) -> asyncio.Queue:
        sym = sym.upper()
        k = _key_for(tf, session)
        q: asyncio.Queue = _BarQueue(maxsize=_QUEUE_MAX)
        with self._lock:
            had_any = self._wanted(sym)
            self._subs.setdefault((sym, k), set()).add((q, bool(v2)))
            self._sym_keys.setdefault(sym, set()).add(k)
            snap = self._developing(sym, k)
            if snap is not None:
                # BarBroadcaster.subscribe puts the current bucket WITHOUT a rev: same here.
                self._put(q, self._msg(sym, k, snap))
        if not had_any:
            self._call(self._on_first, sym)
        self.on_change()
        return q

    def unsubscribe(self, sym: str, tf: str, q: asyncio.Queue, session: str = "rth") -> None:
        sym = sym.upper()
        k = _key_for(tf, session)
        with self._lock:
            subs = self._subs.get((sym, k))
            if subs:
                for item in [x for x in subs if x[0] is q]:
                    subs.discard(item)
                if not subs:
                    self._subs.pop((sym, k), None)
                    ks = self._sym_keys.get(sym)
                    if ks is not None:
                        ks.discard(k)
                        if not ks:
                            self._sym_keys.pop(sym, None)
            still = self._wanted(sym)
        if not still:
            self._call(self._on_last, sym)
        self.on_change()

    def add_interest(self, symbols) -> None:
        for raw in symbols:
            sym = str(raw).upper()
            if not sym:
                continue
            with self._lock:
                was = self._wanted(sym)
                self._interest[sym] = self._interest.get(sym, 0) + 1
            if not was:
                self._call(self._on_first, sym)
        self.on_change()

    def remove_interest(self, symbols) -> None:
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
                still = self._wanted(sym)
            if not still:
                self._call(self._on_last, sym)
        self.on_change()

    def _wanted(self, sym: str) -> bool:
        return self._interest.get(sym, 0) > 0 or bool(self._sym_keys.get(sym))

    def sent_desired(self, keys, syms) -> None:
        """FeedClient sent ingest this desired set. Prune the mirror to it: a key no
        longer sent loses its bars; a symbol no longer sent at all (no key, no owner)
        loses its quote and, only then, its legacy high-water mark and rev clock
        (PR3 review: never on one client's unsubscribe)."""
        keys, syms = frozenset(keys), frozenset(syms)
        with self._lock:
            self._sent_keys, self._sent_syms = keys, syms
            for k in [k for k in self._bars if k not in keys]:
                del self._bars[k]
            gone = {s for s in (set(self._prices) | {s for s, _ in self.legacy._hi})
                    if s not in syms and not any(k[0] == s for k in keys)
                    and not self._wanted(s)}      # re-added while the send was in flight
            for s in gone:
                self._prices.pop(s, None)
                self._tick_mono.pop(s, None)
                self.legacy.forget(s)
                self.revs.forget(s)

    @staticmethod
    def _call(fn, sym: str) -> None:
        try:
            fn(sym)
        except Exception as e:  # noqa: BLE001
            log.warning("[remote_broadcaster] subscription hook(%s) failed: %s", sym, e)

    def desired_keys(self) -> frozenset:
        with self._lock:
            return frozenset(self._subs)

    # ── reads ──────────────────────────────────────────────────────────────

    def feed_fresh(self) -> bool:
        """A batch within stale_s AND ingest's vendor socket up. ⛔ 2026-11-17 audit: ingest keeps
        sending status batches (at least once a second) while its Massive socket is DOWN, so "a batch
        arrived" alone kept the mirror's frozen quotes served as live (get_last_price) and the quote
        feed never fell back. Ingest says which in every status batch (`connect`)."""
        return (self._fresh_mono is not None and self._mono() - self._fresh_mono < self.stale_s
                and self._vendor_up is not False)

    def get_last_price(self, sym: str) -> Optional[dict]:
        """The mirror's latest quote, or None (no quote yet, or the feed has been quiet
        for stale_s: the caller falls back to Finnhub). Same shape as BarBroadcaster's."""
        if not self.feed_fresh():
            return None
        with self._lock:
            p = self._prices.get(sym.upper())
            return dict(p) if p is not None else None

    def get_partial(self, sym: str, tf: str, session: str = "rth") -> Optional[dict]:
        k = _key_for(tf, session)
        with self._lock:
            b = self._developing(sym.upper(), k)
            return dict(b) if b is not None else None

    def _developing(self, sym: str, k: str) -> Optional[dict]:
        bars = self._bars.get((sym, k))
        if not bars:
            return None
        return bars[max(bars)]

    def ensure_seeded(self, sym: str) -> bool:
        """Seeding happens in stream-ingest (it holds the minute map)."""
        return False

    def last_tick_age(self, sym: str) -> Optional[float]:
        m = self._tick_mono.get(sym.upper())
        return None if m is None else self._mono() - m

    def push_aggregate(self, sym, payload, kind) -> None:
        raise RuntimeError("remote mode: market data arrives from stream-ingest, not bar_stream")

    def get_status(self) -> dict:
        with self._lock:
            return {
                "mode": "remote",
                "subscriber_pairs": len(self._subs),
                "quote_interest_symbols": len(self._interest),
                "tracked_partials": sum(len(v) for v in self._sym_keys.values()),
                "tracked_symbols": len({s for s, _ in self._bars} | set(self._prices)),
                "symbols": sorted(self._sym_keys),
                # the keys bars_rail_monitor reads (same meaning as BarBroadcaster's)
                "bars_emitted_total": self.counters["frames_out"],
                "bars_dropped_total": self.counters["dropped"],
                "last_emit_at": self._last_emit_wall or 0.0,
                "last_emit_age_s": (round(_time.time() - self._last_emit_wall, 1)
                                    if self._last_emit_wall else None),
                "feed_fresh": self.feed_fresh(),
                "vendor_up": self._vendor_up,
                "last_batch_age_s": (None if self._fresh_mono is None
                                     else round(self._mono() - self._fresh_mono, 2)),
                **{f"{k}_total": v for k, v in self.counters.items()},
            }

    # ── the data plane (the feed client, on the uvicorn loop) ────────────────

    def reset_mirror(self) -> None:
        """A new ingest epoch (ingest restarted): its state is new, drop the mirror.
        Subscriber queues, the legacy filter and the rev clock are kept."""
        with self._lock:
            self._bars.clear()
            self._prices.clear()
            self._tick_mono.clear()
            self.counters["mirror_resets"] += 1

    def apply_batch(self, batch: fp.Batch) -> None:
        now_m = self._mono()
        quotes: dict = {}       # this batch's quotes for `quote_sink` (pushed list prices), called unlocked
        with self._lock:
            self._fresh_mono = now_m
            st = batch.status
            if isinstance(st, dict) and "connect" in st:
                self._vendor_up = bool(st["connect"])
            self.counters["batches"] += 1
            if batch.bars:
                frames = fp.relay_bars(batch.bars, self.legacy, self.revs, int(self._clock_ms()))
                for f in frames:
                    self.counters["bars_in"] += 1
                    k = (f.sym, f.key)
                    if k not in self._subs and k not in self._sent_keys:
                        continue     # released, and ingest already knows
                    bars = self._bars.setdefault(k, {})
                    bars[f.msg["bar"]["t"]] = f.msg["bar"]
                    if len(bars) > _KEEP_BUCKETS:
                        for old in sorted(bars)[:-_KEEP_BUCKETS]:
                            del bars[old]
                    self._tick_mono[f.sym] = now_m
                    for (q, v2) in list(self._subs.get(k, ())):
                        if fp.LegacyFilter.deliver(f.legacy_ok, v2):
                            self._put(q, f.msg)
                            self.counters["frames_out"] += 1
                            self._last_emit_wall = _time.time()
            for sym, p in batch.prices.items():
                # any symbol this pod holds (a chart, quote interest, or ANY bar_stream
                # owner: what a local-mode minute map would have answered for)
                if not (self._wanted(sym) or sym in self._sent_syms):
                    continue
                self._prices[sym] = dict(p)
                self._tick_mono[sym] = now_m
                self.counters["prices_in"] += 1
                if self.quote_sink is not None:
                    quotes[sym] = self._prices[sym]
        if quotes:
            try:
                self.quote_sink(quotes)
            except Exception as e:  # noqa: BLE001 - the price push never drops the bars feed
                self.counters["quote_sink_errors"] = self.counters.get("quote_sink_errors", 0) + 1
                log.warning("[remote_broadcaster] quote sink failed: %s: %s", type(e).__name__, e)

    @staticmethod
    def _msg(sym: str, k: str, bar: dict) -> dict:
        tf, sess = fp.KEY_SPEC[k]
        msg = {"sym": sym, "tf": tf, "bar": dict(bar)}
        if tf == "60":
            msg["session"] = sess
        return msg

    def _put(self, q: asyncio.Queue, msg: dict) -> None:
        """Same-loop put. A forming frame of the candle already waiting replaces it (_BarQueue);
        otherwise appended, and a still-full queue drops its oldest (BarBroadcaster._safe_put)."""
        if isinstance(q, _BarQueue) and q.conflate(msg):
            self.counters["conflated"] += 1
            return
        try:
            q.put_nowait(msg)
        except asyncio.QueueFull:
            try:
                q.get_nowait()
                q.put_nowait(msg)
                self.counters["dropped"] += 1
            except Exception:  # noqa: BLE001
                pass
