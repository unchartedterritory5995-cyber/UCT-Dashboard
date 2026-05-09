import os
import sqlite3
import time
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
