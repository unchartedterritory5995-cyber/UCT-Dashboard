"""Pushed list prices: `/api/stream/quotes` (api/routers/quote_stream.py) over the per-symbol price
channel (api/services/quote_hub.py), fed by the ingest feed's per-trade last price (RemoteBroadcaster).

What these rails hold (each drives the code and reads what it produced, never "the constant exists"):
  * a symbol update is SERIALISED ONCE and the same bytes reach every member (shared frames);
  * BY DEFAULT every price change leaves on the ingest batch that brought it: the hub holds nothing
    (owner target 2026-11-25: <= 40 ms p50 from a trade at our servers to the row painted);
  * with the QUOTE_STREAM_MAX_HZ knob set, latest wins and at most max_hz updates a second leave;
  * one write is ONE SSE message carrying every pending quote (one browser event per write);
  * the hub measures how long it held a change (stats()['hold_ms']);
  * the first change after a quiet spell leaves AT ONCE (no timer between a trade and the wire);
  * a member who never reads holds at most ONE frame per symbol (the per-connection bound);
  * a batch from ingest reaches a member's pending bytes inside apply_batch (push, no poll);
  * the route is behind QUOTE_STREAM_ENABLED (default off), admits like the bars stream (503
    at_capacity at the cap), and releases everything it took when the stream ends;
  * stream-edge serves the same route function with only the auth swapped.
"""
import asyncio
import json

import pytest
from fastapi.responses import JSONResponse, StreamingResponse

from api.services import feed_protocol as fp
from api.services import quote_hub as qh
from api.services.remote_broadcaster import RemoteBroadcaster


class Clock:
    def __init__(self, t=1000.0):
        self.t = t

    def __call__(self):
        return self.t


def _hub(clock=None, **kw):
    clock = clock or Clock()
    return qh.QuoteHub(monotonic=clock, wall_ms=lambda: 1_700_000_000_000, schedule=None, **kw), clock


def _q(price, volume=1000, trade_ts=1_700_000_000_000):
    return {"price": price, "ts": trade_ts, "trade_ts": trade_ts, "volume": volume}


def _messages(raw: bytes) -> list:
    out = []
    for block in raw.decode().split("\n\n"):
        for line in block.split("\n"):
            if line.startswith("data: "):
                out.append(json.loads(line[6:]))
    return out


def _frames(raw: bytes) -> list:
    """Every quote in every message: a message is [server write ms, quote, quote, ...]."""
    out = []
    for m in _messages(raw):
        assert isinstance(m, list) and isinstance(m[0], int) and not isinstance(m[0], bool), m
        out.extend(m[1:])
    return out


# ── the frame ────────────────────────────────────────────────────────────────

def test_a_quote_is_one_compact_shared_fragment():
    raw = qh.encode_quote("AAPL", 231.45, 12_345_678, 1_700_000_000_123)
    assert isinstance(raw, bytes)
    assert json.loads(raw) == ["AAPL", 231.45, 12_345_678, 1_700_000_000_123]


def test_one_write_is_ONE_message_carrying_every_pending_quote_and_the_write_time():
    hub, _ = _hub()
    c = hub.open(["AAPL", "MSFT", "NVDA"])
    hub.on_prices({"AAPL": _q(100.0), "MSFT": _q(400.0), "NVDA": _q(150.0)})
    raw = c.take()
    msgs = _messages(raw)
    assert len(msgs) == 1, "one write must be one browser event, not one per quote"
    assert msgs[0][0] == 1_700_000_000_000
    assert sorted(q[0] for q in msgs[0][1:]) == ["AAPL", "MSFT", "NVDA"]
    assert raw.startswith(b"data: ") and raw.endswith(b"\n\n") and raw.count(b"data: ") == 1


# ── serialise once, fan out bytes ────────────────────────────────────────────

