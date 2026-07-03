"""R2 upload integrity gate — the 2026-07-03 outage class.

The download side verified snapshot integrity at three points, but the UPLOAD
side verified nothing. A corrupt (or empty force_resync-recovery) worker DB
shipped to R2, and on the web pods' next pull it deleted the local DB and
installed nothing → every /api/bars 503'd until reboot. `_assert_shippable_db`
makes 'latest' good by construction: integrity_check == 'ok' AND an ohlcv
row-count floor, or the upload is refused (retry next cycle).
"""
import os
import sqlite3

import pytest

from api.services import data_sync
from api.services.data_sync import SnapshotIntegrityError, _assert_shippable_db


def _make_db(path, rows):
    c = sqlite3.connect(path)
    c.execute(
        "CREATE TABLE ohlcv (ticker TEXT NOT NULL, tf TEXT NOT NULL, ts INTEGER NOT NULL, "
        "o REAL, h REAL, l REAL, c REAL, v INTEGER, PRIMARY KEY (ticker, tf, ts))"
    )
    c.executemany(
        "INSERT INTO ohlcv VALUES (?,?,?,?,?,?,?,?)",
        [("T", "D", 20260000 + i, 1.0, 2.0, 0.5, 1.5, 100) for i in range(rows)],
    )
    c.commit()
    c.close()
    return path


def test_valid_db_passes_and_returns_row_count(tmp_path):
    db = _make_db(str(tmp_path / "good.db"), 1500)
    n = _assert_shippable_db(db, 1000, "full snapshot")
    assert n == 1500


def test_empty_schema_db_refused_by_row_floor(tmp_path):
    # The exact force_resync-recovery shape: valid schema, zero rows.
    db = _make_db(str(tmp_path / "empty.db"), 0)
    with pytest.raises(SnapshotIntegrityError):
        _assert_shippable_db(db, 1000, "full snapshot")


def test_truncated_db_below_floor_refused(tmp_path):
    db = _make_db(str(tmp_path / "small.db"), 50)
    with pytest.raises(SnapshotIntegrityError):
        _assert_shippable_db(db, 1000, "full snapshot")


def test_delta_floor_of_1_allows_small_but_rejects_empty(tmp_path):
    small = _make_db(str(tmp_path / "d.db"), 3)
    assert _assert_shippable_db(small, 1, "delta") == 3
    empty = _make_db(str(tmp_path / "e.db"), 0)
    with pytest.raises(SnapshotIntegrityError):
        _assert_shippable_db(empty, 1, "delta")


def test_corrupt_db_bytes_refused(tmp_path):
    # A structurally malformed SQLite file (the 2026-07-03 root artifact).
    p = str(tmp_path / "corrupt.db")
    with open(p, "wb") as f:
        f.write(b"SQLite format 3\x00" + b"\xff" * 4096)  # valid magic, garbage pages
    with pytest.raises(SnapshotIntegrityError):
        _assert_shippable_db(p, 1, "full snapshot")


def test_nonexistent_path_refused(tmp_path):
    with pytest.raises(SnapshotIntegrityError):
        _assert_shippable_db(str(tmp_path / "nope.db"), 1, "full snapshot")


def test_upload_snapshot_skips_when_gate_fails(tmp_path, monkeypatch):
    # End-to-end: a corrupt source DB must make upload_snapshot return None
    # WITHOUT calling the S3 client (nothing ships).
    monkeypatch.setattr(data_sync, "_DATA_DIR", str(tmp_path))
    _make_db(str(tmp_path / "bars.db"), 5)  # below the 1000 floor → refused

    class _Boom:
        def upload_file(self, *a, **k):
            raise AssertionError("upload_file must NOT be called when the gate fails")
        def put_object(self, *a, **k):
            raise AssertionError("put_object must NOT be called when the gate fails")

    monkeypatch.setattr(data_sync, "_client", lambda: _Boom())
    monkeypatch.setattr(data_sync, "_bucket", lambda: "test-bucket")
    monkeypatch.setattr(data_sync, "_snapshot_fingerprint", lambda: "fp-x")
    monkeypatch.setattr(data_sync, "SNAPSHOT_MIN_OHLCV_ROWS", 1000)
    monkeypatch.setattr(data_sync, "_last_uploaded_fingerprint", None, raising=False)

    assert data_sync.upload_snapshot(force=True) is None
