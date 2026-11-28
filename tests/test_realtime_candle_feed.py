"""The live candle behind /api/stream/prices' `tick` / `bar_close` / `bar_correction` events is fed by the
LICENSED Massive feed (api/services/realtime_candle_feed.py), so the Finnhub free-tier socket is no longer
needed for them. While both run, one print is never counted twice (one source per symbol + a handover
floor). With FINNHUB_STREAM_ENABLED=0 every field a client read before is still on the wire."""
import asyncio
import json

import pytest

from api.services import realtime_candle, realtime_candle_feed as F, realtime_stream as RS, stream_prev_close as PC

T = 1_794_934_800_000          # a minute start, epoch ms
TS = T // 1000


@pytest.fixture(autouse=True)
def clean(monkeypatch):
    monkeypatch.setenv("STREAM_CANDLE_MASSIVE_ENABLED", "1")   # the switch ON unless a test says off
    F._reset()
    PC._reset()
    realtime_candle._reset()
    monkeypatch.setattr(RS, "_subscribed", set())
    monkeypatch.setattr(RS, "_sub_counts", __import__("collections").Counter())
    monkeypatch.setattr(RS, "_prices", {})
    monkeypatch.setattr(RS, "_last_seen", {})
    yield
    F._reset()
    PC._reset()
    realtime_candle._reset()


def watch(*syms):
    RS._subscribed.update(syms)


def finnhub(sym, p, t_ms, v):
    RS._process_finnhub_trade({"s": sym, "p": p, "t": t_ms, "v": v})


# ── the dedupe rule ───────────────────────────────────────────────────────────

def test_finnhub_alone_feeds_every_print_as_before():
    """Massive never seen for the symbol (bars feed off): Finnhub is always let through, no floor."""
    for i in range(5):
        assert F.admit("AAA", F.SOURCE_FINNHUB, T + i * 100, now=10.0 + i) is True
    assert F.status()["finnhub_applied"] == 5 and F.status()["handovers"] == 0


def test_massive_owns_a_symbol_while_it_is_live_and_finnhub_is_refused():
    assert F.admit("AAA", F.SOURCE_MASSIVE, T, now=100.0)
    assert F.admit("AAA", F.SOURCE_FINNHUB, T + 5_000, now=100.0 + F.MASSIVE_SILENT_S - 0.1) is False
    assert F.status()["finnhub_refused_massive_live"] == 1


def test_finnhub_takes_over_only_after_massive_is_silent_and_starts_past_the_floor():
    assert F.admit("AAA", F.SOURCE_MASSIVE, T, now=100.0)
    later = 100.0 + F.MASSIVE_SILENT_S + 1
    # a Finnhub copy of a print Massive already counted, or one inside the margin: refused
    assert F.admit("AAA", F.SOURCE_FINNHUB, T, now=later) is False
    assert F.admit("AAA", F.SOURCE_FINNHUB, T + F.HANDOVER_MARGIN_MS - 1, now=later) is False
    assert F.admit("AAA", F.SOURCE_FINNHUB, T + F.HANDOVER_MARGIN_MS, now=later) is True
    assert F.status()["handovers"] == 1


def test_massive_takes_back_a_symbol_at_once_with_the_same_floor():
    assert F.admit("AAA", F.SOURCE_FINNHUB, T, now=1.0)                 # Finnhub fed first
    assert F.admit("AAA", F.SOURCE_MASSIVE, T, now=2.0) is False         # the same print from Massive
    assert F.admit("AAA", F.SOURCE_MASSIVE, T + F.HANDOVER_MARGIN_MS, now=2.1) is True
    assert F.admit("AAA", F.SOURCE_FINNHUB, T + 10_000, now=2.2) is False   # Massive now owns it


def test_symbols_are_independent():
    assert F.admit("AAA", F.SOURCE_MASSIVE, T, now=1.0)
    assert F.admit("BBB", F.SOURCE_FINNHUB, T, now=1.0) is True


# ── the candle from Massive prints (local mode) ───────────────────────────────

