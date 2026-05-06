"""Tests for api.services.data_sync.

Tests the local tar/untar round-trip and SQLite backup integration without
any S3 — just file I/O. S3 calls are tested manually after deploy by
hitting /api/health/cache (web) and /internal/health (worker)."""
import io
import sqlite3
import tarfile
import time

import pytest


def _reload_data_sync():
    """Reimport data_sync so it picks up the current DATA_DIR env var."""
    import importlib
    from api.services import data_sync
    importlib.reload(data_sync)
    return data_sync


def test_make_tarball_round_trip(tmp_path, monkeypatch):
    """A real SQLite file written under DATA_DIR survives a tarball round-trip
    and is still a queryable SQLite DB after extraction."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    # Prep: create a real SQLite DB (the backup API only works on real DBs)
    db_path = tmp_path / "bars.db"
    src = sqlite3.connect(str(db_path))
    src.execute("CREATE TABLE t (k INT PRIMARY KEY, v TEXT)")
    src.execute("INSERT INTO t VALUES (1, 'hello')")
    src.commit()
    src.close()
    cache = tmp_path / "bars_cache"
    cache.mkdir()
    (cache / "AAPL_D.json").write_text('{"bars":[]}')

    data_sync = _reload_data_sync()
    data = data_sync._make_tarball()
    assert len(data) > 0

    extract_dir = tmp_path / "extracted"
    extract_dir.mkdir()
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as tar:
        tar.extractall(extract_dir)
    # Extracted DB must still be queryable
    extracted = sqlite3.connect(str(extract_dir / "bars.db"))
    rows = extracted.execute("SELECT k, v FROM t").fetchall()
    extracted.close()
    assert rows == [(1, "hello")]
    assert (extract_dir / "bars_cache" / "AAPL_D.json").read_text() == '{"bars":[]}'


def test_make_tarball_empty_dir_raises(tmp_path, monkeypatch):
    """If neither bars.db nor bars_cache/ exists, refuse to make an empty snapshot."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    data_sync = _reload_data_sync()
    with pytest.raises(FileNotFoundError):
        data_sync._make_tarball()


def test_make_tarball_captures_wal_writes(tmp_path, monkeypatch):
    """Critical regression test: bars.db is in WAL mode and the prewarmer
    writes continuously. Naive tar of bars.db would miss anything still in
    the WAL file. This test writes data via WAL mode and verifies the
    snapshot's bars.db (via backup API) contains those committed-but-not-
    checkpointed rows."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    db_path = tmp_path / "bars.db"
    src = sqlite3.connect(str(db_path))
    src.execute("PRAGMA journal_mode=WAL")
    src.execute("CREATE TABLE t (k INT PRIMARY KEY, v TEXT)")
    src.execute("INSERT INTO t VALUES (1, 'in_wal')")
    src.commit()
    # Deliberately do NOT checkpoint — leave the data sitting in -wal.
    # Keep src open: a checkpoint won't run automatically, AND closing
    # would drain the WAL on some configs. We want a torn-state simulation.

    data_sync = _reload_data_sync()
    data = data_sync._make_tarball()
    src.close()

    extract_dir = tmp_path / "extracted"
    extract_dir.mkdir()
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as tar:
        tar.extractall(extract_dir)
    extracted = sqlite3.connect(str(extract_dir / "bars.db"))
    rows = extracted.execute("SELECT k, v FROM t").fetchall()
    extracted.close()
    # If the backup API was used correctly, the WAL data is there.
    # If we'd naively tar'd the live bars.db, this row would be missing.
    assert rows == [(1, "in_wal")], (
        "Snapshot is missing data that was committed but lived in -wal. "
        "_backup_sqlite_db is not being used correctly."
    )


def test_marker_round_trip(tmp_path, monkeypatch):
    """Writing a marker then reading it back produces correct sync state."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    data_sync = _reload_data_sync()

    ts = str(int(time.time()) - 30)  # snapshot was made 30s ago
    data_sync._write_marker(data_sync._LAST_SYNC_MARKER, ts)

    state = data_sync.get_local_sync_state()
    assert state["snapshot_ts"] == ts
    assert state["synced_at"] is not None
    assert 0 <= state["seconds_since_sync"] < 5


def test_upload_and_sync_markers_are_independent(tmp_path, monkeypatch):
    """The worker's last_upload marker and the web's last_sync marker live
    in separate files so a worker can report uploads without the web ever
    having pulled, and vice versa."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    data_sync = _reload_data_sync()

    # Worker writes upload marker only
    upload_ts = str(int(time.time()))
    data_sync._write_marker(data_sync._LAST_UPLOAD_MARKER, upload_ts)

    upload = data_sync.get_local_upload_state()
    sync = data_sync.get_local_sync_state()

    assert upload["snapshot_ts"] == upload_ts
    assert sync["snapshot_ts"] is None  # web's sync marker not written

    # Web writes sync marker only (different ts)
    sync_ts = str(int(time.time()) + 1)
    data_sync._write_marker(data_sync._LAST_SYNC_MARKER, sync_ts)

    upload = data_sync.get_local_upload_state()
    sync = data_sync.get_local_sync_state()
    assert upload["snapshot_ts"] == upload_ts  # unchanged
    assert sync["snapshot_ts"] == sync_ts


def test_local_sync_state_when_no_marker(tmp_path, monkeypatch):
    """No marker file → all None."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    data_sync = _reload_data_sync()
    state = data_sync.get_local_sync_state()
    assert state == {"snapshot_ts": None, "synced_at": None, "seconds_since_sync": None}


