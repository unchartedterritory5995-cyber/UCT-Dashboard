"""Wisdom capture (S-A, D12) — archive layout, run rows, health, dry run, idempotency.

WHAT THIS FILE HAS TO BE ABLE TO SAY RED FOR
1. an R2 key outside wisdom/context/<as_of>/<dataset>(-NNN)(.sha12).json.gz;
2. an archive encoding that is not byte-stable (every re-run becomes a new version);
3. a re-run of unchanged data writing a second object, or a changed capture
   OVERWRITING the first;
4. a dry run that writes an object, a run row, registry state or a page;
5. a zero or missing capture on a trading day that does not page, a holiday that
   does, or a dataset paging on a state it declared it does not page on;
6. a capture that leaves no run row when the source is unreadable or R2 fails;
7. a watermark that advances on a failed write, or a re-run of the same as_of
   that does not reuse its window;
8. the trailing median counting holidays, weekends or failed runs;
9. a scheduled slot whose datasets do not all run, or whose run ids do not match
   the registry's job run.
"""
from __future__ import annotations

import datetime as dt
import sqlite3

import pytest

from api.services.wisdom import registry
from api.services.wisdom.capture import archive, families, health, runner
from api.services.wisdom.capture.families._base import RowStream, result, safe_reader, watermark_window
from api.services.wisdom.core import r2, store, timeutil

ET = timeutil.ET
NOW = dt.datetime(2026, 9, 14, 17, 0, tzinfo=ET)


@pytest.fixture
def wisdom_db(tmp_path, monkeypatch):
    path = tmp_path / "wisdom.db"
    monkeypatch.setenv("WISDOM_DB_PATH", str(path))
    store.init_db()
    return path


class FakeR2:
    def __init__(self):
        self.objects: dict = {}
        self.puts: list = []

    def head_object(self, Bucket, Key):
        if Key not in self.objects:
            from botocore.exceptions import ClientError

            raise ClientError({"Error": {"Code": "404"}}, "HeadObject")
        return {"Metadata": {"sha256": self.objects[Key][1]}}

    def put_object(self, Bucket, Key, Body, ContentType, Metadata):
        assert Key not in self.objects, f"overwrite attempted: {Key}"
        self.objects[Key] = (Body, Metadata["sha256"])
        self.puts.append(Key)


@pytest.fixture
def fake_r2(monkeypatch):
    fake = FakeR2()
    monkeypatch.setattr(r2, "_client_and_bucket", lambda: (fake, "bucket"))
    return fake


@pytest.fixture
def pages(monkeypatch):
    sent: list = []
    from api.services import chart_health_alerts

    monkeypatch.setattr(chart_health_alerts, "emit",
                        lambda key, severity, message, metadata=None: sent.append((key, severity)) or True)
    return sent


def _reader(name, payload, *, data_as_of="2026-09-14", rows=None, gaps=None, meta=None, seen=None):
    @safe_reader(name, "test")
    def read(*, as_of=None, now_et=None, state=None, **_):
        if seen is not None:
            seen.append(dict(state or {}))
        value = payload() if callable(payload) else payload
        count = rows if rows is not None else (len(value) if isinstance(value, (list, dict)) else None)
        return result(name, as_of=data_as_of, source="test", rows=count, payload=value, gaps=gaps, meta=meta)

    return read


def _dataset(name, read, **kw):
    fields = dict(family=name, job_id=families.JOB_EOD, cadence="test", as_of_rule="test")
    fields.update(kw)
    return families.Dataset(name=name, read=read, **fields)


def _only(monkeypatch, *datasets):
    monkeypatch.setattr(families, "DATASETS", tuple(datasets))
    monkeypatch.setattr(families, "_BY_NAME", {d.name: d for d in datasets})


def _runs(dataset=None):
    with store.read() as conn:
        sql = "SELECT * FROM wisdom_capture_runs"
        params: tuple = ()
        if dataset:
            sql, params = sql + " WHERE dataset = ?", (dataset,)
        return [dict(r) for r in conn.execute(sql + " ORDER BY started_at, rowid", params)]


def _registry(dataset):
    with store.read() as conn:
        row = conn.execute("SELECT * FROM wisdom_capture_datasets WHERE dataset = ?", (dataset,)).fetchone()
    return dict(row) if row else None


# ── 1-2. layout and encoding ────────────────────────────────────────────────

