"""Tests for the incremental (base + delta) R2 snapshot path.

Covers the per-tf delta window, the windowed export, the upload/index/prune,
and an end-to-end base+delta round trip applied to a cold web DB. Uses a fake
in-memory S3 client so no network/R2 is touched.
"""
import os
import sqlite3

import pytest

from api.services import data_sync


def _seed_db(path, rows):
    """rows: list of (ticker, tf, ts, o, h, l, c, v)."""
    c = sqlite3.connect(path)
    c.execute(
        "CREATE TABLE IF NOT EXISTS ohlcv (ticker TEXT NOT NULL, tf TEXT NOT NULL, "
        "ts INTEGER NOT NULL, o REAL, h REAL, l REAL, c REAL, v INTEGER, "
        "PRIMARY KEY (ticker, tf, ts))"
    )
    c.executemany("INSERT OR REPLACE INTO ohlcv VALUES (?,?,?,?,?,?,?,?)", rows)
    c.commit()
    c.close()


class _FakeS3:
    """Minimal S3 double: dict-backed put/get/list/delete."""

    def __init__(self):
        self.objs = {}

    def put_object(self, Bucket, Key, Body, **kw):
        self.objs[Key] = Body if isinstance(Body, bytes) else str(Body).encode()

    def upload_file(self, Filename, Bucket, Key, **kw):
        # Mirrors the real client's streaming upload (data_sync.upload_snapshot
        # ships the base tarball from disk, not RAM, since 2026-06-10).
        with open(Filename, "rb") as f:
            self.objs[Key] = f.read()

    def get_object(self, Bucket, Key):
        if Key not in self.objs:
            raise KeyError(Key)
        blob = self.objs[Key]
        return {"Body": type("B", (), {"read": staticmethod(lambda: blob)})()}

    def list_objects_v2(self, Bucket, Prefix):
        return {"Contents": [{"Key": k} for k in self.objs if k.startswith(Prefix)]}

    def delete_object(self, Bucket, Key):
        self.objs.pop(Key, None)


def test_last_base_day_marker_round_trip(tmp_path, monkeypatch):
    """Restart survival: the worker seeds its per-day base tracker from this
    marker so a redeploy doesn't re-ship the multi-GB base within one ET day."""
    monkeypatch.setattr(data_sync, "_DATA_DIR", str(tmp_path))
    assert data_sync.get_last_base_day() is None
    data_sync.set_last_base_day("2026-06-10")
    assert data_sync.get_last_base_day() == "2026-06-10"


def test_delta_cutoffs_are_per_tf_and_ordered():
    cuts = data_sync._delta_cutoffs(now=1_700_000_000)
    for tf in ("1", "5", "15", "30", "60", "D", "W", "M"):
        assert tf in cuts
        assert cuts[tf] < 1_700_000_000
    # intraday window is tighter (more recent cutoff) than the slow-tf window
    assert cuts["5"] > cuts["W"]


def test_export_delta_only_includes_recent_rows(tmp_path, monkeypatch):
    src = str(tmp_path / "bars.db")
    _seed_db(src, [
        ("AAPL", "D", 1_000_000_000, 1, 1, 1, 1, 1),     # ancient -> excluded
        ("AAPL", "5", 1_699_999_000, 2, 2, 2, 2, 2),     # recent  -> included
    ])
    monkeypatch.setattr(data_sync, "_DATA_DIR", str(tmp_path))
    out_db = str(tmp_path / "delta.db")
    n = data_sync._export_delta_db(out_db, now=1_700_000_000)
    assert n == 1
    got = sqlite3.connect(out_db).execute(
        "SELECT ticker,tf,ts FROM ohlcv"
    ).fetchall()
    assert got == [("AAPL", "5", 1_699_999_000)]


def test_upload_delta_writes_tarball_and_index(tmp_path, monkeypatch):
    fake = _FakeS3()
    monkeypatch.setattr(data_sync, "_DATA_DIR", str(tmp_path))
    monkeypatch.setattr(data_sync, "_client", lambda: fake)
    monkeypatch.setattr(data_sync, "_bucket", lambda: "b")
    _seed_db(str(tmp_path / "bars.db"), [("AAPL", "5", 1_699_999_000, 2, 2, 2, 2, 2)])
    ts = data_sync.upload_delta(now=1_700_000_000)
    assert ts == "1700000000"
    assert f"deltas/{ts}.tar.gz" in fake.objs
    assert "deltas/latest.txt" in fake.objs
    assert ts in fake.objs["deltas/latest.txt"].decode()


