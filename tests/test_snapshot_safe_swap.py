"""Rail: a wholesale snapshot install never leaves a WAL beside a main file it does not belong to
(bars-api 2026-11-13: a verified 19.5 GB install read as `malformed` at once)."""
import os
import sqlite3
import threading
import types

import pytest

from api.services import data_sync as ds


def _bs():
    calls = []
    return types.SimpleNamespace(_WRITE_LOCK=threading.Lock(), DB_SWAP_LOCK=threading.Lock(),
                                 _drop_local_conn=lambda: calls.append("drop"),
                                 bump_db_epoch=lambda: calls.append("bump"), calls=calls)


def _mk(path, n, tag):
    c = sqlite3.connect(path)
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("CREATE TABLE IF NOT EXISTS ohlcv (ticker TEXT, v TEXT)")
    c.executemany("INSERT INTO ohlcv VALUES (?, ?)", [("T%d" % i, tag) for i in range(n)])
    c.commit()
    return c


def test_swap_over_a_live_interim_store_yields_the_snapshot_cleanly(tmp_path):
    dst = str(tmp_path / "bars.db")
    interim = _mk(dst, 50, "interim")                 # live store with WAL frames
    interim.execute("PRAGMA wal_autocheckpoint=0")
    interim.execute("INSERT INTO ohlcv VALUES ('X', 'interim')")
    interim.commit()
    frames = open(dst + "-wal", "rb").read()
    interim.close()                                   # (the last close checkpoints and deletes it)
    open(dst + "-wal", "wb").write(frames)            # a live/crashed writer's log left beside it
    assert os.path.getsize(dst + "-wal") > 0
    snap = str(tmp_path / "snap.db")
    s = _mk(snap, 300, "snapshot")
    s.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    s.execute("PRAGMA journal_mode=DELETE")
    s.close()
    bs = _bs()
    assert ds._swap_in_bars_db(snap, dst, bs) is True
    c = sqlite3.connect(dst)
    assert c.execute("PRAGMA quick_check").fetchone()[0] == "ok"
    assert c.execute("SELECT count(*), min(v), max(v) FROM ohlcv").fetchone() == (300, "snapshot", "snapshot")
    c.close()
    assert bs.calls[-1] == "bump"


def test_orphan_sidecars_of_a_removed_store_are_removed(tmp_path):
    dst = str(tmp_path / "bars.db")
    for suf in ("-wal", "-shm"):
        open(dst + suf, "wb").write(b"\x37\x7f\x06\x82" + b"\0" * 60)   # leftovers, no main file
    snap = str(tmp_path / "snap.db")
    s = _mk(snap, 10, "snapshot")
    s.execute("PRAGMA journal_mode=DELETE")
    s.close()
    assert ds._swap_in_bars_db(snap, dst, _bs())
    assert not os.path.exists(dst + "-wal") or os.path.getsize(dst + "-wal") == 0
    c = sqlite3.connect(dst)
    assert c.execute("SELECT count(*) FROM ohlcv").fetchone()[0] == 10
    c.close()


def test_a_busy_old_store_refuses_and_is_kept(tmp_path, monkeypatch):
    monkeypatch.setattr(ds, "SWAP_BUSY_TIMEOUT_S", 1)
    dst = str(tmp_path / "bars.db")
    w = _mk(dst, 20, "old")
    reader = sqlite3.connect(dst)
    reader.execute("BEGIN")
    reader.execute("SELECT count(*) FROM ohlcv").fetchone()     # an open read pins the WAL
    w.execute("INSERT INTO ohlcv VALUES ('Y', 'old')")
    w.commit()
    snap = str(tmp_path / "snap.db")
    s = _mk(snap, 5, "snapshot")
    s.execute("PRAGMA journal_mode=DELETE")
    s.close()
    assert ds._swap_in_bars_db(snap, dst, _bs()) is False
    reader.rollback()
    reader.close()
    w.close()
    c = sqlite3.connect(dst)
    assert c.execute("SELECT count(*) FROM ohlcv").fetchone()[0] == 21
    c.close()
    assert os.path.exists(snap)                                # nothing moved
