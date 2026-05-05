"""Unit tests for BarBroadcaster."""
import asyncio
import threading
import pytest

from api.services.bar_broadcaster import BarBroadcaster


@pytest.fixture
def bb():
    return BarBroadcaster()


@pytest.mark.asyncio
async def test_push_minute_bar_emits_to_1min_subscriber(bb):
    q = bb.subscribe("AAPL", "1")
    bar = {"t": 1746468600000, "o": 100.0, "h": 101.0, "l": 99.5, "c": 100.5, "v": 1000}
    bb.push_minute_bar("AAPL", bar)
    out = await asyncio.wait_for(q.get(), timeout=0.1)
    assert out == {"sym": "AAPL", "tf": "1", "bar": bar}


@pytest.mark.asyncio
async def test_push_minute_bar_does_not_emit_to_unsubscribed_symbol(bb):
    q = bb.subscribe("MSFT", "1")
    bb.push_minute_bar("AAPL", {"t": 1746468600000, "o": 1, "h": 1, "l": 1, "c": 1, "v": 1})
    with pytest.raises(asyncio.TimeoutError):
        await asyncio.wait_for(q.get(), timeout=0.05)


@pytest.mark.asyncio
async def test_unsubscribe_removes_queue(bb):
    q = bb.subscribe("AAPL", "1")
    bb.unsubscribe("AAPL", "1", q)
    bb.push_minute_bar("AAPL", {"t": 1746468600000, "o": 1, "h": 1, "l": 1, "c": 1, "v": 1})
    with pytest.raises(asyncio.TimeoutError):
        await asyncio.wait_for(q.get(), timeout=0.05)


@pytest.mark.asyncio
async def test_push_minute_bar_aggregates_into_5min_bucket(bb):
    q5 = bb.subscribe("AAPL", "5")
    # First minute of a new 5-min bucket (14:30:00 ET = 1746468600000 ms)
    bar1 = {"t": 1746468600000, "o": 100.0, "h": 101.0, "l": 99.5, "c": 100.5, "v": 1000}
    bb.push_minute_bar("AAPL", bar1)
    msg1 = await asyncio.wait_for(q5.get(), timeout=0.1)
    assert msg1["tf"] == "5"
    assert msg1["bar"]["t"] == 1746468600000  # bucket start
    assert msg1["bar"]["o"] == 100.0
    assert msg1["bar"]["c"] == 100.5
    assert msg1["bar"]["v"] == 1000

    # Second minute, same bucket
    bar2 = {"t": 1746468660000, "o": 100.5, "h": 102.0, "l": 100.2, "c": 101.8, "v": 750}
    bb.push_minute_bar("AAPL", bar2)
    msg2 = await asyncio.wait_for(q5.get(), timeout=0.1)
    assert msg2["bar"]["t"] == 1746468600000  # same bucket start
    assert msg2["bar"]["h"] == 102.0
    assert msg2["bar"]["c"] == 101.8
    assert msg2["bar"]["v"] == 1750


@pytest.mark.asyncio
async def test_push_minute_bar_starts_new_bucket_at_boundary(bb):
    q5 = bb.subscribe("AAPL", "5")
    # 14:34:00 ET — last minute of the 14:30 bucket
    bb.push_minute_bar("AAPL", {"t": 1746468840000, "o": 100, "h": 100, "l": 100, "c": 100, "v": 100})
    await asyncio.wait_for(q5.get(), timeout=0.1)
    # 14:35:00 ET — first minute of a new bucket
    bb.push_minute_bar("AAPL", {"t": 1746468900000, "o": 110, "h": 110, "l": 110, "c": 110, "v": 50})
    msg = await asyncio.wait_for(q5.get(), timeout=0.1)
    assert msg["bar"]["t"] == 1746468900000  # new bucket start
    assert msg["bar"]["o"] == 110            # open from new bucket's first bar
    assert msg["bar"]["v"] == 50             # not summed across buckets


@pytest.mark.asyncio
async def test_first_subscribe_callback_fires_only_once_per_symbol(bb):
    fired = []
    bb._on_first_subscribe = lambda s: fired.append(s)
    bb.subscribe("AAPL", "1")
    bb.subscribe("AAPL", "5")  # second tf for same symbol — should NOT fire again
    assert fired == ["AAPL"]


@pytest.mark.asyncio
async def test_last_unsubscribe_callback_fires_only_when_all_tfs_drop(bb):
    fired = []
    bb._on_last_unsubscribe = lambda s: fired.append(s)
    q1 = bb.subscribe("AAPL", "1")
    q5 = bb.subscribe("AAPL", "5")
    bb.unsubscribe("AAPL", "1", q1)
    assert fired == []  # still subscribed on tf=5
    bb.unsubscribe("AAPL", "5", q5)
    assert fired == ["AAPL"]


@pytest.mark.asyncio
async def test_push_minute_bar_from_other_thread_delivers_to_subscriber():
    """Critical: simulates the WS-thread → SSE-loop boundary. Without C1 fix, this hangs or errors."""
    bb = BarBroadcaster()
    q = bb.subscribe("AAPL", "1")  # Bound to the test's running loop

    bar = {"t": 1746468600000, "o": 100.0, "h": 101.0, "l": 99.5, "c": 100.5, "v": 1000}

    # Push from a different thread, mirroring how bar_stream.py invokes the callback
    def _push_from_thread():
        bb.push_minute_bar("AAPL", bar)

    threading.Thread(target=_push_from_thread, daemon=True).start()

    # The message arrives via call_soon_threadsafe scheduled on the test's loop
    out = await asyncio.wait_for(q.get(), timeout=1.0)
    assert out == {"sym": "AAPL", "tf": "1", "bar": bar}


@pytest.mark.asyncio
async def test_push_minute_bar_drops_stale_out_of_order_bar_for_rollup_tfs(bb):
    """C2: a bar with t < current partial's t must NOT overwrite the in-progress bucket."""
    q5 = bb.subscribe("AAPL", "5")

    # Establish a partial in the 14:30 bucket
    bar1 = {"t": 1746468600000, "o": 100.0, "h": 101.0, "l": 99.5, "c": 100.5, "v": 1000}
    bb.push_minute_bar("AAPL", bar1)
    _ = await asyncio.wait_for(q5.get(), timeout=0.1)  # drain 1st partial

    # Send a STALE bar (older `t`)
    stale = {"t": 1746468000000, "o": 50.0, "h": 50.0, "l": 50.0, "c": 50.0, "v": 99999}
    bb.push_minute_bar("AAPL", stale)

    # Stale bar must NOT have produced a 5-min emission
    with pytest.raises(asyncio.TimeoutError):
        await asyncio.wait_for(q5.get(), timeout=0.05)

    # Now a fresh in-bucket bar should still aggregate from the original partial,
    # NOT from the stale one. If the stale had overwritten, the open would be 50.0.
    bar2 = {"t": 1746468660000, "o": 100.5, "h": 102.0, "l": 100.2, "c": 101.8, "v": 750}
    bb.push_minute_bar("AAPL", bar2)
    msg = await asyncio.wait_for(q5.get(), timeout=0.1)
    assert msg["bar"]["o"] == 100.0   # open from bar1, NOT from stale (would be 50.0)
    assert msg["bar"]["v"] == 1750    # bar1 + bar2, stale's 99999 NOT included
