"""TERM-014 rail: an R2 snapshot/delta tarball is never read whole into memory.

2026-10-02, production web pod: `merge_snapshot` did `resp["Body"].read()` on the
7.76 GiB base tarball. RssAnon rose +7,914 MiB in ~3 min and held ~30 min (extract +
integrity_check + merge) until the merge returned. The fix streams the body through
`_extract_tar_stream`, which never asks the body for more than `_STREAM_READ_BYTES`.

These tests drive the REAL merge doors (`merge_snapshot`, `apply_delta`) against a
body that REFUSES an unbounded read and records every request size, and assert the
merge still lands the same rows (member-visible behaviour unchanged).
"""
import ast
import inspect
import io
import os
import sqlite3
import tarfile

import pytest

from api.services import data_sync


def _seed_db(path, rows):
    c = sqlite3.connect(path)
    c.execute(
        "CREATE TABLE IF NOT EXISTS ohlcv (ticker TEXT NOT NULL, tf TEXT NOT NULL, "
        "ts INTEGER NOT NULL, o REAL, h REAL, l REAL, c REAL, v INTEGER, "
        "PRIMARY KEY (ticker, tf, ts))"
    )
    c.executemany("INSERT OR REPLACE INTO ohlcv VALUES (?,?,?,?,?,?,?,?)", rows)
    c.commit()
    c.close()


def _tar_gz_of(path, arcname):
    """The member plus 64 KiB of incompressible padding, so the gzip body is
    many times the (shrunken) read bound and must arrive over many reads."""
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        tar.add(path, arcname=arcname)
        pad = os.urandom(64 * 1024)
        info = tarfile.TarInfo("pad.bin")
        info.size = len(pad)
        tar.addfile(info, io.BytesIO(pad))
    return buf.getvalue()


class _StrictBody:
    """A response body that refuses to be read whole and logs each request size."""

    def __init__(self, data):
        self._data = data
        self._pos = 0
        self.requests = []

    def read(self, amt=None):
        if amt is None or amt < 0:
            raise AssertionError("unbounded read() of an R2 tarball body")
        self.requests.append(amt)
        chunk = self._data[self._pos:self._pos + amt]
        self._pos += len(chunk)
        return chunk


class _FakeS3:
    def __init__(self, objs):
        self.objs = objs
        self.bodies = []

    def get_object(self, Bucket, Key):
        body = _StrictBody(self.objs[Key])
        self.bodies.append(body)
        return {"Body": body, "ContentLength": len(self.objs[Key])}


def _wire(monkeypatch, tmp_path, objs):
    fake = _FakeS3(objs)
    monkeypatch.setattr(data_sync, "_DATA_DIR", str(tmp_path))
    monkeypatch.setattr(data_sync, "_client", lambda: fake)
    monkeypatch.setattr(data_sync, "_bucket", lambda: "b")
    return fake


def _local_rows(tmp_path):
    c = sqlite3.connect(str(tmp_path / "bars.db"))
    try:
        return sorted(c.execute("SELECT ticker, tf, ts, c FROM ohlcv").fetchall())
    finally:
        c.close()


def test_bound_is_small():
    # The bound is what makes resident memory independent of the object size.
    assert 0 < data_sync._STREAM_READ_BYTES <= 16 * 1024 * 1024


def test_merge_snapshot_streams_and_still_merges(tmp_path, monkeypatch):
    snap_dir = tmp_path / "snap"
    snap_dir.mkdir()
    _seed_db(str(snap_dir / "bars.db"), [
        ("AAPL", "D", 200, 2, 2, 2, 2, 20),   # newer than local -> adopted
        ("MSFT", "D", 100, 5, 5, 5, 5, 50),   # cold ticker -> adopted
    ])
    payload = _tar_gz_of(str(snap_dir / "bars.db"), "bars.db")
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    _seed_db(str(data_dir / "bars.db"), [("AAPL", "D", 100, 1, 1, 1, 1, 10)])
    # Shrink the bound so a small fixture still needs many reads -- proves the
    # bound is honoured per request, not just "the object happened to be small".
    monkeypatch.setattr(data_sync, "_STREAM_READ_BYTES", 512)
    fake = _wire(monkeypatch, data_dir, {"snapshots/1700000000.tar.gz": payload})

    assert data_sync.merge_snapshot("1700000000") is True

    assert _local_rows(data_dir) == [
        ("AAPL", "D", 100, 1.0), ("AAPL", "D", 200, 2.0), ("MSFT", "D", 100, 5.0),
    ]
    reqs = [r for b in fake.bodies for r in b.requests]
    assert reqs, "the tarball body was never read"
    assert max(reqs) <= 512, f"a read exceeded the bound: {max(reqs)}"
    assert sum(reqs) >= len(payload) > 100 * 512   # the whole body, in bounded pieces


def test_apply_delta_streams_and_still_merges(tmp_path, monkeypatch):
    d_dir = tmp_path / "delta"
    d_dir.mkdir()
    _seed_db(str(d_dir / "delta.db"), [("AAPL", "5", 300, 3, 3, 3, 3, 30)])
    payload = _tar_gz_of(str(d_dir / "delta.db"), "delta.db")
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    _seed_db(str(data_dir / "bars.db"), [("AAPL", "5", 100, 1, 1, 1, 1, 10)])
    monkeypatch.setattr(data_sync, "_STREAM_READ_BYTES", 512)
    fake = _wire(monkeypatch, data_dir, {"deltas/1700000300.tar.gz": payload})

    assert data_sync.apply_delta("1700000300") is True

    assert ("AAPL", "5", 300, 3.0) in _local_rows(data_dir)
    reqs = [r for b in fake.bodies for r in b.requests]
    assert reqs and max(reqs) <= 512


def test_bounded_reader_clamps_unbounded_requests():
    body = _StrictBody(b"x" * 10)
    r = data_sync._BoundedReader(body)
    assert r.read() == b"x" * 10          # unbounded -> clamped, never forwarded
    assert r.read(-1) == b""
    assert all(0 < n <= data_sync._STREAM_READ_BYTES for n in body.requests)


# Functions allowed to read an R2 body whole: each reads a small, bounded object
# (a pointer file, an index, a JSON hot-set, or a pack shard served to a client).
_WHOLE_READ_ALLOWED = {
    "get_bytes", "get_latest_snapshot_ts", "get_hotset", "upload_delta",
    "_list_remote_deltas",
}


def test_no_new_whole_body_read_doors():
    """Any `<...>["Body"].read()` / `body.read()` with no size argument must live
    in a known small-object reader. A new door that reads a tarball whole fails
    here (a body bound to any name containing "body", either case)."""
    tree = ast.parse(inspect.getsource(data_sync))
    offenders = []
    for fn in ast.walk(tree):
        if not isinstance(fn, ast.FunctionDef):
            continue
        for node in ast.walk(fn):
            if (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                    and node.func.attr == "read" and not node.args and not node.keywords
                    and "body" in ast.unparse(node.func.value).lower()):
                if fn.name not in _WHOLE_READ_ALLOWED:
                    offenders.append(f"{fn.name}:{node.lineno}")
    assert not offenders, f"whole-body R2 reads outside the allowlist: {offenders}"
