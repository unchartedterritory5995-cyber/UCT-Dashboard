"""Timestamps that let a member's trade-to-pixel latency be split hop by hop (2026-11-25, objective 2).

Before this, a browser could read only the vendor's trade time (`bar.trade_ts`) and the edge pod's
`rev`; nothing said when ingest sent a batch or when the SSE frame left the pod, and a
/api/live-prices row carried only `observed_at`. All fields here are ADDITIVE: an old client
ignores them, and none of them changes a value an old client reads.

  SSE bar frame   `sent_ms`         pod wall ms when the frame is serialised (stream._contract_event)
  ingest wire     batch `ts`        ingest wall ms when the batch is drained for one client; sent only
                                    with INGEST_BATCH_TS=1 (the consumers' parser must be deployed
                                    first: an unknown field is refused, see _parse_batch)
  SSE bar frame   `ingest_ms`       that batch ts, carried onto every frame relayed from the batch
  /api/live-prices row  `observed_ms` (vendor observation, ms), `last_trade_ms` (the last trade's
                  own time, ms), `fetched_at_ms` (when this pod got the row from the vendor: a row
                  served from the 15 s cache keeps the time it was fetched)
"""
import asyncio
import time

import pytest

from api.services import feed_protocol as fp


# ── SSE: sent_ms ─────────────────────────────────────────────────────────────

class _Contract:
    def __init__(self, raises=False):
        self.raises = raises

    def stream_fields(self, sym, tf, session):
        if self.raises:
            raise RuntimeError("identity unavailable")
        return {"contract": 1, "series_rev": 5}


MSG = {"sym": "AAA", "tf": "1", "bar": {"t": 1_800_000_000_000, "o": 1, "h": 1, "l": 1, "c": 1, "v": 1,
                                        "final": False, "trade_ts": 1_799_999_999_900}, "rev": 1_800_000_000_050}


def test_every_bar_frame_carries_the_time_it_left_the_pod():
    from api.routers import stream
    before = int(time.time() * 1000)
    out = stream._contract_event(_Contract(), dict(MSG), "rth")
    after = int(time.time() * 1000)
    assert isinstance(out.get("sent_ms"), int)
    assert before <= out["sent_ms"] <= after
    # additive: everything the frame carried before is unchanged
    for k in ("sym", "tf", "bar", "rev"):
        assert out[k] == MSG[k]
    assert out["series_rev"] == 5


def test_a_frame_whose_identity_lookup_fails_still_carries_its_send_time():
    from api.routers import stream
    out = stream._contract_event(_Contract(raises=True), dict(MSG), "rth")
    assert isinstance(out.get("sent_ms"), int)
    assert out["bar"] == MSG["bar"]


# ── ingest wire: batch ts ────────────────────────────────────────────────────

def _bar(t, c):
    return {"t": t, "o": c, "h": c, "l": c, "c": c, "v": 1}


def test_a_batch_without_ts_is_on_the_wire_exactly_as_before():
    b = fp.Batch(epoch=1, seq=1, bars=(fp.BarUpdate("ZZA", "1", _bar(1_800_000_000_000, 1.0), False),))
    assert "ts" not in fp.to_wire(b)
    assert fp.decode(fp.encode(b)).ts is None


def test_a_batch_carries_its_send_time_through_the_wire():
    b = fp.Batch(epoch=1, seq=1, ts=1_800_000_000_123)
    assert fp.to_wire(b)["ts"] == 1_800_000_000_123
    assert fp.decode(fp.encode(b)).ts == 1_800_000_000_123


@pytest.mark.parametrize("bad", ["soon", -1, 1.5, True])
def test_a_bad_batch_ts_is_refused(bad):
    wire = {"v": fp.PROTOCOL_VERSION, "k": "batch", "epoch": 1, "seq": 1, "ts": bad}
    with pytest.raises(fp.MalformedMessage):
        fp.parse(wire)


def _flush_once(monkeypatch, env):
    from api.services import ingest_feed_server as ifs
    from tests.test_stream_ingest_skeleton import FakeConn, SECRET
    if env is None:
        monkeypatch.delenv("INGEST_BATCH_TS", raising=False)
    else:
        monkeypatch.setenv("INGEST_BATCH_TS", env)

    async def go():
        srv = ifs.IngestFeedServer(secret=SECRET, epoch=7)
        conn = FakeConn()
        buf = fp.CoalescingBuffer(7)
        buf.offer_bar("ZZA", "1", _bar(1_800_000_000_000, 1.0), False)
        client = ifs._Client(client_id="web-1", conn=conn, buffer=buf, connected_at=0.0)
        before = int(time.time() * 1000)
        assert await srv.flush_client(client)
        after = int(time.time() * 1000)
        return conn.sent[0], before, after
    return asyncio.run(go())


