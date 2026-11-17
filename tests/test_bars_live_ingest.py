"""Universe live bars, web side (2026-10-14): minute bars roll into exact 5m buckets,
and a bucket that began before the socket connected is never forwarded."""
import json

import pytest

from api.services import bar_stream, bars_live_ingest as ing

T0 = 1_791_990_000  # a 5m boundary (unix seconds)


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    monkeypatch.setenv("BARS_UNIVERSE_STREAM_ENABLED", "1")
    ing._reset_for_tests()
    yield
    ing._reset_for_tests()


def _am(sym, minute_s, o, h, l, c, v):
    ing.on_am(sym, {"t": minute_s * 1000, "o": o, "h": h, "l": l, "c": c, "v": v})


def test_minutes_roll_into_one_exact_5m_bucket():
    ing.mark_connected(now_ms=(T0 - 10) * 1000)   # first full bucket = T0
    _am("AAA", T0, 10, 11, 9.5, 10.5, 100)
    _am("AAA", T0 + 60, 10.5, 12, 10, 11, 200)
    _am("AAA", T0 + 240, 11, 11.5, 8, 9, 50)
    p = ing.take_payload()
    assert p["rows"] == [["AAA", T0, 10.0, 12.0, 8.0, 9.0, 350]]
    assert p["first_full_bucket_ms"] == T0 * 1000


def test_a_repeated_minute_replaces_itself_rather_than_double_counting():
    ing.mark_connected(now_ms=(T0 - 10) * 1000)
    _am("AAA", T0, 10, 11, 9, 10, 100)
    _am("AAA", T0, 10, 11, 9, 10, 100)
    assert ing.take_payload()["rows"][0][6] == 100


def test_a_bucket_that_began_before_the_socket_is_never_forwarded():
    ing.mark_connected(now_ms=(T0 + 30) * 1000)    # mid-bucket: next full bucket T0+300
    _am("AAA", T0 + 60, 10, 11, 9, 10, 100)
    _am("AAA", T0 + 300, 10, 11, 9, 10, 100)
    rows = ing.take_payload()["rows"]
    assert [r[1] for r in rows] == [T0 + 300]


def test_class_shares_are_stored_under_the_hyphen_form():
    ing.mark_connected(now_ms=(T0 - 10) * 1000)
    _am("BRK.B", T0, 1, 1, 1, 1, 1)
    assert ing.take_payload()["rows"][0][0] == "BRK-B"


def test_a_reconnect_drops_everything_held_for_the_old_socket():
    ing.mark_connected(now_ms=(T0 - 10) * 1000)
    _am("AAA", T0, 1, 1, 1, 1, 1)
    ing.mark_connected(now_ms=(T0 + 400) * 1000)
    assert ing.take_payload()["rows"] == []


def test_under_the_universe_feed_per_symbol_subscribes_drop_AM():
    msg = json.loads(bar_stream._build_subscribe_message(["AAPL"]))
    assert msg["params"] == "A.AAPL,T.AAPL"
    un = json.loads(bar_stream._build_unsubscribe_message(["AAPL"]))
    assert "AM.AAPL" not in un["params"]


def test_with_the_flag_off_subscribes_are_unchanged(monkeypatch):
    monkeypatch.delenv("BARS_UNIVERSE_STREAM_ENABLED", raising=False)
    msg = json.loads(bar_stream._build_subscribe_message(["AAPL"]))
    assert msg["params"] == "AM.AAPL,A.AAPL,T.AAPL"


# ── continuity across reconnects and tier restarts (2026-10-14 evening) ──────────

def test_the_boundary_bucket_goes_out_as_minutes_not_as_a_row():
    ing.mark_connected(now_ms=(T0 + 30) * 1000)     # socket opened inside bucket T0
    _am("AAA", T0 + 60, 10, 11, 9, 10, 100)
    _am("AAA", T0 + 120, 10, 12, 9, 11, 50)
    p = ing.take_payload()
    assert p["rows"] == []
    assert p["minutes"] == [["AAA", T0 + 60, 10.0, 11.0, 9.0, 10.0, 100],
                            ["AAA", T0 + 120, 10.0, 12.0, 9.0, 11.0, 50]]


