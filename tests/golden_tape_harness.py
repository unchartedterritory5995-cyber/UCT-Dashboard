"""Golden-tape harness for the live bar path (ingest-process PR1).

Replays a TAPE (recorded-shape Massive stocks WS frames, synthetic symbols and prices)
through the exact production code path and records EVERYTHING it emits:

    frame --ingest_core.apply_frame--> on_bar / trade listeners / universe hook
          --BarBroadcaster.push_aggregate--> bar frames on real subscriber queues

Output is one JSON line per observable event, in order:
    {"at": ms, "call": "on_bar"|"listener"|"universe", "sym", "kind", "payload"}
    {"at": ms, "frame": "<subscriber label>", "msg": {...}}     # byte-exact json

The broadcaster runs on an injected clock (the tape's `at`) and an injected scheduler
(trailing flushes fire when the tape clock passes their due time), so the output is
fully deterministic, `rev` included. Subscribers are real asyncio queues on a real
loop, reached through the broadcaster's default (call_soon_threadsafe) publisher.

Used by tests/test_ingest_golden_tapes.py, and by the stream-ingest E2E
(`run_tape_via_ingest`, PR4b): the same tape through the real reader into the ingest
service's runtime, its feed buffer, the wire codec and the web relay helpers, whose
frame lines must equal the goldens' frame lines byte for byte, `rev` included.
Regenerate goldens ONLY for an intended behaviour change:
python -m tests.fixtures._gen_golden_tapes --regen
"""
from __future__ import annotations

import asyncio
import contextlib
import heapq
import itertools
import json
import os
from pathlib import Path
from typing import Iterable

from api.services import ingest_core
from api.services.bar_broadcaster import BarBroadcaster

TAPE_DIR = Path(__file__).resolve().parent / "fixtures" / "golden_tapes"

#: Subscribers every tape gets, per symbol in the tape header: (tf, session, v2).
#: Legacy + v2 on 1m and 5m covers the F1 older-t rule; 60/eth covers the
#: session-keyed hourly message shape.
SUBSCRIBERS = (("1", "rth", False), ("1", "rth", True), ("5", "rth", False),
               ("5", "rth", True), ("60", "eth", True))

#: After the last frame the tape clock runs on by this much so every trailing
#: flush scheduled by the throttle fires.
DRAIN_MS = 2_000


def _dumps(obj) -> str:
    # Key order preserved (byte-exact frames); compact; floats as Python repr.
    return json.dumps(obj, separators=(",", ":"), ensure_ascii=False)


def load_tape(name: str) -> dict:
    """A tape file: line 1 = header {symbols, universe, active?}; then {at, frame}."""
    lines = (TAPE_DIR / f"{name}.tape.jsonl").read_text(encoding="utf-8").splitlines()
    header = json.loads(lines[0])
    rows = [json.loads(l) for l in lines[1:] if l.strip()]
    return {"header": header, "rows": rows}


def tape_names() -> list[str]:
    return sorted(p.name[: -len(".tape.jsonl")] for p in TAPE_DIR.glob("*.tape.jsonl"))


def run_tape(name: str, via: str = "apply_frame") -> list[str]:
    """Replay one tape; return its output lines (see module doc).

    via="apply_frame": frames go straight into ingest_core.apply_frame.
    via="reader":      frames go through the REAL bar_stream._run_websocket over a
                       fake socket (auth, resubscribe, timed frames, frame_ctx wiring),
                       so a wiring mistake in the in-web reader shows up as a diff.
    """
    tape = load_tape(name)
    with _pinned_condition_rules():
        return asyncio.run(_run(tape, via))


