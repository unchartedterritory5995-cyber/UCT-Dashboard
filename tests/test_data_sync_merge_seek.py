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
    _db(local, [("AAA", "5", 100), ("AAA", "5", 300), ("AAA", "D", 100),
                ("BBB", "5", 100)])
    _db(snap, [("AAA", "5", 200),    # a gap below the local tail: not adopted
               ("AAA", "5", 400),    # newer than the tail: adopted
               ("AAA", "D", 100),    # already there
               ("CCC", "D", 50),     # a pair the pod has never seen: adopted
               ("CCC", "D", 60)])
    assert data_sync._merge_ohlcv_from(snap, local_db=local) == 3
    assert _rows(local) == {("AAA", "5", 100), ("AAA", "5", 300), ("AAA", "5", 400),
                            ("AAA", "D", 100), ("BBB", "5", 100),
                            ("CCC", "D", 50), ("CCC", "D", 60)}


def test_a_snapshot_with_nothing_new_adopts_zero_not_minus_one(tmp_path):
    """-1 is the "no local DB" sentinel `apply_delta` refuses on, so an empty
    merge must say 0."""
    local, snap = str(tmp_path / "bars.db"), str(tmp_path / "delta.db")
    _db(local, [("AAA", "5", 300)])
    _db(snap, [("AAA", "5", 300)])
    assert data_sync._merge_ohlcv_from(snap, local_db=local) == 0


def test_the_merge_never_scans_the_local_table():
    src = open(data_sync.__file__, encoding="utf-8").read()
    fn = src[src.index("def _merge_ohlcv_from"):src.index("def merge_snapshot")]
    sql = re.search(r'conn\.execute\(\s*"""(.*?)"""', fn, re.S).group(1)
    c = sqlite3.connect(":memory:")
    c.execute("ATTACH ':memory:' AS snap")
    for db in ("main", "snap"):
        c.execute(f"CREATE TABLE {db}.ohlcv (ticker TEXT NOT NULL, tf TEXT NOT NULL, "
                  "ts INTEGER NOT NULL, o REAL, h REAL, l REAL, c REAL, v INTEGER, "
                  "PRIMARY KEY (ticker, tf, ts))")
    plan = [r[3] for r in c.execute("EXPLAIN QUERY PLAN " + sql)]
    assert any(p.startswith("SEARCH m ") for p in plan), plan
    assert not any(re.match(r"SCAN (m|main\.ohlcv|ohlcv)\b", p) for p in plan), plan
