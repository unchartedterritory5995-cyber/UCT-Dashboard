"""stream-ingest: the market-data side of the service (ingest PR4b).

Wires three existing pieces together on the service's ONE asyncio loop:

    Massive socket --bar_stream._run_websocket--> ingest_core.apply_frame --on_bar-->
    BarBroadcaster (the same class the web pod runs) --publisher--> each feed client's
    CoalescingBuffer --IngestFeedServer--> web

Everything that touches the broadcaster runs on that loop: the reader, the feed
handlers, the trailing-flush timers, and the seed APPLY (only the REST fetch of a seed
runs on a worker thread). So frames reach the buffers in exactly the order the
broadcaster derived them, with no cross-thread hop (the cost that starved the in-web
reader in the first place).

What the web side asks for, and what it gets
--------------------------------------------
* `owners` (per-channel symbol sets, unioned over every client by DesiredUnion) are
  what this process subscribes upstream, as ONE bar_stream owner, "remote", whose
  channels for a symbol are the union's. bar_stream's own refcount does the rest.
  STREAM_SCOPED_CHANNELS means here what it means on web (same env var, same code).
  Every such symbol also holds broadcaster INTEREST, so its minute map (and so its
  last price) stays alive without a chart.
* `keys` (sym, key) are chart subscriptions. Each unioned key holds one v2 SINK
  subscriber in the broadcaster; every frame it derives for the key, older-t final
  corrections included, is offered to the buffer of every connected client that wants
  that key. The legacy older-t filter and the `rev` stamp are the web relay's job
  (feed_protocol.LegacyFilter / RevClock), so they survive an ingest restart.
* prices: `get_last_price` for every symbol a client holds, coalesced: a symbol that
  had an event is read once per batch tick, and only a changed quote is offered.
* NH/NL print counters, the volume push's aggregates and Time & Sales prints (PR4c):
  ingest_side_feeds.SideFeeds, fed from the same on_bar.

A client connection that is new, or that adds a key, is first given a SNAPSHOT of it:
the developing bucket plus every bucket that closed in the last
INGEST_SNAPSHOT_LOOKBACK_MIN minutes (default 15), finals included (PR3 review: a
stall drops pending finals, so the developing bucket alone is not enough).

Finality resets: when the broadcaster drops a symbol (`_clear_symbol`: its last
subscriber and interest left), every live buffer forgets that symbol's final
watermarks (`CoalescingBuffer.forget`), or a later resubscribe's non-finals would be
refused as stale.

Seeds (D8): a symbol that gains its first chart key is seeded from REST, and on EVERY
Massive connect (the first too: seeds may have landed during the deploy-handoff
grace) every chart symbol is re-seeded (the minutes the socket missed),
at most INGEST_SEED_WORKERS (default 4) fetches at a time. No seeds while the
connection is not requested: with no live data there is nothing to merge them into.

The Massive connection opens ONLY when all of these hold (break-before-make; never two
stocks sockets, INGEST-PROCESS-DESIGN "DECIDED 11-13"):
    STREAM_INGEST_CONNECT=1, vendor_socket_guard allows it (on Railway, or the local
    opt-in), and MASSIVE_API_KEY is set.
The owner flips STREAM_INGEST_CONNECT only AFTER the web pod has released its socket
(PR6 cutover, off-hours). Reconnects follow massive_reconnect.MaxConnLadder.

DEPLOY HANDOFF. Railway starts a new deployment while the old one still runs, and stops
the old one (SIGTERM; it closes its Massive socket first) only once the new one is
healthy. So the reader waits INGEST_CONNECT_GRACE_S (default 45 s) after boot before
its first connect: the old socket is closed and reaped by then (SIGTERM a moment after
the new health check passes, Massive's 10-30 s reap), and the two never overlap.

Contract with the web side (PR5): a chart key's symbol is always also held under an
owner with channels (the web pod's "bars" owner). A key without channels gets no
upstream subscription here and so no data; it is counted (keys_without_channels).
"""
from __future__ import annotations

import asyncio
import logging
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Callable, Optional

from api.services import bar_broadcaster as bbm
from api.services import bar_stream
from api.services import feed_protocol as fp
from api.services import ingest_side_feeds
from api.services import massive_reconnect

log = logging.getLogger("api.services.ingest_runtime")