def test_the_r2_key_layout():
    assert archive.object_key("2026-09-14", "wire") == "wisdom/context/2026-09-14/wire.json.gz"
    assert archive.object_key("2026-09-14", "detections", shard=7) == "wisdom/context/2026-09-14/detections-007.json.gz"
    assert (archive.object_key("2026-09-14", "wire", sha="abcdef0123456789")
            == "wisdom/context/2026-09-14/wire.abcdef012345.json.gz")
    for bad in (("20260914", "wire"), ("2026-09-14", "Wire"), ("2026-09-14", "../brain"), ("2026-09-14", "")):
        with pytest.raises(ValueError):
            archive.object_key(*bad)
    assert archive.PREFIX.startswith(r2.PREFIX)
    for ds in families.DATASETS:  # every registered dataset has a legal key
        assert archive.object_key("2026-09-14", ds.name).startswith("wisdom/context/2026-09-14/")


def test_the_encoding_is_byte_stable_and_streams_decode_to_the_same_object():
    obj = {"b": [1, 2], "a": {"z": 1, "y": "é"}}
    assert archive.encode(obj) == archive.encode(dict(reversed(list(obj.items()))))
    assert archive.decode(archive.encode(obj)) == obj

    def stream():
        s = archive.StreamedObject({"dataset": "x", "as_of": "2026-09-14"})
        for row in ({"id": 2}, {"id": 1}):
            s.add(row)
        return s.finish({"rows": 2})

    first, second = stream(), stream()
    assert first == second
    assert archive.decode(first) == {"dataset": "x", "as_of": "2026-09-14", "payload": [{"id": 2}, {"id": 1}], "rows": 2}


# ── 3. idempotency and versioning ───────────────────────────────────────────

def test_a_rerun_of_unchanged_data_is_idempotent_with_one_row_per_run(wisdom_db, fake_r2, pages, monkeypatch):
    _only(monkeypatch, _dataset("wire", _reader("wire", {"date": "2026-09-14", "k": 1})))
    first = runner.run_family("wire", now=NOW)
    second = runner.run_family("wire", now=NOW)
    assert (first["status"], first["created"], second["created"]) == ("ok", True, False)
    assert first["r2_key"] == second["r2_key"] == "wisdom/context/2026-09-14/wire.json.gz"
    assert fake_r2.puts == [first["r2_key"]]
    rows = _runs("wire")
    assert len(rows) == 2 and rows[0]["run_id"] != rows[1]["run_id"]
    assert {r["health"] for r in rows} == {"ok"} and pages == []


def test_a_changed_capture_of_the_same_as_of_is_versioned_never_overwritten(wisdom_db, fake_r2, pages, monkeypatch):
    value = {"n": 1}
    _only(monkeypatch, _dataset("wire", _reader("wire", lambda: dict(value))))
    first = runner.run_family("wire", now=NOW)
    value["n"] = 2
    second = runner.run_family("wire", now=NOW)
    assert first["r2_key"] == "wisdom/context/2026-09-14/wire.json.gz"
    assert second["r2_key"].startswith("wisdom/context/2026-09-14/wire.") and second["r2_key"] != first["r2_key"]
    assert second["versioned"] is True and len(fake_r2.objects) == 2
    assert archive.decode(fake_r2.objects[first["r2_key"]][0])["payload"] == {"n": 1}


def test_run_context_does_not_leak_into_the_archived_bytes(wisdom_db, fake_r2, monkeypatch):
    gaps = {"stale": "a", "source_note": "kept"}
    _only(monkeypatch, _dataset("wire", _reader("wire", {"k": 1}, gaps=gaps, meta={"stale_session": "2026-09-14"})))
    out = runner.run_family("wire", now=NOW, as_of="2026-09-14")
    body = archive.decode(fake_r2.objects[out["r2_key"]][0])
    assert body["gaps"] == {"source_note": "kept"} and "stale_session" not in body["meta"]
    assert "captured_at" not in body and body["schema"] == archive.SCHEMA


# ── 4. dry run ──────────────────────────────────────────────────────────────

def test_a_dry_run_writes_nothing_anywhere(wisdom_db, fake_r2, pages, monkeypatch):
    seen: list = []
    _only(monkeypatch, _dataset("detections", _reader("detections", [], seen=seen,
                                                      meta={"watermark_next": 123, "window_lo": 1,
                                                            "window_as_of": "2026-09-14"})))
    out = runner.run_family("detections", now=NOW, dry_run=True)
    assert out["dry_run"] is True and out["health"] == "zero" and out["r2_key"].endswith("detections.json.gz")
    assert out["bytes"] > 0 and out["paged"] is False
    assert fake_r2.puts == [] and _runs() == [] and _registry("detections") is None and pages == []
    # control: the same capture for real does write all three
    real = runner.run_family("detections", now=NOW)
    assert fake_r2.puts and _runs("detections") and _registry("detections")["watermark"] == 123
    assert real["paged"] is True and pages == [("wisdom_capture_p1:detections", "critical")]


