"""Web side of stream-ingest (PR5a): the internal feed client (STREAM_FEED_SOURCE=remote).

One asyncio task on the uvicorn loop. It connects to the stream-ingest service's
`/internal/feed` (Bearer PUSH_SECRET, private network), says `hello`, sends the web
pod's whole desired set, and folds every `batch` into the RemoteBroadcaster.

    desired = owners  (bar_stream's per-(sym, owner) channel holds: "bars" from the
                       broadcaster, plus every other owner: "nhnl", "volume", D3 ...)
            + keys    (RemoteBroadcaster.desired_keys(): every chart (sym, key))

LEVEL-TRIGGERED, FULL REPLACE. Whenever the set changes (the broadcaster says so at
once; bar_stream's owner holds, changed from other threads, are compared every
POLL_S) the client sends the WHOLE `desired` again. No patches: one message type,
nothing to get out of order, and a few KB even at a few thousand symbols.

SEQUENCING (feed_protocol.SeqTracker): a batch in order is applied; the first batch of
a NEW epoch (ingest restarted) resets the mirror first; a gap or duplicate drops the
connection and reconnects (the ingest side sends a fresh snapshot to a new connection).

`gen` grows with every connection (max(prev + 1, wall ms)), so a reconnect within the
ingest-side lease reclaims this pod's held set and can never be refused as stale.

No Massive socket is opened in remote mode (bar_stream.start_stream refuses), so this
client is the web pod's only market-data source; when it is down, get_last_price
answers None after 5 s and the quote feed falls back to Finnhub.
"""
from __future__ import annotations

import asyncio
import logging
import os
import queue
import socket
import threading
import time
from typing import Callable, Optional

from api.services import feed_protocol as fp

log = logging.getLogger("api.services.feed_client")

POLL_S = 0.25
DEBOUNCE_S = 0.05
RECONNECT_MIN_S = 1.0
RECONNECT_MAX_S = 10.0
DEFAULT_URL = "ws://stream-ingest.railway.internal:8080/internal/feed"
# Side-feed work waiting for its thread (~18 batches/s: minutes of slack).
SIDE_QUEUE_MAX = 5000


class SideWorker:
    """Runs the side feeds (NH/NL, volume push, T&S) on ONE thread of their own, in order.

    ⛔ NEVER ON THE EVENT LOOP. They take nhnl_live / volume_live / time_and_sales
    threading locks that those modules' scanner threads hold across a whole-universe
    walk (seconds under GIL contention). Applied on the uvicorn loop, every batch
    waited on them and every SSE stream froze with it: the owner's 1-6 s all-symbol
    price freezes, 2026-11-17. In local mode they ran on the reader thread; this is
    that thread's stand-in. One thread keeps batch order (new_epoch between applies)."""

    def __init__(self, side, maxsize: int = SIDE_QUEUE_MAX):
        self.side = side
        self.q: queue.Queue = queue.Queue(maxsize=maxsize)
        self.counters = {"queued": 0, "done": 0, "dropped": 0, "errors": 0}
        # Overflow never loses a reset: a dropped new_epoch, or a dropped batch (its T&S
        # prints), is replayed as a flag the thread acts on before its next item.
        self._epoch_owed = False
        self._gap_owed = False
        self._thread = threading.Thread(target=self._run, name="feed-side-feeds", daemon=True)
        self._thread.start()

    def submit(self, name: str, *args) -> None:
        try:
            self.q.put_nowait((name, args))
            self.counters["queued"] += 1
        except queue.Full:
            self.counters["dropped"] += 1
            if name == "new_epoch":
                self._epoch_owed = True
            else:
                self._gap_owed = True

    def close(self) -> None:
        try:
            self.q.put_nowait(None)
        except queue.Full:
            pass

    def _run(self) -> None:
        while True:
            item = self.q.get()
            if item is None:
                return
            name, args = item
            try:
                if self._epoch_owed:
                    self._epoch_owed = False
                    self.side.new_epoch()            # also gaps every tape
                    self._gap_owed = False
                if self._gap_owed and hasattr(self.side, "_tas_gap"):
                    self._gap_owed = False
                    self.side._tas_gap(None)         # lost prints: tick direction restarts
                getattr(self.side, name)(*args)
            except Exception as e:  # noqa: BLE001 - a side feed never kills its thread
                self.counters["errors"] += 1
                log.warning("[feed_client] side feeds %s failed: %s: %s", name, type(e).__name__, e)
            self.counters["done"] += 1

    def status(self) -> dict:
        return {**self.counters, "backlog": self.q.qsize(), "alive": self._thread.is_alive()}


