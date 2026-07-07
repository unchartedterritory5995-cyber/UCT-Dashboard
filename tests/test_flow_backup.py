"""Tests for the offsite flow.db backup + boot integrity check (flow_backup.py).

No network: the R2 client is monkeypatched to an in-memory FakeR2 that captures
uploaded artifacts locally. Covers integrity ok/corrupt+alert, gzip artifact
production, retention prune (keep newest 3 + drop old), the disabled gate, and
the router /status shape.
"""
import gzip
import json
import re
import sqlite3
from datetime import date, timedelta

import pytest

from api import flow_backup as fb
from api.flow_db import FlowDB, COLUMNS


# --- fakes -------------------------------------------------------------------

class FakeR2:
    """Minimal boto3-S3 stand-in: captures uploads to an in-memory {key: bytes}
    dict and supports the list/delete used by prune."""

    def __init__(self):
        self.store = {}

    def upload_file(self, filename, bucket, key, ExtraArgs=None):
        with open(filename, "rb") as f:
            self.store[key] = f.read()

    def list_objects_v2(self, Bucket=None, Prefix=""):
        pref = Prefix or ""
        return {"Contents": [{"Key": k} for k in self.store if k.startswith(pref)]}

    def delete_object(self, Bucket=None, Key=None):
        self.store.pop(Key, None)


class FakeScheduler:
    def __init__(self):
        self.jobs = []

    def add_job(self, func, trigger=None, **kw):
        self.jobs.append({"func": func, "trigger": trigger, **kw})


# --- helpers -----------------------------------------------------------------