def test_ingest_stamps_each_batch_it_sends_when_switched_on(monkeypatch):
    sent, before, after = _flush_once(monkeypatch, "1")
    assert isinstance(sent, fp.Batch) and sent.ts is not None
    assert before <= sent.ts <= after


@pytest.mark.parametrize("env", [None, "0", ""])
def test_ingest_sends_no_ts_until_switched_on(monkeypatch, env):
    sent, _, _ = _flush_once(monkeypatch, env)
    assert sent.ts is None


# ── the edge's relay: ingest_ms on frames ─────────────────────────────────────

def _rb():
    from api.services.remote_broadcaster import RemoteBroadcaster
    return RemoteBroadcaster(on_first_subscribe=lambda s: None, on_last_unsubscribe=lambda s: None,
                             clock_ms=lambda: 1_800_000_000_200, monotonic=lambda: 100.0)


def _drain(q):
    out = []
    while not q.empty():
        out.append(q.get_nowait())
    return out


def test_frames_relayed_from_a_stamped_batch_carry_ingest_ms():
    async def go():
        rb = _rb()
        q = rb.subscribe("ZZA", "1", v2=True)
        _drain(q)
        rb.apply_batch(fp.Batch(epoch=1, seq=1, ts=1_800_000_000_150,
                                bars=(fp.BarUpdate("ZZA", "1", _bar(1_800_000_000_000, 1.0), False),)))
        return _drain(q)
    frames = asyncio.run(go())
    assert frames and all(f.get("ingest_ms") == 1_800_000_000_150 for f in frames)


def test_frames_from_an_unstamped_batch_are_exactly_as_before():
    async def go():
        rb = _rb()
        q = rb.subscribe("ZZA", "1", v2=True)
        _drain(q)
        rb.apply_batch(fp.Batch(epoch=1, seq=1, bars=(fp.BarUpdate("ZZA", "1", _bar(1_800_000_000_000, 1.0), False),)))
        return _drain(q)
    frames = asyncio.run(go())
    assert frames and all("ingest_ms" not in f for f in frames)


# ── /api/live-prices rows ─────────────────────────────────────────────────────

class _Client:
    _api_key = "k"

    def get_batch_quotes(self, tickers, *, entity_ids=None):
        from api.services import provider_errors as _pe
        return _pe.ProviderResult(
            value={"AAPL": {
                "ticker": "AAPL",
                "day": {"c": 10.0, "o": 1, "h": 2, "l": 0.5, "v": 100},
                "prevDay": {"c": 9.5},
                "lastTrade": {"p": 10.2, "t": 1_800_000_000_987_654_321},   # ns on the wire
                "todaysChangePerc": 1.0,
                "todaysChange": 0.1,
                "_observed_at": 1_800_000_000.5,
            }},
            provenance=_pe.ProvenanceRecord(vendor="massive", source_activity="test"),
            licensing_class="R",
        )


def test_a_live_price_row_says_when_it_was_observed_traded_and_fetched():
    from api.routers import live_prices as lp
    before = int(time.time() * 1000)
    row = lp._fetch_snapshots(_Client(), ["AAPL"], "regular")["AAPL"]
    after = int(time.time() * 1000)
    assert row["observed_ms"] == 1_800_000_000_500
    assert row["last_trade_ms"] == 1_800_000_000_987
    assert isinstance(row["fetched_at_ms"], int) and before <= row["fetched_at_ms"] <= after
    assert row["observed_at"] == 1_800_000_000.5          # unchanged for old clients


def test_a_row_without_vendor_times_says_none_never_a_guess():
    from api.routers import live_prices as lp

    class _Bare(_Client):
        def get_batch_quotes(self, tickers, *, entity_ids=None):
            r = super().get_batch_quotes(tickers)
            r.value["AAPL"]["lastTrade"] = {"p": 10.2}
            r.value["AAPL"]["_observed_at"] = None
            return r

    row = lp._fetch_snapshots(_Bare(), ["AAPL"], "regular")["AAPL"]
    assert row["observed_ms"] is None and row["last_trade_ms"] is None
    assert isinstance(row["fetched_at_ms"], int)
