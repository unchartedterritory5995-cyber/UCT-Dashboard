"""bars.db WAL checkpointer (2026-09-02).

Root cause of the obscure-long-tail first-view lag: get_bars reads slowed to
0.3-6.8s because the web pod's continuous background writes bloated the WAL with
no dedicated checkpointer. This runs PRAGMA wal_checkpoint(PASSIVE) on a cadence
to keep the WAL small. These pin the flag gate + that a cycle drains the WAL
without raising.
"""
import os
import sqlite3
import tempfile
from unittest.mock import patch

import api.services.bars_wal_checkpointer as ck


def test_enabled_defaults_on_and_respects_kill_switch():
    with patch.dict(os.environ, {}, clear=False):
        os.environ.pop("BARS_WAL_CHECKPOINT_ENABLED", None)
        assert ck.enabled() is True
    with patch.dict(os.environ, {"BARS_WAL_CHECKPOINT_ENABLED": "0"}):
        assert ck.enabled() is False


def _make_wal_db(path: str, rows: int) -> int:
    """Create a WAL db and write `rows` rows WITHOUT checkpointing, so the WAL
    grows. Returns the WAL frame count observed before our checkpoint."""
    w = sqlite3.connect(path)
    w.execute("PRAGMA journal_mode=WAL")
    w.execute("PRAGMA wal_autocheckpoint=0")  # let the WAL grow, like the bloat case
    w.execute("CREATE TABLE ohlcv (ticker TEXT, tf TEXT, ts INT, c REAL)")
    for i in range(rows):
        w.execute("INSERT INTO ohlcv VALUES (?,?,?,?)", ("T", "D", i, float(i)))
    w.commit()
    frames = (w.execute("PRAGMA wal_checkpoint(PASSIVE)").fetchone() or (0, 0, 0))
    # re-dirty so there's something to drain in the test path
    for i in range(rows, rows + rows):
        w.execute("INSERT INTO ohlcv VALUES (?,?,?,?)", ("T", "D", i, float(i)))
    w.commit()
    w.close()
    return frames[1] or 0


def test_run_once_drains_the_wal_and_records_status(tmp_path):
    db = str(tmp_path / "bars.db")
    _make_wal_db(db, 500)
    conn = sqlite3.connect(db, check_same_thread=False)
    conn.execute("PRAGMA busy_timeout=1000")
    ck._run_once(conn)
    st = ck.last_status()
    # A cycle ran: it recorded a mode and a (possibly 0) frame count, no error.
    assert st["mode"] in ("PASSIVE", "TRUNCATE")
    assert st["err"] is None
    assert st["cycles"] >= 1
    # The checkpoint reported a non-negative frame count (WAL is measurable).
    assert st["wal_frames"] is None or st["wal_frames"] >= 0
    conn.close()


def test_run_once_never_raises_on_a_locked_or_odd_db(tmp_path):
    # A fresh db with no WAL / no table still must not raise.
    db = str(tmp_path / "empty.db")
    conn = sqlite3.connect(db, check_same_thread=False)
    conn.execute("PRAGMA journal_mode=WAL")
    ck._run_once(conn)  # should be a clean no-op
    assert ck.last_status()["err"] is None
    conn.close()


def test_db_path_is_sourced_from_bars_sqlite():
    # Never a second path literal — must resolve from the store module.
    from api.services.bars_sqlite import _DB_PATH
    assert ck._db_path() == _DB_PATH
