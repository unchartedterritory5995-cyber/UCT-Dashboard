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
        self.puts: list = []      # canonical keys only — the keys a consumer reads
        self.staged: list = []    # wisdom/staging/<sha>/… — the disposable half

    def head_object(self, Bucket, Key):
        if Key not in self.objects:
            from botocore.exceptions import ClientError

            raise ClientError({"Error": {"Code": "404"}}, "HeadObject")
        body, sha = self.objects[Key]
        return {"Metadata": {"sha256": sha}, "ContentLength": len(body)}

    def put_object(self, Bucket, Key, Body, ContentType, Metadata):
        assert Key not in self.objects, f"overwrite attempted: {Key}"
        self.objects[Key] = (Body, Metadata["sha256"])
        (self.staged if Key.startswith(r2.STAGING_PREFIX) else self.puts).append(Key)

    def copy_object(self, Bucket, Key, CopySource):
        """put_verified stages under wisdom/staging/<sha>/ and copies to the canonical key
        (CONTRACTS §8c.1.3). A fake without this models a product that no longer exists."""
        assert Key not in self.objects, f"overwrite attempted: {Key}"
        self.objects[Key] = self.objects[CopySource["Key"]]
        self.puts.append(Key)

    @property
    def canonical(self) -> dict:
        """Everything outside wisdom/staging/ — what a consumer can actually find."""
        return {k: v for k, v in self.objects.items() if not k.startswith(r2.STAGING_PREFIX)}


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
    assert second["versioned"] is True and len(fake_r2.canonical) == 2
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
    _only(monkeypatch, _dataset("detections", _reader("detections", [{"d": 1}], seen=seen,
                                                      meta={"watermark_next": 123, "window_lo": 1,
                                                            "window_as_of": "2026-09-14"})))
    out = runner.run_family("detections", now=NOW, dry_run=True)
    assert out["dry_run"] is True and out["r2_key"].endswith("detections.json.gz")
    assert out["bytes"] > 0 and out["paged"] is False
    assert fake_r2.puts == [] and fake_r2.staged == [] and _runs() == []
    assert _registry("detections") is None and pages == []
    # control: the same capture for real writes the object, the run row AND the watermark
    runner.run_family("detections", now=NOW)
    assert fake_r2.puts and _runs("detections") and _registry("detections")["watermark"] == 123


def test_a_zero_row_capture_writes_no_object_and_moves_no_watermark(wisdom_db, fake_r2, pages, monkeypatch):
    """The S-A capture-run finding, planted (CONTRACTS §8c.1.2 + §8c.1.3).

    ⚰️ THIS TEST'S PREDECESSOR ASSERTED THE DEFECT. `test_a_dry_run_writes_nothing_anywhere`
    used a ZERO-row reader and its control asserted that the same capture "for real" wrote an
    object and set `watermark == 123` — which is precisely what the owner's ruling forbids, so
    the rail that was supposed to protect this path was pinning the bug in place. A test
    asserting a defect reads exactly like coverage, which is why review did not catch it.

    Both halves are load-bearing and they fail for different reasons:
      * NO OBJECT — an empty capture on an immutable key is permanent (this module has no
        delete path), and it exiles the later genuine backfill to a sha-suffixed key.
        ⛔ `put_verified`'s empty-BYTES guard cannot see this one: `{"payload": [], "rows": 0}`
        gzips to plenty of bytes. The refusal has to be at the runner.
      * NO WATERMARK — a watermark past an empty window makes every later run read `lo >= hi`,
        capture nothing, and page forever, with no repair route.
    """
    _only(monkeypatch, _dataset("detections", _reader("detections", [],
                                                      meta={"watermark_next": 123, "window_lo": 1,
                                                            "window_as_of": "2026-09-14"})))
    out = runner.run_family("detections", now=NOW)

    assert out["status"] == "ok" and out["health"] == "zero"
    assert out["r2_key"] is None and "empty_not_archived" in out["gaps"]
    assert fake_r2.objects == {}, "nothing was written — not the canonical key, not staging"

    reg = _registry("detections")
    assert reg is not None and _runs("detections"), "the run is still RECORDED: we looked, and found nothing"
    assert reg["watermark"] is None and reg["last_r2_key"] is None and reg["last_as_of"] is None

    # ⭐ The withheld object is the only thing withheld — the page still fires, because a
    # silent empty capture is the failure mode that lets a dataset die unnoticed.
    assert out["paged"] is True and pages == [("wisdom_capture_p1:detections", "critical")]


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
    reg = _registry("wire")
    assert reg is not None and reg["last_r2_key"] is None and reg["last_as_of"] is None, \
        "a stale run must not record itself as the dataset's latest good capture"


