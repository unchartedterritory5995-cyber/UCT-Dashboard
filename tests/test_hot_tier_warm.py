from unittest.mock import patch
from api import main as api_main
from api.services import bars_hot_tier


def test_warm_helper_loads_priority_tickers():
    """The synchronous warm helper resolves priority tickers and pre-loads the hot tier."""
    bars_hot_tier._reset()
    fake_payload = {"bars": [{"t": 100, "o": 1, "h": 1.1, "l": 0.9, "c": 1, "v": 1000}]}
    with patch.object(api_main, "_resolve_priority_tickers", return_value=["QQQ", "SPY"]), \
         patch("api.main.bars_disk_cache.get", return_value=fake_payload):
        api_main._warm_hot_tier_now()
    # Both tickers across 4 TFs = 8 entries
    assert bars_hot_tier.size() == 8


def test_warm_helper_skips_when_no_tickers():
    bars_hot_tier._reset()
    with patch.object(api_main, "_resolve_priority_tickers", return_value=[]):
        api_main._warm_hot_tier_now()
    assert bars_hot_tier.size() == 0


def test_warm_helper_handles_disk_miss(monkeypatch):
    """If disk cache returns None, skip without crashing."""
    bars_hot_tier._reset()
    with patch.object(api_main, "_resolve_priority_tickers", return_value=["QQQ"]), \
         patch("api.main.bars_disk_cache.get", return_value=None):
        api_main._warm_hot_tier_now()
    assert bars_hot_tier.size() == 0


def test_warm_helper_caps_at_500():
    """Even if 1000 priority tickers resolved, only first 500 are warmed."""
    bars_hot_tier._reset()
    fake = {"bars": [{"t": 1, "o": 1, "h": 1.1, "l": 0.9, "c": 1, "v": 1000}]}
    big_list = [f"T{i}" for i in range(1000)]
    with patch.object(api_main, "_resolve_priority_tickers", return_value=big_list), \
         patch("api.main.bars_disk_cache.get", return_value=fake):
        api_main._warm_hot_tier_now()
    # Hot tier capacity is 500, so even though 500 tickers × 4 TFs = 2000 attempts,
    # only the most-recently-set 500 entries persist
    assert bars_hot_tier.size() == 500
