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