@contextlib.contextmanager
def _pinned_condition_rules():
    """The goldens use SIP codes 15/30/37/12. Pin the ghost-print filter to its static
    fallback table for the run: a provider rules load (trade_conditions.load_from_provider,
    e.g. from an app-lifespan test with a key set) must not change the goldens."""
    from api.services import trade_conditions as tc
    saved = (tc.FILTER_ENABLED, tc._hl_ineligible, tc._last_ineligible, tc._vol_ineligible)
    tc.FILTER_ENABLED = True
    tc._hl_ineligible = set(tc._HL_INELIGIBLE_FALLBACK) - tc._SESSION_CODES
    tc._last_ineligible = set(tc._LAST_INELIGIBLE_FALLBACK) - tc._SESSION_CODES
    tc._vol_ineligible = set(tc._VOL_INELIGIBLE_FALLBACK) - tc._SESSION_CODES
    try:
        yield
    finally:
        tc.FILTER_ENABLED, tc._hl_ineligible, tc._last_ineligible, tc._vol_ineligible = saved


class _TapeEnd(BaseException):
    """Ends the reader replay (BaseException: _run_websocket retries every Exception)."""


async def _run(tape: dict, via: str) -> list[str]:
    header, rows = tape["header"], tape["rows"]
    out: list[str] = []
    now = [rows[0]["at"] if rows else 0]
    timers: list = []
    seq = itertools.count()

    def clock_ms() -> int:
        return now[0]

    def scheduler(delay_s: float, fn) -> None:
        due = now[0] + int(round(delay_s * 1000))
        heapq.heappush(timers, (due, next(seq), fn))

    bb = BarBroadcaster(clock_ms=clock_ms, scheduler=scheduler, seed_fetcher=lambda s: [])

    queues: list = []
    for sym in header["symbols"]:
        for tf, sess, v2 in SUBSCRIBERS:
            q = bb.subscribe(sym, tf, sess, v2=v2)
            queues.append((f"{sym}/{tf}/{sess}/{'v2' if v2 else 'legacy'}", q))

    def record_call(call: str, sym: str, kind, payload) -> None:
        out.append(_dumps({"at": now[0], "call": call, "sym": sym, "kind": kind, "payload": payload}))

    def on_bar(sym, payload, kind):
        record_call("on_bar", sym, kind, payload)
        bb.push_aggregate(sym, payload, kind)

    active = set(header.get("active", header["symbols"]))
    universe = bool(header.get("universe"))
    listeners = [lambda s, p: record_call("listener", s, "T", p)]
    on_universe_am = (lambda s, p: record_call("universe", s, "AM", p)) if universe else None

    async def drain() -> None:
        # Let call_soon_threadsafe deliveries run, then empty every queue in a fixed order.
        for _ in range(3):
            await asyncio.sleep(0)
        for label, q in queues:
            while not q.empty():
                out.append(_dumps({"at": now[0], "frame": label, "msg": q.get_nowait()}))

    def fire_timers_until(t: int) -> None:
        while timers and timers[0][0] <= t:
            due, _, fn = heapq.heappop(timers)
            now[0] = max(now[0], due)
            fn()

    async def frames():
        await drain()   # subscribe-time snapshots (none on a fresh broadcaster)
        for row in rows:
            fire_timers_until(row["at"])
            await drain()
            now[0] = row["at"]
            yield row["frame"]
            await drain()
        fire_timers_until(now[0] + DRAIN_MS)
        await drain()

    if via == "apply_frame":
        ctx = ingest_core.FrameContext(on_bar=on_bar, active=active, trade_listeners=listeners,
                                       universe=universe, on_universe_am=on_universe_am)
        async for raw in frames():
            ingest_core.apply_frame(raw, ctx)
    elif via == "reader":
        await _run_reader(frames, on_bar, active, listeners, universe, on_universe_am)
    else:
        raise ValueError(via)
    return out


# ── stream-ingest E2E (PR4b) ────────────────────────────────────────────────────

def _label_key(tf: str, sess: str) -> str:
    return "60e" if (tf == "60" and sess == "eth") else tf