# ── 5-6. health, paging, unreachable and failed runs ────────────────────────

def test_zero_on_a_trading_day_pages_and_a_holiday_does_not(wisdom_db, fake_r2, pages, monkeypatch):
    assert timeutil.is_trading_day(dt.date(2026, 9, 14))
    assert not timeutil.is_trading_day(dt.date(2026, 9, 7))  # Labor Day, in the holiday table
    _only(monkeypatch,
          _dataset("catalysts", _reader("catalysts", []), session_shaped=True),
          _dataset("holiday_ds", _reader("holiday_ds", [], data_as_of="2026-09-07"), session_shaped=True),
          _dataset("weekend_ds", _reader("weekend_ds", [], data_as_of="2026-09-12")),
          _dataset("tweets", _reader("tweets", []), pages=frozenset({"missing"})))
    zero = runner.run_family("catalysts", now=NOW)
    holiday = runner.run_family("holiday_ds", now=NOW)
    weekend = runner.run_family("weekend_ds", now=NOW)
    quiet = runner.run_family("tweets", now=NOW)
    assert (zero["health"], zero["paged"]) == ("zero", True)
    assert (holiday["status"], holiday["health"], holiday["r2_key"], holiday["paged"]) == (
        "skipped_holiday", "holiday", None, False)
    assert (weekend["health"], weekend["paged"]) == ("zero", False)
    assert (quiet["health"], quiet["paged"]) == ("zero", False)
    assert pages == [("wisdom_capture_p1:catalysts", "critical")]
    assert [r["status"] for r in _runs("holiday_ds")] == ["skipped_holiday"]


def test_an_unreadable_source_and_a_failed_write_each_leave_a_row(wisdom_db, pages, monkeypatch):
    _only(monkeypatch,
          _dataset("wire", _reader("wire", None, gaps={"wire_data": "gone"})),
          _dataset("gex", _reader("gex", None, gaps={"gex_not_on_web": "by design"}), pages=frozenset()),
          _dataset("rs", _reader("rs", {"AAA": {}})))

    def no_r2():
        raise r2.R2Unavailable("DATA_SYNC_* unset")

    monkeypatch.setattr(r2, "_client_and_bucket", no_r2)
    unreachable = runner.run_family("wire", now=NOW)
    known_gap = runner.run_family("gex", now=NOW)
    failed = runner.run_family("rs", now=NOW)
    assert (unreachable["status"], unreachable["health"], unreachable["paged"]) == ("unreachable", "missing", True)
    assert "wire_data: gone" in unreachable["error"]
    assert (known_gap["status"], known_gap["health"], known_gap["paged"]) == ("unreachable", "missing", False)
    assert (failed["status"], failed["health"]) == ("failed", "missing") and "R2Unavailable" in failed["error"]
    assert {r["dataset"]: r["status"] for r in _runs()} == {"wire": "unreachable", "gex": "unreachable", "rs": "failed"}
    assert sorted(k for k, _ in pages) == ["wisdom_capture_p1:rs", "wisdom_capture_p1:wire"]


def test_a_stale_source_is_recorded_against_the_session_it_failed(wisdom_db, fake_r2, pages, monkeypatch):
    _only(monkeypatch, _dataset("wire", _reader("wire", {"date": "2026-09-11"}, data_as_of="2026-09-11",
                                                gaps={"stale": "no push"},
                                                meta={"stale_session": "2026-09-14"}), session_shaped=True))
    out = runner.run_family("wire", now=NOW)
    assert (out["session_date"], out["status"], out["health"]) == ("2026-09-14", "unreachable", "missing")
    assert out["r2_key"] == "wisdom/context/2026-09-11/wire.json.gz" and out["paged"] is True


def test_classify_covers_every_state():
    c = health.classify
    assert c(status="skipped_holiday", row_count=None, median=None, samples=0, holiday=True) == "holiday"
    assert c(status="unreachable", row_count=5, median=None, samples=0, holiday=False) == "missing"
    assert c(status="failed", row_count=5, median=None, samples=0, holiday=False) == "missing"
    assert c(status="ok", row_count=0, median=100.0, samples=10, holiday=False) == "zero"
    assert c(status="ok", row_count=49, median=100.0, samples=10, holiday=False) == "low"
    assert c(status="ok", row_count=50, median=100.0, samples=10, holiday=False) == "ok"
    assert c(status="ok", row_count=1, median=100.0, samples=health.MIN_MEDIAN_SAMPLES - 1, holiday=False) == "ok"


