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


# ── Phase 4.5: A-event (per-second aggregate) tests ─────────────────────────

@pytest.mark.asyncio
async def test_push_aggregate_A_event_updates_partial_without_finalizing(bb):
    """Phase 4.5: pushing an A event updates the partial bucket and emits to subscribers."""
    q1 = bb.subscribe("AAPL", "1")
    q5 = bb.subscribe("AAPL", "5")

    # 14:30:01 — first second of the 14:30 bucket (bucket_start = 14:30:00 = 1746468600000)
    a_bar = {"t": 1746468601000, "o": 150.10, "h": 150.55, "l": 149.95, "c": 150.40, "v": 100}
    bb.push_aggregate("AAPL", a_bar, "A")

    # Must emit to tf=1 subscriber
    msg1 = await asyncio.wait_for(q1.get(), timeout=0.1)
    assert msg1["sym"] == "AAPL"
    assert msg1["tf"] == "1"
    assert msg1["bar"]["v"] == 100

    # Must emit a partial to tf=5 subscriber
    msg5 = await asyncio.wait_for(q5.get(), timeout=0.1)
    assert msg5["tf"] == "5"
    assert msg5["bar"]["t"] == 1746468600000  # bucket start, NOT the per-second t
    assert msg5["bar"]["v"] == 100


@pytest.mark.asyncio
async def test_push_aggregate_A_events_fold_into_partial(bb):
    """Phase 4.5: multiple A events in the same bucket accumulate OHLCV correctly."""
    q5 = bb.subscribe("AAPL", "5")

    # Three successive seconds in the 14:30 bucket
    bb.push_aggregate("AAPL", {"t": 1746468601000, "o": 100.0, "h": 101.0, "l": 99.5, "c": 100.5, "v": 200}, "A")
    await asyncio.wait_for(q5.get(), timeout=0.1)  # drain first partial

    bb.push_aggregate("AAPL", {"t": 1746468602000, "o": 100.5, "h": 102.0, "l": 100.2, "c": 101.8, "v": 150}, "A")
    msg2 = await asyncio.wait_for(q5.get(), timeout=0.1)
    assert msg2["bar"]["h"] == 102.0   # extended high
    assert msg2["bar"]["l"] == 99.5    # kept low from first
    assert msg2["bar"]["c"] == 101.8   # close from latest second
    assert msg2["bar"]["v"] == 350     # summed volume

    bb.push_aggregate("AAPL", {"t": 1746468603000, "o": 101.8, "h": 101.9, "l": 101.5, "c": 101.6, "v": 80}, "A")
    msg3 = await asyncio.wait_for(q5.get(), timeout=0.1)
    assert msg3["bar"]["v"] == 430     # three seconds summed
    assert msg3["bar"]["o"] == 100.0   # open still from first A event


@pytest.mark.asyncio
async def test_push_aggregate_AM_overwrites_partial_built_from_A_events(bb):
    """Phase 4.5 critical race: AM arriving after A events replaces partial, no double-count."""
    q5 = bb.subscribe("AAPL", "5")

    # Push 3 A events into the 14:30 bucket (total A-volume = 450)
    bb.push_aggregate("AAPL", {"t": 1746468601000, "o": 100.0, "h": 101.0, "l": 99.5, "c": 100.5, "v": 200}, "A")
    bb.push_aggregate("AAPL", {"t": 1746468602000, "o": 100.5, "h": 102.0, "l": 100.2, "c": 101.8, "v": 150}, "A")
    bb.push_aggregate("AAPL", {"t": 1746468603000, "o": 101.8, "h": 101.9, "l": 101.5, "c": 101.6, "v": 100}, "A")
    # drain the 3 A-event partials
    for _ in range(3):
        await asyncio.wait_for(q5.get(), timeout=0.1)

    # AM event arrives at minute close — authoritative volume for the full minute = 1000
    # (not the 450 we already summed from A events)
    am_bar = {"t": 1746468600000, "o": 100.0, "h": 102.5, "l": 99.0, "c": 101.6, "v": 1000}
    bb.push_aggregate("AAPL", am_bar, "AM")
    msg_am = await asyncio.wait_for(q5.get(), timeout=0.1)

    # AM must overwrite: volume = 1000 (authoritative), NOT 450+1000=1450 (double-counted)
    assert msg_am["bar"]["v"] == 1000, (
        f"AM must replace A-partial; expected v=1000, got v={msg_am['bar']['v']}"
    )
    assert msg_am["bar"]["h"] == 102.5   # AM's authoritative high
    assert msg_am["bar"]["l"] == 99.0    # AM's authoritative low
    assert msg_am["bar"]["o"] == 100.0   # AM's authoritative open
