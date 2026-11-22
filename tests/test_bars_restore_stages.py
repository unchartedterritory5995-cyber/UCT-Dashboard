"""A restore must make progress even when deploys keep killing it.

2026-11-08: master was merging about every 15 minutes and every merge redeployed
the worker, so a restore that started over each boot could never finish. Each
stage now persists on the volume, and a kill costs only the stage in progress.

The tarball, gzip and SQLite here are real. Only the R2 client is fake.
"""
from __future__ import annotations

import io
import sqlite3
import tarfile

import pytest

from api.services import bars_restore as br
from api.services import data_sync

TS = "1794127441"


class Client:
    """R2 double that honours Range and can fail mid-stream."""

    def __init__(self, blob: bytes, fail_after=()):
        self.blob = blob
        self.fail_after = list(fail_after)
        self.ranges = []

    def head_object(self, Bucket, Key):
        return {"ContentLength": len(self.blob)}

    def get_object(self, Bucket, Key, Range=None):
        self.ranges.append(Range)
        start = int(Range.split("=")[1].rstrip("-")) if Range else 0
        limit = self.fail_after.pop(0) if self.fail_after else None
        data = self.blob[start:] if limit is None else self.blob[start:start + limit]

        class Body:
            def __init__(self):
                self.raw = io.BytesIO(data)

            def read(self, n):
                chunk = self.raw.read(n)
                if not chunk and limit is not None:
                    raise TimeoutError("read timeout")
                return chunk

        return {"Body": Body()}


def _snapshot(tmp_path, name="bars.db", rows=50):
    db = tmp_path / "src.db"
    c = sqlite3.connect(db)
    c.execute("CREATE TABLE ohlcv (ticker TEXT)")
    c.executemany("INSERT INTO ohlcv VALUES (?)", [(f"T{i}",) for i in range(rows)])
    c.commit()
    c.close()
    out = io.BytesIO()
    with tarfile.open(fileobj=out, mode="w:gz") as t:
        t.add(db, arcname=name)
    db.unlink()
    return out.getvalue()


@pytest.fixture
def data(tmp_path, monkeypatch):
    root = tmp_path / "data"
    root.mkdir()
    monkeypatch.setattr(data_sync, "_DATA_DIR", str(root))
    monkeypatch.setattr(data_sync, "_bucket", lambda: "b")
    monkeypatch.setattr(br, "_RETRY_SLEEP_S", 0)
    return root


def _use(monkeypatch, client):
    monkeypatch.setattr(data_sync, "_client", lambda: client)


def _stage(data):
    return data / ".bars_restore" / TS


def _rows(data):
    c = sqlite3.connect(data / "bars.db")
    try:
        return c.execute("select count(*) from ohlcv").fetchone()[0]
    finally:
        c.close()


def test_a_snapshot_installs_end_to_end(data, tmp_path, monkeypatch):
    _use(monkeypatch, Client(_snapshot(tmp_path)))
    assert br._install_snapshot(TS)
    assert _rows(data) == 50


def test_the_stage_is_removed_after_install(data, tmp_path, monkeypatch):
    _use(monkeypatch, Client(_snapshot(tmp_path)))
    br._install_snapshot(TS)
    assert not _stage(data).exists()


def test_install_records_the_sync_marker(data, tmp_path, monkeypatch):
    _use(monkeypatch, Client(_snapshot(tmp_path)))
    br._install_snapshot(TS)
    assert TS in (data / data_sync._LAST_SYNC_MARKER).read_text()


def test_a_killed_download_resumes_from_its_bytes(data, tmp_path, monkeypatch):
    blob = _snapshot(tmp_path)
    _stage(data).mkdir(parents=True)
    (_stage(data) / "snapshot.tar.gz.part").write_bytes(blob[:100])
    client = Client(blob)
    _use(monkeypatch, client)
    assert br._install_snapshot(TS)
    assert client.ranges == ["bytes=100-"]
    assert _rows(data) == 50


