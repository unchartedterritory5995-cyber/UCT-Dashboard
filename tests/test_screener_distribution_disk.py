"""The screener's value bands survive a restart on disk, keyed on the snapshot fingerprint.

Measured on prod 2026-10-09: the first compute after a boot took 83.5 s while the boot's other
warmers held the CPU, and /api/screener/meta waited behind it.
"""
import importlib

import pytest

from api.services.screener import distribution


def _db(tmp_path, monkeypatch, rows):
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "s.db"))
    from api.services.screener import snapshot_db
    importlib.reload(snapshot_db)
    snapshot_db.init_db()
    snapshot_db.upsert_rows(rows)
    distribution.invalidate()
    return snapshot_db


def _rows(n, built_at=1):
    return [{"ticker": f"T{i:04d}", "snapshot_date": "2026-10-08", "built_at": built_at,
             "price": float(10 + i)} for i in range(n)]


@pytest.fixture(autouse=True)
def _clean():
    distribution.invalidate()
    yield
    distribution.invalidate()


def test_a_restart_reads_the_saved_bands_instead_of_recomputing(tmp_path, monkeypatch):
    _db(tmp_path, monkeypatch, _rows(40))
    first = distribution.distributions()
    assert first["columns"]
    distribution._CACHE.clear()          # a new process: memory empty, disk kept

    def boom(conn):
        raise AssertionError("must not recompute when the disk copy matches")

    monkeypatch.setattr(distribution, "compute", boom)
    assert distribution.distributions() == first


def test_a_new_snapshot_recomputes(tmp_path, monkeypatch):
    snap = _db(tmp_path, monkeypatch, _rows(40))
    distribution.distributions()
    distribution._CACHE.clear()
    snap.upsert_rows(_rows(41, built_at=2))   # nightly build: new stamp, new count
    calls = {"n": 0}
    real = distribution.compute

    def counting(conn):
        calls["n"] += 1
        return real(conn)

    monkeypatch.setattr(distribution, "compute", counting)
    distribution.distributions()
    assert calls["n"] == 1


def test_invalidate_drops_the_disk_copy(tmp_path, monkeypatch):
    snap = _db(tmp_path, monkeypatch, _rows(40))
    distribution.distributions()
    import os
    path = distribution._disk_path(snap.get_db_path())
    assert os.path.exists(path)
    distribution.invalidate()
    assert not os.path.exists(path)


def test_a_corrupt_disk_copy_is_ignored(tmp_path, monkeypatch):
    snap = _db(tmp_path, monkeypatch, _rows(40))
    with open(distribution._disk_path(snap.get_db_path()), "w", encoding="utf-8") as fh:
        fh.write("{not json")
    assert distribution.distributions()["columns"]
