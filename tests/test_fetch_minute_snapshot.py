from unittest.mock import patch
from api.services import bars_fetch


def test_fetch_minute_snapshot_returns_matching_bar():
    """Given a minute timestamp, return the OHLCV bar for that minute."""
    bars = [
        {"t": 1715080740, "o": 699, "h": 700, "l": 698, "c": 699.5, "v": 40000},
        {"t": 1715080800, "o": 700, "h": 701, "l": 699, "c": 700.5, "v": 50000},
        {"t": 1715080860, "o": 700.5, "h": 702, "l": 700, "c": 701.5, "v": 45000},
    ]
    with patch.object(bars_fetch, "_fetch_intraday_massive", return_value=bars):
        bar = bars_fetch.fetch_minute_snapshot("QQQ", 1715080800)
    assert bar is not None
    assert bar["t"] == 1715080800
    assert bar["c"] == 700.5


def test_fetch_minute_snapshot_returns_none_when_unavailable():
    with patch.object(bars_fetch, "_fetch_intraday_massive", return_value=[]):
        bar = bars_fetch.fetch_minute_snapshot("QQQ", 1715080800)
    assert bar is None


def test_fetch_minute_snapshot_returns_none_when_target_not_in_response():
    """If the target minute isn't in the returned bars, return None."""
    bars = [{"t": 1715080740, "c": 699.5, "v": 40000}]
    with patch.object(bars_fetch, "_fetch_intraday_massive", return_value=bars):
        bar = bars_fetch.fetch_minute_snapshot("QQQ", 1715080800)  # different minute
    assert bar is None


def test_fetch_minute_snapshot_handles_exception():
    """If the fetcher raises, return None gracefully."""
    with patch.object(bars_fetch, "_fetch_intraday_massive", side_effect=RuntimeError("boom")):
        bar = bars_fetch.fetch_minute_snapshot("QQQ", 1715080800)
    assert bar is None