def test_massive_prints_build_the_candle_on_every_timeframe():
    watch("AAA")
    F.on_trade("AAA", {"t": T + 1_000, "p": 10.0, "s": 100})
    F.on_trade("AAA", {"t": T + 2_000, "p": 10.3, "s": 200})
    F.on_trade("AAA", {"t": T + 3_000, "p": 9.9, "s": 50})
    F.on_trade("AAA", {"t": T + 4_000, "p": 10.1, "s": 25})
    c = realtime_candle.get_current("AAA", "1")
    assert (c["t"], c["o"], c["h"], c["l"], c["c"], c["v"]) == (TS, 10.0, 10.3, 9.9, 10.1, 375)
    for tf in ("5", "15", "30", "60"):
        assert realtime_candle.get_current("AAA", tf)["v"] == 375


def test_a_symbol_nobody_watches_on_the_price_stream_is_not_fed():
    F.on_trade("ZZZ", {"t": T, "p": 10.0, "s": 100})
    assert realtime_candle.get_current("ZZZ", "1") is None


def test_sip_conditions_are_honoured_like_the_chart_push_feed():
    watch("AAA")
    F.on_trade("AAA", {"t": T + 1_000, "p": 10.0, "s": 100})
    F.on_trade("AAA", {"t": T + 2_000, "p": 10.4, "s": 7, "c": [37]})   # odd lot: size only
    F.on_trade("AAA", {"t": T + 3_000, "p": 10.2, "s": 900, "c": [16]})  # official open: last only, no size
    c = realtime_candle.get_current("AAA", "1")
    assert c["h"] == 10.0 and c["c"] == 10.2 and c["v"] == 107


def test_the_next_minute_closes_the_bar_and_the_stream_emits_unchanged_shapes():
    from api.routers import stream as S
    watch("AAA")
    state = {}
    F.on_trade("AAA", {"t": T + 1_000, "p": 10.0, "s": 100})
    F.on_trade("AAA", {"t": T + 2_000, "p": 10.3, "s": 100})
    ev = S._build_candle_events(["AAA"], state)
    assert [e["type"] for e in ev] == ["tick"]
    assert set(ev[0]) == {"type", "sym", "price", "ts", "vol"} and ev[0]["vol"] == 200
    F.on_trade("AAA", {"t": T + 61_000, "p": 10.1, "s": 10})
    ev = S._build_candle_events(["AAA"], state)
    assert [e["type"] for e in ev] == ["bar_close", "tick"]
    bar = ev[0]["bar"]
    assert {k: bar[k] for k in ("t", "o", "h", "l", "c", "v")} == {
        "t": TS, "o": 10.0, "h": 10.3, "l": 10.0, "c": 10.3, "v": 200}


def test_a_bad_print_never_raises_out_of_the_listener():
    watch("AAA")
    F.on_trade("AAA", {"t": "x", "p": None})
    F.on_trade("AAA", {})
    assert realtime_candle.get_current("AAA", "1") is None


# ── both feeds on: no double count ────────────────────────────────────────────

def test_with_both_feeds_on_every_print_is_counted_once():
    """The same tape from both sockets, interleaved: Massive first for some prints, Finnhub first for
    others. The candle's volume is the tape's volume once, never twice."""
    watch("AAA")
    tape = [(T + 1_000, 10.0, 100), (T + 2_000, 10.2, 200), (T + 3_000, 10.1, 300), (T + 4_000, 10.3, 400)]
    for i, (t, p, v) in enumerate(tape):
        if i % 2:
            finnhub("AAA", p, t, v)
            F.on_trade("AAA", {"t": t, "p": p, "s": v})
        else:
            F.on_trade("AAA", {"t": t, "p": p, "s": v})
            finnhub("AAA", p, t, v)
    assert realtime_candle.get_current("AAA", "1")["v"] == 1000
    # and Finnhub's own price store still moves exactly as before (only the candle is arbitrated)
    assert RS._prices["AAA"]["price"] == 10.3


