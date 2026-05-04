"""Tests for api.services.data_sync.

Tests the local tar/untar round-trip without any S3 — just file I/O.
S3 calls are tested manually after deploy by curling /api/health/cache."""
import io
import tarfile
import time

import pytest


def test_make_tarball_round_trip(tmp_path, monkeypatch):
    """A file written under DATA_DIR survives a tarball round-trip."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    # Prep: create fake bars.db and a file inside bars_cache/
    (tmp_path / "bars.db").write_bytes(b"sqlite-fake-data")
    cache = tmp_path / "bars_cache"
    cache.mkdir()
    (cache / "AAPL_D.json").write_text('{"bars":[]}')

    # Reload the module so it picks up the new DATA_DIR.
    import importlib
    from api.services import data_sync
    importlib.reload(data_sync)

    # Make tarball
    data = data_sync._make_tarball()
    assert len(data) > 0

    # Extract and verify
    extract_dir = tmp_path / "extracted"
    extract_dir.mkdir()
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as tar:
        tar.extractall(extract_dir)
    assert (extract_dir / "bars.db").read_bytes() == b"sqlite-fake-data"
    assert (extract_dir / "bars_cache" / "AAPL_D.json").read_text() == '{"bars":[]}'


def test_make_tarball_empty_dir_raises(tmp_path, monkeypatch):
    """If neither bars.db nor bars_cache/ exists, refuse to make an empty snapshot."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    import importlib
    from api.services import data_sync
    importlib.reload(data_sync)
    with pytest.raises(FileNotFoundError):
        data_sync._make_tarball()


def test_local_marker_round_trip(tmp_path, monkeypatch):
    """Writing a marker then reading it back produces correct sync state."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    import importlib
    from api.services import data_sync
    importlib.reload(data_sync)

    ts = str(int(time.time()) - 30)  # snapshot was made 30s ago
    data_sync._write_local_marker(ts)

    state = data_sync.get_local_sync_state()
    assert state["snapshot_ts"] == ts
    assert state["synced_at"] is not None
    # synced_at should be within the last few seconds (we just wrote it)
    assert 0 <= state["seconds_since_sync"] < 5


def test_local_sync_state_when_no_marker(tmp_path, monkeypatch):
    """No marker file → all None."""
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    import importlib
    from api.services import data_sync
    importlib.reload(data_sync)
    state = data_sync.get_local_sync_state()
    assert state == {"snapshot_ts": None, "synced_at": None, "seconds_since_sync": None}


def test_client_returns_none_without_credentials(monkeypatch):
    """No env vars → no client (don't crash; let caller handle gracefully)."""
    for var in ("DATA_SYNC_ENDPOINT_URL", "DATA_SYNC_ACCESS_KEY", "DATA_SYNC_SECRET_KEY"):
        monkeypatch.delenv(var, raising=False)
    import importlib
    from api.services import data_sync
    importlib.reload(data_sync)
    assert data_sync._client() is None
