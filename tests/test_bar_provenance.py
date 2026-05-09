import pytest
from api.services import bar_provenance


@pytest.fixture
def tmp_db(tmp_path, monkeypatch):
    monkeypatch.setattr(bar_provenance, "_DB_PATH", str(tmp_path / "auth.db"))
    bar_provenance.init_schema()


def test_record_and_lookup(tmp_db):
    bar_provenance.record("QQQ", "30", 1715080800, source="massive")
    row = bar_provenance.get("QQQ", "30", 1715080800)
    assert row["source"] == "massive"
    assert row["validated_at"] is not None
    assert row["verified_at"] is None


def test_record_then_verify(tmp_db):
    bar_provenance.record("QQQ", "30", 1715080800, source="massive")
    bar_provenance.mark_verified("QQQ", "30", 1715080800)
    row = bar_provenance.get("QQQ", "30", 1715080800)
    assert row["verified_at"] is not None


def test_record_replaces_existing(tmp_db):
    bar_provenance.record("QQQ", "30", 1715080800, source="massive")
    bar_provenance.record("QQQ", "30", 1715080800, source="fmp")
    row = bar_provenance.get("QQQ", "30", 1715080800)
    assert row["source"] == "fmp"


def test_count_by_source(tmp_db):
    bar_provenance.record("QQQ", "30", 1715080800, source="massive")
    bar_provenance.record("SPY", "30", 1715080800, source="massive")
    bar_provenance.record("AAPL", "30", 1715080800, source="fmp")
    counts = bar_provenance.count_by_source()
    assert counts == {"massive": 2, "fmp": 1}


def test_get_returns_none_for_unknown(tmp_db):
    assert bar_provenance.get("QQQ", "30", 9999) is None


def test_ticker_uppercase_normalization(tmp_db):
    bar_provenance.record("qqq", "30", 1715080800, source="massive")
    row = bar_provenance.get("QQQ", "30", 1715080800)
    assert row is not None
    assert row["ticker"] == "QQQ"