def test_a_finnhub_head_start_hands_over_without_counting_the_shared_print_twice():
    watch("AAA")
    finnhub("AAA", 10.0, T + 1_000, 100)               # Finnhub connected first
    F.on_trade("AAA", {"t": T + 1_000, "p": 10.0, "s": 100})   # Massive's copy of that print
    F.on_trade("AAA", {"t": T + 5_000, "p": 10.2, "s": 50})
    assert realtime_candle.get_current("AAA", "1")["v"] == 150


# ── remote mode: the ingest batch quotes ──────────────────────────────────────

def test_remote_quotes_build_the_candle_with_day_volume_deltas_and_skip_repeats():
    watch("AAA")
    F.on_quotes({"AAA": {"price": 10.0, "trade_ts": T + 1_000, "volume": 5_000}})
    F.on_quotes({"AAA": {"price": 10.4, "trade_ts": T + 2_000, "volume": 5_300}})
    F.on_quotes({"AAA": {"price": 10.4, "trade_ts": T + 2_000, "volume": 5_300}})   # repeat
    F.on_quotes({"AAA": {"price": 10.1, "trade_ts": T + 3_000, "volume": 5_450}})
    F.on_quotes({"AAA": {"price": 10.1, "trade_ts": None, "volume": 5_500}})        # no trade time
    c = realtime_candle.get_current("AAA", "1")
    assert (c["o"], c["h"], c["l"], c["c"], c["v"]) == (10.0, 10.4, 10.0, 10.1, 450)
    assert F.status()["quotes_repeat"] == 1
    assert F.status()["massive_applied"] == 3          # a repeat never reaches the candle again


def test_the_remote_broadcaster_hands_each_batch_to_the_candle_sink():
    from api.services import feed_protocol as fp
    from api.services.remote_broadcaster import RemoteBroadcaster
    watch("AAA")
    rb = RemoteBroadcaster()
    assert F.install(rb) == "remote" and rb.candle_sink is F.on_quotes
    rb.add_interest(["AAA"])
    rb.apply_batch(fp.Batch(epoch=1, seq=1, prices={"AAA": {"price": 10.0, "ts": T, "trade_ts": T + 1_000,
                                                            "volume": 10}}))
    assert realtime_candle.get_current("AAA", "1")["c"] == 10.0
    # a failing sink never breaks the mirror
    rb.candle_sink = lambda q: 1 / 0
    rb.apply_batch(fp.Batch(epoch=1, seq=2, prices={"AAA": {"price": 10.1, "ts": T, "trade_ts": T + 2_000,
                                                            "volume": 11}}))
    assert rb.counters["candle_sink_errors"] == 1 and rb.get_last_price("AAA")["price"] == 10.1


def test_install_wires_the_local_listener_and_ignores_stubs():
    from api.services import bar_broadcaster, bar_stream
    assert F.install(None) is None
    assert F.install(object()) is None
    bb = bar_broadcaster.BarBroadcaster()
    try:
        assert F.install(bb) == "local" and F.install(bb) == "local"
        assert bar_stream._trade_listeners.count(F.on_trade) == 1
    finally:
        bar_stream.remove_trade_listener(F.on_trade)


# ── the day % fields from the licensed previous close ─────────────────────────

def test_fill_adds_the_day_change_only_where_finnhub_gave_none():
    e = {"price": 11.0, "trade_ts": T, "updated_at": TS}
    assert PC.fill_day_change(e, 10.0) is True
    assert e["change_pct"] == 10.0 and e["change"] == 1.0 and e["timestamp"] == T
    fh = {"price": 11.0, "change_pct": 0.5, "change": 0.05, "timestamp": T - 9}
    assert PC.fill_day_change(fh, 10.0) is False and fh == {"price": 11.0, "change_pct": 0.5, "change": 0.05,
                                                            "timestamp": T - 9}
    none = {"price": 11.0}
    assert PC.fill_day_change(none, None) is False and "change_pct" not in none   # never invented
    assert PC.fill_day_change({"price": 0}, 10.0) is False