def test_seq_counts_acknowledged_flushes_and_resets_with_the_epoch():
    ing.mark_connected(now_ms=(T0 - 10) * 1000)
    p1 = ing.take_payload()
    assert p1["seq"] == 1
    ing.flushed(p1, {"accepted": 0})
    assert ing.take_payload()["seq"] == 2
    ing.mark_connected(now_ms=(T0 + 400) * 1000)
    assert ing.take_payload()["seq"] == 1


def test_a_resync_reply_starts_a_new_epoch_keeping_the_current_bucket_minutes():
    ing.mark_connected(now_ms=(T0 - 10) * 1000)
    _am("AAA", T0, 10, 11, 9, 10, 100)
    _am("AAA", T0 + 60, 10, 13, 9, 12, 40)
    p = ing.take_payload()
    old_epoch = p["epoch_ms"]
    ing.resync(now_ms=(T0 + 90) * 1000)
    q = ing.take_payload()
    assert q["epoch_ms"] != old_epoch and q["seq"] == 1
    assert q["first_full_bucket_ms"] == (T0 + 300) * 1000
    assert [m[1] for m in q["minutes"]] == [T0, T0 + 60]   # nothing the socket saw is lost
    assert q["rows"] == []


def test_the_flusher_obeys_a_resync_reply():
    ing.mark_connected(now_ms=(T0 - 10) * 1000)
    p = ing.take_payload()
    ing.flushed(p, {"accepted": 0, "resync": True})
    assert ing.status()["resyncs"] == 1
    assert ing.take_payload()["epoch_ms"] != p["epoch_ms"]


def test_an_unacknowledged_bucket_is_never_pruned():
    ing.mark_connected(now_ms=(T0 - 10) * 1000)
    for k in range(5):                              # five buckets, no flush succeeds
        _am("AAA", T0 + 300 * k, 1, 1, 1, 1, 1)
    rows = ing.take_payload()["rows"]
    assert sorted(r[1] for r in rows) == [T0 + 300 * k for k in range(5)]


def test_a_failed_flush_resends_everything_it_carried():
    ing.mark_connected(now_ms=(T0 - 10) * 1000)
    _am("AAA", T0, 1, 1, 1, 1, 1)
    p = ing.take_payload()
    for k in range(1, 5):                           # buckets keep closing while in flight
        _am("AAA", T0 + 300 * k, 1, 1, 1, 1, 1)
    ing.requeue(p)
    rows = ing.take_payload()["rows"]
    assert T0 in [r[1] for r in rows]


# ── 1m: the payload's `m1` (BARS_LIVE_1M_ENABLED, 2026-11-16) ─────────────────────

_PAYLOAD_KEYS = {"epoch_ms", "seq", "first_full_bucket_ms", "watermark_ms", "rows", "minutes"}


def _session():
    ing.mark_connected(now_ms=(T0 + 30) * 1000)     # boundary bucket T0, first full T0+300
    _am("AAA", T0 + 60, 10, 11, 9, 10, 100)          # boundary-bucket minute
    _am("AAA", T0 + 300, 10, 12, 9, 11, 50)
    _am("AAA", T0 + 360, 11, 13, 10, 12, 60)
    _am("BBB", T0 + 300, 5, 5, 5, 5, 1)


def test_with_the_1m_flag_off_the_payload_is_unchanged(monkeypatch):
    monkeypatch.delenv("BARS_LIVE_1M_ENABLED", raising=False)
    _session()
    p = ing.take_payload()
    assert set(p) == _PAYLOAD_KEYS
    assert "m1_sent" not in ing.status() and "m1_enabled" not in ing.status()


def test_m1_carries_every_minute_of_each_dirty_bucket_and_the_boundary(monkeypatch):
    monkeypatch.delenv("BARS_LIVE_1M_ENABLED", raising=False)
    _session()
    off = ing.take_payload()
    ing._reset_for_tests()
    monkeypatch.setenv("BARS_LIVE_1M_ENABLED", "1")
    _session()
    on = ing.take_payload()
    assert {k: v for k, v in on.items() if k != "m1"} == {**off, "epoch_ms": on["epoch_ms"]}
    assert sorted(on["m1"]) == sorted([
        ["AAA", T0 + 300, 10.0, 12.0, 9.0, 11.0, 50],
        ["AAA", T0 + 360, 11.0, 13.0, 10.0, 12.0, 60],
        ["BBB", T0 + 300, 5.0, 5.0, 5.0, 5.0, 1],
        ["AAA", T0 + 60, 10.0, 11.0, 9.0, 10.0, 100],
    ])


