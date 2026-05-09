import pytest
from unittest.mock import patch
from api.services import bar_self_heal, bar_quarantine, bar_provenance


@pytest.fixture
def tmp_state(tmp_path, monkeypatch):
    monkeypatch.setattr(bar_provenance, "_DB_PATH", str(tmp_path / "auth.db"))
    monkeypatch.setattr(bar_quarantine, "_DB_PATH", str(tmp_path / "auth.db"))
    bar_provenance.init_schema()
    bar_quarantine.init_schema()


def test_heal_replaces_quarantined_with_alt_clean(tmp_state):
    """Bar quarantined from massive can be healed if FMP returns a valid bar."""
    bar_quarantine.add("QQQ", "30", 1715080800, "deviation 99%", source="massive")
    fmp_clean = {"t": 1715080800, "o": 700, "h": 705, "l": 698, "c": 702, "v": 1500000}

    with patch.object(bar_self_heal, "_fetch_from_alt", return_value=fmp_clean):
        result = bar_self_heal.try_heal("QQQ", "30", 1715080800, original_source="massive")
    assert result["status"] == "healed"
    assert "new_source" in result
    assert bar_quarantine.is_quarantined("QQQ", "30", 1715080800) is False
    # Provenance should reflect the new source
    p = bar_provenance.get("QQQ", "30", 1715080800)
    assert p is not None


def test_heal_no_op_when_alt_unavailable(tmp_state):
    """If alt sources unavailable, leave quarantine in place."""
    bar_quarantine.add("QQQ", "30", 1715080800, "deviation 99%", source="massive")
    with patch.object(bar_self_heal, "_fetch_from_alt", return_value=None):
        result = bar_self_heal.try_heal("QQQ", "30", 1715080800, original_source="massive")
    assert result["status"] == "no-op"
    assert bar_quarantine.is_quarantined("QQQ", "30", 1715080800) is True


def test_heal_skipped_when_not_quarantined(tmp_state):
    """A bar that isn't quarantined should report skipped (not healed/no-op)."""
    result = bar_self_heal.try_heal("QQQ", "30", 1715080800, original_source="massive")
    assert result["status"] == "skipped"


def test_heal_does_not_use_original_source(tmp_state):
    """When healing, don't try the same source that quarantined the bar."""
    bar_quarantine.add("QQQ", "30", 1715080800, "deviation 99%", source="massive")
    sources_tried = []
    def spy(ticker, tf, bar_time, exclude):
        sources_tried.append(exclude)
        return {"t": bar_time, "o": 700, "h": 705, "l": 698, "c": 702, "v": 1500000}
    with patch.object(bar_self_heal, "_fetch_from_alt", side_effect=spy):
        bar_self_heal.try_heal("QQQ", "30", 1715080800, original_source="massive")
    # _fetch_from_alt was called with exclude="massive"
    assert sources_tried[0] == "massive"
