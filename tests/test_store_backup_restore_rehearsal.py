"""TERM-083 (FB-X1-02) — the generalised store backup rail, and the restore REHEARSAL.

"A backup nobody has restored is not a backup." These rails prove the round trip on a
SYNTHETIC store only: backup (the rail's own snapshot) -> gzip -> object store (a fake) ->
download -> restore into a scratch file -> compare against the manifest written at backup
time (schema, per-table row counts, journal mode). Nothing here touches R2, the shared data
root or a real database; every clock is injected.

⛔ The fixture is a WAL store with UN-CHECKPOINTED writes held open by a live writer, and
`test_the_fixture_can_tell_a_raw_file_copy_from_a_backup` proves it: a raw copy of the main
file loses those rows. Without that control the WAL rails below could pass on a fixture that
cannot distinguish the two (lesson_a_fixture_that_cannot_distinguish_is_not_a_rail).
"""
from __future__ import annotations

import datetime as dt
import gzip
import io
import json
import shutil
import sqlite3
from pathlib import Path

import pytest

from api.services import store_backup as sb
from tools import store_restore as sr

NOW = dt.datetime(2026, 9, 27, 7, 5, 0, tzinfo=dt.timezone.utc)
ROWS = {"posts": 40, "replies": 7, "reactions": 0}


# ── the synthetic store ──────────────────────────────────────────────────────
def _wal_store(path: Path) -> sqlite3.Connection:
    """A WAL store whose rows live ONLY in the -wal file until the returned writer closes.

    autocheckpoint is off and the writer stays open, so nothing is folded back into the
    main file: exactly the state a live web process leaves community.db in between
    checkpoints."""
    w = sqlite3.connect(str(path))
    assert w.execute("PRAGMA journal_mode=WAL").fetchone()[0] == "wal"
    w.execute("PRAGMA wal_autocheckpoint=0")
    w.execute("CREATE TABLE posts (id INTEGER PRIMARY KEY AUTOINCREMENT, body TEXT NOT NULL)")
    w.execute("CREATE TABLE replies (id INTEGER PRIMARY KEY, post_id INTEGER REFERENCES posts(id), body TEXT)")
    w.execute("CREATE TABLE reactions (post_id INTEGER, emoji TEXT)")
    w.execute("CREATE INDEX idx_replies_post ON replies(post_id)")
    w.executemany("INSERT INTO posts (body) VALUES (?)", [(f"post {i}",) for i in range(ROWS["posts"])])
    w.executemany("INSERT INTO replies (post_id, body) VALUES (?, ?)", [(1, f"r{i}") for i in range(ROWS["replies"])])
    w.commit()
    return w


class FakeR2:
    """An in-memory object store with the four boto3 calls the rail uses."""

    def __init__(self):
        self.objects: dict[str, bytes] = {}
        self.deleted: list[str] = []

    def upload_file(self, path, bucket, key, ExtraArgs=None):
        self.objects[key] = Path(path).read_bytes()

    def download_file(self, bucket, key, dest):
        if key not in self.objects:
            raise FileNotFoundError(key)
        Path(dest).write_bytes(self.objects[key])

    def list_objects_v2(self, Bucket=None, Prefix="", ContinuationToken=None):
        keys = sorted(k for k in self.objects if k.startswith(Prefix))
        return {"Contents": [{"Key": k, "Size": len(self.objects[k])} for k in keys], "IsTruncated": False}

    def delete_object(self, Bucket=None, Key=None):
        self.deleted.append(Key)
        self.objects.pop(Key, None)


def _backup(tmp_path: Path, r2: FakeR2, name="community", now=NOW):
    src = tmp_path / f"{name}.db"
    writer = _wal_store(src)
    try:
        res = sb.backup_store(name, str(src), r2, "bucket", now=now)
    finally:
        writer.close()
    return res