def test_m1_a_repeated_minute_replaces_itself(monkeypatch):
    monkeypatch.setenv("BARS_LIVE_1M_ENABLED", "1")
    ing.mark_connected(now_ms=(T0 - 10) * 1000)
    _am("AAA", T0, 10, 11, 9, 10, 100)
    _am("AAA", T0, 10, 11, 9, 10.5, 120)
    assert ing.take_payload()["m1"] == [["AAA", T0, 10.0, 11.0, 9.0, 10.5, 120]]


def test_m1_follows_rows_through_a_failed_and_an_acknowledged_flush(monkeypatch):
    monkeypatch.setenv("BARS_LIVE_1M_ENABLED", "1")
    ing.mark_connected(now_ms=(T0 - 10) * 1000)
    _am("AAA", T0, 1, 1, 1, 1, 1)
    p = ing.take_payload()
    ing.requeue(p)                                   # the POST failed
    q = ing.take_payload()
    assert q["m1"] == p["m1"] == [["AAA", T0, 1.0, 1.0, 1.0, 1.0, 1]]
    ing.flushed(q, {"accepted": 1})
    assert ing.take_payload()["m1"] == []            # acknowledged: not sent again
    assert ing.status()["m1_sent"] == 1
    _am("AAA", T0 + 60, 2, 2, 2, 2, 2)               # the bucket's next minute
    assert [m[1] for m in ing.take_payload()["m1"]] == [T0, T0 + 60]


def test_holding_too_many_unflushed_buckets_starts_a_new_epoch():
    ing.mark_connected(now_ms=(T0 - 10) * 1000)
    e0 = ing.take_payload()["epoch_ms"]
    for k in range(ing.MAX_HELD_BUCKETS + 2):
        _am("AAA", T0 + 300 * k, 1, 1, 1, 1, 1)
    assert ing.status()["overflows"] >= 1
    assert ing.take_payload()["epoch_ms"] != e0


def _run_one_flush(monkeypatch):
    """Drive `_flush_loop` through exactly one flush; return (post kwargs, to_thread calls)."""
    import asyncio
    import httpx
    posts, threads = [], []
    sleeps = {"n": 0}

    async def fake_sleep(_s):
        sleeps["n"] += 1
        if sleeps["n"] > 1:
            raise asyncio.CancelledError()      # end the loop after one flush

    real_to_thread = asyncio.to_thread

    async def spy_to_thread(fn, *a, **k):
        threads.append(fn)
        return await real_to_thread(fn, *a, **k)

    class FakeResp:
        def raise_for_status(self):
            pass

        def json(self):
            return {"accepted": 1}

    class FakeClient:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, url, **kw):
            posts.append(kw)
            return FakeResp()

    monkeypatch.setenv("BARS_ORIGIN_URL", "http://bars-api.test:8080")
    monkeypatch.setattr(ing.asyncio, "sleep", fake_sleep)
    monkeypatch.setattr(ing.asyncio, "to_thread", spy_to_thread)
    monkeypatch.setattr(httpx, "AsyncClient", FakeClient)
    with pytest.raises(asyncio.CancelledError):
        asyncio.run(ing._flush_loop())
    return posts, threads


def test_with_1m_the_flush_body_is_encoded_off_the_event_loop(monkeypatch):
    monkeypatch.setenv("BARS_LIVE_1M_ENABLED", "1")
    _session()
    posts, threads = _run_one_flush(monkeypatch)
    assert len(posts) == 1 and "json" not in posts[0]
    assert threads == [ing._encode_payload]                       # the ~2 MB encode ran on a thread
    body = json.loads(posts[0]["content"])
    assert body["m1"] and body["rows"]
    assert posts[0]["headers"]["Content-Type"] == "application/json"


def test_without_1m_the_flush_posts_exactly_as_before(monkeypatch):
    monkeypatch.delenv("BARS_LIVE_1M_ENABLED", raising=False)
    _session()
    posts, threads = _run_one_flush(monkeypatch)
    assert len(posts) == 1 and "json" in posts[0] and "content" not in posts[0]
    assert threads == []
    assert "m1" not in posts[0]["json"]