def feed_source() -> str:
    """STREAM_FEED_SOURCE: "local" (default: this pod reads Massive itself) or "remote"."""
    v = os.environ.get("STREAM_FEED_SOURCE", "local").strip().lower()
    return "remote" if v == "remote" else "local"


def default_client_id(prefix: str = "web") -> str:
    rid = os.environ.get("RAILWAY_REPLICA_ID") or socket.gethostname() or prefix
    return f"{prefix}-{rid}"[: fp.MAX_ID_LEN]


def bar_stream_owners() -> dict:
    """{owner: {sym: frozenset[channel]}} from bar_stream's recorded holds."""
    from api.services import bar_stream
    with bar_stream._state_lock:
        snap = {s: dict(o) for s, o in bar_stream._sub_owners.items()}
    out: dict = {}
    for sym, owners in snap.items():
        for owner, chans in owners.items():
            if chans:
                out.setdefault(owner, {})[sym] = frozenset(chans)
    return out


_client: Optional["FeedClient"] = None
_task: Optional[asyncio.Task] = None
_stop: Optional[asyncio.Event] = None


def start_remote(side_feeds: bool = True, client_prefix: str = "web") -> "FeedClient":
    """Remote mode, at app startup (on the running uvicorn loop): install the
    RemoteBroadcaster as THE broadcaster and start the feed client task.

    `side_feeds=False`: stream-edge, which serves bars only; NH/NL, volume push and
    T&S stay on web (they feed web-side features and take web-side locks)."""
    global _client, _task, _stop
    from api.services import bar_broadcaster, bar_stream
    from api.services.remote_broadcaster import RemoteBroadcaster
    bar_stream._record_only = True
    rb = RemoteBroadcaster(on_first_subscribe=bar_stream.subscribe_symbols_one,
                           on_last_unsubscribe=bar_stream.unsubscribe_symbols_one)
    bar_broadcaster.install_broadcaster(rb)
    side = None
    if side_feeds:
        from api.services.remote_side_feeds import RemoteSideFeeds
        side = RemoteSideFeeds()
    _client = FeedClient(rb, side=side, side_thread=True,
                         client_id=default_client_id(client_prefix))
    _stop = asyncio.Event()
    _task = asyncio.get_running_loop().create_task(_client.run(_stop))
    return _client


async def stop_remote(timeout_s: float = 3.0) -> None:
    """App shutdown: close the feed connection cleanly (no-op when not started)."""
    if _stop is None or _task is None:
        return
    _stop.set()
    try:
        await asyncio.wait_for(_task, timeout_s)
    except (asyncio.TimeoutError, asyncio.CancelledError):
        _task.cancel()
    if _client is not None and _client.side_worker is not None:
        _client.side_worker.close()


def status() -> Optional[dict]:
    return _client.status() if _client is not None else None


def _is_ticker(x) -> bool:
    """Would the protocol's own parser accept `x` as a symbol (`fp.SYM_PATTERN`)? The sender's check,
    so it never builds a message it cannot send."""
    return isinstance(x, str) and bool(fp._SYM_RE.fullmatch(x))


