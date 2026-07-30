"""Unit tests for BarBroadcaster."""
import asyncio
import threading
import time
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
async def test_push_aggregate_A_event_alone_does_not_seed_a_bar(bb):
    """An A (per-second aggregate) event carries no per-trade condition codes, so it
    must NOT seed a developing bar — an unfilterable print can't define o/h/l. Only
    the filtered T path or the authoritative AM baseline may open a bucket."""
    q1 = bb.subscribe("AAPL", "1")
    q5 = bb.subscribe("AAPL", "5")
    a_bar = {"t": 1746468601000, "o": 150.10, "h": 150.55, "l": 149.95, "c": 150.40, "v": 100}
    bb.push_aggregate("AAPL", a_bar, "A")
    # No bucket existed → an A alone emits nothing on either tf
    with pytest.raises(asyncio.TimeoutError):
        await asyncio.wait_for(q1.get(), timeout=0.05)
    with pytest.raises(asyncio.TimeoutError):
        await asyncio.wait_for(q5.get(), timeout=0.05)


@pytest.mark.asyncio
async def test_push_aggregate_A_event_updates_close_only_no_ghost_wick_no_volume(bb):
    """On a bucket already seeded by a filtered T tick, an A event nudges ONLY the
    close. It must NOT extend high/low (A's h/l include unfilterable ghost prints =
    the transient ghost wick) and must NOT add volume (A's per-second volume double-
    counts the same trades' T-tick sizes = the phantom volume spike)."""
    q5 = bb.subscribe("AAPL", "5")
    # Seed the 14:30 bucket with a filtered T tick @ 100.00, size 200
    bb.push_aggregate("AAPL", {"t": 1746468601000, "p": 100.00, "s": 200}, "T")
    await asyncio.wait_for(q5.get(), timeout=0.1)
    bb._last_emit_ms.clear()
    # A event for the same bucket carries a GHOST high 102.0 + a low 99.5 + volume 150
    bb.push_aggregate("AAPL", {"t": 1746468602000, "o": 100.5, "h": 102.0, "l": 99.5, "c": 101.8, "v": 150}, "A")
    msg = await asyncio.wait_for(q5.get(), timeout=0.1)
    assert msg["bar"]["c"] == 101.8    # close nudged by the A event
    assert msg["bar"]["h"] == 100.00   # ghost high NOT folded (T owns h/l)
    assert msg["bar"]["l"] == 100.00   # ghost low NOT folded
    assert msg["bar"]["v"] == 200      # volume unchanged — no A double-count


@pytest.mark.asyncio
async def test_push_aggregate_AM_seeds_and_is_authoritative_after_T_and_A(bb):
    """AM overwrites the broadcast partial with authoritative full-minute OHLCV.
    After a T tick + an A close-nudge, the AM close replaces the bucket — and no
    double-count is even possible now that A adds no volume."""
    q5 = bb.subscribe("AAPL", "5")
    bb.push_aggregate("AAPL", {"t": 1746468601000, "p": 100.0, "s": 200}, "T")
    await asyncio.wait_for(q5.get(), timeout=0.1)
    bb._last_emit_ms.clear()
    bb.push_aggregate("AAPL", {"t": 1746468602000, "o": 100.5, "h": 101.0, "l": 100.2, "c": 101.8, "v": 150}, "A")
    await asyncio.wait_for(q5.get(), timeout=0.1)
    bb._last_emit_ms.clear()
    # AM authoritative full-minute bar
    am_bar = {"t": 1746468600000, "o": 100.0, "h": 102.5, "l": 99.0, "c": 101.6, "v": 1000}
    bb.push_aggregate("AAPL", am_bar, "AM")
    msg = await asyncio.wait_for(q5.get(), timeout=0.1)
    assert msg["bar"]["v"] == 1000   # authoritative, not 200+1000 double-count
    assert msg["bar"]["h"] == 102.5
    assert msg["bar"]["l"] == 99.0
    assert msg["bar"]["o"] == 100.0


