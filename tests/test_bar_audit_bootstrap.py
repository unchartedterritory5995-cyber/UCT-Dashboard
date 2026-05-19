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


def _marker(tmp_cache):
    import os as _os
    return _os.path.join(_os.path.dirname(str(tmp_cache)), "bar_audit_bootstrap.marker")


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


def test_second_run_skips_via_marker(tmp_cache):
    """The bootstrap is a one-shot migration. Once complete it must NOT
    re-scan on every subsequent boot — that 36-min auth.db write storm
    degraded /api/breadth-monitor + /api/bars in the post-deploy window.
    New bad bars are handled by inline validation on the fetch path.
    """
    import os as _os

    (tmp_cache / "QQQ_30_100.json").write_text(
        json.dumps({"bars": [{"t": 1715080800, "o": 10, "h": 5, "l": 9, "c": 7, "v": 100}]})
    )
    n1 = bar_audit_bootstrap.scan_and_quarantine_existing_cache()
    assert n1 >= 1
    assert bar_quarantine.is_quarantined("QQQ", "30", 1715080800) is True
    assert _os.path.exists(_marker(tmp_cache))

    # A fresh bad bar appears AFTER the one-shot migration completed.
    (tmp_cache / "ABCD_30_100.json").write_text(
        json.dumps({"bars": [{"t": 1715090000, "o": 8, "h": 4, "l": 7, "c": 6, "v": 50}]})
    )
    n2 = bar_audit_bootstrap.scan_and_quarantine_existing_cache()
    assert n2 == n1  # returns recorded count, no re-scan
    assert bar_quarantine.is_quarantined("ABCD", "30", 1715090000) is False


def test_force_rescans_despite_marker(tmp_cache):
    bar_audit_bootstrap.scan_and_quarantine_existing_cache()  # writes marker
    (tmp_cache / "ABCD_30_100.json").write_text(
        json.dumps({"bars": [{"t": 1715090000, "o": 8, "h": 4, "l": 7, "c": 6, "v": 50}]})
    )
    bar_audit_bootstrap.scan_and_quarantine_existing_cache(force=True)
    assert bar_quarantine.is_quarantined("ABCD", "30", 1715090000) is True


def test_stale_marker_version_triggers_rescan(tmp_cache):
    bar_audit_bootstrap.scan_and_quarantine_existing_cache()  # writes current version
    with open(_marker(tmp_cache), "w") as f:
        json.dump({"version": 0, "completed_at": 1, "quarantined": 0}, f)
    (tmp_cache / "ABCD_30_100.json").write_text(
        json.dumps({"bars": [{"t": 1715090000, "o": 8, "h": 4, "l": 7, "c": 6, "v": 50}]})
    )
    bar_audit_bootstrap.scan_and_quarantine_existing_cache()
    assert bar_quarantine.is_quarantined("ABCD", "30", 1715090000) is True
