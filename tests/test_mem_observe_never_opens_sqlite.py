"""Rail: mem_observe's page-cache scan never opens a SQLite file (2026-11-13 root cause of the flow.db
corruption: its os.open()+os.close() dropped the process's POSIX locks, and SQLite then deleted the live
-wal/-shm as the 'last connection')."""
import os
import sqlite3
import sys

import pytest

from api.services import mem_observe as mo


def _big(path):
    with open(path, "wb") as f:
        f.write(b"\0" * (mo._FILE_MIN_BYTES + 10))


def test_sqlite_files_and_sidecars_are_never_candidates(tmp_path):
    for n in ("flow.db", "flow.db-wal", "flow.db-shm", "bars.db-journal", "x.sqlite3", "keep.bin"):
        _big(str(tmp_path / n))
    labels = [os.path.basename(c[0]) for c in mo._candidate_files([str(tmp_path)])]
    assert labels == ["keep.bin"], labels


@pytest.mark.parametrize("label", ["/data/flow.db-wal (deleted)", "/data/flow.db-shm (deleted)",
                                   "/data/flow.db", "/data/brain/data/uct_intelligence.db"])
def test_deleted_and_open_sqlite_labels_are_recognised(label):
    assert mo._is_sqlite_name(label)


def test_control_ordinary_files_are_still_measured():
    assert not mo._is_sqlite_name("/data/tape_spool/frames-1.bin")
    assert not mo._is_sqlite_name("/data/flow_backups/tape-2026-11-06.csv.gz")


@pytest.mark.skipif(not sys.platform.startswith("linux"), reason="POSIX lock semantics + /proc are Linux")
def test_a_full_scan_beside_a_live_wal_database_leaves_its_wal_alone(tmp_path):
    p = str(tmp_path / "live.db")
    c = sqlite3.connect(p)
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("CREATE TABLE t (b BLOB)")
    c.execute("INSERT INTO t VALUES (?)", (b"\0" * (2 << 20),))
    c.commit()
    anchor = sqlite3.connect(p)
    anchor.execute("SELECT count(*) FROM t").fetchone()
    mo.file_cache([str(tmp_path)])
    w = sqlite3.connect(p)
    w.execute("INSERT INTO t VALUES (x'00')")
    w.commit()
    w.close()
    assert os.path.exists(p + "-wal")
    anchor.close()
    c.close()
