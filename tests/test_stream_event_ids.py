"""TERM-054 / FB-D3-01 — the web streams emit `id:`, and a reconnect presenting
a Last-Event-ID is ANSWERED rather than silently served a fresh stream.

Both `/api/stream/prices` and `/api/stream/bars` are last-value-wins, so the
replay window is ZERO events. What the spec requires ("Known it worked") is the
declaration: resume is `not_applicable`, nothing is replayed, and the stream says
what it serves instead — and then actually serves it. Every case here drives the
real handler and reads the frames its generator YIELDS; nothing asserts that a
helper exists.

⚠️ Handlers are called directly and their `body_iterator` is iterated inside ONE
`asyncio.run`, like `test_stream_admission.py` and for the same reason: Starlette's
TestClient buffers the body and these generators never end on their own. The
request stub reports "connected" for a fixed number of loop passes, then
"disconnected", which is the generator's only exit.
"""
import asyncio
import json

import pytest
from fastapi.responses import StreamingResponse

from api.routers import stream


# ── harness ──────────────────────────────────────────────────────────────────

class _Req:
    """A request that stays connected for `passes` loop iterations."""

    def __init__(self, passes=1, headers=None):
        self._left = passes
        self.headers = headers or {}

    async def is_disconnected(self):
        if self._left <= 0:
            return True
        self._left -= 1
        return False


def _parse(chunks):
    """SSE text → [{'id':…, 'event':…, 'data':…}] (event defaults to 'message')."""
    frames = []
    for block in "".join(chunks).split("\n\n"):
        if not block.strip():
            continue
        f = {"event": "message"}
        for line in block.split("\n"):
            key, _, val = line.partition(": ")
            f[key] = val
        frames.append(f)
    return frames


async def _drain(resp):
    assert isinstance(resp, StreamingResponse), resp
    return [c async for c in resp.body_iterator]


class _FakeBroadcaster:
    """Stands in for bar_broadcaster: one pre-filled queue per subscribed pair."""

    def __init__(self, preload):
        self.preload = preload          # {(sym, tf): [msg, ...]}
        self.unsubscribed = []

    def subscribe(self, sym, tf):
        q = asyncio.Queue()
        for msg in self.preload.get((sym, tf), []):
            q.put_nowait(msg)
        return q

    def unsubscribe(self, sym, tf, q):
        self.unsubscribed.append((sym, tf))

    # /api/stream/prices touches these when a broadcaster is present
    def add_interest(self, syms):
        pass

    def remove_interest(self, syms):
        pass

    def get_last_price(self, sym):
        return None


@pytest.fixture(autouse=True)
def isolated(monkeypatch):
    """A clean registry, a known boot token and a zeroed sequence per test, and
    every upstream the prices loop reads replaced by a fixed answer."""
    monkeypatch.setattr(stream, "_subscribers", {"prices": set(), "bars": set()})
    monkeypatch.setattr(stream, "_EVENT_BOOT", "b00t")
    monkeypatch.setattr(stream, "_event_seq", {"prices": 0, "bars": 0})
    monkeypatch.setenv("STREAM_BARS_ENABLED", "1")
    monkeypatch.setattr(stream, "subscribe_tickers", lambda syms: None)
    monkeypatch.setattr(stream, "unsubscribe_tickers", lambda syms: None)
    monkeypatch.setattr(stream, "get_realtime_prices",
                        lambda syms: {s: {"price": 100.0, "volume": 5} for s in syms})
    monkeypatch.setattr(stream.realtime_candle, "get_current", lambda sym, tf: None)
    monkeypatch.setattr(stream.realtime_candle, "get_correction_queue", lambda: asyncio.Queue())
    monkeypatch.setattr(stream.realtime_stream, "get_last_seen", lambda sym: None)

    from api.services import bar_broadcaster as bb

    def _no_broadcaster():
        raise RuntimeError("bars overlay not initialised (test)")

    monkeypatch.setattr(bb, "get_broadcaster", _no_broadcaster)
    yield