def test_the_trailing_median_counts_only_ok_runs_on_trading_sessions(wisdom_db):
    trading, cur = [], dt.date(2026, 9, 13)
    while len(trading) < 11:
        if timeutil.is_trading_day(cur):
            trading.append(cur.isoformat())
        cur -= dt.timedelta(days=1)
    rows = [(s, "ok", 100) for s in trading[:10]] + [(trading[10], "ok", 5)]      # 11th session: too old
    rows += [("2026-09-07", "ok", 1), ("2026-09-12", "ok", 1), ("2026-09-13", "ok", 1)]  # holiday + weekend
    rows += [(trading[1], "failed", 0), (trading[2], "ok", 60)]                    # failed + a lower second run
    with store.write() as conn:
        for i, (session, status, n) in enumerate(rows):
            conn.execute("INSERT INTO wisdom_capture_runs (run_id, dataset, session_date, started_at, status, "
                         "row_count) VALUES (?, 'x', ?, '2026-09-14T00:00:00-04:00', ?, ?)", (f"r{i}", session, status, n))
    with store.read() as conn:
        # ten trading sessions of 100: the older 5, the holiday, the weekend and the failed run are all excluded
        assert health.trailing_median(conn, "x", "2026-09-14") == (100.0, 10)
        # before the 9th session only two samples remain (100 and the old 5): too few to call anything low
        assert health.trailing_median(conn, "x", trading[8]) == (52.5, 2)
        assert health.classify(status="ok", row_count=1, median=52.5, samples=2, holiday=False) == "ok"


# ── 7. watermark state ──────────────────────────────────────────────────────

def test_the_watermark_advances_only_on_success_and_a_rerun_reuses_its_window(wisdom_db, fake_r2, monkeypatch):
    seen: list = []

    @safe_reader("vision", "test")
    def read(*, as_of=None, now_et=None, state=None, **_):
        seen.append(dict(state or {}))
        day = dt.date(2026, 9, 14)
        lo, hi, gaps = watermark_window(state, day, 2000, first_window_s=1000)
        return result("vision", as_of=day, source="test", rows=1, payload=[{"lo": lo}], gaps=gaps,
                      meta={"window_lo": lo, "watermark_next": hi, "window_as_of": day.isoformat()})

    _only(monkeypatch, _dataset("vision", read))
    runner.run_family("vision", now=NOW)
    reg = _registry("vision")
    assert (reg["watermark"], reg["window_lo"], reg["window_as_of"]) == (2000, 1000, "2026-09-14")
    runner.run_family("vision", now=NOW)
    assert seen[1]["window_as_of"] == "2026-09-14" and seen[1]["window_lo"] == 1000

    def no_r2():
        raise r2.R2Unavailable("down")

    with store.write() as conn:
        conn.execute("UPDATE wisdom_capture_datasets SET watermark = 1500, window_as_of = NULL WHERE dataset = 'vision'")
    monkeypatch.setattr(r2, "_client_and_bucket", no_r2)
    failed = runner.run_family("vision", now=NOW)
    assert failed["status"] == "failed" and _registry("vision")["watermark"] == 1500


def test_hash_on_change_writes_no_object_for_an_unchanged_payload(wisdom_db, fake_r2, monkeypatch):
    days = iter(("2026-09-13", "2026-09-14", "2026-09-15"))
    payloads = iter(({"themes": [1]}, {"themes": [1]}, {"themes": [1, 2]}))

    @safe_reader("themes", "test")
    def read(**_):
        return result("themes", as_of=next(days), source="test", rows=1, payload=next(payloads))

    _only(monkeypatch, _dataset("themes", read, hash_on_change=True, job_id=families.JOB_THEMES))
    first, same, changed = (runner.run_family("themes", now=NOW) for _ in range(3))
    assert first["created"] is True and same["unchanged"] is True and same["r2_key"] == first["r2_key"]
    assert same["bytes"] == 0 and changed["r2_key"] == "wisdom/context/2026-09-15/themes.json.gz"
    assert len(fake_r2.objects) == 2


