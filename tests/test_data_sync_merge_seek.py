"""The snapshot/delta merge seeks per pair; it never scans the local table (2026-10-14).

`_merge_ohlcv_from` used to find each pair's newest local bar with a `GROUP BY`
over ALL of `ohlcv`, inside the write transaction. On bars-api that scan ran
every 20 minutes and every bars write waited behind it; it froze the tier from
10:20 to 10:28 ET on 2026-10-14 and the X-15 gate run read nothing but timeouts.
"""
import re
import sqlite3

from api.services import data_sync


def _db(path, rows):
    c = sqlite3.connect(path)
    c.execute("CREATE TABLE ohlcv (ticker TEXT NOT NULL, tf TEXT NOT NULL, "
              "ts INTEGER NOT NULL, o REAL, h REAL, l REAL, c REAL, v INTEGER, "
              "PRIMARY KEY (ticker, tf, ts))")
    c.executemany("INSERT INTO ohlcv VALUES (?,?,?,10,11,9,10,100)", rows)
    c.commit()
    c.close()


def _rows(path):
    c = sqlite3.connect(path)
    try:
        return set(c.execute("SELECT ticker, tf, ts FROM ohlcv"))
    finally:
        c.close()


def test_only_bars_newer_than_the_local_tail_are_adopted(tmp_path):
    local, snap = str(tmp_path / "bars.db"), str(tmp_path / "delta.db")
    # 5m keys are bucket starts (multiples of 300): the merge refuses off-grid rows.
    _db(local, [("AAA", "5", 300), ("AAA", "5", 900), ("AAA", "D", 100),
                ("BBB", "5", 300)])
    _db(snap, [("AAA", "5", 600),    # below the tail, basis UNPROVEN (no common row): not adopted
               ("AAA", "5", 1200),   # newer than the tail: adopted
               ("AAA", "D", 100),    # already there
               ("CCC", "D", 50),     # a pair the pod has never seen: adopted
               ("CCC", "D", 60)])
    assert data_sync._merge_ohlcv_from(snap, local_db=local) == 3
    assert _rows(local) == {("AAA", "5", 300), ("AAA", "5", 900), ("AAA", "5", 1200),
                            ("AAA", "D", 100), ("BBB", "5", 300),
                            ("CCC", "D", 50), ("CCC", "D", 60)}


def test_a_snapshot_with_nothing_new_adopts_zero_not_minus_one(tmp_path):
    """-1 is the "no local DB" sentinel `apply_delta` refuses on, so an empty
    merge must say 0."""
    local, snap = str(tmp_path / "bars.db"), str(tmp_path / "delta.db")
    _db(local, [("AAA", "5", 300)])
    _db(snap, [("AAA", "5", 300)])
    assert data_sync._merge_ohlcv_from(snap, local_db=local) == 0


def test_the_merge_never_scans_the_local_table():
    """Every per-pair statement the chunked merge runs is a primary-key seek on BOTH
    tables (2026-11-10: the single set-at-a-time statement became per-pair SQL)."""
    c = sqlite3.connect(":memory:")
    c.execute("ATTACH ':memory:' AS snap")
    for db in ("main", "snap"):
        c.execute(f"CREATE TABLE {db}.ohlcv (ticker TEXT NOT NULL, tf TEXT NOT NULL, "
                  "ts INTEGER NOT NULL, o REAL, h REAL, l REAL, c REAL, v INTEGER, "
                  "PRIMARY KEY (ticker, tf, ts))")
    for sql in (data_sync._MERGE_ADD_SQL, data_sync._MERGE_CORRECT_SQL):
        plan = [r[3] for r in c.execute("EXPLAIN QUERY PLAN " + sql, ("A", "5", 0))]
        assert not any(re.match(r"SCAN\b", p) for p in plan), plan
    for basis in (data_sync._MERGE_BASIS_NEWEST_SQL, data_sync._MERGE_BASIS_OLDEST_SQL):
        plan = [r[3] for r in c.execute("EXPLAIN QUERY PLAN " + basis,
                                        (0,) * basis.count("?"))]
        assert not any(re.match(r"SCAN (main\.ohlcv|ohlcv|s)\b", p) for p in plan), plan