#: The bar_stream owner every web client's channels are held under.
REMOTE_OWNER = "remote"
SNAPSHOT_LOOKBACK_MIN = float(os.environ.get("INGEST_SNAPSHOT_LOOKBACK_MIN", "15"))
SEED_WORKERS = max(1, int(os.environ.get("INGEST_SEED_WORKERS", "4")))
# How long a NEW symbol's partial developing bars wait for its first seed (see _seed_hold).
SEED_HOLD_S = float(os.environ.get("INGEST_SEED_HOLD_S", "3"))
#: Seconds after boot before the first Massive connect (see DEPLOY HANDOFF).
CONNECT_GRACE_S = float(os.environ.get("INGEST_CONNECT_GRACE_S", "45"))
#: Ingest buffers hold a connect-time snapshot (~16 bars per 1m key) on top of the
#: live flow, so they get more pending-bar room than feed_protocol's default.
BUFFER_LIMITS = fp.BufferLimits(max_pending_bars=65536)


_stallwatch_started = False


def connect_requested() -> bool:
    return os.environ.get("STREAM_INGEST_CONNECT", "0") == "1"


def connect_decision() -> tuple[bool, str]:
    """(open the Massive socket?, why not). All three gates, in this order."""
    if not connect_requested():
        return False, "STREAM_INGEST_CONNECT is not 1"
    from api.services import vendor_socket_guard
    ok, reason = vendor_socket_guard.may_open("massive-bars")
    if not ok:
        return False, reason
    if not os.environ.get("MASSIVE_API_KEY"):
        return False, "MASSIVE_API_KEY is not set"
    return True, ""


class _Sink:
    """The one v2 subscriber object every unioned key holds in the broadcaster."""
    __slots__ = ()

    def __repr__(self) -> str:   # pragma: no cover - debugging aid
        return "<ingest sink>"


