"""Tests for the dark auth.db R2 backup service."""
from __future__ import annotations

import gzip
import os
import sqlite3
import tempfile

import pytest

from api.services import authdb_backup


# ── helpers ──────────────────────────────────────────────────────────────────
def _seed_db(path: str, rows: int = 25) -> None:
    """Create a small valid sqlite db with a table + `rows` rows."""
    c = sqlite3.connect(path)
    try:
        c.execute("CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT)")
        c.executemany(
            "INSERT INTO users (email) VALUES (?)",
            [(f"u{i}@x.dev",) for i in range(rows)],
        )
        c.commit()
    finally:
        c.close()


class FakeR2:
    """Minimal boto3-S3 stand-in: records uploads + deletes, lists keys."""

    def __init__(self, existing_keys=None):
        self.uploaded = []          # list of (key, size_bytes)
        self.deleted = []           # list of key
        self._keys = list(existing_keys or [])

    def upload_file(self, path, bucket, key, ExtraArgs=None):
        self.uploaded.append((key, os.path.getsize(path)))
        self._keys.append(key)

    def list_objects_v2(self, Bucket=None, Prefix=None):
        pre = Prefix or ""
        return {"Contents": [{"Key": k} for k in self._keys if k.startswith(pre)]}

    def delete_object(self, Bucket=None, Key=None):
        self.deleted.append(Key)
        if Key in self._keys:
            self._keys.remove(Key)


# ── snapshot / integrity ─────────────────────────────────────────────────────
def test_snapshot_produces_valid_sqlite(tmp_path):
    src = str(tmp_path / "auth.db")
    dst = str(tmp_path / "snap.db")
    _seed_db(src, rows=17)

    authdb_backup._snapshot_to_db(src, dst)

    assert os.path.exists(dst)
    assert authdb_backup._integrity_ok(dst) is True
    c = sqlite3.connect(dst)
    try:
        n = c.execute("SELECT COUNT(*) FROM users").fetchone()[0]
    finally:
        c.close()
    assert n == 17


def test_integrity_ok_false_on_garbage(tmp_path):
    bad = str(tmp_path / "not.db")
    with open(bad, "wb") as f:
        f.write(b"this is not a sqlite database at all")
    assert authdb_backup._integrity_ok(bad) is False


# ── gzip round-trip ──────────────────────────────────────────────────────────
def test_gzip_round_trip(tmp_path):
    src = str(tmp_path / "auth.db")
    gz = str(tmp_path / "auth.db.gz")
    _seed_db(src, rows=9)

    authdb_backup._gzip_file(src, gz)

    with open(src, "rb") as f:
        original = f.read()
    with gzip.open(gz, "rb") as f:
        restored = f.read()
    assert restored == original

    # ...and the decompressed bytes are still a usable sqlite db.
    round_db = str(tmp_path / "round.db")
    with open(round_db, "wb") as f:
        f.write(restored)
    assert authdb_backup._integrity_ok(round_db) is True


# ── prune keeps newest N ─────────────────────────────────────────────────────
def test_prune_keeps_newest_n():
    # 20 chronologically-sortable keys; keep the newest 14 → drop the oldest 6.
    keys = [f"{authdb_backup.KEY_PREFIX}202607{d:02d}T120000Z.db.gz" for d in range(1, 21)]
    client = FakeR2(existing_keys=list(keys))

    deleted = authdb_backup._prune(client, "bucket", keep=14)

    assert deleted == 6
    # The six deleted are the OLDEST (lowest timestamps).
    assert set(client.deleted) == set(keys[:6])
    # Newest 14 survive.
    assert set(client._keys) == set(keys[6:])


def test_prune_noop_when_within_limit():
    keys = [f"{authdb_backup.KEY_PREFIX}202607{d:02d}T120000Z.db.gz" for d in range(1, 5)]
    client = FakeR2(existing_keys=list(keys))
    assert authdb_backup._prune(client, "bucket", keep=14) == 0
    assert client.deleted == []


# ── disabled → no-op ─────────────────────────────────────────────────────────
def test_disabled_is_noop(monkeypatch):
    monkeypatch.delenv(authdb_backup.ENABLED_ENV, raising=False)

    # If run_backup wrongly proceeds it will touch data_sync — make that explode
    # so a regression is loud rather than silently doing work while "dark".
    import api.services.data_sync as data_sync

    def _boom():
        raise AssertionError("data_sync._client must not be called while disabled")

    monkeypatch.setattr(data_sync, "_client", _boom)
    assert authdb_backup.run_backup() is None


def test_disabled_when_flag_zero(monkeypatch):
    monkeypatch.setenv(authdb_backup.ENABLED_ENV, "0")
    assert authdb_backup.is_enabled() is False
    assert authdb_backup.run_backup() is None


# ── end-to-end with a mock R2 client ─────────────────────────────────────────
def test_run_backup_end_to_end(tmp_path, monkeypatch):
    src = str(tmp_path / "auth.db")
    _seed_db(src, rows=42)

    monkeypatch.setenv(authdb_backup.ENABLED_ENV, "1")
    monkeypatch.setattr(authdb_backup, "_auth_db_path", lambda: src)

    fake = FakeR2()
    import api.services.data_sync as data_sync
    monkeypatch.setattr(data_sync, "_client", lambda: fake)
    monkeypatch.setattr(data_sync, "_bucket", lambda: "uct-snap")

    ts = authdb_backup.run_backup()

    assert ts is not None
    assert len(fake.uploaded) == 1
    key, size = fake.uploaded[0]
    assert key.startswith(authdb_backup.KEY_PREFIX)
    assert key.endswith(".db.gz")
    assert size > 0


def test_run_backup_skips_when_no_creds(tmp_path, monkeypatch):
    monkeypatch.setenv(authdb_backup.ENABLED_ENV, "1")
    import api.services.data_sync as data_sync
    monkeypatch.setattr(data_sync, "_client", lambda: None)
    monkeypatch.setattr(data_sync, "_bucket", lambda: None)
    assert authdb_backup.run_backup() is None


def test_run_backup_missing_db(tmp_path, monkeypatch):
    monkeypatch.setenv(authdb_backup.ENABLED_ENV, "1")
    monkeypatch.setattr(authdb_backup, "_auth_db_path", lambda: str(tmp_path / "nope.db"))
    fake = FakeR2()
    import api.services.data_sync as data_sync
    monkeypatch.setattr(data_sync, "_client", lambda: fake)
    monkeypatch.setattr(data_sync, "_bucket", lambda: "uct-snap")
    assert authdb_backup.run_backup() is None
    assert fake.uploaded == []