def test_client_returns_none_without_credentials(monkeypatch):
    """No env vars → no client (don't crash; let caller handle gracefully)."""
    for var in ("DATA_SYNC_ENDPOINT_URL", "DATA_SYNC_ACCESS_KEY", "DATA_SYNC_SECRET_KEY"):
        monkeypatch.delenv(var, raising=False)
    data_sync = _reload_data_sync()
    assert data_sync._client() is None


def test_snapshot_interval_is_five_minutes():
    """Sanity check the interval constant — anything other than 300s would
    surprise the operator and contradict the docs."""
    from api.services import data_sync
    assert data_sync.SNAPSHOT_INTERVAL_SECONDS == 300


def test_download_snapshot_bumps_db_epoch(tmp_path, monkeypatch):
    """Integration regression test: download_snapshot MUST call
    bars_sqlite.bump_db_epoch() after replacing /data/bars.db. Without this,
    every existing thread-local SQLite connection keeps reading the deleted
    inode forever and the entire R2 sync is invisible to user requests.

    This test would have caught the original bug (and any future regression
    from someone "cleaning up" the bump call as dead code)."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("DATA_SYNC_ENDPOINT_URL", "https://example.test")
    monkeypatch.setenv("DATA_SYNC_ACCESS_KEY", "x")
    monkeypatch.setenv("DATA_SYNC_SECRET_KEY", "y")
    monkeypatch.setenv("DATA_SYNC_BUCKET", "test-bucket")

    # Build a tiny tarball containing a real SQLite DB
    import io
    import sqlite3
    import tarfile
    src_db = tmp_path / "src_bars.db"
    s = sqlite3.connect(str(src_db))
    s.execute("CREATE TABLE t (k INT)")
    s.execute("INSERT INTO t VALUES (42)")
    s.commit()
    s.close()
    tar_buf = io.BytesIO()
    with tarfile.open(fileobj=tar_buf, mode="w:gz") as tf:
        tf.add(str(src_db), arcname="bars.db")
    tar_bytes = tar_buf.getvalue()

    # Mock boto3 client
    class _MockBody:
        def read(self):
            return tar_bytes

    class _MockClient:
        def get_object(self, Bucket, Key):
            return {"Body": _MockBody()}

    data_sync = _reload_data_sync()
    monkeypatch.setattr(data_sync, "_client", lambda: _MockClient())

    # Reload bars_sqlite so its _db_epoch starts at 0
    import importlib
    from api.services import bars_sqlite
    importlib.reload(bars_sqlite)
    epoch_before = bars_sqlite._db_epoch

    ok = data_sync.download_snapshot("1234567890")
    assert ok is True

    epoch_after = bars_sqlite._db_epoch
    assert epoch_after == epoch_before + 1, (
        f"download_snapshot did not bump _db_epoch "
        f"(before={epoch_before}, after={epoch_after}). "
        "Connection invalidation broken — pulled snapshots would be ignored "
        "by every thread holding a stale SQLite connection."
    )


def _make_tarball_bytes_with(db_bytes: bytes) -> bytes:
    """Build a tar.gz containing a single bars.db with the provided raw bytes.
    Used to fabricate both good and corrupt snapshots in tests."""
    import os as _os
    import tempfile as _tempfile
    fd, path = _tempfile.mkstemp()
    with _os.fdopen(fd, "wb") as f:
        f.write(db_bytes)
    try:
        buf = io.BytesIO()
        with tarfile.open(fileobj=buf, mode="w:gz") as tar:
            tar.add(path, arcname="bars.db")
        return buf.getvalue()
    finally:
        try:
            _os.remove(path)
        except OSError:
            pass


def test_download_snapshot_refuses_malformed_payload(tmp_path, monkeypatch):
    """A snapshot whose bars.db fails PRAGMA integrity_check must NOT be
    installed. This is the guardrail that prevents the corruption-recovery
    loop from pulling a bad R2 copy on top of a bad local copy and locking
    in the failure permanently."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("DATA_SYNC_ENDPOINT_URL", "https://example.test")
    monkeypatch.setenv("DATA_SYNC_ACCESS_KEY", "x")
    monkeypatch.setenv("DATA_SYNC_SECRET_KEY", "y")
    monkeypatch.setenv("DATA_SYNC_BUCKET", "test-bucket")

    # Pre-existing local bars.db that we don't want clobbered
    local_db = tmp_path / "bars.db"
    local_src = sqlite3.connect(str(local_db))
    local_src.execute("CREATE TABLE preserve (id INT)")
    local_src.execute("INSERT INTO preserve VALUES (777)")
    local_src.commit()
    local_src.close()
    local_db_bytes = local_db.read_bytes()

    # Snapshot whose bars.db is garbage
    tar_bytes = _make_tarball_bytes_with(b"NOT A SQLITE DATABASE")

    class _Body:
        def read(self):
            return tar_bytes

    class _Client:
        def get_object(self, Bucket, Key):
            return {"Body": _Body()}

    data_sync = _reload_data_sync()
    monkeypatch.setattr(data_sync, "_client", lambda: _Client())

    ok = data_sync.download_snapshot("9999999999")
    assert ok is False, "download_snapshot must refuse a snapshot that fails integrity_check"
    # Local file must be untouched — we did not overwrite a possibly-good copy
    assert local_db.read_bytes() == local_db_bytes, (
        "download_snapshot left the local bars.db corrupted — it should "
        "have aborted before any move()"
    )