class FeedClient:
    def __init__(self, rb, *, url: Optional[str] = None, secret: Optional[str] = None,
                 client_id: Optional[str] = None,
                 owners_fn: Callable[[], dict] = bar_stream_owners,
                 connect=None, clock_ms: Optional[Callable[[], int]] = None,
                 side=None, side_thread: bool = False):
        self.rb = rb
        # PR5b: NH/NL, volume push, T&S (remote_side_feeds.RemoteSideFeeds), or None.
        self.side = side
        # Production runs them on their own thread (SideWorker); tests may apply inline.
        self.side_worker = SideWorker(side) if (side is not None and side_thread) else None
        self.url = url or os.environ.get("STREAM_INGEST_URL", DEFAULT_URL)
        self.secret = secret if secret is not None else os.environ.get("PUSH_SECRET", "")
        self.client_id = client_id or default_client_id()
        self._owners_fn = owners_fn
        self._connect = connect
        self._clock_ms = clock_ms or (lambda: int(time.time() * 1000))
        self.gen = 0
        self.seq = fp.SeqTracker()
        self.connected = False
        self._changed: Optional[asyncio.Event] = None
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._last_sent = None
        self.counters = {"connects": 0, "disconnects": 0, "desired_sent": 0, "batches": 0,
                         "resyncs": 0, "epoch_resets": 0, "protocol_errors": 0, "unsendable_syms": 0}
        self._warned_syms: set = set()
        self.last_error: Optional[str] = None
        rb.on_change = self.mark_changed

    # ── change signalling (any thread) ───────────────────────────────────────

    def mark_changed(self) -> None:
        loop, ev = self._loop, self._changed
        if loop is None or ev is None:
            return
        try:
            if asyncio.get_running_loop() is loop:
                ev.set()
                return
        except RuntimeError:
            pass
        try:
            loop.call_soon_threadsafe(ev.set)
        except RuntimeError:
            pass

    def desired(self) -> fp.Desired:
        seeds, tas = self.side.desired_extras() if self.side is not None else ({}, frozenset())
        return self._sendable(fp.Desired(gen=self.gen, owners=self._owners_fn(), keys=self.rb.desired_keys(),
                                         nhnl_seeds=seeds, tas_syms=tas))

    def _sendable(self, d: fp.Desired) -> fp.Desired:
        """The desired set without the symbols the wire cannot carry.

        ⛔⛔ ONE ODD SYMBOL MUST NEVER COST EVERY MEMBER THE FEED (production 2026-11-17, 10:39-11:49
        CT). `fp.encode` validates the whole message, so ONE subscribed symbol outside the ticker rule
        (`fp.SYM_PATTERN`) raised MalformedMessage before the session counted as connected; the
        client reconnected every 10 s with the same set, 409 times: no live bar or quote reached any
        chart on this pod for 70 minutes. Such a symbol cannot be fed by this protocol anyway, so it
        is left out (counted, named once in the log) and every other symbol is sent."""
        bad: set = set()

        def ok(s) -> bool:
            if _is_ticker(s):
                return True
            bad.add(s)
            return False

        owners = {o: {s: ch for s, ch in syms.items() if ok(s)} for o, syms in d.owners.items()}
        keys = frozenset((s, k) for s, k in d.keys if ok(s))
        seeds = {s: v for s, v in d.nhnl_seeds.items() if ok(s)}
        tas = frozenset(s for s in d.tas_syms if ok(s))
        if not bad:
            return d
        self.counters["unsendable_syms"] = len(bad)
        new = bad - self._warned_syms
        if new:
            if len(self._warned_syms) < 1000:
                self._warned_syms |= new
            log.warning("[feed_client] left out of the desired set (not a ticker the feed can carry): %s",
                        ", ".join(sorted(repr(s) for s in new))[:500])
        return fp.Desired(gen=d.gen, owners=owners, keys=keys, nhnl_seeds=seeds, tas_syms=tas)

    # ── the connection loop ────────────────────────────────────────────────

    async def run(self, stop: Optional[asyncio.Event] = None) -> None:
        self._loop = asyncio.get_running_loop()
        self._changed = asyncio.Event()
        stop = stop or asyncio.Event()
        wait = RECONNECT_MIN_S
        while not stop.is_set():
            connects = self.counters["connects"]
            try:
                await self._session(stop)
                wait = RECONNECT_MIN_S
            except asyncio.CancelledError:
                raise
            except Exception as e:  # noqa: BLE001
                if self.counters["connects"] > connects:
                    wait = RECONNECT_MIN_S     # that session was up: start the backoff over
                self.last_error = f"{type(e).__name__}: {e}"[:200]
                log.warning("[feed_client] %s; reconnect in %.0fs", self.last_error, wait)
            self.connected = False
            if stop.is_set():
                break
            self.counters["disconnects"] += 1
            try:
                await asyncio.wait_for(stop.wait(), timeout=wait)
            except asyncio.TimeoutError:
                pass
            wait = min(wait * 2, RECONNECT_MAX_S)

    async def _session(self, stop: asyncio.Event) -> None:
        connect = self._connect
        if connect is None:
            from websockets.asyncio.client import connect
        if not self.secret:
            raise RuntimeError("PUSH_SECRET is not set")
        headers = {"Authorization": f"Bearer {self.secret}"}
        async with connect(self.url, additional_headers=headers, max_size=fp.MAX_MESSAGE_BYTES,
                           ping_interval=20, ping_timeout=60, close_timeout=2,
                           compression=None) as ws:
            self.gen = max(self.gen + 1, int(self._clock_ms()))
            self.seq.reset()
            await ws.send(fp.encode(fp.Hello(client_id=self.client_id, gen=self.gen)))
            if self.side is not None:
                self.side.on_connect()      # ingest may have lost its NH/NL marks: re-seed
            await self._send_desired(ws, force=True)
            self.connected = True
            self.counters["connects"] += 1
            self.last_error = None
            sender = asyncio.create_task(self._desired_loop(ws, stop))
            receiver = asyncio.create_task(self._recv_loop(ws, stop))
            stopper = asyncio.create_task(stop.wait())
            try:
                # Whichever ends first: the feed (an error or a close), the desired sender
                # (a failed send), or a stop request (which must not wait for the next batch).
                done, _ = await asyncio.wait({receiver, sender, stopper},
                                             return_when=asyncio.FIRST_COMPLETED)
                for t in (receiver, sender):
                    if t in done and t.exception() is not None:
                        raise t.exception()
            finally:
                for t in (receiver, sender, stopper):
                    t.cancel()
                for t in (receiver, sender, stopper):
                    try:
                        await t
                    except (asyncio.CancelledError, Exception):  # noqa: BLE001
                        pass

    async def _send_desired(self, ws, force: bool = False) -> None:
        d = self.desired()
        sig = (d.owners, d.keys, d.nhnl_seeds, d.tas_syms)
        if not force and sig == self._last_sent:
            return
        await ws.send(fp.encode(d))
        self._last_sent = sig
        self.counters["desired_sent"] += 1
        # Only now may the mirror forget what is no longer wanted: ingest knows, so a
        # later re-add is a visible change and brings a fresh snapshot.
        self.rb.sent_desired(d.keys, frozenset(s for syms in d.owners.values() for s in syms))

    async def _desired_loop(self, ws, stop: asyncio.Event) -> None:
        while not stop.is_set():
            try:
                await asyncio.wait_for(self._changed.wait(), timeout=POLL_S)
                await asyncio.sleep(DEBOUNCE_S)     # coalesce a burst of chart switches
            except asyncio.TimeoutError:
                pass
            self._changed.clear()
            await self._send_desired(ws)

    async def _recv_loop(self, ws, stop: asyncio.Event) -> None:
        async for data in ws:
            if stop.is_set():
                return
            try:
                msg = fp.decode(data)
            except fp.ProtocolError as e:
                self.counters["protocol_errors"] += 1
                raise RuntimeError(f"bad batch: {e}") from None
            if not isinstance(msg, fp.Batch):
                self.counters["protocol_errors"] += 1
                raise RuntimeError(f"unexpected {type(msg).__name__} from ingest")
            action = self.seq.accept(msg.epoch, msg.seq)
            if action is fp.TrackAction.RESET_AND_APPLY:
                self.counters["epoch_resets"] += 1
                self.rb.reset_mirror()
                if self.side_worker is not None:
                    self.side_worker.submit("new_epoch")
                elif self.side is not None:
                    self.side.new_epoch()
            elif action is fp.TrackAction.RESYNC:
                self.counters["resyncs"] += 1
                raise RuntimeError(f"sequence gap at epoch {msg.epoch} seq {msg.seq}: resync")
            elif action is fp.TrackAction.DISCARD:
                continue
            self.counters["batches"] += 1
            self.rb.apply_batch(msg)
            if self.side_worker is not None:
                if msg.agg or msg.tas or msg.nhnl or msg.nhnl_rt:
                    self.side_worker.submit("apply", msg)
            elif self.side is not None:
                try:
                    self.side.apply(msg)
                except Exception as e:  # noqa: BLE001 - a side feed never drops the bars feed
                    self.counters["side_errors"] = self.counters.get("side_errors", 0) + 1
                    log.warning("[feed_client] side feeds failed: %s: %s", type(e).__name__, e)

    def status(self) -> dict:
        return {"source": "remote", "url": self.url, "client_id": self.client_id,
                "connected": self.connected, "gen": self.gen,
                "secret_configured": bool(self.secret), "last_error": self.last_error,
                "counters": dict(self.counters),
                "side_feeds": self.side.status() if self.side is not None else None,
                "side_worker": self.side_worker.status() if self.side_worker is not None else None}
