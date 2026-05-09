import time
import pytest
from unittest.mock import patch
from api.services import bar_quarantine_cache, bar_quarantine


@pytest.fixture(autouse=True)
def reset():
    bar_quarantine_cache._reset()
    yield
    bar_quarantine_cache._reset()


def test_first_call_hits_db():
    with patch.object(bar_quarantine, "quarantined_times", return_value={1, 2, 3}) as mock_q:
        result = bar_quarantine_cache.quarantined_times_cached("QQQ", "30")
    assert result == {1, 2, 3}
    assert mock_q.call_count == 1


def test_second_call_within_ttl_uses_cache():
    with patch.object(bar_quarantine, "quarantined_times", return_value={1, 2, 3}) as mock_q:
        bar_quarantine_cache.quarantined_times_cached("QQQ", "30")
        bar_quarantine_cache.quarantined_times_cached("QQQ", "30")
    assert mock_q.call_count == 1


def test_invalidate_forces_fresh_lookup():
    with patch.object(bar_quarantine, "quarantined_times", return_value={1}) as mock_q:
        bar_quarantine_cache.quarantined_times_cached("QQQ", "30")
        bar_quarantine_cache.invalidate("QQQ", "30")
        bar_quarantine_cache.quarantined_times_cached("QQQ", "30")
    assert mock_q.call_count == 2


def test_invalidate_uppercases_ticker():
    with patch.object(bar_quarantine, "quarantined_times", return_value={1}) as mock_q:
        bar_quarantine_cache.quarantined_times_cached("qqq", "30")
        bar_quarantine_cache.invalidate("QQQ", "30")  # uppercase
        bar_quarantine_cache.quarantined_times_cached("QQQ", "30")
    assert mock_q.call_count == 2  # invalidated -> re-fetched


def test_different_tfs_cached_separately():
    with patch.object(bar_quarantine, "quarantined_times", return_value={1}) as mock_q:
        bar_quarantine_cache.quarantined_times_cached("QQQ", "1")
        bar_quarantine_cache.quarantined_times_cached("QQQ", "30")
        bar_quarantine_cache.quarantined_times_cached("QQQ", "1")  # cached
    assert mock_q.call_count == 2  # 1 + 30, second tf=1 hit cache


def test_invalidate_all():
    with patch.object(bar_quarantine, "quarantined_times", return_value={1}) as mock_q:
        bar_quarantine_cache.quarantined_times_cached("QQQ", "30")
        bar_quarantine_cache.quarantined_times_cached("SPY", "30")
        bar_quarantine_cache.invalidate_all()
        bar_quarantine_cache.quarantined_times_cached("QQQ", "30")
        bar_quarantine_cache.quarantined_times_cached("SPY", "30")
    assert mock_q.call_count == 4
