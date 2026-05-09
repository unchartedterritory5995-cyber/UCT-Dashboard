import pytest
from api.services import bars_disk_cache, bar_provenance, bar_quarantine


@pytest.fixture
def tmp_setup(tmp_path, monkeypatch):
    cache_dir = tmp_path / "bars_cache"
    cache_dir.mkdir()
    monkeypatch.setattr(bars_disk_cache, "_CACHE_DIR", str(cache_dir))
    monkeypatch.setattr(bar_provenance, "_DB_PATH", str(tmp_path / "auth.db"))
    monkeypatch.setattr(bar_quarantine, "_DB_PATH", str(tmp_path / "auth.db"))
    bar_provenance.init_schema()
    bar_quarantine.init_schema()
    return cache_dir


def test_put_records_provenance_for_each_clean_bar(tmp_setup):
    payload = {
        "source": "massive",
        "bars": [
            {"t": 1715080800, "o": 700, "h": 705, "l": 698, "c": 702, "v": 1500000},
            {"t": 1715080900, "o": 702, "h": 706, "l": 701, "c": 703, "v": 1200000},
        ],
    }
    bars_disk_cache.put("QQQ", "30", 100, payload)
    p1 = bar_provenance.get("QQQ", "30", 1715080800)
    p2 = bar_provenance.get("QQQ", "30", 1715080900)
    assert p1 is not None
    assert p2 is not None
    assert p1["source"] == "massive"
    assert p2["source"] == "massive"


def test_put_handles_missing_source(tmp_setup):
    """Payload without source field defaults to 'unknown'."""
    payload = {
        "bars": [{"t": 1715080800, "o": 700, "h": 705, "l": 698, "c": 702, "v": 1500000}],
    }
    bars_disk_cache.put("QQQ", "30", 100, payload)
    p = bar_provenance.get("QQQ", "30", 1715080800)
    assert p is not None
    assert p["source"] == "unknown"


def test_put_does_not_record_for_corrupt_bars(tmp_setup):
    """Quarantined bars do NOT get a provenance record (provenance = clean cache only)."""
    payload = {
        "source": "massive",
        "bars": [
            {"t": 1715080800, "o": 700, "h": 705, "l": 698, "c": 702, "v": 1500000},
            # The QQQ 6.55 phantom — quarantined, NOT cached
            {"t": 1715080900, "o": 6.55, "h": 6.55, "l": 6.55, "c": 6.55, "v": 56},
        ],
    }
    bars_disk_cache.put("QQQ", "30", 100, payload)
    # Clean bar has provenance
    assert bar_provenance.get("QQQ", "30", 1715080800) is not None
    # Quarantined bar has no provenance
    assert bar_provenance.get("QQQ", "30", 1715080900) is None


def test_put_provenance_failure_does_not_break_cache_write(tmp_setup, monkeypatch):
    """Provenance write errors must NEVER break the cache write path."""
    def boom(*a, **k):
        raise RuntimeError("simulated DB failure")
    monkeypatch.setattr(bar_provenance, "record", boom)
    payload = {
        "source": "massive",
        "bars": [{"t": 1715080800, "o": 700, "h": 705, "l": 698, "c": 702, "v": 1500000}],
    }
    # Should not raise
    bars_disk_cache.put("QQQ", "30", 100, payload)
    # Cache write should have succeeded
    got = bars_disk_cache.get("QQQ", "30", 100)
    assert got is not None
