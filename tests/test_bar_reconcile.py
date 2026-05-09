import pytest
from unittest.mock import patch
from api.services import bar_reconcile, bar_provenance, bar_quarantine


@pytest.fixture
def tmp_state(tmp_path, monkeypatch):
    monkeypatch.setattr(bar_provenance, "_DB_PATH", str(tmp_path / "auth.db"))
    monkeypatch.setattr(bar_quarantine, "_DB_PATH", str(tmp_path / "auth.db"))
    bar_provenance.init_schema()
    bar_quarantine.init_schema()


def test_reconcile_marks_verified_when_within_tolerance(tmp_state):
    """Cached and secondary agree on close=702.5; mark verified."""
    cached_bar = {"t": 1715080800, "o": 700, "h": 705, "l": 698, "c": 702.5, "v": 1500000}
    fmp_bar = {"t": 1715080800, "o": 700, "h": 705.1, "l": 698, "c": 702.6, "v": 1490000}

    bar_provenance.record("QQQ", "30", 1715080800, source="massive")
    with patch.object(bar_reconcile, "_fetch_secondary", return_value=fmp_bar):
        verdict = bar_reconcile.reconcile_bar("QQQ", "30", 1715080800, cached_bar, secondary_source="fmp")

    assert verdict == "verified"
    p = bar_provenance.get("QQQ", "30", 1715080800)
    assert p["verified_at"] is not None
    assert bar_quarantine.is_quarantined("QQQ", "30", 1715080800) is False


def test_reconcile_quarantines_on_close_disagreement(tmp_state):
    """Cached and secondary disagree by >0.1% on close → cached quarantined."""
    cached_bar = {"t": 1715080800, "o": 700, "h": 705, "l": 698, "c": 702.5, "v": 1500000}
    fmp_bar = {"t": 1715080800, "o": 700, "h": 705, "l": 698, "c": 850.0, "v": 1500000}

    bar_provenance.record("QQQ", "30", 1715080800, source="massive")
    with patch.object(bar_reconcile, "_fetch_secondary", return_value=fmp_bar):
        verdict = bar_reconcile.reconcile_bar("QQQ", "30", 1715080800, cached_bar, secondary_source="fmp")

    assert verdict == "disagree"
    assert bar_quarantine.is_quarantined("QQQ", "30", 1715080800) is True


def test_reconcile_quarantines_on_volume_disagreement(tmp_state):
    """Cached and secondary disagree on volume by >5% → quarantine."""
    cached_bar = {"t": 1715080800, "o": 700, "h": 705, "l": 698, "c": 702.5, "v": 100000}
    fmp_bar = {"t": 1715080800, "o": 700, "h": 705, "l": 698, "c": 702.5, "v": 1500000}  # 15x

    bar_provenance.record("QQQ", "30", 1715080800, source="massive")
    with patch.object(bar_reconcile, "_fetch_secondary", return_value=fmp_bar):
        verdict = bar_reconcile.reconcile_bar("QQQ", "30", 1715080800, cached_bar, secondary_source="fmp")

    assert verdict == "disagree"
    assert bar_quarantine.is_quarantined("QQQ", "30", 1715080800) is True


def test_reconcile_skips_when_secondary_unavailable(tmp_state):
    cached_bar = {"t": 1715080800, "o": 700, "h": 705, "l": 698, "c": 702.5, "v": 1500000}
    bar_provenance.record("QQQ", "30", 1715080800, source="massive")
    with patch.object(bar_reconcile, "_fetch_secondary", return_value=None):
        verdict = bar_reconcile.reconcile_bar("QQQ", "30", 1715080800, cached_bar, secondary_source="fmp")
    assert verdict == "skipped"
    p = bar_provenance.get("QQQ", "30", 1715080800)
    assert p["verified_at"] is None
    assert bar_quarantine.is_quarantined("QQQ", "30", 1715080800) is False


def test_close_diff_helper():
    assert bar_reconcile._close_diff(100.0, 100.0) == 0.0
    assert abs(bar_reconcile._close_diff(100.0, 99.0) - 0.01) < 0.0001
    assert bar_reconcile._close_diff(0.0, 100.0) == 1.0  # zero-divide protection


def test_volume_diff_helper():
    assert bar_reconcile._volume_diff(1000, 1000) == 0.0
    assert abs(bar_reconcile._volume_diff(1000, 1100) - (100/1100)) < 0.0001
    assert bar_reconcile._volume_diff(0, 0) == 0.0  # zero-divide protection