def test_a_stream_is_sharded_with_a_manifest(wisdom_db, fake_r2, tmp_path, monkeypatch):
    src = tmp_path / "rows.db"
    with sqlite3.connect(src) as conn:
        conn.execute("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)")
        conn.executemany("INSERT INTO t VALUES (?, ?)", [(i, f"v{i}") for i in range(5)])
    stream = RowStream(str(src), "SELECT id, v FROM t ORDER BY id", batch=2)
    _only(monkeypatch, _dataset("detections", _reader("detections", stream), shard_rows=2,
                                job_id=families.JOB_DETECTIONS))
    out = runner.run_family("detections", now=NOW)
    assert out["rows"] == 5 and out["shards"] == 3 and out["r2_key"] == "wisdom/context/2026-09-14/detections.json.gz"
    manifest = archive.decode(fake_r2.objects[out["r2_key"]][0])
    assert [s["rows"] for s in manifest["shards"]] == [2, 2, 1] and manifest["rows"] == 5
    assert [s["key"] for s in manifest["shards"]] == [
        f"wisdom/context/2026-09-14/detections-00{n}.json.gz" for n in (1, 2, 3)]
    third = archive.decode(fake_r2.objects[manifest["shards"][2]["key"]][0])
    assert third["payload"] == [{"id": 4, "v": "v4"}] and third["shard"] == 3 and third["rows"] == 1
    assert _runs("detections")[0]["row_count"] == 5


# ── 9. slots, the chain step, the health table ──────────────────────────────

def test_a_slot_runs_every_dataset_under_the_registry_run_id(wisdom_db, fake_r2, pages, monkeypatch):
    def boom(**_):
        raise RuntimeError("reader bug")

    _only(monkeypatch,
          _dataset("wire", boom),
          _dataset("rs", _reader("rs", {"AAA": {}})),
          _dataset("themes", _reader("themes", {"t": 1}), job_id=families.JOB_THEMES))
    out = registry.run_job(families.JOB_EOD, force=True, now=NOW)
    assert out["status"] == "ok", out
    assert [d["dataset"] for d in out["result"]["datasets"]] == ["wire", "rs"]
    captured = _runs()
    assert {r["dataset"] for r in captured} == {"wire", "rs"}
    assert {r["run_id"] for r in captured} == {out["run_id"]}
    assert {r["dataset"]: r["status"] for r in captured} == {"wire": "unreachable", "rs": "ok"}


def test_run_all_skips_what_was_captured_today_unless_forced(wisdom_db, fake_r2, monkeypatch):
    _only(monkeypatch, _dataset("wire", _reader("wire", {"k": 1})), _dataset("rs", _reader("rs", {"A": 1})))
    with store.write() as conn:
        conn.execute("INSERT INTO wisdom_capture_runs (run_id, dataset, session_date, started_at, status, row_count) "
                     "VALUES ('earlier', 'wire', '2026-09-14', ?, 'ok', 1)", (timeutil.iso_et(timeutil.now_et()),))
    ctx = registry.JobContext(job_id="wisdom_daily_chain", now_et=timeutil.now_et(), due_key=None, force=False,
                              dry_run=False, run_id="chain-1")
    out = runner.run_all(ctx)
    assert out["already_captured_today"] == ["wire"] and [d["dataset"] for d in out["datasets"]] == ["rs"]
    ctx.force, ctx.run_id = True, "chain-2"
    forced = runner.run_all(ctx)
    assert [d["dataset"] for d in forced["datasets"]] == ["wire", "rs"]


def test_the_health_table_has_n_beside_every_count(wisdom_db, fake_r2, monkeypatch):
    _only(monkeypatch, _dataset("wire", _reader("wire", {"k": 1})), _dataset("gex", _reader("gex", None), pages=frozenset()))
    runner.run_family("wire", now=NOW)
    runner.run_family("wire", now=NOW)
    with store.read() as conn:
        table = {t["dataset"]: t for t in health.health_table(conn, days=10)}
    assert table["wire"]["n"] == 1 and table["wire"]["health_counts"]["ok"] == 1
    assert table["gex"]["n"] == 0 and table["gex"]["latest"] is None and table["gex"]["pages_on"] == []


def test_unknown_datasets_and_broken_state_never_raise(wisdom_db, monkeypatch):
    assert runner.run_family("not_a_dataset")["status"] == "unknown_dataset"
    monkeypatch.setenv("WISDOM_DB_PATH", str(wisdom_db.parent / "missing_dir" / "x" / "no_tables.db"))
    _only(monkeypatch, _dataset("rs", _reader("rs", None)))
    out = runner.run_family("rs", now=NOW)
    assert out["status"] == "unreachable" and "registry_state" in out["gaps"] and out.get("record_error")
