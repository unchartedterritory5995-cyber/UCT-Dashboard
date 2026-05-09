import pytest

from api.services import bar_quarantine


@pytest.fixture
def tmp_db(tmp_path, monkeypatch):
    db_path = tmp_path / "test_auth.db"
    monkeypatch.setattr(bar_quarantine, "_DB_PATH", str(db_path))
    bar_quarantine.init_schema()
    return db_path


def test_add_and_is_quarantined(tmp_db):
    bar_quarantine.add("QQQ", "30", 1715080800, "deviation 99.1%", source="massive")
    assert bar_quarantine.is_quarantined("QQQ", "30", 1715080800) is True


def test_clean_bar_not_quarantined(tmp_db):
    assert bar_quarantine.is_quarantined("QQQ", "30", 1715080800) is False


def test_remove_quarantine(tmp_db):
    bar_quarantine.add("QQQ", "30", 1715080800, "deviation 99.1%")
    bar_quarantine.remove("QQQ", "30", 1715080800)
    assert bar_quarantine.is_quarantined("QQQ", "30", 1715080800) is False


def test_count(tmp_db):
    bar_quarantine.add("QQQ", "30", 1715080800, "r1")
    bar_quarantine.add("QQQ", "30", 1715080900, "r2")
    bar_quarantine.add("AAPL", "5", 1715080800, "r3")
    assert bar_quarantine.count() == 3
    assert bar_quarantine.count(ticker="QQQ") == 2


def test_list_for_ticker_empty(tmp_db):
    assert bar_quarantine.list_for_ticker("AAPL") == []


def test_list_for_ticker_tf_filter(tmp_db):
    bar_quarantine.add("QQQ", "30", 100, "r1")
    bar_quarantine.add("QQQ", "5", 200, "r2")
    rows = bar_quarantine.list_for_ticker("QQQ", tf="30")
    assert len(rows) == 1
    assert rows[0]["tf"] == "30"


def test_quarantined_times_bulk(tmp_db):
    bar_quarantine.add("QQQ", "30", 100, "r1")
    bar_quarantine.add("QQQ", "30", 200, "r2")
    bar_quarantine.add("QQQ", "5", 300, "r3")  # different tf
    assert bar_quarantine.quarantined_times("QQQ", "30") == {100, 200}


def test_re_quarantine_updates_reason(tmp_db):
    bar_quarantine.add("QQQ", "30", 100, "old reason")
    bar_quarantine.add("QQQ", "30", 100, "new reason")
    rows = bar_quarantine.list_for_ticker("QQQ")
    assert len(rows) == 1
    assert rows[0]["reason"] == "new reason"
