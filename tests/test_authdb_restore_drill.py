"""Rails for tools/authdb_restore_drill.py — a backup nobody has restored is a hope."""
from __future__ import annotations

import argparse
import datetime as dt
import gzip
import shutil
import sqlite3
from pathlib import Path

import pytest

from tools import authdb_restore_drill as drill

NOW = dt.datetime(2026, 9, 23, 18, 0, 0, tzinfo=dt.timezone.utc)
FRESH_KEY = "authdb/backup/20260923T120000Z.db.gz"  # 6h before NOW
STALE_KEY = "authdb/backup/20260920T120000Z.db.gz"  # 78h before NOW


def _make_backup(tmp: Path, name: str, tables=drill.REQUIRED_TABLES) -> Path:
    db = tmp / "src.db"
    conn = sqlite3.connect(db)
    for t in tables:
        if t == "j2_notes":
            conn.execute("CREATE TABLE j2_notes (id TEXT, updated_at TEXT)")
            conn.execute("INSERT INTO j2_notes VALUES ('n1', '2026-09-23T11:59:00Z')")
        else:
            conn.execute(f'CREATE TABLE "{t}" (id TEXT)')
            conn.execute(f'INSERT INTO "{t}" VALUES (\'x\')')
    conn.commit()
    conn.close()
    gz = tmp / name
    with open(db, "rb") as f_in, gzip.open(gz, "wb") as f_out:
        shutil.copyfileobj(f_in, f_out)
    db.unlink()
    return gz


class FakeR2:
    def __init__(self, objects: dict[str, Path]):
        self.objects = objects
        self.downloaded = []

    def list_objects_v2(self, **kw):
        keys = [k for k in self.objects if k.startswith(kw["Prefix"])]
        return {"Contents": [{"Key": k, "Size": self.objects[k].stat().st_size} for k in keys]}

    def download_file(self, bucket, key, dest):
        self.downloaded.append(key)
        shutil.copyfile(self.objects[key], dest)


def _args(**kw):
    base = dict(file=None, list=False, report=None, keep=False)
    base.update(kw)
    return argparse.Namespace(**base)


def test_a_fresh_intact_backup_passes_and_the_NEWEST_is_the_one_drilled(tmp_path, capsys):
    r2 = FakeR2({
        STALE_KEY: _make_backup(tmp_path, "old.db.gz"),
        FRESH_KEY: _make_backup(tmp_path, "new.db.gz"),
    })
    assert drill.run(_args(), client=r2, bucket="b", now=NOW) == drill.PASS
    assert r2.downloaded == [FRESH_KEY]
    out = capsys.readouterr().out
    assert "integrity_check: ok" in out and "VERDICT: PASS" in out
    # Non-vacuity: the report actually counted rows in the restored copy.
    assert "| users | 1 |" in out and "| j2_notes | 1 |" in out


def test_a_corrupt_backup_fails(tmp_path, capsys):
    bad = tmp_path / "20260923T120000Z.db.gz"
    with gzip.open(bad, "wb") as f:
        f.write(b"SQLite format 3\x00" + b"\x00" * 90 + b"garbage" * 500)
    assert drill.run(_args(file=str(bad)), now=NOW) == drill.FAIL
    assert "VERDICT: FAIL" in capsys.readouterr().out


def test_a_file_that_is_not_gzip_fails_rather_than_crashing(tmp_path, capsys):
    bad = tmp_path / "20260923T120000Z.db.gz"
    bad.write_bytes(b"not gzip at all")
    assert drill.run(_args(file=str(bad)), now=NOW) == drill.FAIL
    assert "not a readable gzip" in capsys.readouterr().out


def test_a_backup_missing_member_tables_fails_by_name(tmp_path, capsys):
    gz = _make_backup(tmp_path, "20260923T120000Z.db.gz",
                      tables=[t for t in drill.REQUIRED_TABLES if t != "j2_notes"])
    assert drill.run(_args(file=str(gz)), now=NOW) == drill.FAIL
    assert "missing tables: j2_notes" in capsys.readouterr().out


def test_a_stale_newest_backup_fails(tmp_path, capsys):
    r2 = FakeR2({STALE_KEY: _make_backup(tmp_path, "old.db.gz")})
    assert drill.run(_args(), client=r2, bucket="b", now=NOW) == drill.FAIL
    assert "78.0h old" in capsys.readouterr().out


def test_no_credentials_is_inconclusive_never_a_pass(tmp_path, capsys, monkeypatch):
    monkeypatch.setattr(drill.data_sync, "_client", lambda: None)
    assert drill.run(_args(), now=NOW) == drill.INCONCLUSIVE
    assert "INCONCLUSIVE" in capsys.readouterr().out


def test_an_empty_bucket_is_inconclusive(tmp_path):
    assert drill.run(_args(), client=FakeR2({}), bucket="b", now=NOW) == drill.INCONCLUSIVE


def test_it_refuses_to_write_under_the_shared_data_root():
    with pytest.raises(SystemExit, match="shared data root"):
        drill.refuse_shared_root(Path("C:/data/drill"))
    drill.refuse_shared_root(Path("C:/Users/someone/drill"))  # does not raise


def test_the_key_layout_comes_from_the_backup_job():
    assert drill.snapshot_time(FRESH_KEY) == dt.datetime(2026, 9, 23, 12, 0, tzinfo=dt.timezone.utc)
    assert FRESH_KEY.startswith(drill.authdb_backup.KEY_PREFIX)


def test_every_required_table_is_one_the_app_actually_creates():
    """The drill's list is checked against the schema the code declares, so a
    renamed table fails here instead of making every real drill FAIL."""
    import re as _re
    repo = drill.REPO
    declared = set()
    for src in (repo / "api").rglob("*.py"):
        if "test" in src.name:
            continue
        declared.update(_re.findall(r"CREATE TABLE IF NOT EXISTS\s+\"?(\w+)", src.read_text(encoding="utf-8", errors="replace")))
    assert "users" in declared and len(declared) > 50  # non-vacuity: the scan found the schema
    assert [t for t in drill.REQUIRED_TABLES if t not in declared] == []