def test_upload_delta_skips_empty_window(tmp_path, monkeypatch):
    fake = _FakeS3()
    monkeypatch.setattr(data_sync, "_DATA_DIR", str(tmp_path))
    monkeypatch.setattr(data_sync, "_client", lambda: fake)
    monkeypatch.setattr(data_sync, "_bucket", lambda: "b")
    # only an ancient row -> nothing in any window -> no delta shipped
    _seed_db(str(tmp_path / "bars.db"), [("AAPL", "D", 1_000_000_000, 1, 1, 1, 1, 1)])
    assert data_sync.upload_delta(now=1_700_000_000) is None
    assert not any(k.startswith("deltas/") for k in fake.objs)


def test_base_then_delta_round_trip(tmp_path, monkeypatch):
    import time
    fake = _FakeS3()
    monkeypatch.setattr(data_sync, "_client", lambda: fake)
    monkeypatch.setattr(data_sync, "_bucket", lambda: "b")
    # Real wall clock: the base is stamped from time.time(); the delta must be
    # newer (deltas are always uploaded after the base in production).
    base_now = int(time.time())
    delta_now = base_now + 10

    # --- worker side: seed an OLD daily bar + full base, then a RECENT 5m bar + delta ---
    worker_dir = tmp_path / "worker"
    worker_dir.mkdir()
    monkeypatch.setattr(data_sync, "_DATA_DIR", str(worker_dir))
    old_daily_ts = base_now - 100 * 86400   # ~100 days old: in base, outside delta window
    recent_5m_ts = base_now - 3600          # 1h ago: inside the 7-day intraday window
    _seed_db(str(worker_dir / "bars.db"), [("AAPL", "D", old_daily_ts, 1, 1, 1, 1, 1)])
    base_ts = data_sync.upload_snapshot(force=True)        # existing full path
    assert base_ts
    _seed_db(str(worker_dir / "bars.db"),
             [("AAPL", "5", recent_5m_ts, 9, 9, 9, 9, 9)])  # new recent row
    delta_ts = data_sync.upload_delta(now=delta_now)
    assert delta_ts == str(delta_now)

    # --- web side: cold DB, apply base then delta ---
    web_dir = tmp_path / "web"
    web_dir.mkdir()
    monkeypatch.setattr(data_sync, "_DATA_DIR", str(web_dir))
    applied = data_sync.sync_with_deltas()
    assert applied == delta_ts
    rows = sqlite3.connect(str(web_dir / "bars.db")).execute(
        "SELECT ticker,tf,ts FROM ohlcv ORDER BY ts"
    ).fetchall()
    assert ("AAPL", "D", old_daily_ts) in rows    # from base
    assert ("AAPL", "5", recent_5m_ts) in rows    # from delta


def test_sync_with_deltas_is_idempotent(tmp_path, monkeypatch):
    import time
    fake = _FakeS3()
    monkeypatch.setattr(data_sync, "_client", lambda: fake)
    monkeypatch.setattr(data_sync, "_bucket", lambda: "b")
    base_now = int(time.time())
    worker_dir = tmp_path / "worker"
    worker_dir.mkdir()
    monkeypatch.setattr(data_sync, "_DATA_DIR", str(worker_dir))
    _seed_db(str(worker_dir / "bars.db"), [("AAPL", "D", base_now - 100 * 86400, 1, 1, 1, 1, 1)])
    data_sync.upload_snapshot(force=True)
    _seed_db(str(worker_dir / "bars.db"), [("AAPL", "5", base_now - 3600, 9, 9, 9, 9, 9)])
    data_sync.upload_delta(now=base_now + 10)

    web_dir = tmp_path / "web"
    web_dir.mkdir()
    monkeypatch.setattr(data_sync, "_DATA_DIR", str(web_dir))
    data_sync.sync_with_deltas()
    # second run: delta already applied (marker), base already merged -> no-op
    second = data_sync.sync_with_deltas()
    assert second is None