def test_one_update_is_SERIALISED_ONCE_and_the_SAME_bytes_reach_every_member():
    hub, _ = _hub()
    conns = [hub.open(["AAPL"]) for _ in range(50)]
    before = hub.counters["serialised"]
    hub.on_prices({"AAPL": _q(100.0)})
    assert hub.counters["serialised"] - before == 1, "the frame was built per member"
    frames = [c.pending["AAPL"] for c in conns]
    assert all(f is frames[0] for f in frames), "members got copies, not one shared frame"
    assert json.loads(frames[0])[:2] == ["AAPL", 100.0]


def test_a_symbol_nobody_subscribed_is_never_serialised():
    hub, _ = _hub()
    hub.open(["AAPL"])
    hub.on_prices({"MSFT": _q(400.0)})
    assert hub.counters["serialised"] == 0


# ── the default: nothing held; every price change leaves on its ingest batch ──

def test_by_DEFAULT_every_price_change_leaves_on_the_batch_that_brought_it():
    hub, clock = _hub()
    assert hub.max_hz == 0, "the default must hold nothing (owner target: <= 40 ms p50 end to end)"
    c = hub.open(["AAPL"])
    got = []
    for i in range(100):                       # 100 ingest batches, 50 ms apart, a new price in each
        hub.on_prices({"AAPL": _q(100.0 + i / 100)})
        got += _frames(c.take())
        clock.t += 0.05
    assert len(got) == 100, len(got)
    assert got[-1][1] == pytest.approx(100.99)
    st = hub.stats()
    assert st["held"] == 0 and st["hold_ms"]["p90"] == 0


def test_the_hub_MEASURES_how_long_it_held_a_change():
    hub, clock = _hub(max_hz=4.0)
    c = hub.open(["AAPL"])
    hub.on_prices({"AAPL": _q(100.0)})
    c.take()
    clock.t += 0.05
    hub.on_prices({"AAPL": _q(100.1)})       # held: changed 50 ms after the last frame
    clock.t += 0.05
    hub.on_prices({"AAPL": _q(100.2)})       # replaces it; the hold counts from the FIRST unsent change
    clock.t += 0.20
    hub.flush()                                 # 250 ms after that first change
    assert _frames(c.take())[0][1] == 100.2
    h = hub.stats()["hold_ms"]
    assert h["n"] == 2 and h["p90"] == pytest.approx(250, abs=1) and h["p50"] == 0


# ── the knob: latest wins, at most max_hz a second ───────────────────────────

def test_the_first_change_after_quiet_leaves_AT_ONCE():
    hub, clock = _hub(max_hz=4.0)
    c = hub.open(["AAPL"])
    hub.on_prices({"AAPL": _q(100.0)})
    assert _frames(c.take())[0][1] == 100.0
    clock.t += 5.0
    hub.on_prices({"AAPL": _q(101.0)})
    assert _frames(c.take())[0][1] == 101.0, "a change after a quiet spell waited for a timer"


def test_inside_the_interval_the_LATEST_wins_and_leaves_when_the_interval_ends():
    hub, clock = _hub(max_hz=4.0)
    c = hub.open(["AAPL"])
    hub.on_prices({"AAPL": _q(100.0)})
    c.take()
    for i, px in enumerate((100.1, 100.2, 100.3)):
        clock.t += 0.05
        hub.on_prices({"AAPL": _q(px)})
    assert c.take() == b"", "an update left inside the 250 ms interval"
    clock.t += 0.25
    hub.flush()
    assert [f[1] for f in _frames(c.take())] == [100.3], "the held update was not the latest"


def test_a_symbol_trading_every_10ms_leaves_at_most_max_hz_frames_a_second():
    hub, clock = _hub(max_hz=4.0)
    c = hub.open(["AAPL"])
    got = []
    for i in range(100):                       # one second of trades, every 10 ms
        hub.on_prices({"AAPL": _q(100.0 + i / 100)})
        got += _frames(c.take())
        clock.t += 0.01
    assert 4 <= len(got) <= 5, len(got)
    clock.t += 0.3
    hub.flush()
    got += _frames(c.take())
    assert got[-1][1] == pytest.approx(100.99), "the last trade of the second never left"