def test_download_snapshot_does_not_clobber_active_sidecars(tmp_path, monkeypatch):
    """download_snapshot must NOT delete bars.db-wal / bars.db-shm during the
    swap. An earlier version did so (to prevent a theoretical "stale WAL on
    new main file → malformed image" path) but that deletion races with
    in-flight writers — SQLite then reports "disk I/O error" on the next
    operation in any thread that had the WAL open. The malformed-image
    risk is instead handled by integrity_ok() at boot + the put_bars
    malformed handler that triggers force_resync."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("DATA_SYNC_ENDPOINT_URL", "https://example.test")
    monkeypatch.setenv("DATA_SYNC_ACCESS_KEY", "x")
    monkeypatch.setenv("DATA_SYNC_SECRET_KEY", "y")
    monkeypatch.setenv("DATA_SYNC_BUCKET", "test-bucket")

    # Pre-create sidecars that simulate an in-use WAL
    (tmp_path / "bars.db-wal").write_bytes(b"in-use-wal-bytes")
    (tmp_path / "bars.db-shm").write_bytes(b"in-use-shm-bytes")

    # Build a good snapshot
    src_db = tmp_path / "snap_src.db"
    s = sqlite3.connect(str(src_db))
    s.execute("CREATE TABLE t (k INT)")
    s.execute("INSERT INTO t VALUES (1)")
    s.commit()
    s.close()
    tar_bytes = _make_tarball_bytes_with(src_db.read_bytes())

    class _Body:
        def read(self):
            return tar_bytes

    class _Client:
        def get_object(self, Bucket, Key):
            return {"Body": _Body()}

    data_sync = _reload_data_sync()
    monkeypatch.setattr(data_sync, "_client", lambda: _Client())

    ok = data_sync.download_snapshot("123")
    assert ok is True
    # Sidecars must STILL be on disk — deleting them would race with
    # active SQLite writers and surface as disk I/O errors at runtime.
    assert (tmp_path / "bars.db-wal").exists(), (
        "download_snapshot deleted bars.db-wal — this races with in-flight "
        "writers and causes disk I/O errors. See data_sync.py comment."
    )
    assert (tmp_path / "bars.db-shm").exists(), (
        "download_snapshot deleted bars.db-shm — same race as above."
    )


def test_force_resync_clears_marker_and_local_db(tmp_path, monkeypatch):
    """force_resync is the recovery hammer: it must clear the local sync
    marker (so sync_if_newer no longer short-circuits on 'I'm up to date')
    AND delete the local bars.db plus -wal/-shm so a malformed file can't
    poison the next open. We verify the cleanup half here without going
    through R2 — when no remote credentials are configured, force_resync
    returns False but must still have done the local cleanup."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    # Deliberately do NOT set DATA_SYNC_* — get_latest_snapshot_ts returns None
    for var in ("DATA_SYNC_ENDPOINT_URL", "DATA_SYNC_ACCESS_KEY",
                "DATA_SYNC_SECRET_KEY", "DATA_SYNC_BUCKET"):
        monkeypatch.delenv(var, raising=False)

    # Pre-state: corrupt local bars.db, sidecars, and a sync marker
    (tmp_path / "bars.db").write_bytes(b"GARBAGE")
    (tmp_path / "bars.db-wal").write_bytes(b"stale-wal")
    (tmp_path / "bars.db-shm").write_bytes(b"stale-shm")

    data_sync = _reload_data_sync()
    data_sync._write_marker(data_sync._LAST_SYNC_MARKER, "9999")
    assert (tmp_path / data_sync._LAST_SYNC_MARKER).exists()

    ok = data_sync.force_resync()
    assert ok is False, "no remote credentials → cannot pull → returns False"

    # All four files must be gone after force_resync, even though the pull failed
    assert not (tmp_path / "bars.db").exists(), "force_resync did not remove corrupt bars.db"
    assert not (tmp_path / "bars.db-wal").exists(), "force_resync did not remove stale -wal"
    assert not (tmp_path / "bars.db-shm").exists(), "force_resync did not remove stale -shm"
    assert not (tmp_path / data_sync._LAST_SYNC_MARKER).exists(), (
        "force_resync did not clear the sync marker — sync_if_newer would "
        "still short-circuit on the stale 'I'm up to date' check"
    )
