import json
import pytest

from api.services import bars_disk_cache, bar_quarantine, bar_audit_bootstrap


@pytest.fixture
def tmp_cache(tmp_path, monkeypatch):
    cache_dir = tmp_path / "bars_cache"
    cache_dir.mkdir()
    db_path = tmp_path / "auth.db"
    monkeypatch.setattr(bars_disk_cache, "_CACHE_DIR", str(cache_dir))
    monkeypatch.setattr(bar_quarantine, "_DB_PATH", str(db_path))
    bar_quarantine.init_schema()
    return cache_dir


def test_scan_finds_existing_corruption(tmp_cache):
    """Plant corrupt bars into a raw cache file (bypass put()), then scan."""
    raw_payload = {
        "bars": [
            {"t": 1715080700, "o": 700, "h": 705, "l": 698, "c": 702, "v": 1500000},
            {"t": 1715080800, "o": 6.55, "h": 6.55, "l": 6.55, "c": 6.55, "v": 56},
        ]
    }
    p = tmp_cache / "QQQ_30_100.json"
    p.write_text(json.dumps(raw_payload))

    n = bar_audit_bootstrap.scan_and_quarantine_existing_cache()
    assert n >= 1
    assert bar_quarantine.is_quarantined("QQQ", "30", 1715080800) is True
    assert bar_quarantine.is_quarantined("QQQ", "30", 1715080700) is False