def _make_flow_db(path, rows=25):
    """Create a valid flow.db with `rows` inserted rows."""
    FlowDB(path)  # creates the flow table schema
    with sqlite3.connect(path) as c:
        for i in range(rows):
            row = {col: "" for col in COLUMNS}
            row.update({"CreatedDate": "7/6/2026", "CreatedTime": "9:30:00 AM",
                        "Symbol": f"SYM{i}", "Volume": "100", "Price": "1.25",
                        "CallPut": "C", "Strike": "200", "Premium": "50000",
                        "ExpirationDate": "7/17/2026"})
            dedup = FlowDB._make_dedup_key(row, "stocks")
            c.execute(
                """INSERT INTO flow (source, CreatedDate, CreatedTime, Symbol, Type,
                   Volume, Price, Side, CallPut, Strike, Spot, Premium, ExpirationDate,
                   Color, ImpliedVolatility, Dte, ER, StockEtf, Sector, Uoa, Weekly,
                   MktCap, OI, dedup_key)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                ("stocks", *(str(row.get(col, "")) for col in COLUMNS), dedup))
        c.commit()
    return path


@pytest.fixture()
def wired(tmp_path, monkeypatch):
    """A valid flow.db + FakeR2, with the module wired to both and ENABLED on."""
    db_path = str(tmp_path / "flow.db")
    _make_flow_db(db_path, rows=25)
    fake = FakeR2()
    monkeypatch.setattr(fb, "DB_PATH", db_path)
    monkeypatch.setattr(fb, "ENABLED", True)
    monkeypatch.setattr(fb, "_r2_client", lambda: fake)
    monkeypatch.setattr(fb, "_bucket", lambda: "test-bucket")
    return db_path, fake, tmp_path


# --- integrity check ---------------------------------------------------------

def test_integrity_check_ok(tmp_path, monkeypatch):
    db_path = str(tmp_path / "flow.db")
    _make_flow_db(db_path, rows=5)
    monkeypatch.setattr(fb, "DB_PATH", db_path)
    calls = []
    monkeypatch.setattr(fb, "_post_discord", lambda msg: calls.append(msg) or True)
    res = fb.startup_integrity_check()
    assert res["ok"] is True
    assert calls == []  # no alert on a healthy DB


def test_integrity_check_corrupt_alerts(tmp_path, monkeypatch):
    db_path = str(tmp_path / "flow.db")
    # Deliberately-corrupt file: valid path, junk contents -> pragma raises.
    with open(db_path, "wb") as f:
        f.write(b"NOT A SQLITE DATABASE " * 500)
    monkeypatch.setattr(fb, "DB_PATH", db_path)
    calls = []
    monkeypatch.setattr(fb, "_post_discord", lambda msg: calls.append(msg) or True)
    res = fb.startup_integrity_check()
    assert res["ok"] is False
    assert res["alerted"] is True          # would-alert
    assert len(calls) == 1
    assert "detail" in res and res["detail"]


def test_integrity_check_missing_db_is_ok(tmp_path, monkeypatch):
    # A fresh volume with no flow.db yet must NOT page.
    monkeypatch.setattr(fb, "DB_PATH", str(tmp_path / "nope.db"))
    calls = []
    monkeypatch.setattr(fb, "_post_discord", lambda msg: calls.append(msg) or True)
    res = fb.startup_integrity_check()
    assert res["ok"] is True
    assert calls == []


# --- backup produces a gzip artifact locally ---------------------------------

def test_backup_produces_gzip_artifact(wired, tmp_path):
    db_path, fake, _ = wired
    res = fb.backup_flow_db_to_r2()

    assert res["status"] == "ok"
    assert re.fullmatch(r"flow_backups/flow-\d{4}-\d{2}-\d{2}\.db\.gz", res["key"])
    assert res["bytes"] > 0
    assert "duration_sec" in res

    # The artifact was captured, is valid gzip, and decompresses to a valid
    # sqlite DB carrying the same rows.
    assert res["key"] in fake.store
    raw = gzip.decompress(fake.store[res["key"]])
    restored = tmp_path / "restored.db"
    restored.write_bytes(raw)
    conn = sqlite3.connect(str(restored))
    try:
        assert conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        assert conn.execute("SELECT COUNT(*) FROM flow").fetchone()[0] == 25
    finally:
        conn.close()

    # Marker persisted for /status.
    marker = fb._read_marker()
    assert marker and marker["key"] == res["key"] and marker["bytes"] == res["bytes"]


def test_backup_missing_source_errors(tmp_path, monkeypatch):
    monkeypatch.setattr(fb, "DB_PATH", str(tmp_path / "absent.db"))
    monkeypatch.setattr(fb, "ENABLED", True)
    monkeypatch.setattr(fb, "_r2_client", lambda: FakeR2())
    monkeypatch.setattr(fb, "_bucket", lambda: "b")
    res = fb.backup_flow_db_to_r2()
    assert res["status"] == "error"
    assert "not found" in res["error"]


# --- retention prune ---------------------------------------------------------

def _seed_keys(fake, days_ago_list, today):
    for n in days_ago_list:
        d = today - timedelta(days=n)
        fake.store[f"flow_backups/flow-{d.isoformat()}.db.gz"] = b"x"


def test_prune_keeps_newest_3_and_drops_old():
    fake = FakeR2()
    today = date(2026, 7, 6)
    # newest three (0/1/2 days), plus two well past the 14d window (20/40)
    _seed_keys(fake, [0, 1, 2, 20, 40], today)
    res = fb._prune_old_backups(fake, "b", retain_days=14, now_date=today)

    assert len(res["deleted"]) == 2
    assert len(fake.store) == 3
    kept_dates = sorted(fb._date_from_key(k) for k in fake.store)
    assert kept_dates == [today - timedelta(days=2),
                          today - timedelta(days=1), today]


def test_prune_keeps_newest_3_even_when_all_old():
    fake = FakeR2()
    today = date(2026, 7, 6)
    # ALL four are older than 14 days; newest 3 still survive, oldest drops.
    _seed_keys(fake, [20, 30, 40, 50], today)
    res = fb._prune_old_backups(fake, "b", retain_days=14, now_date=today)

    assert len(fake.store) == 3
    assert res["deleted"] == [f"flow_backups/flow-{(today - timedelta(days=50)).isoformat()}.db.gz"]


def test_prune_ignores_unrelated_keys():
    fake = FakeR2()
    today = date(2026, 7, 6)
    fake.store["flow_backups/flow-not-a-date.db.gz"] = b"x"
    fake.store["flow_backups/README.txt"] = b"x"
    _seed_keys(fake, [40], today)
    fb._prune_old_backups(fake, "b", retain_days=14, now_date=today)
    # keep_min protects the single dated key; malformed keys are left alone.
    assert "flow_backups/flow-not-a-date.db.gz" in fake.store
    assert f"flow_backups/flow-{(today - timedelta(days=40)).isoformat()}.db.gz" in fake.store


# --- disabled gate -----------------------------------------------------------

def test_disabled_gate_no_ops(tmp_path, monkeypatch):
    db_path = str(tmp_path / "flow.db")
    _make_flow_db(db_path, rows=3)
    fake = FakeR2()
    monkeypatch.setattr(fb, "DB_PATH", db_path)
    monkeypatch.setattr(fb, "ENABLED", False)
    monkeypatch.setattr(fb, "_r2_client", lambda: fake)
    monkeypatch.setattr(fb, "_bucket", lambda: "b")
    res = fb.backup_flow_db_to_r2()
    assert res["status"] == "disabled"
    assert fake.store == {}  # nothing built or uploaded


# --- scheduler gate ----------------------------------------------------------

def test_register_jobs_gated(monkeypatch):
    monkeypatch.setattr(fb, "ENABLED", False)
    assert fb.register_jobs(FakeScheduler()) is False

    monkeypatch.setattr(fb, "ENABLED", True)
    sched = FakeScheduler()
    assert fb.register_jobs(sched) is True
    assert len(sched.jobs) == 1
    job = sched.jobs[0]
    assert job["id"] == "flow_db_backup"
    assert job["max_instances"] == 1
    assert job["replace_existing"] is True
    assert job["func"] is fb.backup_flow_db_to_r2


# --- router status shape -----------------------------------------------------

def test_router_status_shape(tmp_path, monkeypatch):
    db_path = str(tmp_path / "flow.db")
    _make_flow_db(db_path, rows=1)
    monkeypatch.setattr(fb, "DB_PATH", db_path)
    monkeypatch.setattr(fb, "ENABLED", True)
    monkeypatch.setattr(fb, "RETAIN_DAYS", 14)
    resp = fb.status()
    body = json.loads(resp.body)
    assert {"enabled", "retain_days", "db_path", "r2_configured", "last_backup"} <= set(body)
    assert body["enabled"] is True
    assert body["retain_days"] == 14
    assert body["db_path"] == db_path


def test_router_run_requires_push_secret(monkeypatch):
    monkeypatch.setenv("PUSH_SECRET", "s3cret")
    with pytest.raises(Exception):
        fb.trigger_run(authorization="Bearer wrong")