def test_a_volume_only_change_is_held_to_the_slower_volume_cadence():
    hub, clock = _hub(max_hz=4.0, volume_interval_s=1.0)
    c = hub.open(["AAPL"])
    hub.on_prices({"AAPL": _q(100.0, volume=1000)})
    c.take()
    clock.t += 0.3
    hub.on_prices({"AAPL": _q(100.0, volume=1100)})
    assert c.take() == b"", "a volume-only change left at the price cadence"
    clock.t += 0.8
    hub.flush()
    assert _frames(c.take())[0][2] == 1100


def test_an_unchanged_quote_is_not_sent_again():
    hub, clock = _hub(max_hz=4.0)
    c = hub.open(["AAPL"])
    hub.on_prices({"AAPL": _q(100.0)})
    c.take()
    clock.t += 2.0
    hub.on_prices({"AAPL": _q(100.0)})
    assert c.take() == b""


# ── the per-connection bound ─────────────────────────────────────────────────

def test_a_member_who_never_reads_holds_at_most_ONE_frame_per_symbol():
    hub, clock = _hub(max_hz=4.0)
    c = hub.open(["AAPL", "MSFT"])
    for i in range(200):
        hub.on_prices({"AAPL": _q(100 + i), "MSFT": _q(400 + i)})
        clock.t += 0.3
    assert set(c.pending) == {"AAPL", "MSFT"}
    assert json.loads(c.pending["AAPL"])[1] == 299.0, "the pending frame is not the newest"
    assert c.replaced > 0


def test_a_new_member_gets_the_current_quote_at_once():
    hub, _ = _hub()
    hub.open(["AAPL"])
    hub.on_prices({"AAPL": _q(100.0)})
    late = hub.open(["AAPL", "MSFT"], snapshot=lambda s: _q(400.0) if s == "MSFT" else None)
    got = {f[0]: f[1] for f in _frames(late.take())}
    assert got == {"AAPL": 100.0, "MSFT": 400.0}


def test_close_drops_the_member_and_a_symbol_nobody_holds():
    hub, _ = _hub()
    c = hub.open(["AAPL"])
    hub.on_prices({"AAPL": _q(100.0)})
    hub.close(c)
    assert hub.stats()["symbols"] == 0 and hub.stats()["connections"] == 0
    hub.on_prices({"AAPL": _q(101.0)})
    assert c.take() == b""


# ── the push path: ingest batch -> member bytes, no timer ────────────────────

def _batch(seq, prices, connect=True):
    return fp.Batch(epoch=1, seq=seq, prices=prices, status={"connect": connect})


def test_an_ingest_batch_reaches_the_member_INSIDE_apply_batch():
    rb = RemoteBroadcaster()
    hub, _ = _hub()
    assert qh.hub_for(rb, hub=hub) is hub
    rb.add_interest(["AAPL"])
    c = hub.open(["AAPL"])
    rb.apply_batch(_batch(1, {"AAPL": _q(123.45, trade_ts=1_700_000_000_500)}))
    f = _frames(c.take())
    assert f and f[0][:4] == ["AAPL", 123.45, 1000, 1_700_000_000_500]


def test_hub_for_refuses_a_broadcaster_without_the_price_sink():
    class Local:
        pass
    assert qh.hub_for(Local()) is None


# ── the route ────────────────────────────────────────────────────────────────

class _Req:
    async def is_disconnected(self):
        return False


@pytest.fixture
def route(monkeypatch):
    from api.routers import quote_stream, stream
    from api.services import bar_broadcaster as bbm
    monkeypatch.setattr(stream, "_subscribers", {"prices": set(), "bars": set()})
    rb = RemoteBroadcaster()
    monkeypatch.setattr(bbm, "_singleton", rb, raising=False)
    hub, clock = _hub()
    monkeypatch.setattr(qh, "_hub", hub, raising=False)
    monkeypatch.setenv("QUOTE_STREAM_ENABLED", "1")
    return quote_stream, stream, rb, hub, clock


def _open(qs, tickers="AAPL,MSFT"):
    return asyncio.run(qs.stream_quotes(_Req(), tickers=tickers, _access={}))


