import time
from unittest.mock import patch

from api.routers import stream


def test_build_stale_events_flags_stale_ticker():
    """When is_stale is True for a subscribed ticker, emit a stale event."""
    with patch("api.routers.stream.realtime_stream.get_last_seen", return_value=1715000000), \
         patch("api.routers.stream.bars_liveness.is_stale", return_value=True):
        events = stream._build_stale_events(["QQQ"], now=1715001000)
        assert len(events) == 1
        assert events[0]["type"] == "stale"
        assert events[0]["sym"] == "QQQ"
        assert events[0]["last_seen"] == 1715000000


def test_build_stale_events_skips_fresh_ticker():
    """When is_stale is False, no event emitted."""
    with patch("api.routers.stream.realtime_stream.get_last_seen", return_value=1715001000), \
         patch("api.routers.stream.bars_liveness.is_stale", return_value=False):
        events = stream._build_stale_events(["QQQ"], now=1715001000)
        assert events == []


def test_build_stale_events_skips_ticker_with_no_last_seen():
    """A ticker that's never had a tick (last_seen = None) shouldn't emit stale."""
    with patch("api.routers.stream.realtime_stream.get_last_seen", return_value=None), \
         patch("api.routers.stream.bars_liveness.is_stale", return_value=True):
        events = stream._build_stale_events(["QQQ"], now=1715001000)
        assert events == []


class _FakeBB:
    """Stub bar_broadcaster: Massive developing-partial last price per symbol."""
    def __init__(self, ts_by_sym):
        self._ts = ts_by_sym

    def get_last_price(self, sym):
        ts = self._ts.get(sym.upper())
        return {"price": 100.0, "ts": ts, "volume": 1} if ts is not None else None


def test_massive_activity_suppresses_finnhub_only_staleness():
    """Finnhub silent >120s but the Massive partial is fresh → NOT stale.

    Regression for the "badge says STALE but the price is ticking" bug: the
    Massive feed powers the visible price/candle, so its activity must count.
    Real is_stale (120s threshold for tf="1", ages measured against the real
    clock — hence now = time.time()), market_open forced via patch.
    """
    now = int(time.time())
    bb = _FakeBB({"QQQ": (now - 30) * 1000})  # Massive bucket 30s old, in MS
    with patch("api.routers.stream.realtime_stream.get_last_seen", return_value=now - 600), \
         patch("api.routers.stream.bars_liveness.is_market_open", return_value=True):
        events = stream._build_stale_events(["QQQ"], now=now, bb=bb)
        assert events == []


def test_stale_when_both_sources_quiet():
    """Finnhub AND Massive both silent past the threshold → stale still fires."""
    now = int(time.time())
    bb = _FakeBB({"QQQ": (now - 600) * 1000})  # Massive also 10 min old
    with patch("api.routers.stream.realtime_stream.get_last_seen", return_value=now - 900), \
         patch("api.routers.stream.bars_liveness.is_market_open", return_value=True):
        events = stream._build_stale_events(["QQQ"], now=now, bb=bb)
        assert len(events) == 1
        assert events[0]["sym"] == "QQQ"
        # Newest source (Massive, seconds-normalized) is what's reported.
        assert events[0]["last_seen"] == now - 600


def test_massive_activity_counts_for_never_finnhub_symbol():
    """last_seen None (Finnhub never printed) but Massive fresh → not stale,
    and Massive quiet → stale (previously invisible to the detector)."""
    now = int(time.time())
    with patch("api.routers.stream.realtime_stream.get_last_seen", return_value=None), \
         patch("api.routers.stream.bars_liveness.is_market_open", return_value=True):
        fresh = stream._build_stale_events(["QQQ"], now=now, bb=_FakeBB({"QQQ": (now - 10) * 1000}))
        assert fresh == []
        quiet = stream._build_stale_events(["QQQ"], now=now, bb=_FakeBB({"QQQ": (now - 600) * 1000}))
        assert len(quiet) == 1


def test_bb_error_falls_back_to_finnhub_only():
    """A throwing bb must never break staleness detection."""
    class _Boom:
        def get_last_price(self, sym):
            raise RuntimeError("boom")

    with patch("api.routers.stream.realtime_stream.get_last_seen", return_value=1715000000), \
         patch("api.routers.stream.bars_liveness.is_stale", return_value=True):
        events = stream._build_stale_events(["QQQ"], now=1715001000, bb=_Boom())
        assert len(events) == 1


def test_build_stale_events_handles_multiple_tickers():
    """Mix of stale and fresh — only stale ones emit events."""
    def fake_last_seen(sym):
        return {"QQQ": 1715000000, "SPY": 1715001000}.get(sym.upper())

    def fake_is_stale(last_bar_time, tf, market_open=None):
        return last_bar_time == 1715000000  # only QQQ is stale

    with patch("api.routers.stream.realtime_stream.get_last_seen", side_effect=fake_last_seen), \
         patch("api.routers.stream.bars_liveness.is_stale", side_effect=fake_is_stale):
        events = stream._build_stale_events(["QQQ", "SPY"], now=1715001000)
        assert len(events) == 1
        assert events[0]["sym"] == "QQQ"
