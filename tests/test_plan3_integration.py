"""End-to-end test exercising provenance + reconciliation flow."""
import pytest
from unittest.mock import patch
from api.services import bars_disk_cache, bar_provenance, bar_quarantine, bar_reconcile, bar_self_heal


@pytest.fixture
def tmp_state(tmp_path, monkeypatch):
    cache_dir = tmp_path / "bars_cache"
    cache_dir.mkdir()
    monkeypatch.setattr(bars_disk_cache, "_CACHE_DIR", str(cache_dir))
    monkeypatch.setattr(bar_provenance, "_DB_PATH", str(tmp_path / "auth.db"))
    monkeypatch.setattr(bar_quarantine, "_DB_PATH", str(tmp_path / "auth.db"))
    bar_provenance.init_schema()
    bar_quarantine.init_schema()


def test_clean_path_records_provenance(tmp_state):
    """Cache write -> provenance recorded with massive source."""
    payload = {
        "source": "massive",
        "bars": [{"t": 1715080800, "o": 700, "h": 705, "l": 698, "c": 702, "v": 1500000}],
    }
    bars_disk_cache.put("QQQ", "30", 100, payload)
    p = bar_provenance.get("QQQ", "30", 1715080800)
    assert p is not None
    assert p["source"] == "massive"
    assert p["verified_at"] is None


def test_reconcile_marks_verified(tmp_state):
    """After cache write, reconcile against secondary source. Agreement -> verified."""
    bar = {"t": 1715080800, "o": 700, "h": 705, "l": 698, "c": 702, "v": 1500000}
    payload = {"source": "massive", "bars": [bar]}
    bars_disk_cache.put("QQQ", "30", 100, payload)

    fmp_bar = {"t": 1715080800, "o": 700, "h": 705, "l": 698, "c": 702.1, "v": 1490000}
    with patch.object(bar_reconcile, "_fetch_secondary", return_value=fmp_bar):
        verdict = bar_reconcile.reconcile_bar("QQQ", "30", 1715080800, bar, secondary_source="fmp")
    assert verdict == "verified"

    p = bar_provenance.get("QQQ", "30", 1715080800)
    assert p["verified_at"] is not None


def test_disagreement_quarantines_then_self_heal(tmp_state):
    """Cache write -> reconcile disagrees -> quarantined -> self-heal from alt -> cleared."""
    bar = {"t": 1715080800, "o": 700, "h": 705, "l": 698, "c": 702, "v": 1500000}
    payload = {"source": "massive", "bars": [bar]}
    bars_disk_cache.put("QQQ", "30", 100, payload)

    # Reconcile with disagreement
    fmp_bad = {"t": 1715080800, "o": 700, "h": 705, "l": 698, "c": 850.0, "v": 1500000}
    with patch.object(bar_reconcile, "_fetch_secondary", return_value=fmp_bad):
        verdict = bar_reconcile.reconcile_bar("QQQ", "30", 1715080800, bar, secondary_source="fmp")
    assert verdict == "disagree"
    assert bar_quarantine.is_quarantined("QQQ", "30", 1715080800) is True

    # Self-heal from yfinance (the third source)
    yf_clean = {"t": 1715080800, "o": 700, "h": 705, "l": 698, "c": 702, "v": 1500000}
    with patch.object(bar_self_heal, "_fetch_from_alt", return_value=yf_clean):
        result = bar_self_heal.try_heal("QQQ", "30", 1715080800, original_source="massive")
    assert result["status"] == "healed"
    assert bar_quarantine.is_quarantined("QQQ", "30", 1715080800) is False