@pytest.mark.asyncio
async def test_push_aggregate_A_close_only_on_1min_no_per_second_candles(bb):
    """Regression (per-second-candle fix + ghost-wick fix): on tf='1', A events do
    NOT spawn a candle per second and do NOT fold a ghost high — they nudge the
    close of the minute bucket the T path seeded, at the minute-floored time.

    tf='1' used to be a RAW pass-through in the AM/A path, so each per-second A
    event was emitted verbatim (its own sub-minute `t` + one second's volume) —
    the frontend appended a fresh candle every tick and the volume series collided."""
    q1 = bb.subscribe("AAPL", "1")
    # T tick seeds the 14:30 minute bucket
    bb.push_aggregate("AAPL", {"t": 1746468601000, "p": 100.0, "s": 200}, "T")
    m0 = await asyncio.wait_for(q1.get(), timeout=0.1)
    assert m0["bar"]["t"] == 1746468600000   # minute bucket start (not the per-second t)
    bb._last_emit_ms.clear()
    # A event with a GHOST high 105.0 — must update close only, at the SAME minute time
    bb.push_aggregate("AAPL", {"t": 1746468602000, "o": 100.5, "h": 105.0, "l": 100.2, "c": 100.8, "v": 150}, "A")
    m1 = await asyncio.wait_for(q1.get(), timeout=0.1)
    assert m1["bar"]["t"] == 1746468600000   # SAME minute candle — not a per-second one
    assert m1["bar"]["c"] == 100.8           # close nudged
    assert m1["bar"]["h"] == 100.0           # ghost 105.0 NOT folded
    assert m1["bar"]["v"] == 200             # no volume double-count


@pytest.mark.asyncio
async def test_push_aggregate_AM_finalizes_1min_bucket_authoritatively(bb):
    """AM on tf='1' emits the authoritative minute bar (seeds if no bucket yet)."""
    q1 = bb.subscribe("AAPL", "1")
    bb.push_aggregate("AAPL", {"t": 1746468600000, "o": 100.0, "h": 102.5, "l": 99.0, "c": 101.6, "v": 1000}, "AM")
    msg = await asyncio.wait_for(q1.get(), timeout=0.1)
    assert msg["bar"]["t"] == 1746468600000
    assert msg["bar"]["v"] == 1000
    assert msg["bar"]["h"] == 102.5


# ── Phase 4.6: T-event (per-trade tick) tests ────────────────────────────────

# 14:30:01.234 ET = 1746468601234 ms (bucket_start for "1" = 1746468600000)

@pytest.mark.asyncio
async def test_push_T_creates_partial_when_none_exists(bb):
    """T event with no prior AM/A for the symbol's current minute creates a fresh partial."""
    q1 = bb.subscribe("AAPL", "1")
    # No prior partial — T event must bootstrap one
    trade = {"t": 1746468601234, "p": 150.25, "s": 100}
    bb.push_aggregate("AAPL", trade, "T")
    msg = await asyncio.wait_for(q1.get(), timeout=0.15)
    bar = msg["bar"]
    assert bar["o"] == 150.25   # o = trade price (first trade in bucket)
    assert bar["h"] == 150.25
    assert bar["l"] == 150.25
    assert bar["c"] == 150.25
    assert bar["v"] == 100
    assert bar["t"] == 1746468600000  # anchored at bucket start


@pytest.mark.asyncio
async def test_push_T_updates_existing_partial_high_low_close_and_sums_volume(bb):
    """Multiple T events in the same minute accumulate correctly."""
    q1 = bb.subscribe("AAPL", "1")
    # Seed partial via first trade
    bb.push_aggregate("AAPL", {"t": 1746468601000, "p": 150.00, "s": 200}, "T")
    await asyncio.wait_for(q1.get(), timeout=0.15)

    # Force throttle window to pass so second trade emits
    bb._last_emit_ms.clear()

    # Second trade: higher price
    bb.push_aggregate("AAPL", {"t": 1746468602000, "p": 151.00, "s": 100}, "T")
    msg2 = await asyncio.wait_for(q1.get(), timeout=0.15)
    bar = msg2["bar"]
    assert bar["o"] == 150.00   # open from first trade
    assert bar["h"] == 151.00   # extended high
    assert bar["l"] == 150.00   # low unchanged
    assert bar["c"] == 151.00   # close = latest trade
    assert bar["v"] == 300      # summed volume


@pytest.mark.asyncio
async def test_push_T_extends_high_only_when_trade_price_exceeds(bb):
    """High is extended only when new trade price > current high."""
    q1 = bb.subscribe("AAPL", "1")
    bb.push_aggregate("AAPL", {"t": 1746468601000, "p": 150.00, "s": 100}, "T")
    await asyncio.wait_for(q1.get(), timeout=0.15)
    bb._last_emit_ms.clear()

    # Trade below current high — high must NOT change
    bb.push_aggregate("AAPL", {"t": 1746468602000, "p": 149.50, "s": 50}, "T")
    msg = await asyncio.wait_for(q1.get(), timeout=0.15)
    assert msg["bar"]["h"] == 150.00  # unchanged