def run_tape_via_ingest(name: str, web: str = "relay") -> list[str]:
    """Replay one tape through the stream-ingest path; return its FRAME lines.

        tape --real bar_stream._run_websocket (fake socket)--> IngestRuntime.on_bar
             --BarBroadcaster (ingest's, v2 sinks)--> the client's CoalescingBuffer
             --drain + encode/decode (the wire)--> feed_protocol.relay_bars
             --LegacyFilter.deliver--> one line per (subscriber label, frame)

    The client wants exactly the harness SUBSCRIBERS' keys for the tape's symbols
    and holds the tape's active set on every channel. The buffer is drained at each
    point where run_tape drains its queues, at the same tape clock, so the relay's
    rev clock sees the same `now` the in-web dispatch saw.

    web="remote" (PR5a): instead of the bare relay helpers, the decoded batches go into
    the web pod's real RemoteBroadcaster, and the lines are what its SSE subscriber
    queues (one per SUBSCRIBERS label) receive: the full web-side path."""
    if web not in ("relay", "remote"):
        raise ValueError(web)
    tape = load_tape(name)
    with _pinned_condition_rules():
        return asyncio.run(_run_ingest(tape, web))


async def _run_ingest(tape: dict, web: str = "relay") -> list[str]:
    import copy

    from api.services import bar_stream as bs
    from api.services import feed_protocol as fp
    from api.services import ingest_feed_server as ifs
    from api.services import ingest_runtime

    header, rows = tape["header"], tape["rows"]
    out: list[str] = []
    now = [rows[0]["at"] if rows else 0]
    timers: list = []
    seq = itertools.count()

    def scheduler(delay_s: float, fn) -> None:
        heapq.heappush(timers, (now[0] + int(round(delay_s * 1000)), next(seq), fn))

    saved = {n: copy.deepcopy(getattr(bs, n)) for n in
             ("_active", "_active_channels", "_sub_owners", "_pending_subscribe", "_pending_unsubscribe")}
    runtime = ingest_runtime.IngestRuntime(
        broadcaster_kw={"clock_ms": lambda: now[0], "scheduler": scheduler,
                        "seed_fetcher": lambda s: []},
        seeding=False)
    srv = ifs.IngestFeedServer(secret="golden", epoch=1, monotonic=lambda: now[0] / 1000.0,
                               on_delta=runtime.on_delta, limits=ingest_runtime.BUFFER_LIMITS,
                               data=runtime)
    active = set(header.get("active", header["symbols"]))
    universe = bool(header.get("universe"))
    try:
        srv.union.hello("golden", 1, now[0] / 1000.0)
        client = ifs._Client(client_id="golden", conn=None,
                             buffer=fp.CoalescingBuffer(srv.epoch, srv._limits), connected_at=0.0)
        srv.clients["golden"] = client
        keys = frozenset((sym, _label_key(tf, sess)) for sym in header["symbols"]
                         for tf, sess, _ in SUBSCRIBERS)
        desired = fp.Desired(gen=1, owners={"bars": {s: frozenset(fp.CHANNELS) for s in sorted(active)}},
                             keys=keys)
        srv._apply(srv.union.set_desired("golden", desired, now[0] / 1000.0))
        runtime.client_updated(client)
        if bs._sub_owners.get(next(iter(sorted(active))), {}).get(ingest_runtime.REMOTE_OWNER) is None:
            raise AssertionError("the runtime did not subscribe the active set upstream")

        labels = [(f"{sym}/{tf}/{sess}/{'v2' if v2 else 'legacy'}", sym, _label_key(tf, sess), v2)
                  for sym in header["symbols"] for tf, sess, v2 in SUBSCRIBERS]
        legacy, revs = fp.LegacyFilter(), fp.RevClock()
        rb = queues = None
        if web == "remote":
            from api.services.remote_broadcaster import RemoteBroadcaster
            rb = RemoteBroadcaster(clock_ms=lambda: now[0], monotonic=lambda: now[0] / 1000.0)
            queues = [(label, rb.subscribe(sym, tf, sess, v2=v2))
                      for sym in header["symbols"] for tf, sess, v2 in SUBSCRIBERS
                      for label in [f"{sym}/{tf}/{sess}/{'v2' if v2 else 'legacy'}"]]

        async def drain() -> None:
            runtime.before_flush()
            batch = client.buffer.drain()
            if batch is None:
                return
            batch = fp.decode(fp.encode(batch))          # through the wire codec
            assert batch.epoch == srv.epoch
            if rb is not None:
                rb.apply_batch(batch)
                for label, q in queues:
                    while not q.empty():
                        out.append(_dumps({"at": now[0], "frame": label, "msg": q.get_nowait()}))
                return
            frames_out = fp.relay_bars(batch.bars, legacy, revs, now[0])
            for label, sym, key, v2 in labels:
                for f in frames_out:
                    if f.sym == sym and f.key == key and fp.LegacyFilter.deliver(f.legacy_ok, v2):
                        out.append(_dumps({"at": now[0], "frame": label, "msg": f.msg}))

        def fire_timers_until(t: int) -> None:
            while timers and timers[0][0] <= t:
                due, _, fn = heapq.heappop(timers)
                now[0] = max(now[0], due)
                fn()

        async def frames():
            await drain()
            for row in rows:
                fire_timers_until(row["at"])
                await drain()
                now[0] = row["at"]
                yield row["frame"]
                await drain()
            fire_timers_until(now[0] + DRAIN_MS)
            await drain()

        # The real reader; every listener/universe hook is a no-op here (bars only).
        await _run_reader(frames, runtime.on_bar, active, [], universe,
                          (lambda s, p: None) if universe else None)
    finally:
        for n, v in saved.items():
            cur = getattr(bs, n)
            cur.clear()
            cur.update(v)
    return out