def test_prev_close_is_read_once_per_retry_window_refreshed_and_dropped_when_old(monkeypatch):
    calls = []
    monkeypatch.setattr(PC, "_fetch", lambda syms: calls.append(list(syms)) or {
        s: {"prev_close": 10.0} for s in syms if s != "NOPE"})
    assert PC.want(["AAA", "NOPE"], now=0.0, start=False) == 2
    PC._drain()
    assert calls == [["AAA", "NOPE"]] and PC._worker["running"] is False
    PC._known["AAA"] = (10.0, 0.0)
    assert PC.get("AAA", now=1.0) == 10.0 and PC.get("NOPE", now=1.0) is None
    assert PC.want(["AAA", "NOPE"], now=30.0, start=False) == 0          # fresh / tried a moment ago
    assert PC.want(["NOPE"], now=PC.RETRY_S + 1, start=False) == 1        # retried after a minute
    assert PC.want(["AAA"], now=PC.REFRESH_S + 1, start=False) == 1       # refreshed after ten
    assert PC.get("AAA", now=PC.MAX_AGE_S + 1) is None                    # too old: missing, not stale


# ── the real handler with the Finnhub socket off ──────────────────────────────

def _drive(monkeypatch, live, tickers="AAA"):
    from api.routers import stream as S
    from api.services import bar_broadcaster as bb

    class Req:
        headers = {}
        closed = False

        async def is_disconnected(self):
            return self.closed

    monkeypatch.setattr(S, "_subscribers", {"prices": set(), "bars": set()})
    monkeypatch.setattr(S, "_event_seq", {"prices": 0, "bars": 0})
    monkeypatch.setattr(realtime_candle, "_correction_subscribers", {})
    monkeypatch.setattr(bb, "get_broadcaster", lambda: live)
    monkeypatch.setattr(PC, "want", lambda syms, **k: 0)

    async def go():
        req = Req()
        resp = await S.stream_prices(req, tickers=tickers, last_event_id=None)
        chunks = []

        async def drain():
            async for c in resp.body_iterator:
                chunks.append(c if isinstance(c, str) else c.decode())
        task = asyncio.create_task(drain())
        await asyncio.sleep(0.05)
        live.during()                     # prints arrive while the connection is open
        await asyncio.sleep(0.4)
        req.closed = True
        await asyncio.wait_for(task, 5)
        return "".join(chunks)

    frames = []
    for block in asyncio.run(go()).split("\n\n"):
        ev, data = "message", None
        for line in block.split("\n"):
            if line.startswith("event: "):
                ev = line[7:]
            elif line.startswith("data: "):
                data = line[6:]
        if data:
            try:
                frames.append((ev, json.loads(data)))
            except ValueError:
                pass
    return frames


def test_with_finnhub_off_quotes_keep_every_field_and_the_tick_events_keep_coming(monkeypatch):
    monkeypatch.setenv("FINNHUB_STREAM_ENABLED", "0")
    assert RS.stream_enabled() is False and RS._prices == {}       # nothing from Finnhub at all
    PC.remember("AAA", 10.0)

    class Live:
        def get_last_price(self, sym):
            return {"price": 10.5, "trade_ts": T + 2_000, "volume": 900} if sym == "AAA" else None

        def add_interest(self, syms):
            pass

        def remove_interest(self, syms):
            pass

        def during(self):
            F.on_trade("AAA", {"t": T + 1_000, "p": 10.4, "s": 100})
            F.on_trade("AAA", {"t": T + 2_000, "p": 10.5, "s": 100})

    frames = _drive(monkeypatch, Live())
    quotes = [d["AAA"] for ev, d in frames if ev == "message" and isinstance(d, dict) and "AAA" in d]
    assert quotes, frames
    q = quotes[-1]
    # every field the Finnhub-fed entry carried (realtime_stream._STREAM_FIELDS) plus the overlay's
    assert RS._STREAM_FIELDS <= set(q)
    assert q["price"] == 10.5 and q["change_pct"] == 5.0 and q["change"] == 0.5 and q["timestamp"] == T + 2_000
    ticks = [d for ev, d in frames if ev == "tick"]
    assert ticks and ticks[-1]["sym"] == "AAA" and ticks[-1]["price"] == 10.5 and ticks[-1]["vol"] == 200
    assert "AAA" not in RS._subscribed                              # released on disconnect


