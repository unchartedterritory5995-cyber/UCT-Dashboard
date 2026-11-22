"""Rails for the Chart IQ pack backup builder on the worker (api/services/chart_iq/pack_backup.py)."""
import datetime
import io
import sqlite3

import pytest

from api.services.chart_iq import pack_backup as B

TUE_0100 = datetime.datetime(2026, 11, 3, 1, 0)    # Tue 01:00 ET: inside the early-morning window
TUE_1200 = datetime.datetime(2026, 11, 3, 12, 0)   # session hours: outside every window


class FakeS3:
    def __init__(self, objects=None):
        self.objects = dict(objects or {})
        self.puts = []

    def get_object(self, Bucket, Key):
        if Key not in self.objects:
            raise KeyError(Key)
        return {"Body": io.BytesIO(self.objects[Key])}

    def put_object(self, Bucket, Key, Body):
        self.puts.append(Key)
        self.objects[Key] = Body


def _pack(path, day, rows=1200, corrupt=False):
    c = sqlite3.connect(path)
    c.execute("CREATE TABLE reads (ticker TEXT PRIMARY KEY, asof TEXT, body TEXT, built REAL)")
    c.execute("CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT)")
    c.executemany("INSERT INTO reads VALUES (?,?,?,?)", [("T%d" % i, day, "{}", 0.0) for i in range(rows)])
    c.execute("INSERT INTO meta VALUES ('day', ?)", (day,))
    c.commit()
    c.close()
    return 0


@pytest.fixture
def armed(monkeypatch):
    monkeypatch.setenv("CHART_IQ_PACK_WORKER_ENABLED", "1")
    monkeypatch.setenv("DATA_SYNC_BUCKET", "b")
    monkeypatch.setattr(B, "market_day", lambda: "2026-11-02")


def test_off_by_default_and_outside_the_windows(monkeypatch):
    monkeypatch.delenv("CHART_IQ_PACK_WORKER_ENABLED", raising=False)
    assert B.run_once(now=TUE_0100) == {"skipped": "disabled"}
    assert B.start_loop() is False
    monkeypatch.setenv("CHART_IQ_PACK_WORKER_ENABLED", "1")
    assert B.run_once(now=TUE_1200) == {"skipped": "outside window"}   # never during the session


def test_windows():
    assert B.in_window(TUE_0100)
    assert B.in_window(datetime.datetime(2026, 11, 3, 7, 0))       # Tue before the open
    assert not B.in_window(TUE_1200)
    assert not B.in_window(datetime.datetime(2026, 11, 2, 1, 0))   # Mon 01:00: Sunday has no session to catch
    assert not B.in_window(datetime.datetime(2026, 11, 8, 7, 0))   # Sunday morning


def test_current_pack_builds_nothing(armed):
    s3 = FakeS3({"chart_iq/latest_day.txt": b"2026-11-02"})
    called = []
    assert B.run_once(s3=s3, run_child=lambda p: called.append(p), now=TUE_0100)["skipped"] == "current"
    assert called == [] and s3.puts == []


def test_behind_builds_checks_and_publishes_pointer_last(armed):
    s3 = FakeS3({"chart_iq/latest_day.txt": b"2026-10-30"})
    rep = B.run_once(s3=s3, run_child=lambda p: _pack(p, "2026-11-02"), now=TUE_0100)
    assert rep["day"] == "2026-11-02" and rep["rows"] == 1200 and rep["was"] == "2026-10-30"
    assert s3.puts[0].endswith(".db.gz") and s3.puts[1:] == ["chart_iq/latest_day.txt", "chart_iq/latest.txt"]
    assert s3.objects["chart_iq/latest_day.txt"] == b"2026-11-02"


@pytest.mark.parametrize("child,why", [
    (lambda p: _pack(p, "2026-11-02", rows=10), "only 10 reads"),           # too small: the web installer would refuse it
    (lambda p: _pack(p, "2026-10-30"), "pack day 2026-10-30"),              # built the wrong session
    (lambda p: 1, "child build exit 1"),                                    # the child failed
])
def test_a_bad_build_is_never_published(armed, child, why):
    s3 = FakeS3({"chart_iq/latest_day.txt": b"2026-10-30"})
    rep = B.run_once(s3=s3, run_child=child, now=TUE_0100)
    assert why in rep["error"] and s3.puts == []


def test_published_day_falls_back_to_the_packs_own_meta(tmp_path):
    import gzip
    p = tmp_path / "p.db"
    _pack(str(p), "2026-10-29", rows=3)
    s3 = FakeS3({"chart_iq/latest.txt": b"123", "chart_iq/123.db.gz": gzip.compress(p.read_bytes())})
    assert B.published_day(s3, "b") == "2026-10-29"
    assert B.published_day(FakeS3(), "b") is None    # nothing published: behind by definition


def test_child_builds_into_the_given_file_with_the_build_gate_open_only_there(tmp_path, monkeypatch):
    from api.services.chart_iq import pack
    for k in ("CHART_IQ_PACK_DB", "CHART_IQ_ENABLED", "CHART_IQ_PACK_ENABLED", "CHART_IQ_PACK_FALLBACK_ENABLED"):
        monkeypatch.setenv(k, "0")          # monkeypatch restores whatever the child sets
    seen = {}

    def fake_build(force=False):
        seen.update(force=force, db=pack._path(), gate=pack.server_build_allowed())
        _pack(pack._path(), "2026-11-02", rows=5)
        return {"ok": 5}
    monkeypatch.setattr(pack, "build", fake_build)
    out = str(tmp_path / "child.db")
    assert B._child(out) == 0
    assert seen == {"force": True, "db": out, "gate": True}
    c = sqlite3.connect(out)
    assert dict(c.execute("SELECT k, v FROM meta").fetchall())["source"] == "worker"
    c.close()


def test_dry_run_builds_at_any_hour_even_when_current_and_never_touches_the_live_keys(armed, monkeypatch):
    monkeypatch.setenv("CHART_IQ_PACK_WORKER_DRYRUN", "1")
    s3 = FakeS3({"chart_iq/latest_day.txt": b"2026-11-02"})     # current: a real run would skip
    rep = B.run_once(s3=s3, run_child=lambda p: _pack(p, "2026-11-02"), now=TUE_1200)   # and it is session hours
    assert rep["test"] is True and rep["rows"] == 1200
    assert all(k.startswith("chart_iq_test/") for k in s3.puts) and len(s3.puts) == 3
    assert s3.objects["chart_iq/latest_day.txt"] == b"2026-11-02"   # the live keys are untouched
