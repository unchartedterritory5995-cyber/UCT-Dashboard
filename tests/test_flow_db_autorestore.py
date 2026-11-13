"""Rails for flow.db self-repair (2026-11-13: page 1 overwritten at 07:35 ET, tape dead until a
person restored the backup at 09:30:40 ET)."""
import hashlib
import os
import sqlite3
import time
from collections import namedtuple

import pytest

from api import flow_db_autorestore as far
from api import flow_gap_autofill as gf
from api import flow_integrity_canary as canary


def _make(path, n, start=1):
    c = sqlite3.connect(path)
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("CREATE TABLE IF NOT EXISTS flow (id INTEGER PRIMARY KEY, x TEXT)")
    c.executemany("INSERT INTO flow VALUES (?, ?)", [(i, "r%d" % i) for i in range(start, start + n)])
    c.commit()
    c.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    c.close()
    for suf in ("-wal", "-shm"):
        if os.path.exists(path + suf):
            os.remove(path + suf)


def _wreck(path):
    with open(path, "r+b") as f:          # what 11/13 looked like: page 1 is not a SQLite header
        f.write(b"\n\x00\x00\x00" + b"\x00" * 60)


def _sha(path):
    return hashlib.sha256(open(path, "rb").read()).hexdigest()


@pytest.fixture
def env(tmp_path, monkeypatch):
    db = str(tmp_path / "flow.db")
    bdir = tmp_path / "flow_backups"
    bdir.mkdir()
    monkeypatch.setattr(gf, "DB_PATH", db)
    monkeypatch.setattr(gf, "BACKUP_DIR", str(bdir))
    monkeypatch.setattr(gf, "BACKUP_FREE_FLOOR_BYTES", 0)
    monkeypatch.setattr(far, "ENABLED", True)
    shouts = []
    monkeypatch.setattr(far, "_shout", shouts.append)
    far._state.update(fatal_ticks=0, last_result=None)
    return db, bdir, shouts


def _backup(bdir, name, n, age_s):
    p = str(bdir / name)
    _make(p, n)
    t = time.time() - age_s
    os.utime(p, (t, t))
    return p


def test_restores_the_newest_good_backup_and_keeps_everything(env):
    db, bdir, shouts = env
    _make(db, 50)
    old = _backup(bdir, "flow-pre-1-2026-11-01.db", 10, 3600)
    new = _backup(bdir, "flow-pre-2-2026-11-12.db", 30, 60)
    h = _sha(new)
    _wreck(db)
    r = far.restore("test")
    assert r["status"] == "restored" and r["backup"] == new
    ok, mx, _ = far.reads_cleanly(db)
    assert ok and mx == 30
    assert _sha(new) == h and os.path.exists(old)             # backups untouched
    assert os.path.exists(r["kept"])                            # damaged file KEPT
    assert any("Restored" in s for s in shouts)
    w = sqlite3.connect(db)                                     # and it takes writes
    w.execute("INSERT INTO flow VALUES (31, 'live')")
    w.commit()
    w.close()


def test_skips_a_bad_newest_backup(env):
    db, bdir, _ = env
    _make(db, 5)
    good = _backup(bdir, "flow-pre-1-a.db", 8, 3600)
    bad = _backup(bdir, "flow-pre-2-b.db", 9, 60)
    _wreck(bad)
    _wreck(db)
    r = far.restore()
    assert r["status"] == "restored" and r["backup"] == good


def test_does_nothing_when_live_reads_cleanly(env):
    db, bdir, _ = env
    _make(db, 5)
    _backup(bdir, "flow-pre-1-a.db", 3, 60)
    h = _sha(db)
    assert far.restore()["status"] == "live_ok"
    assert _sha(db) == h


def test_one_restore_per_cooldown(env):
    db, bdir, _ = env
    _backup(bdir, "flow-pre-1-a.db", 3, 60)
    _make(db, 5)
    _wreck(db)
    assert far.restore()["status"] == "restored"
    _wreck(db)
    assert far.restore()["status"] == "cooldown"
    assert far.restore(now=time.time() + far.COOLDOWN_S + 1)["status"] == "restored"


def test_no_room_and_no_backup_shout_and_swap_nothing(env, monkeypatch):
    db, bdir, shouts = env
    _make(db, 5)
    _wreck(db)
    h = _sha(db)
    assert far.restore()["status"] == "no_backup"
    _backup(bdir, "flow-pre-1-a.db", 3, 60)
    DU = namedtuple("DU", "total used free")
    monkeypatch.setattr(far.shutil, "disk_usage", lambda p: DU(1, 1, 10))
    assert far.restore()["status"] == "no_room"
    assert _sha(db) == h and len(shouts) == 2


def test_disabled(env, monkeypatch):
    db, bdir, _ = env
    _backup(bdir, "flow-pre-1-a.db", 3, 60)
    _make(db, 5)
    _wreck(db)
    monkeypatch.setattr(far, "ENABLED", False)
    assert far.restore()["status"] == "disabled"


def test_trigger_needs_consecutive_fatal_failures(env, monkeypatch):
    calls = []
    monkeypatch.setattr(far, "restore", lambda reason="": calls.append(reason) or {"status": "x"})
    fatal = {"ok": False, "detail": "DatabaseError: file is not a database"}
    assert far.on_canary_result(fatal) is None
    far.on_canary_result({"ok": True})                          # a clean read resets the count
    far.on_canary_result(fatal)
    assert not calls
    far.on_canary_result({"ok": False, "detail": "connect timed out"})   # not fatal: not counted
    far.on_canary_result(fatal)
    assert len(calls) == 1


def test_nightly_backup_is_verified_and_replaces_the_old_one(env):
    db, bdir, _ = env
    _make(db, 40)
    old = _backup(bdir, "flow-pre-1-2026-11-01.db", 3, 7200)
    r = far.nightly_backup()
    assert r["status"] == "ok" and os.path.exists(r["path"])
    assert not os.path.exists(old)                              # one backup kept: the new one
    assert far.reads_cleanly(r["path"])[1] == 40
    assert not [f for f in os.listdir(bdir) if "partial" in f]


def test_nightly_backup_refuses_a_damaged_live_file(env):
    db, bdir, shouts = env
    _make(db, 40)
    old = _backup(bdir, "flow-pre-1-2026-11-01.db", 3, 7200)
    _wreck(db)
    assert far.nightly_backup()["status"] == "live_unreadable"
    assert os.path.exists(old) and shouts


def test_gap_fill_never_prunes_backups_against_a_damaged_live_file(env):
    db, bdir, _ = env
    _make(db, 10)
    old = _backup(bdir, "flow-pre-1-2026-11-01.db", 3, 7200)
    _wreck(db)
    with pytest.raises(RuntimeError, match="does not read cleanly"):
        gf._backup_db(99, __import__("datetime").date(2026, 11, 13))
    assert os.path.exists(old)


def test_canary_onset_is_shouted_and_feeds_the_restore(env, monkeypatch):
    shouted, fed = [], []
    monkeypatch.setattr(canary, "_shout", shouted.append)
    monkeypatch.setattr(canary, "check_once", lambda: {"ok": False, "detail": "file is not a database",
                                                      "max_id": None})
    monkeypatch.setattr(canary, "check_disk", lambda: None)
    monkeypatch.setattr(canary, "check_stall", lambda m: None)
    monkeypatch.setattr(far, "on_canary_result", fed.append)
    canary._state.update(tripped=False)
    canary.run_tick()
    assert fed and any("READ FAILED" in s for s in shouted)
    canary._state.update(tripped=False)