def test_with_finnhub_on_its_entry_is_sent_exactly_as_before(monkeypatch):
    monkeypatch.delenv("FINNHUB_STREAM_ENABLED", raising=False)
    PC.remember("AAA", 10.0)
    RS._prices["AAA"] = {"price": 10.2, "change_pct": 0.1, "change": 0.01, "timestamp": T + 9_000,
                         "updated_at": TS + 9, "prev_close": 10.19}

    class Live:
        def get_last_price(self, sym):
            return None

        def add_interest(self, syms):
            pass

        def remove_interest(self, syms):
            pass

        def during(self):
            pass

    frames = _drive(monkeypatch, Live())
    q = [d["AAA"] for ev, d in frames if ev == "message" and isinstance(d, dict) and "AAA" in d][-1]
    assert q == {"price": 10.2, "change_pct": 0.1, "change": 0.01, "timestamp": T + 9_000, "updated_at": TS + 9}


# ── the switch: STREAM_CANDLE_MASSIVE_ENABLED, default OFF = master's behaviour ──

def _tape_through_both(off_env, monkeypatch):
    if off_env is None:
        monkeypatch.delenv("STREAM_CANDLE_MASSIVE_ENABLED", raising=False)
    else:
        monkeypatch.setenv("STREAM_CANDLE_MASSIVE_ENABLED", off_env)
    watch("AAA")
    tape = [(T + 1_000, 10.0, 100), (T + 2_000, 10.2, 200), (T + 3_000, 10.1, 300)]
    for t, p, v in tape:
        F.on_trade("AAA", {"t": t, "p": p, "s": v})
        F.on_quotes({"AAA": {"price": p, "trade_ts": t, "volume": v}})
        finnhub("AAA", p, t, v)
    return realtime_candle.get_current("AAA", "1")


@pytest.mark.parametrize("off", [None, "", "0", "false", "off", "anything"])
def test_switched_off_the_candle_is_the_finnhub_only_candle_of_master(monkeypatch, off):
    got = _tape_through_both(off, monkeypatch)
    # master's candle: the same Finnhub prints, nothing else (realtime_stream before this change)
    expect = {"t": TS, "o": 10.0, "h": 10.2, "l": 10.0, "c": 10.1, "v": 600, "last_tick_ts": TS + 3}
    assert got == expect
    assert F._owner == {} and F._last_applied_ms == {} and F._massive_seen == {}   # nothing recorded
    assert F.enabled() is False and F.status()["enabled"] is False


def test_switched_off_install_hooks_nothing(monkeypatch):
    from api.services import bar_broadcaster, bar_stream
    from api.services.remote_broadcaster import RemoteBroadcaster
    monkeypatch.setenv("STREAM_CANDLE_MASSIVE_ENABLED", "0")
    rb = RemoteBroadcaster()
    assert F.install(rb) is None and rb.candle_sink is None
    before = list(bar_stream._trade_listeners)
    assert F.install(bar_broadcaster.BarBroadcaster()) is None
    assert bar_stream._trade_listeners == before


def test_turning_it_off_quiets_a_listener_hooked_while_on(monkeypatch):
    watch("AAA")
    F.on_trade("AAA", {"t": T + 1_000, "p": 10.0, "s": 100})
    monkeypatch.setenv("STREAM_CANDLE_MASSIVE_ENABLED", "0")
    F.on_trade("AAA", {"t": T + 2_000, "p": 10.2, "s": 100})
    F.on_quotes({"AAA": {"price": 10.3, "trade_ts": T + 3_000, "volume": 1}})
    assert realtime_candle.get_current("AAA", "1")["v"] == 100