@pytest.mark.asyncio
async def test_push_T_lowers_low_only_when_trade_price_below(bb):
    """Low is lowered only when new trade price < current low."""
    q1 = bb.subscribe("AAPL", "1")
    bb.push_aggregate("AAPL", {"t": 1746468601000, "p": 150.00, "s": 100}, "T")
    await asyncio.wait_for(q1.get(), timeout=0.15)
    bb._last_emit_ms.clear()

    # Trade above current low — low must NOT change
    bb.push_aggregate("AAPL", {"t": 1746468602000, "p": 150.50, "s": 50}, "T")
    msg = await asyncio.wait_for(q1.get(), timeout=0.15)
    assert msg["bar"]["l"] == 150.00  # unchanged


@pytest.mark.asyncio
async def test_push_T_emits_to_1min_subscriber(bb):
    """T event emits an SSE frame to tf=1 subscriber."""
    q1 = bb.subscribe("AAPL", "1")
    bb.push_aggregate("AAPL", {"t": 1746468601234, "p": 155.0, "s": 50}, "T")
    msg = await asyncio.wait_for(q1.get(), timeout=0.15)
    assert msg["sym"] == "AAPL"
    assert msg["tf"] == "1"
    assert msg["bar"]["c"] == 155.0


@pytest.mark.asyncio
async def test_push_T_emits_to_5min_subscriber_with_5min_bucket_start(bb):
    """T event emits to tf=5 subscriber with correctly computed 5-min bucket start."""
    q5 = bb.subscribe("AAPL", "5")
    # 14:30:01.234 ET — bucket start for tf=5 is 14:30:00 = 1746468600000
    bb.push_aggregate("AAPL", {"t": 1746468601234, "p": 155.0, "s": 50}, "T")
    msg = await asyncio.wait_for(q5.get(), timeout=0.15)
    assert msg["tf"] == "5"
    assert msg["bar"]["t"] == 1746468600000  # 5-min bucket start


@pytest.mark.asyncio
async def test_push_aggregate_AM_bypasses_throttle(bb):
    """Two AM events pushed within 50ms must BOTH arrive at subscriber (no throttle for AM)."""
    q1 = bb.subscribe("AAPL", "1")
    bar1 = {"t": 1746468600000, "o": 100.0, "h": 101.0, "l": 99.5, "c": 100.5, "v": 1000}
    bar2 = {"t": 1746468660000, "o": 100.5, "h": 102.0, "l": 100.2, "c": 101.8, "v": 750}
    # Seed a last_emit_ms entry as if we just emitted (simulates throttle active for A/T)
    bb._last_emit_ms[("AAPL", "1")] = int(time.time() * 1000)
    bb.push_aggregate("AAPL", bar1, "AM")
    bb.push_aggregate("AAPL", bar2, "AM")
    # Both must arrive — AM bypasses throttle
    msg1 = await asyncio.wait_for(q1.get(), timeout=0.15)
    msg2 = await asyncio.wait_for(q1.get(), timeout=0.15)
    assert msg1["bar"]["v"] == 1000
    assert msg2["bar"]["v"] == 750


@pytest.mark.asyncio
async def test_push_aggregate_T_throttle_drops_within_window(bb):
    """5 T events pushed within 50ms (< 100ms throttle window) → only 1 SSE frame arrives."""
    q1 = bb.subscribe("AAPL", "1")
    # Ensure last_emit_ms is clear so the FIRST event passes the throttle gate
    bb._last_emit_ms.clear()
    trade = {"t": 1746468601000, "p": 150.0, "s": 10}
    for _ in range(5):
        bb.push_aggregate("AAPL", trade, "T")
    # Give the event loop a tick to process queued items
    await asyncio.sleep(0.02)
    # Only 1 frame should be in the queue (throttle dropped the rest)
    count = 0
    while not q1.empty():
        q1.get_nowait()
        count += 1
    assert count == 1, f"Expected 1 SSE frame within throttle window, got {count}"


# ── Quote-feed interest + get_last_price (live-price SSE source) ──────────────