def test_rows_that_exist_on_a_holiday_are_archived_and_still_read_holiday(wisdom_db, fake_r2, pages, monkeypatch):
    _only(monkeypatch, _dataset("catalysts", _reader("catalysts", [{"ticker": "AAA"}], data_as_of="2026-09-07"),
                                session_shaped=True))
    out = runner.run_family("catalysts", now=NOW)
    assert (out["status"], out["health"], out["paged"]) == ("ok", "holiday", False)
    assert out["r2_key"] == "wisdom/context/2026-09-07/catalysts.json.gz" and fake_r2.puts == [out["r2_key"]]


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
    # distinct counts, so dropping ANY exclusion moves the median: trading sessions 100, 90, ... 10 newest-first
    rows = [(s, "ok", 100 - 10 * i) for i, s in enumerate(trading[:10])] + [(trading[10], "ok", 5)]  # 11th: too old
    rows += [("2026-09-07", "ok", 1000), ("2026-09-12", "ok", 1000), ("2026-09-13", "ok", 1000)]  # holiday + weekend
    rows += [(trading[1], "failed", 5000), (trading[2], "ok", 1)]                  # failed + a lower second run
    with store.write() as conn:
        for i, (session, status, n) in enumerate(rows):
            conn.execute("INSERT INTO wisdom_capture_runs (run_id, dataset, session_date, started_at, status, "
                         "row_count) VALUES (?, 'x', ?, '2026-09-14T00:00:00-04:00', ?, ?)", (f"r{i}", session, status, n))
    with store.read() as conn:
        # median of 10..100 = 55: the older 5, the holiday and weekend 1000s and the failed 5000 are all excluded
        # (without the trading-session filter the 1000s enter and the median reads 85)
        assert health.trailing_median(conn, "x", "2026-09-14") == (55.0, 10)
        # before the 9th session only two samples remain (10 and the old 5): too few to call anything low
        assert health.trailing_median(conn, "x", trading[8]) == (7.5, 2)
        assert health.classify(status="ok", row_count=1, median=7.5, samples=2, holiday=False) == "ok"


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
    assert len(fake_r2.canonical) == 2


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


def test_a_backfill_of_an_older_day_never_walks_the_current_pointer_back(wisdom_db, fake_r2, monkeypatch):
    """F3 (CONTRACTS §8c.1.2): `last_as_of` / `last_r2_key` are ORDERED, like the watermark.

    ⚰️ The pointer UPDATE was unconditional while the watermark four lines below it was
    monotonic — and EVERY legitimate backfill takes this path (`capture_result` → `_run_one`
    → `_record`; `backfill.catalysts_history`, `vision_history`, `detections_retention` and
    `x_posts` all route through it), so backfilling March walked the pointer back to March.

    ⭐ Severity comes from hash_on_change: most canonical keys for such a dataset do not
    exist, so `last_r2_key` is the ONLY way a consumer finds the CURRENT object. A
    backfilled pointer hands S-D/S-E/S-F a months-old taxonomy with nothing on it to say so
    — the worst shape of wrong, because it reads as fresh.
    """
    days = iter(("2026-09-14", "2026-03-02"))
    payloads = iter(({"themes": ["today"]}, {"themes": ["march"]}))

    @safe_reader("themes", "test")
    def read(**_):
        return result("themes", as_of=next(days), source="test", rows=1, payload=next(payloads))

    _only(monkeypatch, _dataset("themes", read, hash_on_change=True, job_id=families.JOB_THEMES))
    today = runner.run_family("themes", now=NOW)
    sha_after_today = _registry("themes")["last_sha256"]
    backfill = runner.run_family("themes", now=NOW)      # the same reader, now yielding March

    assert today["r2_key"] == "wisdom/context/2026-09-14/themes.json.gz"
    assert backfill["r2_key"] == "wisdom/context/2026-03-02/themes.json.gz"
    assert backfill["created"] is True, "the older day IS archived — only the POINTER is ordered"

    reg = _registry("themes")
    assert reg["last_as_of"] == "2026-09-14" and reg["last_r2_key"] == today["r2_key"]
    assert reg["last_sha256"] == sha_after_today, "a backfilled sha must not shadow the current one"


