"""Content identity for the ETF/INDEX classification snapshot.

WHY THIS EXISTS — measured on the live Railway services 2026-09-07:

    web          19,483 ETF/INDEX symbols, last_synced 2026-09-07T09:30
    flow-worker  18,863 ETF/INDEX symbols, last_synced 2026-07-14T05:30

Four separate Railway volumes, every one mounted at /data, so FLOW_DB_PATH
resolves to the same PATH but service-local STORAGE. flow-worker's copy froze at
the P5 cutover and has been 55 days stale while still deciding live tape routing
through massive_processor.is_index_source().

`last_synced` + a row count cannot detect that class of drift on its own: a swap
of one ticker for another leaves both unchanged. These tests pin the digest as
the identity and the single-read snapshot as the consistency guarantee.
"""
import sqlite3
import pytest

from api import ticker_types as tt


@pytest.fixture()
def db(tmp_path, monkeypatch):
    p = tmp_path / "flow.db"
    monkeypatch.setattr(tt, "DB_PATH", str(p))
    conn = sqlite3.connect(str(p))
    tt.ensure_schema(conn)
    conn.close()
    tt.refresh_class_sets()          # drop any memo from another test
    return str(p)


def _put(path, rows):
    conn = sqlite3.connect(path)
    conn.executemany(
        "INSERT OR REPLACE INTO ticker_types (ticker, asset_type, last_synced) VALUES (?,?,?)",
        rows,
    )
    conn.commit()
    conn.close()
    tt.refresh_class_sets()


# ── the digest is a CONTENT identity, not metadata ──────────────────────────
def test_same_content_gives_the_same_generation(db):
    _put(db, [("SPY", "ETF", "t1"), ("QQQ", "ETF", "t1")])
    a = tt.etf_index_snapshot()["generation"]
    _put(db, [("SPY", "ETF", "t1"), ("QQQ", "ETF", "t1")])
    assert tt.etf_index_snapshot()["generation"] == a


def test_insertion_ORDER_does_not_change_the_generation(db):
    _put(db, [("SPY", "ETF", "t1"), ("QQQ", "ETF", "t1")])
    a = tt.etf_index_snapshot()["generation"]
    conn = sqlite3.connect(db); conn.execute("DELETE FROM ticker_types"); conn.commit(); conn.close()
    _put(db, [("QQQ", "ETF", "t1"), ("SPY", "ETF", "t1")])
    assert tt.etf_index_snapshot()["generation"] == a, "digest must be order-independent"


def test_a_SWAP_that_preserves_the_count_still_changes_the_generation(db):
    """⛔ THE CASE last_synced + count CANNOT SEE.

    Same number of symbols, one substituted. A count comparison reports 'equal';
    the digest does not. This is the whole reason the identity is a digest.
    """
    _put(db, [("SPY", "ETF", "t1"), ("QQQ", "ETF", "t1")])
    before = tt.etf_index_snapshot()
    conn = sqlite3.connect(db); conn.execute("DELETE FROM ticker_types"); conn.commit(); conn.close()
    _put(db, [("SPY", "ETF", "t1"), ("IWM", "ETF", "t1")])
    after = tt.etf_index_snapshot()
    assert after["count"] == before["count"], "fixture must hold the count constant"
    assert after["generation"] != before["generation"]


def test_changing_only_asset_type_changes_the_generation(db):
    _put(db, [("SPCX", "ETF", "t1")])
    a = tt.etf_index_snapshot()["generation"]
    conn = sqlite3.connect(db); conn.execute("DELETE FROM ticker_types"); conn.commit(); conn.close()
    _put(db, [("SPCX", "INDEX", "t1")])
    assert tt.etf_index_snapshot()["generation"] != a


def test_STOCK_rows_do_not_affect_the_etf_index_generation(db):
    _put(db, [("SPY", "ETF", "t1")])
    a = tt.etf_index_snapshot()["generation"]
    _put(db, [("NVDA", "STOCK", "t1"), ("AMD", "STOCK", "t1")])
    assert tt.etf_index_snapshot()["generation"] == a, "the projection is ETF/INDEX only"


def test_an_empty_table_still_yields_a_stable_generation(db):
    a = tt.etf_index_snapshot()
    assert a["count"] == 0
    assert isinstance(a["generation"], str) and len(a["generation"]) == 64


# ── snapshot and identity come from ONE read ────────────────────────────────
def test_snapshot_generation_matches_the_rows_it_returned(db):
    _put(db, [("SPY", "ETF", "t1"), ("QQQ", "INDEX", "t1"), ("NVDA", "STOCK", "t1")])
    snap = tt.etf_index_snapshot()
    assert snap["symbols"] == ["QQQ", "SPY"]
    assert snap["count"] == 2
    # Recomputing the digest from the returned rows must reproduce the stamp.
    rebuilt = tt._generation_from_rows([("SPY", "ETF"), ("QQQ", "INDEX")])
    assert snap["generation"] == rebuilt


def test_snapshot_last_synced_travels_with_it_for_diagnostics(db):
    _put(db, [("SPY", "ETF", "2026-09-07T09:30:03")])
    assert tt.etf_index_snapshot()["last_synced"] == "2026-09-07T09:30:03"


# ── the memo must not outlive a sync ────────────────────────────────────────
def test_refresh_class_sets_drops_the_generation_memo(db):
    _put(db, [("SPY", "ETF", "t1")])
    a = tt.classification_generation()["generation"]
    conn = sqlite3.connect(db)
    conn.execute("INSERT OR REPLACE INTO ticker_types (ticker, asset_type, last_synced) "
                 "VALUES ('IWM','ETF','t2')")
    conn.commit(); conn.close()
    # Without the memo drop this would still report the OLD identity — a replica
    # comparing against it would believe it was current while holding stale rows.
    tt.refresh_class_sets()
    assert tt.classification_generation()["generation"] != a


def test_classification_generation_agrees_with_the_full_snapshot(db):
    _put(db, [("SPY", "ETF", "t1"), ("QQQ", "ETF", "t1")])
    assert tt.classification_generation()["generation"] == tt.etf_index_snapshot()["generation"]


def test_generation_read_failure_is_non_fatal(db, monkeypatch):
    def boom():
        raise sqlite3.OperationalError("disk gone")
    monkeypatch.setattr(tt, "etf_index_snapshot", boom)
    tt.refresh_class_sets()
    got = tt.classification_generation()
    assert got["generation"] is None      # declines, never raises