def test_a_read_timeout_retries_the_same_snapshot(data, tmp_path, monkeypatch):
    """A timeout used to fall through to a day-older snapshot."""
    blob = _snapshot(tmp_path)
    client = Client(blob, fail_after=[100])
    _use(monkeypatch, client)
    assert br._install_snapshot(TS)
    assert client.ranges == [None, "bytes=100-"]


def test_a_dead_download_gives_up(data, tmp_path, monkeypatch):
    client = Client(_snapshot(tmp_path), fail_after=[0] * 50)
    _use(monkeypatch, client)
    assert not br._install_snapshot(TS)
    assert len(client.ranges) == br._DOWNLOAD_ATTEMPTS


def test_steady_progress_is_not_counted_as_failure(data, tmp_path, monkeypatch):
    blob = _snapshot(tmp_path)
    client = Client(blob, fail_after=[1] * (br._DOWNLOAD_ATTEMPTS + 3))
    _use(monkeypatch, client)
    assert br._install_snapshot(TS)


def test_an_oversized_partial_restarts(data, tmp_path, monkeypatch):
    blob = _snapshot(tmp_path)
    _stage(data).mkdir(parents=True)
    (_stage(data) / "snapshot.tar.gz.part").write_bytes(b"x" * (len(blob) + 5))
    client = Client(blob)
    _use(monkeypatch, client)
    assert br._install_snapshot(TS)
    assert client.ranges == [None]


def test_a_finished_download_is_not_fetched_again(data, tmp_path, monkeypatch):
    blob = _snapshot(tmp_path)
    _stage(data).mkdir(parents=True)
    (_stage(data) / "snapshot.tar.gz").write_bytes(blob)
    client = Client(blob)
    _use(monkeypatch, client)
    assert br._install_snapshot(TS)
    assert client.ranges == []


def _small_db(tmp_path, rows=1):
    src = tmp_path / "x.db"
    c = sqlite3.connect(src)
    c.execute("CREATE TABLE ohlcv (ticker TEXT)")
    c.executemany("INSERT INTO ohlcv VALUES (?)", [("T",)] * rows)
    c.commit()
    c.close()
    return src


def test_a_finished_extract_is_not_redone(data, tmp_path, monkeypatch):
    src = _small_db(tmp_path)
    _stage(data).mkdir(parents=True)
    (_stage(data) / "bars.db").write_bytes(src.read_bytes())
    client = Client(b"")
    _use(monkeypatch, client)
    assert br._install_snapshot(TS)
    assert client.ranges == []


def test_the_tarball_is_freed_after_extract(data, tmp_path, monkeypatch):
    """Tarball plus database at once is what can fill the volume."""
    seen = {}
    real = br._is_complete_database

    def spy(path):
        seen["tar_present"] = (_stage(data) / "snapshot.tar.gz").exists()
        return real(path)

    monkeypatch.setattr(br, "_is_complete_database", spy)
    _use(monkeypatch, Client(_snapshot(tmp_path)))
    assert br._install_snapshot(TS)
    assert seen["tar_present"] is False


def test_install_does_not_run_the_full_integrity_scan(data, tmp_path, monkeypatch):
    """Measured 2026-11-08: on the 40 GB file this outlived every redeploy gap,
    so the restore could never finish. The snapshot passed the same scan before
    upload, and the uploader repeats it before anything ships again."""

    def explode(_path):
        raise AssertionError("no full scan at install")

    monkeypatch.setattr(data_sync, "_verify_snapshot_db", explode)
    _use(monkeypatch, Client(_snapshot(tmp_path)))
    assert br._install_snapshot(TS)
    assert _rows(data) == 50