class IngestRuntime:
    def __init__(self, *, broadcaster_kw: Optional[dict] = None,
                 seed_fetcher: Optional[Callable[[str], list]] = None,
                 seeding: Optional[bool] = None,
                 policy: Optional[massive_reconnect.MaxConnLadder] = None,
                 snapshot_lookback_ms: Optional[int] = None):
        self.sink = _Sink()
        # Upstream subscriptions follow the union, not the broadcaster's refcount, so
        # its first-subscribe hook is a no-op; its last-unsubscribe hook is the
        # finality reset. `broadcaster_kw`: test seams (clock_ms, scheduler).
        self.bc = bbm.BarBroadcaster(on_first_subscribe=lambda sym: None,
                                     on_last_unsubscribe=self._symbol_cleared,
                                     publisher=self._publish, **(broadcaster_kw or {}))
        self._fetch = seed_fetcher or bbm._default_seed_fetcher
        # Seeds only when the socket will really open (no live data = nothing to merge into).
        self.seeding = connect_decision()[0] if seeding is None else bool(seeding)
        self.policy = policy or massive_reconnect.MaxConnLadder()
        self.policy.on_connected = self._on_vendor_connected
        self.lookback_ms = int((SNAPSHOT_LOOKBACK_MIN if snapshot_lookback_ms is None
                                else snapshot_lookback_ms / 60_000) * 60_000)
        self.server = None
        self.side = ingest_side_feeds.SideFeeds(
            monotonic=lambda: self.server._mono() if self.server is not None else time.monotonic(),
            wall_ms=lambda: self.bc._clock_ms())          # the broadcaster's clock (a test seam)
        # what this process holds, mirroring the union
        self._interest: set = set()              # symbols holding broadcaster interest
        self._keys: set = set()                  # (sym, key) holding a sink
        # routing: who gets what (connected clients only; a leased client has no buffer)
        self._routes: dict = {}                  # client_id -> _Client
        self._key_routes: dict = {}              # (sym, key) -> [client]
        self._sym_routes: dict = {}              # sym -> [client]
        self._client_view: dict = {}             # client_id -> (keys, syms) already snapshotted
        self._price_dirty: set = set()
        self._price_sent: dict = {}              # (client_id, sym) -> last price dict offered
        self._pool: Optional[ThreadPoolExecutor] = None
        self._seed_sem: Optional[asyncio.Semaphore] = None
        self._seed_tasks: set = set()
        # sym -> monotonic s its FIRST seed was scheduled. Until that seed lands, the
        # symbol's developing bars are partial (only the trades since the subscribe),
        # and a client that takes a partial bucket as its first authoritative frame
        # locks its open (liveBarMerge I2): the owner's wrong first candle. So its
        # NON-final bars are held, and `_reoffer` sends the seeded bucket. Bounded by
        # SEED_HOLD_S so a slow or failed seed never blanks the live candle.
        self._seed_hold: dict = {}
        self._first_seed: set = set()            # first seed scheduled, not finished
        self._reader: Optional[asyncio.Task] = None
        self._grace_until: Optional[float] = None
        self.counters = {"bars_routed": 0, "bars_unrouted": 0, "bars_superseded": 0,
                         "prices_offered": 0, "snapshot_bars": 0, "snapshots": 0,
                         "forgets": 0, "seeds_started": 0, "seeds_applied": 0,
                         "seed_errors": 0, "reseeds": 0, "upstream_changes": 0,
                         "bars_invalid": 0, "prices_invalid": 0, "keys_without_channels": 0,
                         "seed_reoffers": 0, "bars_held_for_seed": 0, "seed_hold_expired": 0}

    def attach(self, server) -> None:
        self.server = server

    # ── control plane: the union changed ─────────────────────────────────────

    def on_delta(self, delta: fp.ChannelDelta) -> None:
        union = self.server.union
        chans = union.channels()
        # 1) additions first, so a symbol moving from one hold to another is never
        #    dropped (and its finality reset) in between
        for sym in sorted(delta.subscribe):
            self._upstream(sym, chans.get(sym))
            if chans.get(sym) and sym not in self._interest:
                self._interest.add(sym)
                self.bc.add_interest([sym])
        new_syms = set()
        keyed_before = {s for s, _ in self._keys}
        for sym, key in sorted(delta.keys_added):
            if (sym, key) in self._keys:
                continue
            if not chans.get(sym):
                self.counters["keys_without_channels"] += 1
                log.warning("[stream-ingest] chart key %s/%s has no upstream channels: it gets no data", sym, key)
            tf, sess = fp.KEY_SPEC[key]
            self.bc.subscribe_sink(sym, tf, self.sink, sess)
            self._keys.add((sym, key))
            if sym not in keyed_before:
                new_syms.add(sym)
        # 2) removals
        for sym, key in sorted(delta.keys_removed):
            if (sym, key) not in self._keys:
                continue
            tf, sess = fp.KEY_SPEC[key]
            self._keys.discard((sym, key))
            self.bc.unsubscribe(sym, tf, self.sink, sess)
        for sym in sorted(delta.unsubscribe):
            self._upstream(sym, chans.get(sym))
            if not chans.get(sym) and sym in self._interest:
                self._interest.discard(sym)
                self.bc.remove_interest([sym])
        for sym in sorted(new_syms):
            self._schedule_seed(sym, first=True)
        self.side.sync(union)        # lease expiry may have released seeds / volume symbols

    def _upstream(self, sym: str, want) -> None:
        self.counters["upstream_changes"] += 1
        if want:
            bar_stream.subscribe_symbols([sym], owner=REMOTE_OWNER, channels=want)
        else:
            bar_stream.unsubscribe_symbols([sym], owner=REMOTE_OWNER)

    def _symbol_cleared(self, sym: str) -> None:
        """BarBroadcaster dropped `sym` (minute map + hwm): finality starts over."""
        self.counters["forgets"] += 1
        for client in list(self._routes.values()):
            client.buffer.forget(sym)
        for k in [k for k in self._price_sent if k[1] == sym]:
            del self._price_sent[k]

    # ── control plane: one client's own set changed (or it just connected) ────

    def client_updated(self, client) -> None:
        """After hello / desired / patch of `client` (a connected _Client): route it,
        and snapshot whatever it holds that its buffer has not been given yet."""
        cid = client.client_id
        union = self.server.union
        keys = union.client_keys(cid)
        syms = union.client_syms(cid)
        fresh = self._routes.get(cid) is not client
        if fresh:
            self._routes[cid] = client
            self._client_view[cid] = (frozenset(), frozenset())   # a fresh buffer
            for k in [k for k in self._price_sent if k[0] == cid]:
                del self._price_sent[k]
        old_keys, old_syms = self._client_view[cid]
        self._client_view[cid] = (keys, syms)
        for sym in old_syms - syms:
            self._price_sent.pop((cid, sym), None)
        self._reindex()
        self.side.sync(union)
        self.side.client_updated(client, union, fresh)
        buf = client.buffer
        added = sorted(keys - old_keys)
        if added:
            self.counters["snapshots"] += 1
        for sym, key in added:
            tf, sess = fp.KEY_SPEC[key]
            held = sym in self._seed_hold and self._holding(sym)
            for bar in self.bc.snapshot_bars(sym, tf, sess, lookback_ms=self.lookback_ms):
                if held and not bar.get("final"):
                    continue                  # partial: the seed's _reoffer sends it
                if buf.offer_bar(sym, key, bar, bool(bar.get("final"))) is fp.Offer.STALLED:
                    return
                self.counters["snapshot_bars"] += 1
        for sym in sorted(syms - old_syms):
            self._offer_price(client, sym)

    def client_gone(self, client) -> None:
        cid = client.client_id
        if self._routes.get(cid) is client:
            del self._routes[cid]
            self._client_view.pop(cid, None)
            for k in [k for k in self._price_sent if k[0] == cid]:
                del self._price_sent[k]
            self._reindex()
        self.side.client_gone(client)

    def _reindex(self) -> None:
        kr: dict = {}
        sr: dict = {}
        for cid, client in self._routes.items():
            keys, syms = self._client_view.get(cid, (frozenset(), frozenset()))
            for k in keys:
                kr.setdefault(k, []).append(client)
            for s in syms:
                sr.setdefault(s, []).append(client)
        self._key_routes, self._sym_routes = kr, sr

    # ── data plane ────────────────────────────────────────────────────────────

    def on_bar(self, sym: str, payload: dict, kind: str) -> None:
        """bar_stream's callback: the broadcaster first (it routes bars through
        `_publish` synchronously), then mark the quote dirty."""
        self.bc.push_aggregate(sym, payload, kind)
        su = sym.upper()
        self._price_dirty.add(su)
        self.side.on_event(su, payload, kind)

    def _publish(self, sink, loop, msg: dict) -> None:
        """BarBroadcaster's publisher: called under its lock, in dispatch order."""
        if sink is not self.sink:   # a queue subscriber: not expected in this process
            bbm.BarBroadcaster._threadsafe_publish(sink, loop, msg)
            return
        tf = msg["tf"]
        key = "60e" if (tf == "60" and msg.get("session") == "eth") else tf
        sym = msg["sym"]
        bar = msg["bar"]
        targets = self._key_routes.get((sym, key))
        if not targets:
            self.counters["bars_unrouted"] += 1
            return
        final = bool(bar.get("final"))
        if not final and sym in self._seed_hold and self._holding(sym):
            self.counters["bars_held_for_seed"] += 1
            return
        for client in targets:
            try:
                r = client.buffer.offer_bar(sym, key, bar, final)
            except fp.ProtocolError as e:
                # Unsendable (e.g. a non-finite price): count it, never let it escape
                # into the broadcaster's flush, which runs inside the reader's frame loop.
                self.counters["bars_invalid"] += 1
                log.warning("[stream-ingest] unsendable bar %s/%s: %s", sym, key, e)
                return
            if r is fp.Offer.ACCEPTED:
                self.counters["bars_routed"] += 1
            elif r is fp.Offer.SUPERSEDED:
                self.counters["bars_superseded"] += 1
            # STALLED: the server closes that client 1013 at its next flush

    def before_flush(self) -> None:
        """Once per batch tick: the side feeds, then the changed quotes."""
        self.side.flush()
        if not self._price_dirty:
            return
        dirty, self._price_dirty = self._price_dirty, set()
        for sym in dirty:
            for client in self._sym_routes.get(sym, ()):
                self._offer_price(client, sym)

    def _offer_price(self, client, sym: str) -> None:
        lp = self.bc.get_last_price(sym)
        if lp is None:
            return
        k = (client.client_id, sym)
        if self._price_sent.get(k) == lp:
            return
        try:
            r = client.buffer.offer_price(sym, lp["price"], lp["ts"], lp.get("trade_ts"), lp.get("volume"))
        except fp.ProtocolError:
            self.counters["prices_invalid"] += 1
            return
        if r is fp.Offer.ACCEPTED:
            self._price_sent[k] = lp
            self.counters["prices_offered"] += 1

    # ── seeds (D8) ────────────────────────────────────────────────────────────

    def _holding(self, sym: str) -> bool:
        t = self._seed_hold.get(sym)
        if t is None:
            return False
        if self._now() - t > SEED_HOLD_S:
            self._seed_hold.pop(sym, None)
            self.counters["seed_hold_expired"] += 1
            return False
        return True

    def _now(self) -> float:
        return self.server._mono() if self.server is not None else time.monotonic()

    def _schedule_seed(self, sym: str, first: bool = False) -> None:
        if not self.seeding:
            return
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return
        if self._pool is None:
            self._pool = ThreadPoolExecutor(max_workers=SEED_WORKERS, thread_name_prefix="ingest-seed")
            self._seed_sem = asyncio.Semaphore(SEED_WORKERS)
        if first:
            self._seed_hold.setdefault(sym, self._now())
            self._first_seed.add(sym)
        task = loop.create_task(self._seed(sym))
        self._seed_tasks.add(task)
        task.add_done_callback(self._seed_tasks.discard)

    async def _seed(self, sym: str) -> None:
        async with self._seed_sem:
            if not self.bc.begin_seed(sym):
                self._release_hold(sym)       # already seeded today: nothing partial to hide
                return
            self.counters["seeds_started"] += 1
            try:
                bars = await asyncio.get_running_loop().run_in_executor(self._pool, self._fetch, sym)
            except Exception as e:  # noqa: BLE001
                self.counters["seed_errors"] += 1
                log.warning("[stream-ingest] seed(%s) failed: %s", sym, type(e).__name__)
                bars = []
            # back on the loop: the apply (and the frames it emits) is ordered with the reader
            if self.bc.apply_seed(sym, bars):
                self.counters["seeds_applied"] += 1
                self._seed_hold.pop(sym, None)
                self._first_seed.discard(sym)
                self._reoffer(sym)
            else:
                self._release_hold(sym)       # a failed seed: the live bars are all there is

    def _release_hold(self, sym: str) -> None:
        # Re-offer even when the hold already EXPIRED: a bar dropped while held is marked
        # sent by the broadcaster and would not come again until the bucket changes.
        held = self._seed_hold.pop(sym, None) is not None
        if held or sym in self._first_seed:
            self._first_seed.discard(sym)
            self._reoffer(sym)

    def _reoffer(self, sym: str) -> None:
        """After a seed corrected `sym`'s minute map: give every connected client the
        recent buckets again. The broadcaster re-emits only the CURRENT bucket on a seed
        (F2), so without this a client would keep a closed bucket built from the live
        trades alone (a snapshot taken before the seed, or the minutes a Massive
        reconnect missed). A final replaces a final in the buffer (late-AM rule)."""
        for (s, key) in sorted(self._keys):
            if s != sym:
                continue
            targets = self._key_routes.get((s, key))
            if not targets:
                continue
            tf, sess = fp.KEY_SPEC[key]
            bars = self.bc.snapshot_bars(s, tf, sess, lookback_ms=self.lookback_ms)
            for client in targets:
                for bar in bars:
                    if client.buffer.offer_bar(s, key, bar, bool(bar.get("final"))) is fp.Offer.STALLED:
                        break
                    self.counters["seed_reoffers"] += 1

    def _on_vendor_connected(self, n: int) -> None:
        """EVERY Massive connect, the first included, re-seeds every chart symbol: a
        seed that landed before it (during the deploy-handoff grace, or before a
        reconnect) cannot contain the trades the socket was not there to see."""
        syms = sorted({s for s, _ in self._keys})
        if not syms:
            return
        self.counters["reseeds"] += 1
        log.info("[stream-ingest] Massive reconnect #%d: re-seeding %d chart symbol(s)", n, len(syms))
        for sym in syms:
            self.bc.reset_seed(sym)
            self._schedule_seed(sym)

    # ── the Massive reader ──────────────────────────────────────────────────

    def start_reader(self, grace_s: Optional[float] = None) -> bool:
        """Open the Massive socket if every gate allows it, after the deploy-handoff
        grace (see module doc)."""
        grace = CONNECT_GRACE_S if grace_s is None else float(grace_s)
        ok, why = connect_decision()
        if not ok:
            log.info("[stream-ingest] Massive socket NOT opened: %s", why)
            return False
        loop = asyncio.get_running_loop()
        bar_stream._ws_loop = loop
        bar_stream._ws_thread_ident = threading.get_ident()
        beat = loop.create_task(bar_stream._loop_beat())
        global _stallwatch_started
        if not _stallwatch_started:   # one watcher thread per process (it never exits)
            _stallwatch_started = True
            threading.Thread(target=bar_stream._stall_watch, daemon=True,
                             name="ingest-stallwatch").start()
        self._grace_until = loop.time() + grace

        async def read() -> None:
            if grace > 0:
                log.info("[stream-ingest] first Massive connect in %.0fs (deploy handoff grace)", grace)
                await asyncio.sleep(grace)
            # HOT STANDBY (INGEST_HOT_STANDBY=1): a second socket with the same subscriptions, its own
            # reconnect ladder; its connects never re-seed (bar_stream: only a gap does).
            self.standby_policy = (massive_reconnect.MaxConnLadder()
                                   if bar_stream._hot_standby_enabled() else None)
            # ONE socket-opening call (test_the_one_vendor_socket_path_is_behind_every_gate); the
            # standby argument rides along only when the standby is on.
            standby = {"standby_policy": self.standby_policy} if self.standby_policy is not None else {}
            await bar_stream._run_websocket(self.on_bar, policy=self.policy, **standby)

        self._reader = loop.create_task(read())
        self._reader.add_done_callback(lambda t: beat.cancel())
        log.info("[stream-ingest] Massive reader started")
        return True

    async def stop_reader(self, timeout_s: float = 3.0) -> None:
        """SIGTERM, step 1: close the Massive socket (the reader's `async with` sends
        the close frame), BEFORE the clients get their final batch."""
        task, self._reader = self._reader, None
        if task is None:
            return
        task.cancel()
        try:
            await asyncio.wait_for(task, timeout_s)
        except (asyncio.CancelledError, asyncio.TimeoutError):
            pass
        except Exception as e:  # noqa: BLE001
            log.warning("[stream-ingest] reader ended with %s", type(e).__name__)
        for t in list(self._seed_tasks):
            t.cancel()
        if self._pool is not None:
            self._pool.shutdown(wait=False, cancel_futures=True)

    def _in_grace(self) -> bool:
        if self._reader is None or self._grace_until is None:
            return False
        try:
            return asyncio.get_running_loop().time() < self._grace_until
        except RuntimeError:
            return False

    @property
    def vendor_connected(self) -> bool:
        return bool(bar_stream._running) and self._reader is not None

    # ── status ────────────────────────────────────────────────────────────────

    def status(self) -> dict:
        ok, why = connect_decision()
        bs = bar_stream.get_status() if self._reader is not None else None
        bstat = self.bc.get_status()
        bstat.pop("symbols", None)
        return {
            "vendor_socket": ("connected" if self.vendor_connected else
                              "handoff-grace" if self._in_grace() else
                              "connecting" if self._reader is not None and not self._reader.done() else
                              "none"),
            "connect": {"requested": connect_requested(), "allowed": ok, "why_not": why or None,
                        "reconnect": self.policy.status(),
                        "standby": bar_stream.hot_standby_status(),
                        "standby_reconnect": (self.standby_policy.status()
                                              if getattr(self, "standby_policy", None) is not None else None)},
            "upstream": (None if bs is None else {
                "connected": bs["connected"], "active_count": bs["active_count"],
                "feed": bs["feed"], "liveness": bs["liveness"], "loop_stalls": bs["loop_stalls"],
                "am_lag_ms": bs["am_lag_ms"], "ingest": bs["ingest"], "universe": bs["universe"],
                "channels": bar_stream.get_channel_counts()}),
            "broadcaster": bstat,
            "held": {"interest_symbols": len(self._interest), "keys": len(self._keys)},
            "routing": {"clients": len(self._routes), "keys": len(self._key_routes),
                        "symbols": len(self._sym_routes)},
            "seeding": self.seeding,
            "side_feeds": self.side.status(),
            "counters": dict(self.counters),
        }