def _prices(passes=1, headers=None, last_event_id=None):
    async def go():
        resp = await stream.stream_prices(
            _Req(passes, headers), tickers="AAPL,MSFT", last_event_id=last_event_id)
        return _parse(await _drain(resp))
    return asyncio.run(go())


def _bars(monkeypatch, preload, passes=1, headers=None, last_event_id=None):
    from api.services import bar_broadcaster as bb
    fake = _FakeBroadcaster(preload)
    monkeypatch.setattr(bb, "get_broadcaster", lambda: fake)

    async def go():
        resp = await stream.stream_bars(
            _Req(passes, headers), bars="AAPL:5,MSFT:1", last_event_id=last_event_id)
        return _parse(await _drain(resp))
    return asyncio.run(go())


def _seq(frame):
    boot, _, n = frame["id"].rpartition("-")
    return boot, int(n)


# ── ids ──────────────────────────────────────────────────────────────────────

def test_every_prices_frame_carries_a_strictly_increasing_id():
    frames = _prices(passes=1)
    # Non-vacuity: the snapshot pass really emitted something to check.
    assert frames and frames[0]["event"] == "message", frames
    assert all("id" in f for f in frames), frames
    ids = [_seq(f) for f in frames]
    assert {boot for boot, _ in ids} == {"b00t"}
    seqs = [n for _, n in ids]
    assert seqs == sorted(seqs) and len(set(seqs)) == len(seqs), seqs


def test_every_bars_frame_carries_an_id_including_the_heartbeat(monkeypatch):
    # A private clock for the router only (never the global `time.time`): the
    # generator's first read seeds `last_heartbeat`, the second is 100 s later,
    # so the one loop pass is also a heartbeat pass.
    import types
    monkeypatch.setattr(stream, "time", types.SimpleNamespace(time=_clock([0, 100])))
    frames = _bars(monkeypatch, {
        ("AAPL", "5"): [{"sym": "AAPL", "tf": "5", "bar": {"t": 1, "c": 1}}],
        ("MSFT", "1"): [{"sym": "MSFT", "tf": "1", "bar": {"t": 2, "c": 2}}],
    }, passes=1)
    kinds = [f["event"] for f in frames]
    assert kinds.count("bar") == 2 and "heartbeat" in kinds, kinds
    assert all("id" in f for f in frames), frames
    seqs = [_seq(f)[1] for f in frames]
    assert seqs == list(range(1, len(frames) + 1)), seqs


def test_the_sequence_is_monotonic_ACROSS_connections_of_one_process(monkeypatch):
    """Two connections share one counter, so a later connection's ids are all
    greater — which is what makes a presented id comparable at all."""
    first = _prices(passes=1)
    second = _prices(passes=1)
    assert max(_seq(f)[1] for f in first) < min(_seq(f)[1] for f in second)


def _clock(values):
    it = iter(values)
    last = [values[-1]]

    def now():
        try:
            last[0] = next(it)
        except StopIteration:
            pass
        return last[0]
    return now


# ── no id presented ⇒ no declaration ─────────────────────────────────────────

def test_a_first_connection_is_not_a_resume():
    frames = _prices(passes=1)
    assert all(f["event"] != "resume" for f in frames), frames


# ── an id presented ⇒ the declaration, then what it promised ────────────────

def test_a_reconnect_with_the_HEADER_gets_the_declaration_first_then_the_snapshot():
    earlier = _prices(passes=1)
    last_id = earlier[-1]["id"]

    frames = _prices(passes=1, headers={"last-event-id": last_id})
    assert frames[0]["event"] == "resume", frames
    decl = json.loads(frames[0]["data"])
    assert decl == {
        "type": "resume",
        "stream": "prices",
        "delivery": "last-value-wins",
        "resume": "not_applicable",
        "replayed": 0,
        "replay_window_events": 0,
        "last_event_id": last_id,
        "origin": "this_process",
        "served_instead": "current_snapshot",
    }
    # The declaration carries an id too, newer than the one presented.
    assert _seq(frames[0])[1] > _seq(earlier[-1])[1]
    # ⭐ never claim what cannot be served: the promised snapshot FOLLOWS, and
    # it carries every subscribed ticker.
    snap = [f for f in frames[1:] if f["event"] == "message"]
    assert snap, frames
    assert set(json.loads(snap[0]["data"])) == {"AAPL", "MSFT"}


