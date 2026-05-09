import os
import json
import pytest

from api.services import bars_disk_cache, bar_quarantine


@pytest.fixture
def tmp_cache(tmp_path, monkeypatch):
    cache_dir = tmp_path / "bars_cache"
    cache_dir.mkdir()
    db_path = tmp_path / "auth.db"
    monkeypatch.setattr(bars_disk_cache, "_CACHE_DIR", str(cache_dir))
    monkeypatch.setattr(bar_quarantine, "_DB_PATH", str(db_path))
    bar_quarantine.init_schema()
    return cache_dir


def test_put_caches_clean_bars(tmp_cache):
    payload = {
        "bars": [
            {"t": 1715080800, "o": 700, "h": 705, "l": 698, "c": 702.5, "v": 1500000},
            {"t": 1715080900, "o": 702.5, "h": 706, "l": 701, "c": 703, "v": 1200000},
        ]
    }
    bars_disk_cache.put("QQQ", "30", 100, payload)
    got = bars_disk_cache.get("QQQ", "30", 100)
    assert got is not None
    assert len(got["bars"]) == 2


def test_put_rejects_corrupt_bars(tmp_cache):
    """Corrupt bars get filtered out + quarantined; clean bars cached."""
    payload = {
        "bars": [
            {"t": 1715080700, "o": 700, "h": 705, "l": 698, "c": 702.5, "v": 1500000},
            # The QQQ 6.55 phantom — should be quarantined, not cached
            {"t": 1715080800, "o": 6.55, "h": 6.55, "l": 6.55, "c": 6.55, "v": 56},
            {"t": 1715080900, "o": 702.5, "h": 706, "l": 701, "c": 703, "v": 1200000},
        ]
    }
    bars_disk_cache.put("QQQ", "30", 100, payload)
    got = bars_disk_cache.get("QQQ", "30", 100)
    assert got is not None
    bar_times = [b["t"] for b in got["bars"]]
    assert 1715080800 not in bar_times  # phantom filtered
    assert bar_quarantine.is_quarantined("QQQ", "30", 1715080800) is True


def test_put_rejects_all_corrupt_returns_none(tmp_cache):
    """If every bar fails validation, nothing is cached.

    Uses a structurally-broken bar (H<L) so validation fails on the
    first bar regardless of prior-close context (which doesn't exist
    for the leading bar of a payload).
    """
    payload = {
        "bars": [
            # H < L is impossible — structurally invalid, fails on its own
            {"t": 1715080800, "o": 700, "h": 695, "l": 705, "c": 700, "v": 1000000},
        ]
    }
    bars_disk_cache.put("QQQ", "30", 100, payload)
    got = bars_disk_cache.get("QQQ", "30", 100)
    assert got is None