@pytest.mark.asyncio
async def test_add_interest_triggers_first_subscribe_once(bb):
    """Interest fires the upstream subscribe exactly once per symbol (refcounted)."""
    fired = []
    bb._on_first_subscribe = lambda s: fired.append(s)
    bb.add_interest(["AAPL", "aapl"])  # two refs (case-normalized) — one subscribe
    assert fired == ["AAPL"]


@pytest.mark.asyncio
async def test_get_last_price_reads_developing_bar_from_T_ticks(bb):
    """A quote consumer (interest only, no queue) reads the live tick price."""
    bb.add_interest(["AAPL"])
    assert bb.get_last_price("AAPL") is None  # no tick yet
    bb.push_aggregate("AAPL", {"t": 1746468601234, "p": 150.25, "s": 100}, "T")
    lp = bb.get_last_price("AAPL")
    assert lp["price"] == 150.25
    bb._last_emit_ms.clear()
    bb.push_aggregate("AAPL", {"t": 1746468602000, "p": 151.10, "s": 50}, "T")
    assert bb.get_last_price("AAPL")["price"] == 151.10  # ticks with each trade


@pytest.mark.asyncio
async def test_get_last_price_includes_live_day_volume_from_av(bb):
    """Cumulative day volume (Massive `av` on A/AM events) rides get_last_price."""
    bb.add_interest(["AAPL"])
    bb.push_aggregate("AAPL", {"t": 1746468601234, "p": 150.25, "s": 100}, "T")
    assert bb.get_last_price("AAPL")["volume"] is None   # no aggregate yet
    # A per-second aggregate carries av = today's accumulated volume
    bb.push_aggregate("AAPL", {"t": 1746468601000, "o": 150.2, "h": 150.3,
                               "l": 150.1, "c": 150.25, "v": 500, "av": 42000}, "A")
    lp = bb.get_last_price("AAPL")
    assert lp["price"] == 150.25   # price still from the last trade tick
    assert lp["volume"] == 42000   # day volume from av
    # av grows through the session
    bb.push_aggregate("AAPL", {"t": 1746468602000, "o": 150.25, "h": 150.4,
                               "l": 150.2, "c": 150.35, "v": 300, "av": 42300}, "A")
    assert bb.get_last_price("AAPL")["volume"] == 42300


@pytest.mark.asyncio
async def test_remove_interest_refcounts_and_unsubscribes_at_zero(bb):
    """Last interest release (with no chart subscriber) unsubscribes + clears partial."""
    gone = []
    bb._on_last_unsubscribe = lambda s: gone.append(s)
    bb.add_interest(["AAPL"])
    bb.add_interest(["AAPL"])  # refcount = 2
    bb.push_aggregate("AAPL", {"t": 1746468601234, "p": 150.25, "s": 100}, "T")
    bb.remove_interest(["AAPL"])
    assert gone == []                       # still one ref outstanding
    assert bb.get_last_price("AAPL") is not None
    bb.remove_interest(["AAPL"])
    assert gone == ["AAPL"]                  # fully released → upstream unsubscribe
    assert bb.get_last_price("AAPL") is None  # partial cleared


@pytest.mark.asyncio
async def test_chart_subscriber_keeps_symbol_wanted_despite_interest_release(bb):
    """A live chart (queue subscriber) must keep the symbol subscribed upstream
    even after the quote feed drops its interest — no premature unsubscribe."""
    gone = []
    bb._on_last_unsubscribe = lambda s: gone.append(s)
    q = bb.subscribe("AAPL", "1")   # chart
    bb.add_interest(["AAPL"])       # quote feed
    bb.remove_interest(["AAPL"])    # quote feed leaves
    assert gone == []               # chart still needs it
    bb.unsubscribe("AAPL", "1", q)  # chart leaves too
    assert gone == ["AAPL"]


@pytest.mark.asyncio
async def test_interest_does_not_create_subscriber_queue(bb):
    """Interest must NOT dispatch ticks into a queue (it only keeps the partial
    alive) — otherwise every watched symbol would load the request loop."""
    bb.add_interest(["AAPL"])
    # No subscriber pair exists for AAPL despite an incoming tick.
    bb.push_aggregate("AAPL", {"t": 1746468601234, "p": 150.25, "s": 100}, "T")
    assert not bb._symbol_has_any_subscriber("AAPL")
    assert bb.get_status()["quote_interest_symbols"] == 1