def test_the_managers_QUERY_door_is_honoured_too():
    earlier = _prices(passes=1)
    frames = _prices(passes=1, last_event_id=earlier[-1]["id"])
    assert frames[0]["event"] == "resume"
    assert json.loads(frames[0]["data"])["origin"] == "this_process"


def test_the_header_wins_over_the_query_parameter():
    earlier = _prices(passes=1)
    frames = _prices(passes=1, headers={"last-event-id": earlier[-1]["id"]},
                     last_event_id="garbage")
    decl = json.loads(frames[0]["data"])
    assert decl["last_event_id"] == earlier[-1]["id"]
    assert decl["origin"] == "this_process"


def test_bars_reconnect_is_declared_and_the_next_bar_per_pair_follows(monkeypatch):
    frames = _bars(monkeypatch, {
        ("AAPL", "5"): [{"sym": "AAPL", "tf": "5", "bar": {"t": 9, "c": 9}}],
    }, passes=1, last_event_id="b00t-0")
    assert frames[0]["event"] == "resume", frames
    decl = json.loads(frames[0]["data"])
    assert decl["stream"] == "bars"
    assert decl["delivery"] == "last-value-wins"
    assert decl["resume"] == "not_applicable" and decl["replayed"] == 0
    assert decl["served_instead"] == "next_bar_per_pair"
    assert decl["origin"] == "this_process"
    # the promised next bar arrives after the declaration
    bars = [f for f in frames[1:] if f["event"] == "bar"]
    assert bars and json.loads(bars[0]["data"])["bar"]["t"] == 9


# ── beyond the window: whose id was it? ─────────────────────────────────────

@pytest.mark.parametrize("presented, origin", [
    ("b00t-1", "this_process"),         # at/below the current sequence
    ("dead-1", "other_process"),        # well-formed, another process (a deploy)
    ("b00t-999999", "unrecognised"),    # a sequence this process never reached
    ("not-an-id", "unrecognised"),
    ("12345", "unrecognised"),
    ("b00t-", "unrecognised"),
])
def test_the_declaration_names_whose_id_it_was(presented, origin):
    stream._event_seq["prices"] = 5
    decl = stream._resume_declaration("prices", presented)
    assert decl["origin"] == origin, decl
    # …and whatever the origin, nothing is claimed as replayed.
    assert decl["resume"] == "not_applicable" and decl["replayed"] == 0


def test_an_absent_or_blank_id_is_not_a_resume():
    assert stream._resume_declaration("prices", None) is None
    assert stream._resume_declaration("prices", "") is None
    # Non-vacuity: the same function DOES answer when handed an id.
    assert stream._resume_declaration("prices", "b00t-0") is not None


def test_an_oversized_id_is_echoed_truncated():
    decl = stream._resume_declaration("bars", "x" * 500)
    assert len(decl["last_event_id"]) == stream._MAX_LAST_EVENT_ID
    assert decl["origin"] == "unrecognised"


def test_the_requested_id_reader_tolerates_a_bare_request_object():
    """The admission tests call the handler with a request carrying no headers;
    the id reader must not turn that into an AttributeError."""

    class _Bare:
        pass

    assert stream._requested_last_event_id(_Bare(), None) is None
    assert stream._requested_last_event_id(_Bare(), "b00t-3") == "b00t-3"
    # a FastAPI `Query(None)` default reaching a direct call is not an id
    assert stream._requested_last_event_id(_Bare(), object()) is None


def test_every_stream_declares_delivery_and_a_served_instead():
    """A stream added to the registry must say what it is and what a resume gets."""
    assert set(stream.STREAM_DELIVERY) == set(stream._SERVED_INSTEAD) == {"prices", "bars"}
    assert set(stream.STREAM_DELIVERY) == set(stream._subscribers)