def test_a_truncated_database_is_refused(data, tmp_path, monkeypatch):
    src = _small_db(tmp_path, rows=5000)
    bytes_ = src.read_bytes()
    _stage(data).mkdir(parents=True)
    (_stage(data) / "bars.db").write_bytes(bytes_[:len(bytes_) - 4096])
    _use(monkeypatch, Client(b""))
    assert not br._install_snapshot(TS)
    assert not (data / "bars.db").exists()


def test_a_database_with_no_bars_is_refused(data, tmp_path, monkeypatch):
    src = _small_db(tmp_path, rows=0)
    _stage(data).mkdir(parents=True)
    (_stage(data) / "bars.db").write_bytes(src.read_bytes())
    _use(monkeypatch, Client(b""))
    assert not br._install_snapshot(TS)


def test_garbage_in_the_stage_is_refused(data, monkeypatch):
    _stage(data).mkdir(parents=True)
    (_stage(data) / "bars.db").write_bytes(b"NOT SQLITE" * 500)
    _use(monkeypatch, Client(b""))
    assert not br._install_snapshot(TS)


def test_a_gzip_checksum_failure_is_refused(data, tmp_path, monkeypatch):
    """Transport corruption is what the upload-side scan cannot cover."""
    blob = bytearray(_snapshot(tmp_path))
    blob[-8] ^= 0xFF  # the gzip CRC32 trailer
    _use(monkeypatch, Client(bytes(blob)))
    assert not br._install_snapshot(TS)
    assert not (data / "bars.db").exists()


def test_a_corrupt_database_is_refused_and_its_stage_dropped(data, tmp_path, monkeypatch):
    monkeypatch.setattr(br, "_is_complete_database", lambda _p: False)
    _use(monkeypatch, Client(_snapshot(tmp_path)))
    assert not br._install_snapshot(TS)
    assert not (data / "bars.db").exists()
    assert not _stage(data).exists()


def test_a_corrupt_tarball_is_refused_and_its_stage_dropped(data, monkeypatch):
    _use(monkeypatch, Client(b"not a tarball at all"))
    assert not br._install_snapshot(TS)
    assert not _stage(data).exists()


def test_a_tarball_without_the_database_is_refused(data, tmp_path, monkeypatch):
    _use(monkeypatch, Client(_snapshot(tmp_path, name="other.db")))
    assert not br._install_snapshot(TS)
    assert not (data / "bars.db").exists()


def test_a_path_traversal_member_is_never_written(data, tmp_path, monkeypatch):
    _use(monkeypatch, Client(_snapshot(tmp_path, name="../evil.db")))
    assert not br._install_snapshot(TS)
    assert not (data.parent / "evil.db").exists()


def test_no_r2_client_fails_cleanly(data, monkeypatch):
    monkeypatch.setattr(data_sync, "_client", lambda: None)
    assert not br._install_snapshot(TS)


def test_the_stage_survives_a_failed_download(data, tmp_path, monkeypatch):
    """Progress is the point: a network failure must not discard it."""
    blob = _snapshot(tmp_path)
    client = Client(blob, fail_after=[100] + [0] * 50)
    _use(monkeypatch, client)
    assert not br._install_snapshot(TS)
    assert (_stage(data) / "snapshot.tar.gz.part").stat().st_size == 100


def test_a_full_restore_resumes_across_a_simulated_kill(data, tmp_path, monkeypatch):
    blob = _snapshot(tmp_path)
    (data / "bars.db").write_bytes(b"NOT SQLITE" * 200)
    monkeypatch.setattr(data_sync, "get_latest_snapshot_ts", lambda: TS)
    monkeypatch.setattr(data_sync, "_list_snapshot_ts_desc", lambda: [TS])
    first = Client(blob, fail_after=[200] + [0] * 50)
    _use(monkeypatch, first)
    assert not br.restore()
    assert br.restore_needed()
    second = Client(blob)
    _use(monkeypatch, second)
    assert br.restore()
    assert second.ranges == ["bytes=200-"]
    assert _rows(data) == 50 and not br.restore_needed()