def test_the_stream_is_OFF_unless_the_flag_is_set(route, monkeypatch):
    qs = route[0]
    monkeypatch.delenv("QUOTE_STREAM_ENABLED")
    r = _open(qs)
    assert isinstance(r, JSONResponse) and r.status_code == 503
    assert b"disabled" in r.body
    assert route[1].subscriber_count("quotes") == 0


def test_the_stream_refuses_at_the_shared_subscriber_cap(route, monkeypatch):
    qs, stream = route[0], route[1]
    monkeypatch.setattr(stream, "MAX_SUBSCRIBERS", 2)
    assert isinstance(_open(qs), StreamingResponse)
    assert isinstance(_open(qs), StreamingResponse)
    r = _open(qs)
    assert isinstance(r, JSONResponse) and r.status_code == 503 and b"at_capacity" in r.body
    assert stream.subscriber_count("quotes") == 2


def test_the_symbol_list_is_capped_deduped_and_validated(route):
    qs, _s, rb = route[0], route[1], route[2]
    many = ",".join(f"T{i:04d}" for i in range(qs.MAX_QUOTE_SYMBOLS + 40)) + ",aapl,AAPL,bad sym,"
    r = _open(qs, many)
    assert isinstance(r, StreamingResponse)
    assert len(rb._interest) == qs.MAX_QUOTE_SYMBOLS
    assert isinstance(_open(qs, " , ,"), JSONResponse)


def test_the_generator_pushes_hello_status_snapshot_and_live_frames_then_releases(route):
    qs, stream, rb, hub, clock = route

    async def go():
        rb.apply_batch(_batch(1, {}))                         # the feed is fresh
        resp = await qs.stream_quotes(_Req(), tickers="AAPL", _access={})
        it = resp.body_iterator
        first = await it.__anext__()
        assert b"event: hello" in (first if isinstance(first, bytes) else first.encode())
        st = await it.__anext__()
        assert b'event: status\ndata: {"live": true}' in (st if isinstance(st, bytes) else st.encode())
        rb.apply_batch(_batch(2, {"AAPL": _q(55.5)}))
        chunk = await asyncio.wait_for(it.__anext__(), 2.0)
        assert _frames(chunk)[0][:2] == ["AAPL", 55.5]
        assert stream.subscriber_count("quotes") == 1 and rb._interest.get("AAPL") == 1
        await it.aclose()
        assert stream.subscriber_count("quotes") == 0, "the admission slot was not released"
        assert "AAPL" not in rb._interest, "the upstream interest was not released"
        assert hub.stats()["connections"] == 0
    asyncio.run(go())


def test_the_generator_says_live_false_when_the_feed_goes_quiet(route):
    qs, _s, rb, _h, _c = route

    async def go():
        rb.apply_batch(_batch(1, {}, connect=False))          # ingest says its vendor socket is down
        resp = await qs.stream_quotes(_Req(), tickers="AAPL", _access={})
        it = resp.body_iterator
        await it.__anext__()
        st = await it.__anext__()
        assert b'{"live": false}' in (st if isinstance(st, bytes) else st.encode())
        await it.aclose()
    asyncio.run(go())


# ── stream-edge serves it too ────────────────────────────────────────────────

def test_stream_edge_serves_the_same_quotes_route_with_only_auth_swapped():
    from api import stream_edge_main as se
    from api.bars_auth import require_bars_access
    from api.routers import quote_stream
    app = se.build_app(start_feed=False)
    routes = {r.path: r for r in app.routes if hasattr(r, "endpoint")}
    assert routes["/api/stream/quotes"].endpoint is quote_stream.stream_quotes
    assert app.dependency_overrides[require_bars_access] is se.edge_access


def test_web_mounts_the_quotes_route():
    import pathlib
    src = (pathlib.Path(__file__).resolve().parents[1] / "api" / "main.py").read_text(encoding="utf-8")
    assert "quote_stream" in src and "include_router(quote_stream" in src


def test_the_edge_cookie_reaches_the_quotes_stream_and_nothing_wider():
    from api import chart_edge_token as cet
    p = cet.QUOTES_COOKIE_PATH
    assert p == "/api/stream/quotes"
    assert p in cet.COOKIE_PATHS
