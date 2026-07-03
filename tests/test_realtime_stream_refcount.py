"""Refcount semantics for realtime_stream.subscribe_tickers/unsubscribe_tickers.

Regression coverage for the bucket-reconnect freeze: two SSE connections (or
the client-side connection pool's bucket reconnects) sharing a ticker must not
have one connection's disconnect kill the upstream subscription the other
connection still needs. See docs/superpowers/specs/
2026-07-02-sse-connection-pooling-design.md "Amendment (final review)".
"""

from api.services import realtime_stream


def setup_function(fn):
    """Reset module subscription state between tests."""
    with realtime_stream._lock:
        realtime_stream._subscribed.clear()
        realtime_stream._sub_counts.clear()


def test_shared_ticker_survives_one_of_two_unsubscribes():
    """Two subscribes of the same ticker + one unsubscribe -> still subscribed."""
    realtime_stream.subscribe_tickers(["AAPL"])
    realtime_stream.subscribe_tickers(["AAPL"])  # second connection, same ticker
    assert realtime_stream._sub_counts["AAPL"] == 2

    realtime_stream.unsubscribe_tickers(["AAPL"])  # first connection disconnects

    assert "AAPL" in realtime_stream._subscribed
    assert realtime_stream._sub_counts["AAPL"] == 1


def test_second_unsubscribe_removes_ticker():
    """After both connections unsubscribe, the ticker is fully removed."""
    realtime_stream.subscribe_tickers(["AAPL"])
    realtime_stream.subscribe_tickers(["AAPL"])
    realtime_stream.unsubscribe_tickers(["AAPL"])
    realtime_stream.unsubscribe_tickers(["AAPL"])

    assert "AAPL" not in realtime_stream._subscribed
    assert realtime_stream._sub_counts.get("AAPL", 0) == 0


def test_unsubscribe_never_subscribed_ticker_is_noop():
    """Unsubscribing a ticker nobody subscribed to must not error or go negative."""
    realtime_stream.unsubscribe_tickers(["ZZZZ"])  # should not raise

    assert "ZZZZ" not in realtime_stream._subscribed
    assert realtime_stream._sub_counts.get("ZZZZ", 0) == 0
    # No entry should be created with a negative count.
    assert "ZZZZ" not in realtime_stream._sub_counts


def test_over_unsubscribe_clamps_at_zero():
    """Unsubscribing more times than subscribed must clamp at 0, not go negative."""
    realtime_stream.subscribe_tickers(["MSFT"])
    realtime_stream.unsubscribe_tickers(["MSFT"])
    realtime_stream.unsubscribe_tickers(["MSFT"])  # extra unsubscribe

    assert "MSFT" not in realtime_stream._subscribed
    assert realtime_stream._sub_counts.get("MSFT", 0) == 0


def test_distinct_tickers_subscribe_and_unsubscribe_independently():
    """Tickers that don't overlap between connections are unaffected by each other."""
    realtime_stream.subscribe_tickers(["AAPL", "MSFT"])
    realtime_stream.subscribe_tickers(["NVDA"])

    assert realtime_stream._subscribed == {"AAPL", "MSFT", "NVDA"}

    realtime_stream.unsubscribe_tickers(["AAPL", "MSFT"])

    assert realtime_stream._subscribed == {"NVDA"}
    assert realtime_stream._sub_counts.get("AAPL", 0) == 0
    assert realtime_stream._sub_counts.get("MSFT", 0) == 0
    assert realtime_stream._sub_counts["NVDA"] == 1


def test_bucket_reconnect_pattern_no_freeze():
    """Simulates the client pool's bucket-reconnect sequence: new bucket
    subscribes the union FIRST (including tickers already covered by the old
    bucket), then the old connection's `finally` unsubscribes its own list.
    The overlapping ticker must remain subscribed throughout.
    """
    # Old bucket already streaming AAPL + MSFT.
    realtime_stream.subscribe_tickers(["AAPL", "MSFT"])

    # Union changed (e.g. a new widget added NVDA) -> new bucket subscribes
    # the full new union BEFORE the old connection tears down.
    realtime_stream.subscribe_tickers(["AAPL", "MSFT", "NVDA"])

    # Old connection's SSE generator now runs its `finally` and unsubscribes
    # its original ticker list.
    realtime_stream.unsubscribe_tickers(["AAPL", "MSFT"])

    # AAPL/MSFT must still be subscribed (new bucket still needs them) —
    # this is exactly what would freeze under plain-set (non-refcounted) semantics.
    assert realtime_stream._subscribed == {"AAPL", "MSFT", "NVDA"}


def test_get_stream_status_reflects_effective_set():
    """get_stream_status() reads _subscribed — must reflect refcounted effective set."""
    realtime_stream.subscribe_tickers(["AAPL"])
    realtime_stream.subscribe_tickers(["AAPL"])
    realtime_stream.unsubscribe_tickers(["AAPL"])

    status = realtime_stream.get_stream_status()
    assert status["subscribed_count"] == 1
    assert "AAPL" in status["subscribed_tickers"]
