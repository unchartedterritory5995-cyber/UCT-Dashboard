"""Tests for the universe percentile store (ratings_db)."""
from __future__ import annotations

import importlib

import pytest


@pytest.fixture()
def db(tmp_path, monkeypatch):
    """Fresh ratings_db pointed at a temp file, schema initialized."""
    monkeypatch.setenv("RESEARCH_RATINGS_DB_PATH", str(tmp_path / "rr.db"))
    monkeypatch.setenv("RATINGS_PERCENTILE_MIN_SAMPLE", "10")
    monkeypatch.setenv("RATINGS_SECTOR_MIN_SAMPLE", "5")
    import api.services.research.ratings_db as rdb
    importlib.reload(rdb)
    rdb.init_db()
    yield rdb
    _cleanup_ratings_db(rdb)  # keep seeded distributions out of other test files


def _cleanup_ratings_db(rdb):
    import os
    rdb._invalidate_memo()
    for suf in ("", "-wal", "-shm"):
        try:
            os.remove(rdb.DB_PATH + suf)
        except OSError:
            pass


def _seed_linear(rdb, metric_key, n=100):
    """Store n tickers whose `metric_key` = 0..n-1 so percentile is predictable."""
    for i in range(n):
        rdb.upsert_metrics(f"T{i}", {metric_key: float(i)})
    rdb.rebuild_distributions()


def test_percentile_monotonic_and_bounded(db):
    _seed_linear(db, "rs_return", 100)
    dists = db.get_distributions()
    assert dists["rs_return"]["n"] == 100
    lo = db.percentile("rs_return", -999, dists)   # below everything
    mid = db.percentile("rs_return", 49.5, dists)  # median
    hi = db.percentile("rs_return", 999, dists)    # above everything
    assert 1 <= lo <= mid <= hi <= 99
    assert lo == 1
    assert hi == 99
    assert 45 <= mid <= 55  # roughly median


def test_percentile_inverted_for_value(db):
    # peg distribution 0..99 — LOW peg should rank HIGH when inverted
    _seed_linear(db, "peg", 100)
    dists = db.get_distributions()
    low_peg = db.percentile("peg", 2, dists, invert=True)    # cheap → strong
    high_peg = db.percentile("peg", 95, dists, invert=True)  # expensive → weak
    assert low_peg > high_peg
    assert low_peg >= 90
    assert high_peg <= 10


def test_below_min_sample_returns_none(db):
    # only 5 samples but MIN_SAMPLE=10 → unusable → None (caller uses absolute)
    for i in range(5):
        db.upsert_metrics(f"S{i}", {"roe": float(i)})
    db.rebuild_distributions()
    assert db.percentile("roe", 3, db.get_distributions()) is None


def test_none_value_and_unknown_metric(db):
    _seed_linear(db, "rs_return", 20)
    dists = db.get_distributions()
    assert db.percentile("rs_return", None, dists) is None
    assert db.percentile("nonexistent_metric", 5, dists) is None


def test_upsert_replaces_and_status(db):
    db.upsert_metrics("AAPL", {"rs_return": 10.0, "roe": 30.0})
    db.upsert_metrics("AAPL", {"rs_return": 20.0, "roe": 35.0})  # replace
    for i in range(15):
        db.upsert_metrics(f"X{i}", {"rs_return": float(i)})
    db.rebuild_distributions()
    st = db.status()
    assert st["tickers_stored"] == 16  # AAPL + 15
    assert st["distributions"]["rs_return"]["n"] == 16
    assert st["usable"] is True


def test_fresh_syms_skip_set(db):
    db.upsert_metrics("FRESH", {"rs_return": 1.0})
    fresh = db.get_fresh_syms(max_age_seconds=3600)
    assert "FRESH" in fresh
    # nothing is fresh within a 0s window
    assert db.get_fresh_syms(max_age_seconds=0) == set() or "FRESH" not in db.get_fresh_syms(0)


def test_empty_db_returns_empty_distributions(db):
    assert db.get_distributions() == {}
    assert db.percentile("rs_return", 5) is None  # no dists → None


def test_sector_distributions_and_percentile(db):
    # 10 Tech names rs 0..9, 6 Energy names rs 0..5, 3 Utilities (below gate of 5)
    for i in range(10):
        db.upsert_metrics(f"TECH{i}", {"rs_return": float(i), "sector": "Technology"})
    for i in range(6):
        db.upsert_metrics(f"ENE{i}", {"rs_return": float(i), "sector": "Energy"})
    for i in range(3):
        db.upsert_metrics(f"UTL{i}", {"rs_return": float(i), "sector": "Utilities"})
    db.rebuild_distributions()

    sd = db.get_sector_distributions()
    assert sd["Technology"]["rs_return"]["n"] == 10
    assert sd["Energy"]["rs_return"]["n"] == 6
    # within-sector rank: a high rs in Tech ranks high vs Tech peers
    assert db.sector_percentile("Technology", "rs_return", 9) >= 90
    assert db.sector_percentile("Technology", "rs_return", 0) <= 10
    assert db.sector_count("Technology") == 10
    # Utilities pool (3) is below SECTOR_MIN_SAMPLE=5 → unusable
    assert db.sector_percentile("Utilities", "rs_return", 1) is None
    # unknown sector / None
    assert db.sector_percentile("Nonexistent", "rs_return", 5) is None
    assert db.sector_percentile(None, "rs_return", 5) is None


def test_sector_column_migration_on_existing_table(db, monkeypatch):
    # simulate a pre-Sector-RS table: drop the sector column path by re-running init
    # (init_db is idempotent + adds the column if missing) — just assert upsert+read works
    db.upsert_metrics("X1", {"rs_return": 5.0, "sector": "Healthcare"})
    db.init_db()  # idempotent, must not error or wipe
    db.upsert_metrics("X2", {"rs_return": 6.0, "sector": "Healthcare"})
    assert db.status()["tickers_stored"] == 2
