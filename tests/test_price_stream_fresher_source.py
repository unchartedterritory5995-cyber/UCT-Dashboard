"""The price stream sends the FRESHER of the live (Massive) and Finnhub quotes (2026-11-17 audit, gap 2:
stale shown as live). A symbol whose live trades stop arriving while the vendor socket is up must not
hold a frozen price while Finnhub's own trades move on."""
from api.routers import stream as S

T = 1_794_934_800_000          # a trade time, epoch ms


def test_the_live_quote_overlays_finnhub_when_it_is_as_new_or_newer():
    cur = {"AAA": {"price": 10.0, "timestamp": T - 5_000, "change_pct": 1.0}}
    S._overlay_live(cur, "AAA", {"price": 10.2, "trade_ts": T, "volume": 900})
    assert cur["AAA"]["price"] == 10.2 and cur["AAA"]["volume"] == 900
    assert cur["AAA"]["trade_ts"] == T and cur["AAA"]["updated_at"] == T // 1000
    assert cur["AAA"]["change_pct"] == 1.0                       # only price / volume / time are overlaid


def test_a_clearly_newer_finnhub_trade_keeps_its_own_price():
    cur = {"AAA": {"price": 11.0, "timestamp": T + S.FRESHER_SOURCE_MARGIN_MS + 1}}
    S._overlay_live(cur, "AAA", {"price": 10.2, "trade_ts": T, "volume": 900})
    assert cur["AAA"] == {"price": 11.0, "timestamp": T + S.FRESHER_SOURCE_MARGIN_MS + 1}
    # within the margin the live feed still wins (the two stamp one print about a second apart)
    cur = {"AAA": {"price": 11.0, "timestamp": T + S.FRESHER_SOURCE_MARGIN_MS}}
    S._overlay_live(cur, "AAA", {"price": 10.2, "trade_ts": T})
    assert cur["AAA"]["price"] == 10.2


def test_a_finnhub_time_in_seconds_is_read_as_seconds():
    cur = {"AAA": {"price": 11.0, "timestamp": (T // 1000) + 10}}     # the tick recorder writes seconds
    S._overlay_live(cur, "AAA", {"price": 10.2, "trade_ts": T})
    assert cur["AAA"]["price"] == 11.0


def test_without_a_time_on_either_side_the_live_quote_overlays_as_before():
    cur = {"AAA": {"price": 11.0}}
    S._overlay_live(cur, "AAA", {"price": 10.2, "trade_ts": T})
    assert cur["AAA"]["price"] == 10.2
    cur = {"AAA": {"price": 11.0, "timestamp": T + 60_000}}
    S._overlay_live(cur, "AAA", {"price": 10.2})                       # no live trade time: overlaid
    assert cur["AAA"]["price"] == 10.2 and isinstance(cur["AAA"]["updated_at"], int)
    cur = {}
    S._overlay_live(cur, "BBB", {"price": 5.0, "trade_ts": T})          # no Finnhub entry at all
    assert cur["BBB"]["price"] == 5.0
    S._overlay_live(cur, "CCC", None)                                   # no live quote: nothing
    S._overlay_live(cur, "CCC", {"price": None})
    assert "CCC" not in cur


def test_trade_ms_reads_either_unit_and_refuses_non_times():
    assert S._trade_ms(T) == T and S._trade_ms(T // 1000) == (T // 1000) * 1000
    assert S._trade_ms(None) is None and S._trade_ms("x") is None and S._trade_ms(0) is None
    assert S._trade_ms(float("nan")) is None


def test_the_real_price_stream_sends_the_fresher_quote_per_symbol(monkeypatch):
    """Drives the REAL /api/stream/prices handler (as test_price_stream_correction_fanout does): AAA's
    live trade is the newer, BBB's live flow stopped while Finnhub moved on."""
    import asyncio
    import json
    from api.services import bar_broadcaster as bb
    from api.services import realtime_candle

    class Req:
        headers = {}
        closed = False

        async def is_disconnected(self):
            return self.closed

    class Live:
        def get_last_price(self, sym):
            return {"AAA": {"price": 10.2, "trade_ts": T}, "BBB": {"price": 20.0, "trade_ts": T - 60_000}}.get(sym)

        def add_interest(self, syms):
            pass

        def remove_interest(self, syms):
            pass

    finnhub = {"AAA": {"price": 10.0, "timestamp": T - 3_000}, "BBB": {"price": 21.5, "timestamp": T}}
    monkeypatch.setattr(S, "_subscribers", {"prices": set(), "bars": set()})
    monkeypatch.setattr(S, "_event_seq", {"prices": 0, "bars": 0})
    monkeypatch.setattr(S, "subscribe_tickers", lambda syms: None)
    monkeypatch.setattr(S, "unsubscribe_tickers", lambda syms: None)
    monkeypatch.setattr(S, "get_realtime_prices", lambda syms: {s: dict(finnhub[s]) for s in syms if s in finnhub})
    monkeypatch.setattr(S.realtime_candle, "get_current", lambda sym, tf: None)
    monkeypatch.setattr(S.realtime_stream, "get_last_seen", lambda sym: None)
    monkeypatch.setattr(realtime_candle, "_correction_subscribers", {})
    monkeypatch.setattr(bb, "get_broadcaster", lambda: Live())

    async def go():
        req = Req()
        resp = await S.stream_prices(req, tickers="AAA,BBB", last_event_id=None)
        chunks = []

        async def drain():
            async for c in resp.body_iterator:
                chunks.append(c if isinstance(c, str) else c.decode())
        task = asyncio.create_task(drain())
        await asyncio.sleep(0.4)
        req.closed = True
        await asyncio.wait_for(task, 5)
        return "".join(chunks)

    text = asyncio.run(go())
    sent = {}
    for block in text.split("\n\n"):
        for line in block.split("\n"):
            if line.startswith("data: ") and "price" in line:
                try:
                    d = json.loads(line[6:])
                except ValueError:
                    continue
                for sym, e in (d.items() if isinstance(d, dict) else ()):
                    if isinstance(e, dict) and "price" in e:
                        sent[sym] = e["price"]
    assert sent.get("AAA") == 10.2          # the live trade is the newer
    assert sent.get("BBB") == 21.5          # the live flow stopped a minute ago: Finnhub's newer trade