async def _run_reader(frames, on_bar, active, listeners, universe, on_universe_am) -> None:
    """Drive the real bar_stream._run_websocket over a fake socket that plays `frames`.
    Every module global it touches is restored afterwards."""
    import sys
    import types
    from unittest import mock

    import websockets

    import api.services as services_pkg
    from api.services import bar_stream as bs

    class FakeSocket:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def send(self, msg):
            pass

        async def recv(self):
            return '[{"ev":"status","status":"auth_success"}]'

        async def ping(self):
            return asyncio.get_running_loop().create_future()   # never answered: fine

        async def close(self):
            pass

        def __aiter__(self):
            return self._gen()

        async def _gen(self):
            async for raw in frames():
                yield raw
            raise _TapeEnd()

    # universe_am_handler / note_gap_connect / start_minute_frames: the minute-frame hooks
    # (bars_live_ingest), whose OFF state is exactly this: the plain on_am, and no-ops.
    fake_bli = types.SimpleNamespace(mark_connected=lambda: None, start_flusher=lambda loop: None,
                                     on_am=on_universe_am,
                                     universe_am_handler=lambda: on_universe_am,
                                     note_gap_connect=lambda: None,
                                     start_minute_frames=lambda loop: False)
    saved_active, saved_listeners = set(bs._active), list(bs._trade_listeners)
    saved_channels = {k: set(v) for k, v in bs._active_channels.items()}
    bs._active.clear()
    bs._active.update(active)
    bs._active_channels.clear()
    bs._trade_listeners[:] = listeners
    try:
        with mock.patch.object(bs, "_API_KEY", "golden-tape"), \
             mock.patch.object(bs, "_universe_stream_enabled", lambda: universe), \
             mock.patch.object(websockets, "connect", lambda *a, **k: FakeSocket()), \
             mock.patch.dict(sys.modules, {"api.services.bars_live_ingest": fake_bli}), \
             mock.patch.object(services_pkg, "bars_live_ingest", fake_bli, create=True):
            try:
                await bs._run_websocket(on_bar)
            except _TapeEnd:
                pass
    finally:
        bs._active.clear()
        bs._active.update(saved_active)
        bs._active_channels.clear()
        bs._active_channels.update(saved_channels)
        bs._trade_listeners[:] = saved_listeners
        bs._running = False
        bs._ws_connection = None


def golden_path(name: str) -> Path:
    return TAPE_DIR / f"{name}.golden.jsonl"


def write_golden(name: str, lines: Iterable[str]) -> None:
    golden_path(name).write_text("".join(l + "\n" for l in lines), encoding="utf-8", newline="\n")


def read_golden(name: str) -> list[str]:
    return golden_path(name).read_text(encoding="utf-8").splitlines()


def filter_env_is_default() -> bool:
    """The goldens assume the ghost-print filter is ON (its prod default)."""
    return os.environ.get("TRADE_CONDITION_FILTER_ENABLED", "1") == "1"