# ── the control: the fixture can distinguish a raw copy from a backup ───────
def test_the_fixture_can_tell_a_raw_file_copy_from_a_backup(tmp_path):
    src = tmp_path / "community.db"
    writer = _wal_store(src)
    try:
        assert (tmp_path / "community.db-wal").stat().st_size > 0
        raw = tmp_path / "raw.db"
        shutil.copyfile(src, raw)
        c = sqlite3.connect(str(raw))
        try:
            tables = {r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        finally:
            c.close()
        # The raw copy of a WAL store with un-checkpointed writes does not even hold the schema.
        assert "posts" not in tables
    finally:
        writer.close()


# ── the round trip ───────────────────────────────────────────────────────────
def test_a_backup_round_trips_through_the_object_store_into_a_scratch_restore(tmp_path):
    r2 = FakeR2()
    res = _backup(tmp_path, r2)
    assert res["status"] == "ok", res
    assert res["key"] == "store_backups/community/20260927T070500Z.db.gz"
    assert sb.manifest_key(res["key"]) in r2.objects

    work = tmp_path / "work"
    work.mkdir()
    report = sr.rehearse_stores(r2, "bucket", now=NOW, work=work, stores=["community"])
    one = report["stores"]["community"]
    assert one["verdict"] == "PASS", one
    assert report["verdict"] == sr.PASS
    # Independent of the manifest: the counts the fixture WROTE, WAL-resident rows included.
    assert one["restored"]["tables"]["posts"] == ROWS["posts"]
    assert one["restored"]["tables"]["replies"] == ROWS["replies"]
    assert one["restored"]["tables"]["reactions"] == ROWS["reactions"]
    assert one["restored"]["integrity"] == "ok"


def test_the_manifest_records_the_source_as_the_backup_saw_it(tmp_path):
    r2 = FakeR2()
    res = _backup(tmp_path, r2)
    manifest = json.loads(r2.objects[sb.manifest_key(res["key"])])
    assert manifest["store"] == "community"
    assert manifest["taken_at"] == "2026-09-27T07:05:00+00:00"
    assert manifest["journal_mode"] == "wal"
    assert manifest["tables"]["posts"] == ROWS["posts"]
    # sqlite_sequence is member state too (AUTOINCREMENT counters) and must come back.
    assert "sqlite_sequence" in manifest["tables"]
    assert len(manifest["schema_sha256"]) == 64


def test_the_restored_copy_keeps_wal_mode_and_leaves_no_journal_files(tmp_path):
    r2 = FakeR2()
    res = _backup(tmp_path, r2)
    gz = tmp_path / "b.db.gz"
    gz.write_bytes(r2.objects[res["key"]])
    dest = tmp_path / "restore" / "community.db"
    dest.parent.mkdir()
    out = sr.restore_file(gz, dest, now=NOW)
    assert out["restored_to"] == str(dest)
    c = sqlite3.connect(str(dest))
    try:
        assert c.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
        assert c.execute("SELECT COUNT(*) FROM posts").fetchone()[0] == ROWS["posts"]
    finally:
        c.close()
    assert not Path(str(dest) + ".restoring").exists()


def test_local_round_trip_passes_on_a_hot_wal_store(tmp_path):
    src = tmp_path / "community.db"
    writer = _wal_store(src)
    try:
        work = tmp_path / "work"
        work.mkdir()
        out = sr.round_trip(src, work, now=NOW)
    finally:
        writer.close()
    assert out["verdict"] == "PASS", out
    assert out["restored"]["tables"]["posts"] == ROWS["posts"]


def test_a_write_landing_between_the_count_and_the_copy_does_not_split_them(tmp_path, monkeypatch):
    """The manifest and the copied pages are ONE point in time: a commit that lands after the
    counts were taken is in neither. Without the held read transaction the backup would copy
    41 posts against a manifest of 40, and the rehearsal would fail a healthy backup."""
    src = tmp_path / "community.db"
    writer = _wal_store(src)
    real_measure = sb.measure
    wrote = []

    def measure_then_write(conn):
        out = real_measure(conn)
        if not wrote:
            writer.execute("INSERT INTO posts (body) VALUES ('landed after the count')")
            writer.commit()
            wrote.append(True)
        return out

    monkeypatch.setattr(sb, "measure", measure_then_write)
    try:
        work = tmp_path / "work"
        work.mkdir()
        out = sr.round_trip(src, work, now=NOW)
    finally:
        writer.close()
    assert wrote, "the interleaved write never happened, so this test proved nothing"
    assert out["verdict"] == "PASS", out
    assert out["restored"]["tables"]["posts"] == ROWS["posts"]


# ── the rehearsal goes red on a broken backup ────────────────────────────────
def _tamper(r2: FakeR2, key: str, tmp_path: Path, sql: str) -> None:
    """Rewrite the stored backup object with `sql` applied — a backup that lost something."""
    db = tmp_path / "tamper.db"
    with gzip.open(io.BytesIO(r2.objects[key])) as f_in:
        db.write_bytes(f_in.read())
    c = sqlite3.connect(str(db))
    c.executescript(sql)
    c.close()
    buf = io.BytesIO()
    with gzip.GzipFile(fileobj=buf, mode="wb") as f_out:
        f_out.write(db.read_bytes())
    r2.objects[key] = buf.getvalue()


def test_a_backup_missing_a_table_fails_the_rehearsal_by_name(tmp_path):
    r2 = FakeR2()
    res = _backup(tmp_path, r2)
    _tamper(r2, res["key"], tmp_path, "DROP TABLE reactions;")
    work = tmp_path / "work"
    work.mkdir()
    report = sr.rehearse_stores(r2, "bucket", now=NOW, work=work, stores=["community"])
    one = report["stores"]["community"]
    assert one["verdict"] == "FAIL"
    assert report["verdict"] == sr.FAIL
    assert any("missing tables: reactions" in r for r in one["reasons"]), one["reasons"]


def test_a_backup_missing_rows_fails_the_rehearsal_by_table(tmp_path):
    r2 = FakeR2()
    res = _backup(tmp_path, r2)
    _tamper(r2, res["key"], tmp_path, "DELETE FROM posts WHERE id > 30;")
    work = tmp_path / "work"
    work.mkdir()
    one = sr.rehearse_stores(r2, "bucket", now=NOW, work=work, stores=["community"])["stores"]["community"]
    assert one["verdict"] == "FAIL"
    assert any("posts: backup had 40, restore has 30" in r for r in one["reasons"]), one["reasons"]


def test_a_backup_with_no_manifest_is_inconclusive_never_a_pass(tmp_path):
    r2 = FakeR2()
    res = _backup(tmp_path, r2)
    del r2.objects[sb.manifest_key(res["key"])]
    work = tmp_path / "work"
    work.mkdir()
    report = sr.rehearse_stores(r2, "bucket", now=NOW, work=work, stores=["community"])
    assert report["stores"]["community"]["verdict"] == "INCONCLUSIVE"
    assert report["verdict"] == sr.INCONCLUSIVE


def test_a_corrupt_object_fails(tmp_path):
    r2 = FakeR2()
    res = _backup(tmp_path, r2)
    r2.objects[res["key"]] = b"not gzip"
    work = tmp_path / "work"
    work.mkdir()
    one = sr.rehearse_stores(r2, "bucket", now=NOW, work=work, stores=["community"])["stores"]["community"]
    assert one["verdict"] == "FAIL"


def test_a_stale_newest_backup_fails_the_rehearsal(tmp_path):
    r2 = FakeR2()
    _backup(tmp_path, r2, now=NOW - dt.timedelta(days=4))
    work = tmp_path / "work"
    work.mkdir()
    one = sr.rehearse_stores(r2, "bucket", now=NOW, work=work, stores=["community"])["stores"]["community"]
    assert one["verdict"] == "FAIL"
    assert any("old" in r for r in one["reasons"]), one["reasons"]


def test_an_empty_bucket_is_inconclusive_and_no_credentials_is_inconclusive(tmp_path):
    work = tmp_path / "work"
    work.mkdir()
    assert sr.rehearse_stores(FakeR2(), "bucket", now=NOW, work=work, stores=["community"])["verdict"] == sr.INCONCLUSIVE
    assert sr.rehearse_stores(None, None, now=NOW, work=work, stores=["community"])["verdict"] == sr.INCONCLUSIVE


# ── the artefact-first staleness check: NAMES, not counts ───────────────────
def test_stale_names_every_store_with_no_fresh_object(tmp_path):
    r2 = FakeR2()
    _backup(tmp_path, r2, name="community", now=NOW)
    _backup(tmp_path, r2, name="modelbook", now=NOW - dt.timedelta(days=5))
    named = dict(sb.stale_stores(r2, "bucket", now=NOW, max_age_hours=48, stores=["community", "modelbook", "education"]))
    assert "community" not in named
    assert named["modelbook"].startswith("newest backup is 120.0h old")
    assert named["education"] == "no backup object"


# ── the backup rail itself ───────────────────────────────────────────────────
def test_an_absent_store_is_reported_and_never_created(tmp_path):
    missing = tmp_path / "never.db"
    res = sb.backup_store("community", str(missing), FakeR2(), "bucket", now=NOW)
    assert res["status"] == "absent"
    assert not missing.exists()


def test_prune_keeps_the_newest_n_and_removes_each_pruned_manifest_with_it(tmp_path):
    r2 = FakeR2()
    for d in range(4):
        sub = tmp_path / f"d{d}"
        sub.mkdir()
        _backup(sub, r2, now=NOW - dt.timedelta(days=d))
    deleted = sb.prune(r2, "bucket", "community", keep=2)
    assert len(deleted) == 4  # two db objects + their two manifests
    left = sorted(k for k in r2.objects if k.startswith("store_backups/community/"))
    assert left == [
        "store_backups/community/20260926T070500Z.db.gz",
        "store_backups/community/20260926T070500Z.manifest.json",
        "store_backups/community/20260927T070500Z.db.gz",
        "store_backups/community/20260927T070500Z.manifest.json",
    ]


def test_run_backup_is_dark_until_the_flag_is_set(tmp_path, monkeypatch):
    monkeypatch.delenv(sb.ENABLED_ENV, raising=False)
    assert sb.run_backup(now=NOW, client=FakeR2(), bucket="bucket") is None


def test_run_backup_contains_one_stores_failure(tmp_path, monkeypatch):
    monkeypatch.setenv(sb.ENABLED_ENV, "1")
    src = tmp_path / "community.db"
    writer = _wal_store(src)
    garbage = tmp_path / "modelbook.db"
    garbage.write_bytes(b"not a database" * 100)
    paths = {"community": str(src), "modelbook": str(garbage)}
    monkeypatch.setattr(sb, "resolve_path", lambda name: paths[name])
    try:
        out = sb.run_backup(now=NOW, client=FakeR2(), bucket="bucket", stores=["community", "modelbook"])
    finally:
        writer.close()
    assert out["community"]["status"] == "ok"
    assert out["modelbook"]["status"] == "error"


class _FakeScheduler:
    def __init__(self):
        self.jobs = []

    def add_job(self, fn, trigger=None, **kw):
        self.jobs.append((fn, trigger, kw))


def test_register_jobs_registers_nothing_while_dark_and_one_nightly_job_when_armed(monkeypatch):
    monkeypatch.delenv(sb.ENABLED_ENV, raising=False)
    s = _FakeScheduler()
    assert sb.register_jobs(s) is False and s.jobs == []
    monkeypatch.setenv(sb.ENABLED_ENV, "1")
    assert sb.register_jobs(s) is True
    assert [kw["id"] for _, _, kw in s.jobs] == ["store_backup_nightly"]


# ── the registry ─────────────────────────────────────────────────────────────
def test_every_registered_store_resolves_through_its_own_module():
    """The path is read from the owning module, never restated here, so a moved store
    moves its backup with it. Non-vacuity: the five stores the spec names are all in."""
    names = [s.name for s in sb.STORES]
    assert len(names) == len(set(names))
    for spec_named in ("community", "modelbook", "charts_layouts", "user_definitions", "education"):
        assert spec_named in names
    for s in sb.STORES:
        assert sb.resolve_path(s.name).endswith(".db"), s.name
        assert s.klass in sb.CLASSES


def test_stores_another_rail_backs_up_are_not_registered_twice():
    names = {s.name for s in sb.STORES}
    assert set(sb.COVERED_ELSEWHERE) == {"auth", "flow"}
    assert not names & set(sb.COVERED_ELSEWHERE)


def test_the_real_restore_refuses_to_overwrite_without_replace_and_moves_aside_never_deletes(tmp_path):
    r2 = FakeR2()
    res = _backup(tmp_path, r2)
    gz = tmp_path / "b.db.gz"
    gz.write_bytes(r2.objects[res["key"]])
    live = tmp_path / "live"
    live.mkdir()
    dest = live / "community.db"
    dest.write_bytes(b"old main")
    Path(str(dest) + "-wal").write_bytes(b"old wal")
    with pytest.raises(sr.RestoreRefused, match="exists"):
        sr.restore_file(gz, dest, now=NOW)
    assert dest.read_bytes() == b"old main"
    out = sr.restore_file(gz, dest, now=NOW, replace=True)
    aside = Path(out["moved_aside"][0])
    assert aside.read_bytes() == b"old main"
    assert Path(str(aside) + "-wal").read_bytes() == b"old wal"
    # ⛔ A stale -wal left beside a restored main file would be replayed onto it.
    assert not Path(str(dest) + "-wal").exists()
    c = sqlite3.connect(str(dest))
    try:
        assert c.execute("SELECT COUNT(*) FROM posts").fetchone()[0] == ROWS["posts"]
    finally:
        c.close()


def test_a_stale_wal_beside_an_absent_main_file_is_refused(tmp_path):
    r2 = FakeR2()
    res = _backup(tmp_path, r2)
    gz = tmp_path / "b.db.gz"
    gz.write_bytes(r2.objects[res["key"]])
    live = tmp_path / "live"
    live.mkdir()
    dest = live / "community.db"
    Path(str(dest) + "-wal").write_bytes(b"orphan wal")
    with pytest.raises(sr.RestoreRefused, match="-wal"):
        sr.restore_file(gz, dest, now=NOW)


def test_the_rehearsal_refuses_a_work_directory_under_the_shared_data_root():
    with pytest.raises(SystemExit, match="shared data root"):
        sr.refuse_shared_root(Path("C:/data/rehearsal"))