def test_an_object_that_does_not_read_back_moves_no_watermark(wisdom_db, fake_r2, pages, monkeypatch):
    """CONTRACTS §8c.1.2 — "only on a write whose object passed a non-empty + CHECKSUM check".

    `status == "ok"` was the whole condition. It is not proof: it says the reader returned
    and the put did not raise, neither of which is "the bytes are readable back at the
    canonical key". Here the bucket accepts the write and then reports a different digest —
    a silent-corruption shape — and the run must fail closed rather than stamp a watermark
    over a window whose object nobody can trust.
    """
    real_head = fake_r2.head_object

    def lying_head(Bucket, Key):
        head = real_head(Bucket=Bucket, Key=Key)
        if not Key.startswith(r2.STAGING_PREFIX):          # staging verifies; the canonical copy does not
            head = {**head, "Metadata": {"sha256": "0" * 64}}
        return head

    monkeypatch.setattr(fake_r2, "head_object", lying_head)
    _only(monkeypatch, _dataset("detections", _reader("detections", [{"d": 1}],
                                                      meta={"watermark_next": 123, "window_lo": 1,
                                                            "window_as_of": "2026-09-14"})))
    out = runner.run_family("detections", now=NOW)

    assert out["status"] == "failed" and "R2VerificationFailed" in (out["error"] or "")
    reg = _registry("detections")
    assert reg["watermark"] is None and reg["last_r2_key"] is None

    # CONTROL: the same capture against an honest bucket advances everything, so the
    # assertion above is about the checksum and not about the fixture being inert.
    monkeypatch.setattr(fake_r2, "head_object", real_head)
    fake_r2.objects.clear()
    good = runner.run_family("detections", now=NOW)
    assert good["status"] == "ok" and _registry("detections")["watermark"] == 123


def test_an_archive_that_did_not_verify_moves_no_watermark_even_when_the_run_reads_ok(
        wisdom_db, fake_r2, pages, monkeypatch):
    """The §8c.1.2 invariant AT ITS DECISION POINT, not via a path that short-circuits first.

    ⚰️ THE MUTATION HARNESS CAUGHT THIS AND REVIEW DID NOT. Replacing
    `if nxt is not None and _advanceable(...)` with `if nxt is not None` left all 38 tests
    GREEN, because every other rail reaches the watermark through a guard that fires
    earlier: a zero-row capture leaves `arch is None`, and a failed checksum leaves
    `status == "failed"` — so `_advanceable` was doing nothing any test could see.

    ⭐ That is not an argument for deleting it. It is the reachable case: `put_versioned`
    accepts a `putter`, so any archive path that did NOT go through `put_verified` returns a
    result with no `verified` key — and a watermark must not move past a write nobody
    checked. Leaving the invariant implicit in two unrelated short-circuits is exactly how
    it comes back: change either one and the watermark is silently unguarded again.
    """
    unverified = {"key": "wisdom/context/2026-09-14/detections.json.gz", "sha256": "a" * 64,
                  "bytes": 10, "created": True, "rows": 3}          # note: no "verified"
    monkeypatch.setattr(runner, "_archive", lambda ds, out, **kw: dict(unverified))
    _only(monkeypatch, _dataset("detections", _reader("detections", [{"d": 1}], rows=3,
                                                      meta={"watermark_next": 123, "window_lo": 1,
                                                            "window_as_of": "2026-09-14"})))
    out = runner.run_family("detections", now=NOW)
    assert out["status"] == "ok" and out["r2_key"] == unverified["key"], "the run itself reads fine"
    assert _registry("detections")["watermark"] is None, "an unverified write moved the watermark"

    # CONTROL: the SAME result with verified:True advances — so the assertion above is
    # about the checksum flag and not about the fixture being inert in some other way.
    monkeypatch.setattr(runner, "_archive", lambda ds, out, **kw: {**unverified, "verified": True})
    runner.run_family("detections", now=NOW)
    assert _registry("detections")["watermark"] == 123
